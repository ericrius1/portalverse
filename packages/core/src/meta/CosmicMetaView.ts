import * as THREE from 'three/webgpu';
import type { AvatarState, WorldManifest } from '../types';
import {
  COSMIC_CONSTELLATIONS,
  SNOWGLOBE_RADIUS,
  computeSnowglobeLayout,
  getConstellationBasis,
  projectConstellationPoint,
  type ConstellationSpec,
  type SnowglobePlacement,
} from './constellations';
import {
  createCosmicSkyMaterial,
  createConstellationArtTexture,
  createNebulaWispMaterial,
  createSnowglobeGlassMaterial,
  createSnowglobeLabelTexture,
  createStarSpriteTexture,
  type SnowglobeGlassHandle,
} from './cosmicShaders';
import {
  DIORAMA_GROUND_Y,
  buildSnowglobeDiorama,
  type SnowglobeDiorama,
} from './snowglobeDioramas';

export type MetaViewFocus =
  | { kind: 'overview' }
  | { kind: 'world'; world: WorldManifest; playerCount: number; players: AvatarState[] }
  | { kind: 'constellation'; constellation: ConstellationSpec };

export interface CosmicMetaViewCallbacks {
  onFocusChange?: (focus: MetaViewFocus) => void;
  onEnterWorld?: (worldId: string) => void;
  onHoverChange?: (label: string | null) => void;
}

export interface CosmicMetaViewOptions {
  worlds: readonly WorldManifest[];
  activeWorldId: string;
  isMobile?: boolean;
  callbacks?: CosmicMetaViewCallbacks;
}

interface FlakeParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  size: number;
}

interface SnowglobeEntry {
  placement: SnowglobePlacement;
  root: THREE.Group;
  hitMesh: THREE.Mesh;
  glass: SnowglobeGlassHandle;
  bezelGlowMat: THREE.MeshStandardMaterial;
  activeHalo: THREE.Group;
  diorama: SnowglobeDiorama;
  labelSprite: THREE.Sprite;
  labelTexture: THREE.Texture;
  labelMat: THREE.SpriteMaterial;
  flakesMesh: THREE.InstancedMesh;
  flakes: FlakeParticle[];
  shakeEnergy: number;
  hoverAmount: number;
  selectedAmount: number;
  explorerGroup: THREE.Group;
  explorerMeshes: THREE.Mesh[];
  explorerMats: THREE.MeshBasicMaterial[];
  players: AvatarState[];
}

interface ConstellationEntry {
  spec: ConstellationSpec;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  artMesh: THREE.Mesh;
  artMat: THREE.MeshBasicMaterial;
  artTex: THREE.Texture;
  lineMat: THREE.MeshBasicMaterial;
  starSprites: Array<{ sprite: THREE.Sprite; baseScale: number; phase: number }>;
  highlight: number;
}

interface ShootingStar {
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  origin: THREE.Vector3;
  dir: THREE.Vector3;
  age: number;
  duration: number;
  cooldown: number;
  speed: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

const DEG2RAD = Math.PI / 180;
const FLURRY_MAX_R = SNOWGLOBE_RADIUS - 0.34;
const FLURRY_MIN_Y = DIORAMA_GROUND_Y + 0.14;
const FLURRY_MAX_Y = SNOWGLOBE_RADIUS - 0.36;

/**
 * Full-screen WebGPU 3D Cosmic Snowglobe Meta View.
 * Renders every Portalverse world as a handcrafted animated 3D miniature snowglobe
 * floating in a deep nebula & starfield cosmos ringed by 12 interactive constellations
 * (buffalo, aliens, flying saucer, tropical & cosmic plants, concepts, and creatures).
 */
export class CosmicMetaView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(54, 16 / 9, 0.2, 650);

  private readonly worlds: readonly WorldManifest[];
  private readonly callbacks: CosmicMetaViewCallbacks;
  private readonly isMobile: boolean;

  private activeWorldId: string;
  private readonly globes: SnowglobeEntry[] = [];
  private readonly globeById = new Map<string, SnowglobeEntry>();
  private readonly constellations: ConstellationEntry[] = [];
  private readonly constellationById = new Map<string, ConstellationEntry>();

  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly textures: THREE.Texture[] = [];
  private readonly sharedStarTexture: THREE.Texture;
  private readonly explorerOrbGeo: THREE.SphereGeometry;

  private starFieldMesh!: THREE.InstancedMesh;
  private starBaseMatrices: THREE.Matrix4[] = [];
  private starPositions: THREE.Vector3[] = [];
  private starScales: number[] = [];
  private starPhases: number[] = [];
  private readonly shootingStars: ShootingStar[] = [];
  private seamCurve: THREE.CatmullRomCurve3 | null = null;
  private seamSparkMesh: THREE.InstancedMesh | null = null;
  private seamSparkCount = 0;

  private showConstellationArt = true;
  private focusMode: 'overview' | 'world' | 'constellation' = 'overview';
  private focusedWorldId: string | null = null;
  private focusedConstellationId: string | null = null;
  private hoveredGlobeId: string | null = null;
  private hoveredConstellationId: string | null = null;

  // Smooth orbital camera state
  private readonly overviewDistance: number;
  private readonly targetPos = new THREE.Vector3(0, 0.8, 0);
  private readonly goalTargetPos = new THREE.Vector3(0, 0.8, 0);
  private orbitYaw = 0.22;
  private goalOrbitYaw = 0.22;
  private orbitPitch = 0.24;
  private goalOrbitPitch = 0.24;
  private orbitDistance: number;
  private goalOrbitDistance: number;
  private userHasInteracted = false;

  // Dive-in enter transition state
  private divingWorldId: string | null = null;
  private diveProgress = 0;

  // Input / pointer / touch state (bound to canvas only while active)
  private boundCanvas: HTMLElement | null = null;
  private activePointers = new Map<number, { x: number; y: number }>();
  private primaryPointerId: number | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private pointerDragged = false;
  private lastPinchDist = 0;
  private lastTapAt = 0;
  private lastTapGlobeId: string | null = null;
  private readonly heldKeys = new Set<string>();

  // Scratch math objects (zero per-frame allocations)
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly dummy = new THREE.Object3D();
  private readonly scratchA = new THREE.Vector3();
  private readonly scratchB = new THREE.Vector3();
  private readonly scratchQuat = new THREE.Quaternion();
  private readonly upVec = new THREE.Vector3(0, 1, 0);
  private readonly globeHitMeshes: THREE.Mesh[] = [];
  private readonly constellationHitMeshes: THREE.Mesh[] = [];
  private readonly rand = mulberry32(88421);

  private disposed = false;

  constructor(options: CosmicMetaViewOptions) {
    this.worlds = options.worlds;
    this.activeWorldId = options.activeWorldId;
    this.isMobile = Boolean(options.isMobile);
    this.callbacks = options.callbacks ?? {};

    this.scene.background = new THREE.Color('#020510');
    this.sharedStarTexture = this.trackTex(createStarSpriteTexture());
    this.explorerOrbGeo = this.trackGeo(new THREE.SphereGeometry(0.17, 10, 10));

    const layout = computeSnowglobeLayout(this.worlds, SNOWGLOBE_RADIUS);
    const maxRing = layout.reduce((acc, p) => Math.max(acc, Math.hypot(p.position[0], p.position[2])), 16);
    this.overviewDistance = Math.min(72, Math.max(32, maxRing * 1.62 + 12));
    this.orbitDistance = this.overviewDistance;
    this.goalOrbitDistance = this.overviewDistance;

    this.setupLights();
    this.buildCosmicBackdrop();
    this.buildStarfield();
    this.buildShootingStars();
    this.buildConstellations();
    this.buildSnowglobes(layout);
    this.buildSeamStarThread(layout);
    this.syncCameraTransform();
  }

  private trackGeo<T extends THREE.BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private trackMat<T extends THREE.Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private trackTex<T extends THREE.Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  private setupLights(): void {
    const hemi = new THREE.HemisphereLight('#cfe7ff', '#1e1640', 1.45);
    const key = new THREE.DirectionalLight('#fff6e5', 2.0);
    key.position.set(28, 42, 34);
    const rim = new THREE.DirectionalLight('#60a5fa', 1.2);
    rim.position.set(-36, 18, -32);
    const cosmicBounce = new THREE.DirectionalLight('#c084fc', 0.6);
    cosmicBounce.position.set(12, -26, -18);
    this.scene.add(hemi, key, rim, cosmicBounce);
  }

  private buildCosmicBackdrop(): void {
    const sky = new THREE.Mesh(
      this.trackGeo(new THREE.SphereGeometry(340, 40, 28)),
      this.trackMat(createCosmicSkyMaterial()),
    );
    sky.renderOrder = -20;
    this.scene.add(sky);

    // Soft layered 3D parallax nebula wisps floating across the distant cosmos
    const wispGeo = this.trackGeo(new THREE.PlaneGeometry(175, 118));
    const wispSpecs: Array<[number, number, number, string, string, number, number]> = [
      [-115, 68, -165, '#0ea5e9', '#6366f1', 0.4, 0.24],
      [130, 52, -145, '#a855f7', '#ec4899', 1.9, 0.2],
      [148, -18, 128, '#14b8a6', '#38bdf8', 3.2, 0.19],
      [-142, 38, 134, '#8b5cf6', '#f472b6', 4.5, 0.21],
      [12, 148, -110, '#38bdf8', '#c084fc', 5.7, 0.18],
      [-28, -96, -142, '#0284c7', '#4f46e5', 2.4, 0.16],
    ];
    for (const [x, y, z, cA, cB, phase, opacity] of wispSpecs) {
      const mesh = new THREE.Mesh(wispGeo, this.trackMat(createNebulaWispMaterial(cA, cB, phase, opacity)));
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      mesh.rotation.z = phase * 0.65;
      mesh.renderOrder = -15;
      this.scene.add(mesh);
    }
  }

  private buildStarfield(): void {
    const count = this.isMobile ? 1100 : 2200;
    const starGeo = this.trackGeo(new THREE.OctahedronGeometry(0.32, 0));
    const starMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        fog: false,
      }),
    );

    const mesh = new THREE.InstancedMesh(starGeo, starMat, count);
    mesh.frustumCulled = false;
    const palette = [
      new THREE.Color('#ffffff'),
      new THREE.Color('#dbeafe'),
      new THREE.Color('#bae6fd'),
      new THREE.Color('#fef3c7'),
      new THREE.Color('#fbcfe8'),
      new THREE.Color('#ddd6fe'),
      new THREE.Color('#a7f3d0'),
    ];

    for (let i = 0; i < count; i++) {
      // Uniform distribution on sphere shell between 85m and 290m
      const u = this.rand() * 2 - 1;
      const theta = this.rand() * Math.PI * 2;
      const sqrtOneMinus = Math.sqrt(Math.max(0, 1 - u * u));
      const r = 85 + this.rand() * 205;
      const x = Math.cos(theta) * sqrtOneMinus * r;
      const y = u * r;
      const z = Math.sin(theta) * sqrtOneMinus * r;

      const scale = 0.38 + Math.pow(this.rand(), 2.8) * 2.15;
      const pos = new THREE.Vector3(x, y, z);
      this.starPositions.push(pos);
      this.starScales.push(scale);
      this.starPhases.push(this.rand() * Math.PI * 2);

      this.dummy.position.copy(pos);
      this.dummy.rotation.set(this.rand() * Math.PI, this.rand() * Math.PI, 0);
      this.dummy.scale.setScalar(scale);
      this.dummy.updateMatrix();
      mesh.setMatrixAt(i, this.dummy.matrix);
      this.starBaseMatrices.push(this.dummy.matrix.clone());
      mesh.setColorAt(i, palette[Math.floor(this.rand() * palette.length)]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.starFieldMesh = mesh;
    this.scene.add(mesh);
  }

  private buildShootingStars(): void {
    const geo = this.trackGeo(new THREE.CylinderGeometry(0.02, 0.14, 14, 5));
    geo.rotateX(Math.PI / 2);
    for (let i = 0; i < 4; i++) {
      const mat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: i % 2 === 0 ? '#e0f2fe' : '#fde68a',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shootingStars.push({
        mesh,
        mat,
        origin: new THREE.Vector3(),
        dir: new THREE.Vector3(1, 0, 0),
        age: 0,
        duration: 1.2,
        cooldown: 1.5 + i * 2.6,
        speed: 95,
      });
    }
  }

  private buildConstellations(): void {
    const beamGeo = this.trackGeo(new THREE.CylinderGeometry(0.15, 0.15, 1, 6));
    const hitGeo = this.trackGeo(new THREE.SphereGeometry(1, 10, 8));
    const hitMat = this.trackMat(new THREE.MeshBasicMaterial({ visible: false }));

    for (const spec of COSMIC_CONSTELLATIONS) {
      const group = new THREE.Group();
      const basis = getConstellationBasis(spec);
      const centerVec = new THREE.Vector3(...basis.center);
      const spanWorld = Math.tan(spec.angularSpanDeg * DEG2RAD) * spec.distance * 2.38;

      // 1. Subtle Uranometria-style painterly astral art plate behind the stars
      const artTex = this.trackTex(createConstellationArtTexture(spec));
      const artMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          map: artTex,
          transparent: true,
          opacity: 0.72,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      const artMesh = new THREE.Mesh(this.trackGeo(new THREE.PlaneGeometry(spanWorld, spanWorld)), artMat);
      artMesh.position.copy(centerVec).multiplyScalar(1.015);
      artMesh.lookAt(0, 0, 0);
      artMesh.renderOrder = -6;
      group.add(artMesh);

      // 2. Project star positions onto the celestial sphere
      const starPositions3D = spec.stars.map(
        (s) => new THREE.Vector3(...projectConstellationPoint(spec, s.x, s.y, 1.0)),
      );

      // 3. Luminous star-to-star constellation beams (InstancedMesh so lines look rich at all DPIs)
      const lineMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: spec.color,
          transparent: true,
          opacity: 0.52,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      const beamMesh = new THREE.InstancedMesh(beamGeo, lineMat, Math.max(1, spec.edges.length));
      beamMesh.renderOrder = -4;
      for (let i = 0; i < spec.edges.length; i++) {
        const [ia, ib] = spec.edges[i];
        const a = starPositions3D[ia];
        const b = starPositions3D[ib];
        const mid = this.scratchA.copy(a).add(b).multiplyScalar(0.5);
        const dir = this.scratchB.copy(b).sub(a);
        const len = dir.length();
        dir.normalize();
        this.scratchQuat.setFromUnitVectors(this.upVec, dir);
        this.dummy.position.copy(mid);
        this.dummy.quaternion.copy(this.scratchQuat);
        this.dummy.scale.set(1, len, 1);
        this.dummy.updateMatrix();
        beamMesh.setMatrixAt(i, this.dummy.matrix);
      }
      beamMesh.instanceMatrix.needsUpdate = true;
      group.add(beamMesh);

      // 4. Twinkling starburst hero sprites at every star node
      const starSprites: ConstellationEntry['starSprites'] = [];
      for (let i = 0; i < spec.stars.length; i++) {
        const s = spec.stars[i];
        const pos = starPositions3D[i];
        const starTint = new THREE.Color(spec.color).lerp(new THREE.Color('#ffffff'), s.mag > 1.15 ? 0.65 : 0.42);
        const sMat = this.trackMat(
          new THREE.SpriteMaterial({
            map: this.sharedStarTexture,
            color: starTint,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false,
          }),
        );
        const sprite = new THREE.Sprite(sMat);
        const baseScale = 3.2 + s.mag * 3.8;
        sprite.position.copy(pos);
        sprite.scale.set(baseScale, baseScale, 1);
        sprite.renderOrder = -3;
        group.add(sprite);
        starSprites.push({ sprite, baseScale, phase: i * 1.37 + spec.azimuthDeg * 0.1 });
      }

      // 5. Invisible picking sphere so users can click any constellation in the sky
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.position.copy(centerVec);
      hitMesh.scale.setScalar(spanWorld * 0.44);
      hitMesh.userData.constellationId = spec.id;
      group.add(hitMesh);
      this.constellationHitMeshes.push(hitMesh);

      this.scene.add(group);
      const entry: ConstellationEntry = {
        spec,
        group,
        hitMesh,
        artMesh,
        artMat,
        artTex,
        lineMat,
        starSprites,
        highlight: 0,
      };
      this.constellations.push(entry);
      this.constellationById.set(spec.id, entry);
    }
  }

  private buildSnowglobes(layout: SnowglobePlacement[]): void {
    // Shared ornate turned obsidian pedestal profile sitting neatly under the glass sphere
    const pedestalPoints = [
      new THREE.Vector2(0.0, -3.02),
      new THREE.Vector2(1.96, -3.02),
      new THREE.Vector2(2.04, -2.92),
      new THREE.Vector2(1.88, -2.76),
      new THREE.Vector2(1.62, -2.54),
      new THREE.Vector2(1.48, -2.26),
      new THREE.Vector2(1.74, -2.02),
      new THREE.Vector2(2.12, -1.78),
      new THREE.Vector2(2.26, -1.62),
      new THREE.Vector2(2.06, -1.52),
      new THREE.Vector2(0.0, -1.52),
    ];
    const pedestalGeo = this.trackGeo(new THREE.LatheGeometry(pedestalPoints, 36));
    const pedestalMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: '#0f172a',
        emissive: '#090e1d',
        emissiveIntensity: 0.35,
        roughness: 0.36,
        metalness: 0.58,
      }),
    );

    const brassCollarGeo = this.trackGeo(new THREE.TorusGeometry(2.16, 0.085, 12, 48));
    const brassFootGeo = this.trackGeo(new THREE.TorusGeometry(1.96, 0.06, 10, 44));
    const brassMat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: '#e5b34b',
        emissive: '#92400e',
        emissiveIntensity: 0.28,
        roughness: 0.24,
        metalness: 0.86,
      }),
    );

    const accentRingGeo = this.trackGeo(new THREE.TorusGeometry(1.86, 0.042, 8, 44));
    const glassGeo = this.trackGeo(new THREE.SphereGeometry(SNOWGLOBE_RADIUS, 36, 28));
    const hitGeo = this.trackGeo(new THREE.SphereGeometry(SNOWGLOBE_RADIUS * 1.14, 14, 10));
    const hitMat = this.trackMat(new THREE.MeshBasicMaterial({ visible: false }));
    const flakeGeo = this.trackGeo(new THREE.OctahedronGeometry(0.055, 0));
    const haloRingOuterGeo = this.trackGeo(new THREE.TorusGeometry(SNOWGLOBE_RADIUS + 0.52, 0.032, 8, 56));
    const haloRingInnerGeo = this.trackGeo(new THREE.TorusGeometry(SNOWGLOBE_RADIUS + 0.32, 0.022, 8, 48));
    const haloMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: '#fde68a',
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );

    const flakesPerGlobe = this.isMobile ? 42 : 76;

    for (const placement of layout) {
      const world = placement.world;
      const root = new THREE.Group();
      root.position.set(...placement.position);

      // 1. Ornate obsidian & brass pedestal base
      const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
      const brassCollar = new THREE.Mesh(brassCollarGeo, brassMat);
      brassCollar.rotation.x = Math.PI / 2;
      brassCollar.position.y = -1.58;
      const brassFoot = new THREE.Mesh(brassFootGeo, brassMat);
      brassFoot.rotation.x = Math.PI / 2;
      brassFoot.position.y = -2.96;

      const bezelGlowMat = this.trackMat(
        new THREE.MeshStandardMaterial({
          color: world.accentColor,
          emissive: world.accentColor,
          emissiveIntensity: 1.25,
          roughness: 0.2,
          metalness: 0.3,
        }),
      );
      const accentRing = new THREE.Mesh(accentRingGeo, bezelGlowMat);
      accentRing.rotation.x = Math.PI / 2;
      accentRing.position.y = -2.28;
      root.add(pedestal, brassCollar, brassFoot, accentRing);

      // 2. Bespoke animated miniature 3D diorama world inside the dome
      const diorama = buildSnowglobeDiorama(world);
      root.add(diorama.group);

      // 3. Swirling interior snow / biome flurry particles
      const flakeMat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0.88,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const flakesMesh = new THREE.InstancedMesh(flakeGeo, flakeMat, flakesPerGlobe);
      flakesMesh.renderOrder = 6;
      const colA = new THREE.Color(diorama.flurry.colorA);
      const colB = new THREE.Color(diorama.flurry.colorB);
      const flakes: FlakeParticle[] = [];

      for (let i = 0; i < flakesPerGlobe; i++) {
        // Sample uniform point inside upper interior hemisphere
        let fx = 0;
        let fy = 0;
        let fz = 0;
        for (let tries = 0; tries < 8; tries++) {
          fx = (this.rand() * 2 - 1) * FLURRY_MAX_R;
          fy = FLURRY_MIN_Y + this.rand() * (FLURRY_MAX_Y - FLURRY_MIN_Y);
          fz = (this.rand() * 2 - 1) * FLURRY_MAX_R;
          if (Math.hypot(fx, fy, fz) <= FLURRY_MAX_R) break;
        }
        const size = 0.55 + this.rand() * 0.95;
        flakes.push({
          x: fx,
          y: fy,
          z: fz,
          vx: (this.rand() - 0.5) * 0.16,
          vy: diorama.flurry.fallSpeed * (0.65 + this.rand() * 0.7),
          vz: (this.rand() - 0.5) * 0.16,
          phase: this.rand() * Math.PI * 2,
          size,
        });
        this.dummy.position.set(fx, fy, fz);
        this.dummy.scale.setScalar(size);
        this.dummy.updateMatrix();
        flakesMesh.setMatrixAt(i, this.dummy.matrix);
        flakesMesh.setColorAt(i, i % 2 === 0 ? colA : colB);
      }
      flakesMesh.instanceMatrix.needsUpdate = true;
      if (flakesMesh.instanceColor) flakesMesh.instanceColor.needsUpdate = true;
      root.add(flakesMesh);

      // 4. Crystal TSL snowglobe glass dome (rendered after interior contents)
      //    Refracts the interior + flurry through the liquid lens with spectral
      //    chromatic aberration; the inner back wall (renderOrder 5) is drawn
      //    first so its highlights get lensed by the front surface too.
      const glass = createSnowglobeGlassMaterial(world.accentColor, {
        spectralSamples: this.isMobile ? 3 : 6,
      });
      this.trackMat(glass.material);
      this.trackMat(glass.backMaterial);
      const glassBackWall = new THREE.Mesh(glassGeo, glass.backMaterial);
      glassBackWall.renderOrder = 5;
      const glassDome = new THREE.Mesh(glassGeo, glass.material);
      glassDome.renderOrder = 10;
      root.add(glassBackWall, glassDome);

      // 5. Active-world golden orbital astrolabe halo ("You are here")
      const activeHalo = new THREE.Group();
      const ringA = new THREE.Mesh(haloRingOuterGeo, haloMat);
      const ringB = new THREE.Mesh(haloRingInnerGeo, haloMat);
      ringA.rotation.set(Math.PI * 0.42, 0.2, 0);
      ringB.rotation.set(-Math.PI * 0.35, -0.4, 0.3);
      activeHalo.add(ringA, ringB);
      activeHalo.visible = world.id === this.activeWorldId;
      root.add(activeHalo);

      // 6. Live multiplayer explorer firefly orbs orbiting this world's globe
      const explorerGroup = new THREE.Group();
      root.add(explorerGroup);

      // 7. Crisp floating title plaque below the snowglobe pedestal
      const authorShort = world.owner ?? world.author;
      const labelTexture = createSnowglobeLabelTexture(
        world.name,
        authorShort,
        world.accentColor,
        world.id === this.activeWorldId,
      );
      const labelMat = this.trackMat(
        new THREE.SpriteMaterial({
          map: labelTexture,
          transparent: true,
          depthWrite: false,
          fog: false,
        }),
      );
      const labelSprite = new THREE.Sprite(labelMat);
      labelSprite.scale.set(4.5, 4.5 * (140 / 512), 1);
      labelSprite.position.set(0, -3.72, 0);
      labelSprite.renderOrder = 12;
      root.add(labelSprite);

      // 8. Invisible picking sphere
      const hitMesh = new THREE.Mesh(hitGeo, hitMat);
      hitMesh.userData.worldId = world.id;
      root.add(hitMesh);
      this.globeHitMeshes.push(hitMesh);

      this.scene.add(root);

      const entry: SnowglobeEntry = {
        placement,
        root,
        hitMesh,
        glass,
        bezelGlowMat,
        activeHalo,
        diorama,
        labelSprite,
        labelTexture,
        labelMat,
        flakesMesh,
        flakes,
        shakeEnergy: 0.35, // Gentle sparkle wake-up swirl on opening
        hoverAmount: 0,
        selectedAmount: 0,
        explorerGroup,
        explorerMeshes: [],
        explorerMats: [],
        players: [],
      };
      this.globes.push(entry);
      this.globeById.set(world.id, entry);
    }
  }

  private buildSeamStarThread(layout: SnowglobePlacement[]): void {
    if (layout.length < 2) return;
    const pts = layout.map((p) => new THREE.Vector3(p.position[0], p.position[1] - 2.35, p.position[2]));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.45);
    this.seamCurve = curve;

    const tubeGeo = this.trackGeo(new THREE.TubeGeometry(curve, Math.max(64, layout.length * 14), 0.055, 6, true));
    const tubeMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: '#7dd3fc',
        transparent: true,
        opacity: 0.24,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const ribbon = new THREE.Mesh(tubeGeo, tubeMat);
    ribbon.renderOrder = 1;
    this.scene.add(ribbon);

    // Luminous traveling starlight packets gliding along the Seam loop
    this.seamSparkCount = Math.min(30, Math.max(12, layout.length * 2));
    const sparkGeo = this.trackGeo(new THREE.OctahedronGeometry(0.16, 0));
    const sparkMat = this.trackMat(
      new THREE.MeshBasicMaterial({
        color: '#e0f2fe',
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const sparks = new THREE.InstancedMesh(sparkGeo, sparkMat, this.seamSparkCount);
    sparks.renderOrder = 2;
    this.seamSparkMesh = sparks;
    this.scene.add(sparks);
  }

  /** Update which world displays the golden "You are here" orbital astrolabe halo. */
  setActiveWorld(worldId: string): void {
    if (this.activeWorldId === worldId) return;
    const prev = this.globeById.get(this.activeWorldId);
    this.activeWorldId = worldId;
    const next = this.globeById.get(worldId);

    for (const entry of [prev, next]) {
      if (!entry) continue;
      const isCurrent = entry.placement.world.id === worldId;
      entry.activeHalo.visible = isCurrent;
      const authorShort = entry.placement.world.owner ?? entry.placement.world.author;
      const newTex = createSnowglobeLabelTexture(
        entry.placement.world.name,
        authorShort,
        entry.placement.world.accentColor,
        isCurrent,
      );
      entry.labelMat.map = newTex;
      entry.labelMat.needsUpdate = true;
      entry.labelTexture.dispose();
      entry.labelTexture = newTex;
    }
  }

  /** Sync live multiplayer roster orbs circling each world's snowglobe. */
  syncPresence(roster: readonly AvatarState[]): void {
    const byWorld = new Map<string, AvatarState[]>();
    for (const player of roster) {
      const list = byWorld.get(player.worldId);
      if (list) list.push(player);
      else byWorld.set(player.worldId, [player]);
    }

    for (const entry of this.globes) {
      const players = byWorld.get(entry.placement.world.id) ?? [];
      entry.players = players;

      // Rebuild small orb indicator set only when count changes
      const targetCount = Math.min(8, players.length);
      while (entry.explorerMeshes.length > targetCount) {
        const m = entry.explorerMeshes.pop()!;
        const mat = entry.explorerMats.pop()!;
        entry.explorerGroup.remove(m);
        mat.dispose();
      }
      while (entry.explorerMeshes.length < targetCount) {
        const mat = new THREE.MeshBasicMaterial({ color: '#38bdf8' });
        const mesh = new THREE.Mesh(this.explorerOrbGeo, mat);
        entry.explorerGroup.add(mesh);
        entry.explorerMeshes.push(mesh);
        entry.explorerMats.push(mat);
      }
      for (let i = 0; i < targetCount; i++) {
        entry.explorerMats[i].color.set(players[i].color || '#38bdf8');
      }
    }

    if (this.focusMode === 'world' && this.focusedWorldId) {
      this.emitFocusChange();
    }
  }

  /** Toggle the ghostly Uranometria-style constellation illustration plates on/off. */
  setShowConstellationArt(show: boolean): void {
    this.showConstellationArt = show;
    for (const c of this.constellations) {
      c.artMesh.visible = show;
    }
  }

  getShowConstellationArt(): boolean {
    return this.showConstellationArt;
  }

  /** Gently stir up a swirling snowstorm inside one globe (or all globes if omitted). */
  shakeGlobe(worldId?: string): void {
    if (worldId) {
      const entry = this.globeById.get(worldId);
      if (entry) entry.shakeEnergy = Math.min(1.4, entry.shakeEnergy + 1.0);
      return;
    }
    for (const entry of this.globes) {
      entry.shakeEnergy = Math.min(1.4, entry.shakeEnergy + 0.95);
    }
  }

  /** Return camera to the panoramic overview of all snowglobes and constellations. */
  focusOverview(): void {
    this.divingWorldId = null;
    this.diveProgress = 0;
    this.focusMode = 'overview';
    this.focusedWorldId = null;
    this.focusedConstellationId = null;
    this.goalTargetPos.set(0, 0.8, 0);
    this.goalOrbitDistance = this.overviewDistance;
    this.goalOrbitPitch = 0.24;
    this.emitFocusChange();
  }

  /** Smoothly fly the camera to inspect one world's snowglobe up close. */
  focusWorld(worldId: string): boolean {
    const entry = this.globeById.get(worldId);
    if (!entry) return false;
    this.userHasInteracted = true;
    this.divingWorldId = null;
    this.diveProgress = 0;
    this.focusMode = 'world';
    this.focusedWorldId = worldId;
    this.focusedConstellationId = null;
    this.goalTargetPos.copy(entry.root.position);
    this.goalOrbitDistance = 8.4;
    this.goalOrbitPitch = 0.19;
    // Frame from just outside the cosmic ring looking slightly inward so constellations shine behind
    const outwardYaw = Math.atan2(entry.placement.position[0], entry.placement.position[2]);
    this.goalOrbitYaw = this.orbitYaw + shortestAngleDelta(this.orbitYaw, outwardYaw);
    entry.shakeEnergy = Math.max(entry.shakeEnergy, 0.85);
    this.emitFocusChange();
    return true;
  }

  /** Step to the previous or next world snowglobe in Portalverse's circular loop. */
  stepWorld(delta: number): void {
    if (!this.globes.length) return;
    const currentIdx = this.focusedWorldId
      ? this.globes.findIndex((g) => g.placement.world.id === this.focusedWorldId)
      : this.globes.findIndex((g) => g.placement.world.id === this.activeWorldId);
    const start = currentIdx >= 0 ? currentIdx : 0;
    const nextIdx = (start + delta + this.globes.length) % this.globes.length;
    this.focusWorld(this.globes[nextIdx].placement.world.id);
  }

  /** Smoothly swing the camera to gaze up at a specific constellation in the cosmic sky. */
  focusConstellation(constellationId: string): boolean {
    const entry = this.constellationById.get(constellationId);
    if (!entry) return false;
    this.userHasInteracted = true;
    this.divingWorldId = null;
    this.diveProgress = 0;
    this.focusMode = 'constellation';
    this.focusedConstellationId = constellationId;
    this.focusedWorldId = null;

    // Position the camera just inside the cosmic center looking outward toward the constellation
    const azRad = entry.spec.azimuthDeg * DEG2RAD;
    const elRad = entry.spec.elevationDeg * DEG2RAD;
    // Orbit camera sits at target + (sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch)) * dist
    // So to look toward direction (sin(az)*cos(el), sin(el), -cos(az)*cos(el)), put camera on the opposite side:
    const targetYaw = Math.atan2(-Math.sin(azRad), Math.cos(azRad));
    const targetPitch = THREE.MathUtils.clamp(-elRad * 0.92, -1.15, 0.9);
    this.goalTargetPos.set(0, 1.8, 0);
    this.goalOrbitDistance = 8.0;
    this.goalOrbitYaw = this.orbitYaw + shortestAngleDelta(this.orbitYaw, targetYaw);
    this.goalOrbitPitch = targetPitch;
    this.emitFocusChange();
    return true;
  }

  /** Step to the next or previous constellation. */
  stepConstellation(delta: number): void {
    if (!this.constellations.length) return;
    const idx = this.focusedConstellationId
      ? this.constellations.findIndex((c) => c.spec.id === this.focusedConstellationId)
      : -1;
    const next = (idx + delta + this.constellations.length) % this.constellations.length;
    this.focusConstellation(this.constellations[next].spec.id);
  }

  /** Dive smoothly into a world's snowglobe glass dome and invoke `onEnterWorld`. */
  enterWorld(worldId: string): void {
    const entry = this.globeById.get(worldId);
    if (!entry) {
      this.callbacks.onEnterWorld?.(worldId);
      return;
    }
    this.focusWorld(worldId);
    this.divingWorldId = worldId;
    this.diveProgress = 0;
    entry.shakeEnergy = 1.3;
  }

  getFocus(): MetaViewFocus {
    if (this.focusMode === 'world' && this.focusedWorldId) {
      const entry = this.globeById.get(this.focusedWorldId);
      if (entry) {
        return {
          kind: 'world',
          world: entry.placement.world,
          playerCount: entry.players.length,
          players: entry.players,
        };
      }
    }
    if (this.focusMode === 'constellation' && this.focusedConstellationId) {
      const entry = this.constellationById.get(this.focusedConstellationId);
      if (entry) {
        return { kind: 'constellation', constellation: entry.spec };
      }
    }
    return { kind: 'overview' };
  }

  private emitFocusChange(): void {
    this.callbacks.onFocusChange?.(this.getFocus());
  }

  /** Bind mouse, wheel, touch, and keyboard listeners when opening Meta View. */
  attachControls(canvas: HTMLElement): void {
    if (this.boundCanvas === canvas) return;
    this.detachControls();
    this.boundCanvas = canvas;
    this.divingWorldId = null;
    this.diveProgress = 0;
    this.camera.fov = 54;
    this.camera.updateProjectionMatrix();

    // Frame the current world nicely in the overview right on arrival
    const activeEntry = this.globeById.get(this.activeWorldId);
    if (activeEntry) {
      const frontYaw = Math.atan2(activeEntry.placement.position[0], activeEntry.placement.position[2]);
      this.orbitYaw = frontYaw + 0.18;
      this.goalOrbitYaw = this.orbitYaw;
    }
    this.orbitPitch = 0.24;
    this.goalOrbitPitch = 0.24;
    this.orbitDistance = this.overviewDistance * 1.12;
    this.goalOrbitDistance = this.overviewDistance;
    this.targetPos.set(0, 0.8, 0);
    this.goalTargetPos.set(0, 0.8, 0);
    this.focusMode = 'overview';
    this.focusedWorldId = null;
    this.focusedConstellationId = null;
    this.userHasInteracted = false;
    this.shakeGlobe();

    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointercancel', this.handlePointerUp);
    canvas.addEventListener('wheel', this.handleWheel, { passive: false });
    canvas.addEventListener('dblclick', this.handleDoubleClick);
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
    }

    this.emitFocusChange();
  }

  /** Unbind listeners when returning to the active room. */
  detachControls(): void {
    if (this.boundCanvas) {
      this.boundCanvas.removeEventListener('pointerdown', this.handlePointerDown);
      this.boundCanvas.removeEventListener('pointermove', this.handlePointerMove);
      this.boundCanvas.removeEventListener('pointerup', this.handlePointerUp);
      this.boundCanvas.removeEventListener('pointercancel', this.handlePointerUp);
      this.boundCanvas.removeEventListener('wheel', this.handleWheel);
      this.boundCanvas.removeEventListener('dblclick', this.handleDoubleClick);
      this.boundCanvas.style.cursor = '';
      this.boundCanvas = null;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
    }
    this.activePointers.clear();
    this.primaryPointerId = null;
    this.heldKeys.clear();
    this.hoveredGlobeId = null;
    this.hoveredConstellationId = null;
    this.callbacks.onHoverChange?.(null);
  }

  /** Advance snowglobe animations, flurries, twinkling stars, comets, and smooth camera easing. */
  update(dt: number, elapsed: number): void {
    if (this.disposed) return;
    const safeDt = Math.min(Math.max(dt, 0), 0.05);

    // 1. Keyboard gentle orbit glide while Meta View is active
    if (this.boundCanvas && !this.divingWorldId) {
      const yawInput = (this.heldKeys.has('KeyD') ? 1 : 0) - (this.heldKeys.has('KeyA') ? 1 : 0);
      const pitchInput = (this.heldKeys.has('KeyW') ? 1 : 0) - (this.heldKeys.has('KeyS') ? 1 : 0);
      if (yawInput !== 0 || pitchInput !== 0) {
        this.userHasInteracted = true;
        this.goalOrbitYaw += yawInput * safeDt * 1.15;
        this.goalOrbitPitch = THREE.MathUtils.clamp(this.goalOrbitPitch + pitchInput * safeDt * 0.85, -1.2, 1.28);
      }
    }

    // Gentle ambient cosmic drift in untouched overview mode
    if (this.focusMode === 'overview' && !this.userHasInteracted && !this.divingWorldId) {
      this.goalOrbitYaw += safeDt * 0.055;
    }

    // 2. Smooth dive-in zoom transition into a snowglobe when entering a world
    if (this.divingWorldId) {
      const diveTarget = this.globeById.get(this.divingWorldId);
      if (diveTarget) {
        this.diveProgress += safeDt / 0.42;
        const t = THREE.MathUtils.clamp(this.diveProgress, 0, 1);
        const eased = t * t * (3 - 2 * t);
        this.goalTargetPos.copy(diveTarget.root.position);
        this.goalOrbitDistance = THREE.MathUtils.lerp(8.4, 0.45, eased);
        this.camera.fov = THREE.MathUtils.lerp(54, 78, eased);
        this.camera.updateProjectionMatrix();
        if (this.diveProgress >= 1) {
          const id = this.divingWorldId;
          this.divingWorldId = null;
          this.callbacks.onEnterWorld?.(id);
        }
      }
    }

    // 3. Exponentially smooth camera parameters
    const smooth = 1 - Math.exp(-safeDt * 7.5);
    this.targetPos.lerp(this.goalTargetPos, smooth);
    this.orbitYaw += (this.goalOrbitYaw - this.orbitYaw) * smooth;
    this.orbitPitch += (this.goalOrbitPitch - this.orbitPitch) * smooth;
    this.orbitDistance += (this.goalOrbitDistance - this.orbitDistance) * smooth;
    this.syncCameraTransform();

    // 4. Twinkle a rotating slice of background stars per frame for crisp 60fps performance
    const starCount = this.starPositions.length;
    const stride = 6;
    const offset = Math.floor(elapsed * 60) % stride;
    for (let i = offset; i < starCount; i += stride) {
      const twinkle = 0.65 + 0.45 * Math.sin(elapsed * 2.1 + this.starPhases[i]);
      const sc = this.starScales[i] * twinkle;
      this.dummy.position.copy(this.starPositions[i]);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(sc);
      this.dummy.updateMatrix();
      this.starFieldMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.starFieldMesh.instanceMatrix.needsUpdate = true;

    // 5. Periodic shooting stars streaking across upper cosmic dome
    for (const s of this.shootingStars) {
      if (s.cooldown > 0) {
        s.cooldown -= safeDt;
        if (s.cooldown <= 0) {
          const az = this.rand() * Math.PI * 2;
          const el = 0.25 + this.rand() * 0.72;
          const r = 175 + this.rand() * 45;
          s.origin.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
          s.dir
            .set(-Math.sin(az) + (this.rand() - 0.5) * 0.5, -0.25 - this.rand() * 0.35, Math.cos(az) + (this.rand() - 0.5) * 0.5)
            .normalize();
          s.age = 0;
          s.duration = 0.85 + this.rand() * 0.65;
          s.speed = 78 + this.rand() * 54;
          s.mesh.visible = true;
          s.mesh.position.copy(s.origin);
          s.mesh.lookAt(this.scratchA.copy(s.origin).add(s.dir));
        }
      } else {
        s.age += safeDt;
        const p = s.age / s.duration;
        if (p >= 1) {
          s.mesh.visible = false;
          s.mat.opacity = 0;
          s.cooldown = 3.2 + this.rand() * 6.5;
        } else {
          s.mesh.position.copy(s.origin).addScaledVector(s.dir, s.age * s.speed);
          s.mat.opacity = Math.sin(p * Math.PI) * 0.92;
        }
      }
    }

    // 6. Animate constellations (gentle breathing glow + focus/hover spotlighting)
    for (const c of this.constellations) {
      const isFocused = this.focusMode === 'constellation' && this.focusedConstellationId === c.spec.id;
      const isHovered = this.hoveredConstellationId === c.spec.id;
      const targetHl = isFocused ? 1.0 : isHovered ? 0.65 : 0.0;
      c.highlight += (targetHl - c.highlight) * Math.min(1, safeDt * 7);

      c.lineMat.opacity = 0.44 + c.highlight * 0.46 + Math.sin(elapsed * 1.4 + c.spec.azimuthDeg) * 0.06;
      c.artMat.opacity = 0.54 + c.highlight * 0.42;

      for (const st of c.starSprites) {
        const pulse = 0.86 + 0.22 * Math.sin(elapsed * 2.5 + st.phase);
        const s = st.baseScale * pulse * (1 + c.highlight * 0.24);
        st.sprite.scale.set(s, s, 1);
      }
    }

    // 7. Animate Seam loop traveling starlight packets
    if (this.seamCurve && this.seamSparkMesh) {
      for (let i = 0; i < this.seamSparkCount; i++) {
        const u = (elapsed * 0.032 + i / this.seamSparkCount) % 1;
        this.seamCurve.getPointAt(u, this.scratchA);
        const pulse = 0.75 + 0.45 * Math.sin(elapsed * 4.5 + i * 1.1);
        this.dummy.position.copy(this.scratchA);
        this.dummy.rotation.set(elapsed, elapsed * 0.7, 0);
        this.dummy.scale.setScalar(pulse);
        this.dummy.updateMatrix();
        this.seamSparkMesh.setMatrixAt(i, this.dummy.matrix);
      }
      this.seamSparkMesh.instanceMatrix.needsUpdate = true;
    }

    // 8. Animate every floating snowglobe (bobbing, diorama motion, 88 BPM bezel pulse, flurry physics, explorer orbs)
    const bpmPulse = 0.5 + 0.5 * Math.sin((elapsed * 88 * Math.PI * 2) / 60);

    for (const entry of this.globes) {
      const isFocused = this.focusMode === 'world' && this.focusedWorldId === entry.placement.world.id;
      const isHovered = this.hoveredGlobeId === entry.placement.world.id;

      entry.hoverAmount += ((isHovered ? 1 : 0) - entry.hoverAmount) * Math.min(1, safeDt * 9);
      entry.selectedAmount += ((isFocused ? 1 : 0) - entry.selectedAmount) * Math.min(1, safeDt * 8);

      // Gentle zero-gravity cosmic float
      const bobY = Math.sin(elapsed * 0.92 + entry.placement.bobPhase) * 0.44;
      entry.root.position.set(
        entry.placement.position[0],
        entry.placement.position[1] + bobY,
        entry.placement.position[2],
      );
      if (isFocused && !this.divingWorldId) {
        this.goalTargetPos.copy(entry.root.position);
      }

      // Subtle scale lift on hover/selection
      const targetScale = 1 + entry.hoverAmount * 0.065 + entry.selectedAmount * 0.05;
      entry.root.scale.setScalar(targetScale);

      // Slowly turn the interior diorama so all sides catch the light
      entry.diorama.group.rotation.y = elapsed * 0.16 + entry.placement.bobPhase;
      entry.diorama.update(safeDt, elapsed);

      // Glass shader & base accent glow
      entry.glass.uHover.value = entry.hoverAmount;
      entry.glass.uSelected.value = entry.selectedAmount;
      entry.glass.uShake.value = Math.min(1.5, entry.shakeEnergy);
      entry.bezelGlowMat.emissiveIntensity = 1.05 + bpmPulse * 0.35 + entry.hoverAmount * 0.55 + entry.selectedAmount * 0.7;

      // Active-world golden astrolabe rings
      if (entry.activeHalo.visible) {
        entry.activeHalo.children[0].rotation.z = elapsed * 0.38;
        entry.activeHalo.children[1].rotation.y = -elapsed * 0.52;
      }

      // Orbiting multiplayer explorer firefly orbs
      for (let i = 0; i < entry.explorerMeshes.length; i++) {
        const a = elapsed * 1.15 + (i / Math.max(1, entry.explorerMeshes.length)) * Math.PI * 2;
        const orbitR = SNOWGLOBE_RADIUS + 0.65;
        entry.explorerMeshes[i].position.set(
          Math.cos(a) * orbitR,
          0.35 + Math.sin(elapsed * 2.2 + i) * 0.35,
          Math.sin(a) * orbitR,
        );
      }

      // Swirling shakeable interior flurry physics
      entry.shakeEnergy = Math.max(0, entry.shakeEnergy - safeDt * 0.34);
      const swirl = 0.25 + entry.shakeEnergy * 3.1;
      const chaos = entry.shakeEnergy * 1.35;
      const fallBase = entry.diorama.flurry.fallSpeed;

      for (let i = 0; i < entry.flakes.length; i++) {
        const f = entry.flakes[i];
        // Tangential vortex around Y axis inside the glass
        const cosA = Math.cos(swirl * safeDt);
        const sinA = Math.sin(swirl * safeDt);
        const nx = f.x * cosA - f.z * sinA;
        const nz = f.x * sinA + f.z * cosA;
        f.x = nx + Math.sin(elapsed * 1.7 + f.phase) * (0.14 + chaos * 0.45) * safeDt;
        f.z = nz + Math.cos(elapsed * 1.5 + f.phase) * (0.14 + chaos * 0.45) * safeDt;
        f.y += (f.vy + Math.sin(elapsed * 3.8 + f.phase) * chaos * 0.85) * safeDt;

        // Wrap vertically cleanly inside the dome
        if (fallBase < 0 && f.y < FLURRY_MIN_Y) {
          f.y = FLURRY_MAX_Y - this.rand() * 0.45;
          const a = this.rand() * Math.PI * 2;
          const r = this.rand() * FLURRY_MAX_R * 0.72;
          f.x = Math.cos(a) * r;
          f.z = Math.sin(a) * r;
        } else if (fallBase >= 0 && f.y > FLURRY_MAX_Y) {
          f.y = FLURRY_MIN_Y + this.rand() * 0.35;
          const a = this.rand() * Math.PI * 2;
          const r = this.rand() * FLURRY_MAX_R * 0.78;
          f.x = Math.cos(a) * r;
          f.z = Math.sin(a) * r;
        }

        // Constrain strictly inside the inner glass sphere
        const dist = Math.hypot(f.x, f.y, f.z);
        if (dist > FLURRY_MAX_R) {
          const clampScale = (FLURRY_MAX_R * 0.96) / dist;
          f.x *= clampScale;
          f.y = Math.max(FLURRY_MIN_Y, f.y * clampScale);
          f.z *= clampScale;
        }

        this.dummy.position.set(f.x, f.y, f.z);
        this.dummy.rotation.set(elapsed + f.phase, elapsed * 0.7, 0);
        this.dummy.scale.setScalar(f.size * (1 + entry.shakeEnergy * 0.3));
        this.dummy.updateMatrix();
        entry.flakesMesh.setMatrixAt(i, this.dummy.matrix);
      }
      entry.flakesMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Render the cosmic scene directly using the engine's shared WebGPURenderer. */
  render(renderer: THREE.WebGPURenderer, aspect: number): void {
    if (this.disposed) return;
    if (Number.isFinite(aspect) && aspect > 0 && Math.abs(this.camera.aspect - aspect) > 1e-4) {
      this.camera.aspect = aspect;
      this.camera.updateProjectionMatrix();
    }
    renderer.setRenderTarget(null);
    renderer.render(this.scene, this.camera);
  }

  private syncCameraTransform(): void {
    const cosP = Math.cos(this.orbitPitch);
    const sinP = Math.sin(this.orbitPitch);
    const sinY = Math.sin(this.orbitYaw);
    const cosY = Math.cos(this.orbitYaw);

    this.camera.position.set(
      this.targetPos.x + sinY * cosP * this.orbitDistance,
      this.targetPos.y + sinP * this.orbitDistance,
      this.targetPos.z + cosY * cosP * this.orbitDistance,
    );
    this.camera.lookAt(this.targetPos);
    this.camera.updateMatrixWorld();
  }

  private pickAtClient(clientX: number, clientY: number): { worldId?: string; constellationId?: string } {
    if (!this.boundCanvas) return {};
    const rect = this.boundCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return {};
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const globeHits = this.raycaster.intersectObjects(this.globeHitMeshes, false);
    if (globeHits.length > 0) {
      const worldId = globeHits[0].object.userData.worldId as string | undefined;
      if (worldId) return { worldId };
    }

    const constHits = this.raycaster.intersectObjects(this.constellationHitMeshes, false);
    if (constHits.length > 0) {
      const constellationId = constHits[0].object.userData.constellationId as string | undefined;
      if (constellationId) return { constellationId };
    }

    return {};
  }

  private readonly handlePointerDown = (e: PointerEvent): void => {
    if (this.divingWorldId) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.boundCanvas?.setPointerCapture?.(e.pointerId);

    if (this.activePointers.size === 1) {
      this.primaryPointerId = e.pointerId;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      this.lastPointerX = e.clientX;
      this.lastPointerY = e.clientY;
      this.pointerDragged = false;
    } else if (this.activePointers.size === 2) {
      this.pointerDragged = true;
      const pts = [...this.activePointers.values()];
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  };

  private readonly handlePointerMove = (e: PointerEvent): void => {
    if (this.divingWorldId) return;
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        if (this.lastPinchDist > 0) {
          const delta = this.lastPinchDist - dist;
          this.applyZoomDelta(delta * 0.09);
        }
        this.lastPinchDist = dist;
        return;
      }

      if (e.pointerId === this.primaryPointerId) {
        const dx = e.clientX - this.lastPointerX;
        const dy = e.clientY - this.lastPointerY;
        this.lastPointerX = e.clientX;
        this.lastPointerY = e.clientY;
        if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) > 6) {
          this.pointerDragged = true;
          this.userHasInteracted = true;
        }
        const sens = e.pointerType === 'touch' ? 0.0068 : 0.0055;
        this.goalOrbitYaw -= dx * sens;
        this.goalOrbitPitch = THREE.MathUtils.clamp(this.goalOrbitPitch + dy * sens, -1.24, 1.32);
        return;
      }
    }

    // Passive hover picking on desktop
    if (e.pointerType === 'mouse' && this.activePointers.size === 0) {
      const hit = this.pickAtClient(e.clientX, e.clientY);
      const prevGlobe = this.hoveredGlobeId;
      const prevConst = this.hoveredConstellationId;
      this.hoveredGlobeId = hit.worldId ?? null;
      this.hoveredConstellationId = hit.constellationId ?? null;

      if (hit.worldId && hit.worldId !== prevGlobe) {
        const entry = this.globeById.get(hit.worldId);
        if (entry) entry.shakeEnergy = Math.max(entry.shakeEnergy, 0.45);
      }

      if (this.boundCanvas) {
        this.boundCanvas.style.cursor = hit.worldId || hit.constellationId ? 'pointer' : 'grab';
      }

      if (this.hoveredGlobeId !== prevGlobe || this.hoveredConstellationId !== prevConst) {
        const label = this.hoveredGlobeId
          ? this.globeById.get(this.hoveredGlobeId)?.placement.world.name ?? null
          : this.hoveredConstellationId
            ? this.constellationById.get(this.hoveredConstellationId)?.spec.name ?? null
            : null;
        this.callbacks.onHoverChange?.(label);
      }
    }
  };

  private readonly handlePointerUp = (e: PointerEvent): void => {
    const wasPrimary = e.pointerId === this.primaryPointerId;
    const wasTap = wasPrimary && !this.pointerDragged && this.activePointers.size === 1;
    this.activePointers.delete(e.pointerId);
    if (wasPrimary) this.primaryPointerId = null;
    if (this.activePointers.size < 2) this.lastPinchDist = 0;

    if (!wasTap || this.divingWorldId) return;

    const hit = this.pickAtClient(e.clientX, e.clientY);
    if (hit.worldId) {
      const now = performance.now();
      if (this.lastTapGlobeId === hit.worldId && now - this.lastTapAt < 380) {
        this.lastTapGlobeId = null;
        this.enterWorld(hit.worldId);
      } else {
        this.lastTapAt = now;
        this.lastTapGlobeId = hit.worldId;
        this.focusWorld(hit.worldId);
      }
    } else if (hit.constellationId) {
      this.lastTapGlobeId = null;
      this.focusConstellation(hit.constellationId);
    } else if (this.focusMode !== 'overview') {
      this.lastTapGlobeId = null;
      this.focusOverview();
    }
  };

  private readonly handleDoubleClick = (e: MouseEvent): void => {
    if (this.divingWorldId) return;
    const hit = this.pickAtClient(e.clientX, e.clientY);
    if (hit.worldId) {
      this.enterWorld(hit.worldId);
    }
  };

  private readonly handleWheel = (e: WheelEvent): void => {
    if (this.divingWorldId) return;
    e.preventDefault();
    this.userHasInteracted = true;
    this.applyZoomDelta(e.deltaY * 0.025);
  };

  private applyZoomDelta(delta: number): void {
    const minDist = this.focusMode === 'world' ? 4.8 : this.focusMode === 'constellation' ? 4.0 : 12.0;
    const maxDist = this.focusMode === 'world' ? 24.0 : this.focusMode === 'constellation' ? 22.0 : 96.0;
    this.goalOrbitDistance = THREE.MathUtils.clamp(this.goalOrbitDistance + delta, minDist, maxDist);
  }

  private readonly handleKeyDown = (e: KeyboardEvent): void => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
      return;
    }
    this.heldKeys.add(e.code);
    if (this.divingWorldId) return;

    if (e.code === 'ArrowRight' && !e.repeat) {
      e.preventDefault();
      if (this.focusMode === 'constellation') this.stepConstellation(1);
      else this.stepWorld(1);
    } else if (e.code === 'ArrowLeft' && !e.repeat) {
      e.preventDefault();
      if (this.focusMode === 'constellation') this.stepConstellation(-1);
      else this.stepWorld(-1);
    } else if (e.code === 'Space' && !e.repeat) {
      e.preventDefault();
      this.shakeGlobe(this.focusMode === 'world' ? (this.focusedWorldId ?? undefined) : undefined);
    } else if ((e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) {
      if (this.focusMode === 'world' && this.focusedWorldId) {
        e.preventDefault();
        this.enterWorld(this.focusedWorldId);
      }
    }
  };

  private readonly handleKeyUp = (e: KeyboardEvent): void => {
    this.heldKeys.delete(e.code);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachControls();
    for (const entry of this.globes) {
      entry.diorama.dispose();
      entry.labelTexture.dispose();
      for (const mat of entry.explorerMats) mat.dispose();
    }
    this.globes.length = 0;
    this.globeById.clear();
    this.constellations.length = 0;
    this.constellationById.clear();
    this.starBaseMatrices.length = 0;
    this.starPositions.length = 0;
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.geometries.length = 0;
    this.materials.length = 0;
    this.textures.length = 0;
  }
}
