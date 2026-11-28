/// <reference types="vite/client" />
import * as THREE from 'three/webgpu';
import { disposeObject, loadGLB } from '@portalverse/core/rooms/kit';
import type { RoomCollider } from '@portalverse/core/types';
import { DANCE_BPS, type DanceStyle } from './dancers';
import type { SpellHitTarget } from './spells';

// Static asset URLs (bundled cleanly by Vite, well under the 12 MiB room budget)
import gazeboUrl from './assets/dance_gazebo.glb?url';
import gramophoneUrl from './assets/dj_gramophone.glb?url';
import chimeTotemUrl from './assets/chime_totem.glb?url';
import starFountainUrl from './assets/star_fountain.glb?url';

export const STAGE_RADIUS = 11.2;

export const TURNTABLE_POS = Object.freeze({ x: -5.2, z: -6.2, yaw: 0.65 });

export const CHIME_TOTEM_SPOTS: ReadonlyArray<{ x: number; z: number; color: string }> = [
  { x: -7.4, z: -2.0, color: '#2dd4bf' },
  { x: 7.4, z: -2.0, color: '#ff2a85' },
  { x: 5.4, z: -6.2, color: '#fbbf24' },
];

export const GEYSER_SPOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: -5.6, z: 3.8 },
  { x: 5.6, z: 3.8 },
];

export const PRISM_ORB_SPOTS: ReadonlyArray<{ x: number; y: number; z: number; color: string }> = [
  { x: -4.6, y: 3.7, z: -4.6, color: '#fbbf24' },
  { x: 4.6, y: 3.7, z: -4.6, color: '#22d3ee' },
  { x: -4.6, y: 3.7, z: 4.6, color: '#ff2a85' },
  { x: 4.6, y: 3.7, z: 4.6, color: '#a855f7' },
];

export interface FloorPad {
  index: number;
  x: number;
  z: number;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  glow: number;
  cooldown: number;
}

export interface TotemState {
  index: number;
  x: number;
  z: number;
  color: string;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  crystalNode: THREE.Object3D | null;
  tetherBeam: THREE.Mesh;
  tetherMat: THREE.MeshBasicMaterial;
  litTimer: number;
  touchCooldown: number;
}

export interface GeyserState {
  index: number;
  x: number;
  z: number;
  group: THREE.Group;
  hitMesh: THREE.Mesh;
  ringNode: THREE.Object3D | null;
  burstTimer: number;
  cooldown: number;
}

export interface PrismOrbState {
  index: number;
  x: number;
  y: number;
  z: number;
  color: string;
  mesh: THREE.Mesh;
  hitMesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  beam: THREE.Mesh;
  beamMat: THREE.MeshBasicMaterial;
  spinBoost: number;
}

interface SparkParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
}

export interface StagePropsHandle {
  root: THREE.Group;
  interactiveMeshes: THREE.Object3D[];
  totems: TotemState[];
  geysers: GeyserState[];
  orbs: PrismOrbState[];
  floorPads: FloorPad[];
  collider: RoomCollider;
  triggerTotem: (index: number, colorHex?: string) => boolean;
  triggerOrb: (index: number, colorHex?: string) => void;
  triggerGeyserFx: (index: number) => void;
  triggerSparklers: (colorHex: string) => void;
  getTotemTargets: () => SpellHitTarget[];
  getOrbTargets: () => SpellHitTarget[];
  allTotemsLit: () => boolean;
  update: (dt: number, elapsed: number, style: DanceStyle, overdrive: boolean) => void;
  dispose: () => void;
}

/**
 * Loads Claude's 4 sculpted Blender hero GLBs (`dance_gazebo`, `dj_gramophone`,
 * `chime_totem`, `star_fountain`) plus procedural harmonic floor pads, hovering
 * mirror-prism disco orbs, chandelier beam tethers, and rim sparkler cannons.
 */
export function buildStageProps(
  onTotemLit: (index: number, allLitNow: boolean) => void,
  onOrbSpin: (index: number) => void,
): StagePropsHandle {
  const root = new THREE.Group();
  root.name = 'starlight-stage-props';

  const ownedGeos: THREE.BufferGeometry[] = [];
  const ownedMats: THREE.Material[] = [];
  const loadedRoots: THREE.Object3D[] = [];
  const interactiveMeshes: THREE.Object3D[] = [];
  let disposed = false;

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    ownedGeos.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    ownedMats.push(m);
    return m;
  };

  let chandelierNode: THREE.Object3D | null = null;
  let platterNode: THREE.Object3D | null = null;
  const eqBarMats: THREE.MeshStandardMaterial[] = [];

  // --- 1. Pavilion Gazebo container + fallback chandelier ---
  const gazeboGroup = new THREE.Group();
  gazeboGroup.name = 'pavilion-gazebo-holder';
  root.add(gazeboGroup);

  const fallbackChandelier = new THREE.Mesh(
    trackGeo(new THREE.OctahedronGeometry(0.85, 1)),
    trackMat(
      new THREE.MeshStandardMaterial({
        color: '#e0f2fe',
        emissive: '#fbbf24',
        emissiveIntensity: 0.9,
        metalness: 0.7,
        roughness: 0.15,
      }),
    ),
  );
  fallbackChandelier.position.set(0, 7.6, 0);
  gazeboGroup.add(fallbackChandelier);
  chandelierNode = fallbackChandelier;

  // --- 2. Celestial Turntable Console ---
  const turntableGroup = new THREE.Group();
  turntableGroup.position.set(TURNTABLE_POS.x, 0, TURNTABLE_POS.z);
  turntableGroup.rotation.y = TURNTABLE_POS.yaw;
  root.add(turntableGroup);

  const turntableHit = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(1.25, 1.25, 1.9, 12)),
    trackMat(new THREE.MeshBasicMaterial({ visible: false })),
  );
  turntableHit.position.y = 0.95;
  turntableHit.userData.propKind = 'turntable';
  turntableGroup.add(turntableHit);
  interactiveMeshes.push(turntableHit);

  const fallbackPlatter = new THREE.Mesh(
    trackGeo(new THREE.CylinderGeometry(0.42, 0.42, 0.08, 24)),
    trackMat(new THREE.MeshStandardMaterial({ color: '#fbbf24', emissive: '#f59e0b', emissiveIntensity: 0.6 })),
  );
  fallbackPlatter.position.set(0, 1.06, 0);
  turntableGroup.add(fallbackPlatter);
  platterNode = fallbackPlatter;

  // --- 3. 12 Harmonic Musical Floor Petal Pads (flat & walkable) ---
  const floorPads: FloorPad[] = [];
  const padGeo = trackGeo(new THREE.CylinderGeometry(0.62, 0.68, 0.03, 6));
  const padPalette = [
    '#2dd4bf', '#38bdf8', '#818cf8', '#c084fc', '#f472b6', '#fbbf24',
    '#34d399', '#22d3ee', '#a78bfa', '#e879f9', '#fb7185', '#f59e0b',
  ];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const x = Math.cos(a) * 4.65;
    const z = Math.sin(a) * 4.65;
    const mat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#1e293b',
        emissive: new THREE.Color(padPalette[i]),
        emissiveIntensity: 0.28,
        roughness: 0.35,
        metalness: 0.45,
      }),
    );
    const mesh = new THREE.Mesh(padGeo, mat);
    mesh.position.set(x, 0.016, z);
    mesh.rotation.y = a;
    root.add(mesh);
    floorPads.push({ index: i, x, z, mesh, mat, glow: 0, cooldown: 0 });
  }

  // --- 4. 3 Harmonic Crystal Chime Totems + Chandelier Light Tethers ---
  const totems: TotemState[] = [];
  const tetherGeo = trackGeo(new THREE.CylinderGeometry(0.045, 0.09, 1, 8, 1, true));
  const fallbackCrystalGeo = trackGeo(new THREE.OctahedronGeometry(0.32, 0));

  CHIME_TOTEM_SPOTS.forEach((spot, index) => {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    group.rotation.y = Math.atan2(-spot.x, -spot.z);
    root.add(group);

    const hitMesh = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(0.9, 0.9, 4.4, 10)),
      trackMat(new THREE.MeshBasicMaterial({ visible: false })),
    );
    hitMesh.position.y = 2.2;
    hitMesh.userData.propKind = 'totem';
    hitMesh.userData.propIndex = index;
    group.add(hitMesh);
    interactiveMeshes.push(hitMesh);

    const fbCrystal = new THREE.Mesh(
      fallbackCrystalGeo,
      trackMat(
        new THREE.MeshStandardMaterial({
          color: spot.color,
          emissive: spot.color,
          emissiveIntensity: 1.0,
          roughness: 0.15,
        }),
      ),
    );
    fbCrystal.position.y = 3.25;
    group.add(fbCrystal);

    // Light tether from crystal (spot.x, 3.3, spot.z) to overhead chandelier (0, 7.6, 0)
    const start = new THREE.Vector3(spot.x, 3.3, spot.z);
    const end = new THREE.Vector3(0, 7.6, 0);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const len = start.distanceTo(end);
    const tetherMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: spot.color,
        transparent: true,
        opacity: 0.0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    const tetherBeam = new THREE.Mesh(tetherGeo, tetherMat);
    tetherBeam.position.copy(mid);
    tetherBeam.scale.set(1, len, 1);
    tetherBeam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    root.add(tetherBeam);

    totems.push({
      index,
      x: spot.x,
      z: spot.z,
      color: spot.color,
      group,
      hitMesh,
      crystalNode: fbCrystal,
      tetherBeam,
      tetherMat,
      litTimer: 0,
      touchCooldown: 0,
    });
  });

  // --- 5. 2 Zero-G Star Geyser Launch Pads ---
  const geysers: GeyserState[] = [];
  const fbRingGeo = trackGeo(new THREE.TorusGeometry(1.15, 0.06, 10, 32));
  fbRingGeo.rotateX(Math.PI / 2);

  GEYSER_SPOTS.forEach((spot, index) => {
    const group = new THREE.Group();
    group.position.set(spot.x, 0, spot.z);
    root.add(group);

    const hitMesh = new THREE.Mesh(
      trackGeo(new THREE.CylinderGeometry(1.55, 1.55, 0.5, 16)),
      trackMat(new THREE.MeshBasicMaterial({ visible: false })),
    );
    hitMesh.position.y = 0.25;
    hitMesh.userData.propKind = 'geyser';
    hitMesh.userData.propIndex = index;
    group.add(hitMesh);
    interactiveMeshes.push(hitMesh);

    const fbRing = new THREE.Mesh(
      fbRingGeo,
      trackMat(
        new THREE.MeshStandardMaterial({
          color: '#fbbf24',
          emissive: '#22d3ee',
          emissiveIntensity: 1.1,
          metalness: 0.7,
          roughness: 0.2,
        }),
      ),
    );
    fbRing.position.y = 0.24;
    group.add(fbRing);

    geysers.push({
      index,
      x: spot.x,
      z: spot.z,
      group,
      hitMesh,
      ringNode: fbRing,
      burstTimer: 0,
      cooldown: 0,
    });
  });

  // --- 6. 4 Hovering Mirror-Prism Disco Orbs ---
  const orbs: PrismOrbState[] = [];
  const orbGeo = trackGeo(new THREE.IcosahedronGeometry(0.48, 0));
  const orbBeamGeo = trackGeo(new THREE.ConeGeometry(1.45, 4.2, 16, 1, true));
  orbBeamGeo.translate(0, -2.1, 0);

  PRISM_ORB_SPOTS.forEach((spot, index) => {
    const mat = trackMat(
      new THREE.MeshStandardMaterial({
        color: '#f8fafc',
        emissive: new THREE.Color(spot.color),
        emissiveIntensity: 0.75,
        metalness: 0.9,
        roughness: 0.08,
        flatShading: true,
      }),
    );
    const mesh = new THREE.Mesh(orbGeo, mat);
    mesh.position.set(spot.x, spot.y, spot.z);
    mesh.userData.propKind = 'orb';
    mesh.userData.propIndex = index;
    root.add(mesh);
    interactiveMeshes.push(mesh);

    const beamMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: spot.color,
        transparent: true,
        opacity: 0.12,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const beam = new THREE.Mesh(orbBeamGeo, beamMat);
    mesh.add(beam);

    orbs.push({
      index,
      x: spot.x,
      y: spot.y,
      z: spot.z,
      color: spot.color,
      mesh,
      hitMesh: mesh,
      mat,
      beam,
      beamMat,
      spinBoost: 0,
    });
  });

  // --- 7. Rim Sparkler Cannon Particle Pool ---
  const sparkGeo = trackGeo(new THREE.OctahedronGeometry(0.08, 0));
  const sparkMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: '#fbbf24',
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  const sparks: SparkParticle[] = [];

  const spawnSparklerVolley = (colorHex: string): void => {
    sparkMat.color.set(colorHex);
    for (let c = 0; c < 8; c++) {
      const a = (c * Math.PI) / 4 + Math.PI / 8;
      const cx = Math.cos(a) * 9.85;
      const cz = Math.sin(a) * 9.85;
      for (let p = 0; p < 4; p++) {
        if (sparks.length > 72) break;
        const m = new THREE.Mesh(sparkGeo, sparkMat);
        m.position.set(cx, 0.35, cz);
        root.add(m);
        sparks.push({
          mesh: m,
          vx: -Math.cos(a) * (1.2 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.2,
          vy: 4.4 + Math.random() * 2.8,
          vz: -Math.sin(a) * (1.2 + Math.random() * 1.4) + (Math.random() - 0.5) * 1.2,
          life: 0,
          maxLife: 0.95 + Math.random() * 0.45,
        });
      }
    }
  };

  // --- 8. Lazy-load Claude's 4 Blender GLBs (skipped safely in headless Node Vitest!) ---
  const canFetch = typeof fetch === 'function' && typeof window !== 'undefined';
  if (canFetch) {
    void loadGLB(gazeboUrl)
      .then((gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        fallbackChandelier.visible = false;
        loadedRoots.push(gltf.scene);
        gazeboGroup.add(gltf.scene);
        chandelierNode = gltf.scene.getObjectByName('ChandelierCore') ?? fallbackChandelier;
      })
      .catch((err) => console.warn('[starlight-pavilion] dance_gazebo.glb load skipped:', err));

    void loadGLB(gramophoneUrl)
      .then((gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        fallbackPlatter.visible = false;
        loadedRoots.push(gltf.scene);
        turntableGroup.add(gltf.scene);
        platterNode = gltf.scene.getObjectByName('TurntablePlatter') ?? fallbackPlatter;
        // Collect Starlight_Eq0..Starlight_Eq6 materials for live 88 BPM equalizer pulsing!
        const foundEq = new Map<number, THREE.MeshStandardMaterial>();
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            if (m instanceof THREE.MeshStandardMaterial) {
              const match = /^Starlight_Eq(\d+)$/.exec(m.name);
              if (match) foundEq.set(Number(match[1]), m);
            }
          }
        });
        [...foundEq.entries()]
          .sort((a, b) => a[0] - b[0])
          .forEach(([, m]) => eqBarMats.push(m));
      })
      .catch((err) => console.warn('[starlight-pavilion] dj_gramophone.glb load skipped:', err));

    void loadGLB(chimeTotemUrl)
      .then((gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        loadedRoots.push(gltf.scene);
        totems.forEach((totem, i) => {
          const clone = i === 0 ? gltf.scene : gltf.scene.clone(true);
          if (i > 0) loadedRoots.push(clone);
          if (totem.crystalNode) totem.crystalNode.visible = false;
          totem.group.add(clone);
          totem.crystalNode = clone.getObjectByName('ChimeCrystal') ?? totem.crystalNode;
        });
      })
      .catch((err) => console.warn('[starlight-pavilion] chime_totem.glb load skipped:', err));

    void loadGLB(starFountainUrl)
      .then((gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        loadedRoots.push(gltf.scene);
        geysers.forEach((geyser, i) => {
          const clone = i === 0 ? gltf.scene : gltf.scene.clone(true);
          if (i > 0) loadedRoots.push(clone);
          if (geyser.ringNode) geyser.ringNode.visible = false;
          geyser.group.add(clone);
          geyser.ringNode = clone.getObjectByName('GeyserRing') ?? geyser.ringNode;
        });
      })
      .catch((err) => console.warn('[starlight-pavilion] star_fountain.glb load skipped:', err));
  }

  // --- 9. Smooth Cylinder Colliders (8 pavilion columns + 3 totems + turntable — X=0 promenade 100% open!) ---
  const solidCylinders: Array<{ x: number; z: number; r: number }> = [
    { x: TURNTABLE_POS.x, z: TURNTABLE_POS.z, r: 1.05 },
    ...CHIME_TOTEM_SPOTS.map((s) => ({ x: s.x, z: s.z, r: 0.72 })),
  ];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8; // 22.5° + k*45° -> completely clear of ±Z promenade!
    solidCylinders.push({ x: Math.cos(a) * 10.8, z: Math.sin(a) * 10.8, r: 0.65 });
  }

  const collider: RoomCollider = {
    move(_from, to, radius) {
      let x = to[0];
      let z = to[2];
      for (const c of solidCylinders) {
        const dx = x - c.x;
        const dz = z - c.z;
        const minDist = c.r + radius;
        const dSq = dx * dx + dz * dz;
        if (dSq < minDist * minDist) {
          const d = Math.sqrt(dSq) || 0.001;
          x = c.x + (dx / d) * minDist;
          z = c.z + (dz / d) * minDist;
        }
      }
      return [x, z];
    },
  };

  const allTotemsLit = () => totems.every((t) => t.litTimer > 0.1);

  const triggerTotem = (index: number, colorHex?: string): boolean => {
    const t = totems[index];
    if (!t) return false;
    const wasAll = allTotemsLit();
    t.litTimer = 11.0;
    t.touchCooldown = 1.4;
    if (colorHex) t.tetherMat.color.set(colorHex);
    else t.tetherMat.color.set(t.color);
    const nowAll = allTotemsLit();
    onTotemLit(index, nowAll && !wasAll);
    return true;
  };

  const triggerOrb = (index: number, colorHex?: string): void => {
    const orb = orbs[index];
    if (!orb) return;
    orb.spinBoost = 1.0;
    if (colorHex) {
      orb.beamMat.color.set(colorHex);
      orb.mat.emissive.set(colorHex);
    }
    onOrbSpin(index);
  };

  const triggerGeyserFx = (index: number): void => {
    const g = geysers[index];
    if (!g) return;
    g.burstTimer = 1.35;
    g.cooldown = 1.8;
  };

  return {
    root,
    interactiveMeshes,
    totems,
    geysers,
    orbs,
    floorPads,
    collider,
    triggerTotem,
    triggerOrb,
    triggerGeyserFx,
    triggerSparklers: spawnSparklerVolley,
    getTotemTargets: () =>
      totems.map((t) => ({
        x: t.x,
        z: t.z,
        radius: 1.1,
        onHit: (col) => triggerTotem(t.index, col),
      })),
    getOrbTargets: () =>
      orbs.map((o) => ({
        x: o.x,
        z: o.z,
        radius: 1.2,
        onHit: (col) => triggerOrb(o.index, col),
      })),
    allTotemsLit,
    update(dt, elapsed, style, overdrive) {
      const step = Math.min(Math.max(dt, 0), 0.05);
      const beatPulse = 0.5 + 0.5 * Math.sin(elapsed * DANCE_BPS * Math.PI * 2);

      // Spin overhead mirror-prism chandelier
      if (chandelierNode) {
        chandelierNode.rotation.y += step * (overdrive ? 1.85 : style === 'hypergroove' ? 0.95 : 0.45);
      }
      // Spin Celestial Turntable platter at 88 BPM vinyl cadence + pulse EQ bars!
      if (platterNode) {
        platterNode.rotation.y += step * Math.PI * DANCE_BPS * (style === 'hypergroove' ? 1.2 : 0.85);
      }
      for (let i = 0; i < eqBarMats.length; i++) {
        const wave = 0.5 + 0.5 * Math.sin(elapsed * DANCE_BPS * Math.PI * (style === 'hypergroove' ? 4 : 2) + i * 0.85);
        eqBarMats[i].emissiveIntensity = 0.55 + wave * (overdrive ? 2.4 : 1.55);
      }

      // Decay harmonic floor pads
      for (const pad of floorPads) {
        pad.cooldown = Math.max(0, pad.cooldown - step);
        pad.glow = Math.max(0, pad.glow - step * 1.15);
        pad.mat.emissiveIntensity = 0.25 + pad.glow * 2.1 + (overdrive ? beatPulse * 0.65 : 0);
      }

      // Update Harmonic Chime Totems & light tethers
      for (const t of totems) {
        t.litTimer = Math.max(0, t.litTimer - step);
        t.touchCooldown = Math.max(0, t.touchCooldown - step);
        const lit = t.litTimer > 0;
        if (t.crystalNode) {
          t.crystalNode.rotation.y += step * (lit ? 4.8 : 0.85);
          t.crystalNode.position.y = 3.25 + Math.sin(elapsed * (lit ? 6 : 2.1) + t.index) * (lit ? 0.16 : 0.08);
        }
        t.tetherMat.opacity = lit ? (0.42 + beatPulse * 0.28) * Math.min(1, t.litTimer) : 0;
      }

      // Update Zero-G Star Geyser pads
      for (const g of geysers) {
        g.burstTimer = Math.max(0, g.burstTimer - step);
        g.cooldown = Math.max(0, g.cooldown - step);
        if (g.ringNode) {
          g.ringNode.rotation.y += step * (g.burstTimer > 0 ? 7.5 : 1.1);
          g.ringNode.position.y = 0.24 + (g.burstTimer > 0 ? Math.sin(g.burstTimer * Math.PI) * 1.15 : Math.sin(elapsed * 2.4 + g.index) * 0.05);
        }
      }

      // Update Hovering Mirror-Prism Disco Orbs
      for (const o of orbs) {
        o.spinBoost = Math.max(0, o.spinBoost - step * 0.35);
        o.mesh.rotation.y += step * (0.9 + o.spinBoost * 7.2 + (overdrive ? 2.5 : 0));
        o.mesh.rotation.x = Math.sin(elapsed * 1.2 + o.index) * 0.35;
        o.mesh.position.y = o.y + Math.sin(elapsed * 1.8 + o.index * 1.5) * 0.22;
        o.beamMat.opacity = 0.1 + o.spinBoost * 0.38 + (overdrive ? 0.16 : 0);
        o.mat.emissiveIntensity = 0.65 + o.spinBoost * 1.65 + beatPulse * 0.3;
      }

      // Update Rim Sparkler particles
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life += step;
        if (s.life >= s.maxLife) {
          root.remove(s.mesh);
          sparks.splice(i, 1);
          continue;
        }
        const t = s.life / s.maxLife;
        s.mesh.position.x += s.vx * step;
        s.mesh.position.y += s.vy * step;
        s.mesh.position.z += s.vz * step;
        s.vy -= 7.5 * step;
        s.mesh.scale.setScalar(Math.max(0.05, 1 - t));
      }
    },
    dispose() {
      disposed = true;
      for (const s of sparks) root.remove(s.mesh);
      sparks.length = 0;
      for (const r of loadedRoots) disposeObject(r);
      loadedRoots.length = 0;
      for (const g of ownedGeos) g.dispose();
      for (const m of ownedMats) m.dispose();
    },
  };
}
