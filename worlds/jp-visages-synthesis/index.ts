/// <reference types="vite/client" />
/**
 * VISAGES — SYNTHESIS (`jp-visages-synthesis`)
 *
 * A unified synthesis of the strongest elements across the three Visages studies:
 *  - Neon's monumental composition, ruined background monoliths, scattered debris, pale
 *    limestone visages with dark smudges, readable moonlit chiaroscuro, and richly
 *    integrated organic blood pools (wet halos, arterial depth shifts, live foot ripples).
 *  - Structurally coherent single-layer cobblestones (one laid stone layout with per-stone
 *    tone, beveled edges, recessed mortar, natural surface grain, and rare within-stone
 *    hairline fractures — no nested Voronoi grids) and non-tiled 3D-shaded rubble/pillars.
 *  - Claude's convincingly recessed and asymmetrically patchy face cracks, thin blood trails
 *    weeping down the cheeks, moon-and-cloud night sky, and textured uneven dirt beside
 *    the cobbled road (without triangular snow particles).
 *  - Codex's endless procession with camera-selected head LOD, and the selected A-style
 *    moon-mirror eyes. Earlier eye treatments remain in the optional blind study.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cameraPosition,
  clamp,
  color,
  cos,
  dot,
  exp,
  faceDirection,
  float,
  floor,
  fract,
  hash,
  max,
  min,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalGeometry,
  normalView,
  normalWorld,
  normalWorldGeometry,
  positionGeometry,
  positionView,
  positionViewDirection,
  positionWorld,
  pow,
  reflectVector,
  sin,
  smoothstep,
  texture,
  time,
  uniform,
  uniformArray,
  vec2,
  vec3,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { breathe } from '@portalverse/core/rooms/kit';
import headUrl from './assets/female_human_head_game.glb?url';
import reliefUrl from './assets/pentagram-relief.png?url';
import { RING_RADIUS } from './prayer';
import { mountPrayer } from './prayerEffects';
import { createWinningEyes } from './eyes';
import { loadHeadLods } from './headLods';
import { RippleTrail, poolCoverage, RIPPLE_CAPACITY, RIPPLE_LIFETIME } from './ripples';
import { createVisibleHeads, spatialGroups } from './visibility';
import { DEFAULT_TUNING, type VisagesTuning } from './tuning';
import {
  EYE_STUDY_HEADS, EYE_STUDY_KEY, EYE_STUDY_LABELS,
  eyeStudyCollider, studyEyeMaterial, studyReflectionMap,
} from './eyeStudy';
import {
  buildVisageSynthesisPlan,
  createVisageCollider,
  HEAD_PAIR_HALF_COUNT,
  HEAD_SPACING,
  PATH_HALF_WIDTH,
  terrainHeightAt,
  WALK_BOUNDS,
  type HeadPlacement,
  type VisageSynthesisPlan,
} from './layout';
import {
  buildPillarGeometries,
  buildRockGeometries,
  copyOfGeometry,
  loadSplitHead,
  type SplitHeadAssets,
} from './headGeometry';
import {
  COBBLE_TEX_SIZE,
  cobbleMapPixels,
  ENV_SKY_HEIGHT,
  ENV_SKY_WIDTH,
  reflectionSkyPixels,
  STONE_NOISE_SIZE,
  stoneNoisePixels,
} from './textures';

type FloatNode = THREE.Node<'float'>;
type Vec3Node = THREE.Node<'vec3'>;

const VOID_DARK = '#06080f';
const SKY_ZENITH = '#020308';
/** Moon hangs ahead down the avenue (-Z) so it frames the endless heads and aligns with reflections. */
const MOON_DIR = new THREE.Vector3(-0.24, 0.72, -0.65).normalize();
const RIM_DIR = new THREE.Vector3(0.42, 0.58, 0.69).normalize();

/** Gentle extra distance falloff so far geometry merges seamlessly into VOID_DARK before ±392 m. */
const DARK_NEAR = 115;
const DARK_FAR = 330;

interface SharedSynthesisLayout {
  plan: VisageSynthesisPlan;
  headAssets: SplitHeadAssets;
  groundGeometry: THREE.BufferGeometry;
  rockShapes: THREE.BufferGeometry[];
  pillarShapes: THREE.BufferGeometry[];
  allHeadMatrices: THREE.Matrix4[];
  rockMatrices: THREE.Matrix4[][];
  rockMeta: Float32Array[];
  pillarMatrices: THREE.Matrix4[][];
  pillarMeta: Float32Array[];
}

let sharedPromise: Promise<SharedSynthesisLayout> | undefined;

function sharedSynthesisLayout(): Promise<SharedSynthesisLayout> {
  sharedPromise ??= buildSharedLayout().catch(err => {
    sharedPromise = undefined;
    throw err;
  });
  return sharedPromise;
}

async function buildSharedLayout(): Promise<SharedSynthesisLayout> {
  const moonTuple = [MOON_DIR.x, MOON_DIR.y, MOON_DIR.z] as const;
  const [headAssets] = await Promise.all([
    loadSplitHead(headUrl),
    cobbleMapPixels(),
    stoneNoisePixels(),
    reflectionSkyPixels(moonTuple),
  ]);
  await breathe();

  const plan = buildVisageSynthesisPlan();
  await breathe();

  // High-density non-uniform ground mesh: crisp 1 m X detail along the cobbled road and uneven
  // dirt banks beside it, wider spacing deep in the dark flanks, stretching ±440 m along Z.
  const xs: number[] = [];
  for (let x = -140; x < -26; x += 6) xs.push(x);
  for (let x = -26; x <= 26; x += 1) xs.push(x);
  for (let x = 32; x <= 140; x += 6) xs.push(x);

  const reachZ = (HEAD_PAIR_HALF_COUNT + 1) * HEAD_SPACING + 20; // ±440 m
  const zs: number[] = [];
  for (let z = -reachZ; z <= reachZ; z += 3.0) zs.push(z);

  const gPos = new Float32Array(xs.length * zs.length * 3);
  let ptr = 0;
  for (let j = 0; j < zs.length; j++) {
    const z = zs[j];
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      gPos[ptr++] = x;
      gPos[ptr++] = terrainHeightAt(x, z);
      gPos[ptr++] = z;
    }
    if ((j & 15) === 15) await breathe();
  }

  const gIdx = new Uint32Array((xs.length - 1) * (zs.length - 1) * 6);
  ptr = 0;
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = j * xs.length + i;
      const b = a + 1;
      const c = a + xs.length;
      const d = c + 1;
      gIdx[ptr++] = a;
      gIdx[ptr++] = c;
      gIdx[ptr++] = b;
      gIdx[ptr++] = b;
      gIdx[ptr++] = c;
      gIdx[ptr++] = d;
    }
  }
  const groundGeometry = new THREE.BufferGeometry();
  groundGeometry.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  groundGeometry.setIndex(new THREE.BufferAttribute(gIdx, 1));
  groundGeometry.computeVertexNormals();
  groundGeometry.computeBoundingSphere();
  await breathe();

  const rockShapes = buildRockGeometries();
  const pillarShapes = buildPillarGeometries();
  await breathe();

  const q = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  const makeHeadMatrix = (h: HeadPlacement) => {
    euler.set(0, h.yaw, 0, 'YXZ');
    return new THREE.Matrix4().compose(
      pos.set(h.x, h.y, h.z),
      q.setFromEuler(euler),
      scl.set(h.scale, h.scale, h.scale),
    );
  };

  const allHeadMatrices = plan.heads.map(makeHeadMatrix);

  const rockMatrices: THREE.Matrix4[][] = rockShapes.map(() => []);
  const rockMetaLists: number[][] = rockShapes.map(() => []);
  for (const r of plan.rubble) {
    const bucket = r.variant % rockShapes.length;
    euler.set(r.rotX, r.rotY, r.rotZ, 'YXZ');
    rockMatrices[bucket].push(
      new THREE.Matrix4().compose(
        pos.set(r.x, r.y, r.z),
        q.setFromEuler(euler),
        scl.set(r.scaleX, r.scaleY, r.scaleZ),
      ),
    );
    // Per-instance 3D noise seed offset (xyz) + brightness shade (w) to eliminate any stone tiling.
    const s1 = (r.seed * 73.13) % 31;
    const s2 = (r.seed * 191.77 + 11.3) % 31;
    const s3 = (r.seed * 347.29 + 5.7) % 31;
    rockMetaLists[bucket].push(s1, s2, s3, r.shade);
  }
  const rockMeta = rockMetaLists.map(arr => new Float32Array(arr));

  const pillarMatrices: THREE.Matrix4[][] = pillarShapes.map(() => []);
  const pillarMetaLists: number[][] = pillarShapes.map(() => []);
  for (const p of plan.pillars) {
    const bucket = p.variant % pillarShapes.length;
    euler.set(p.tiltX, p.yaw, p.tiltZ, 'YXZ');
    pillarMatrices[bucket].push(
      new THREE.Matrix4().compose(
        pos.set(p.x, p.y, p.z),
        q.setFromEuler(euler),
        scl.set(p.width, p.height, p.depth),
      ),
    );
    const s1 = (p.seed * 59.41) % 29;
    const s2 = (p.seed * 137.83 + 7.1) % 29;
    const s3 = (p.seed * 263.17 + 13.9) % 29;
    pillarMetaLists[bucket].push(s1, s2, s3, 0.35 + (p.seed % 0.65));
  }
  const pillarMeta = pillarMetaLists.map(arr => new Float32Array(arr));

  return {
    plan,
    headAssets,
    groundGeometry,
    rockShapes,
    pillarShapes,
    allHeadMatrices,
    rockMatrices,
    rockMeta,
    pillarMatrices,
    pillarMeta,
  };
}

/** Perturb the view-space normal by a metric height field using screen-space derivatives. */
function bumpNormal(height: FloatNode): Vec3Node {
  return Fn(() => {
    const dpdx = positionView.dFdx();
    const dpdy = positionView.dFdy();
    const r1 = dpdy.cross(normalView);
    const r2 = normalView.cross(dpdx);
    const det = dpdx.dot(r1).mul(faceDirection);
    const grad = det.sign().mul(r1.mul(height.dFdx()).add(r2.mul(height.dFdy())));
    return det.abs().add(1e-5).mul(normalView).sub(grad).normalize();
  })() as Vec3Node;
}

/** Analytic mirror reflection of the moonlit night sky, silver clouds, and crisp moon disc. */
function mirroredSky(dir: Vec3Node): Vec3Node {
  const up = clamp(dir.y, 0, 1);
  const sky = mix(color('#1c2a36'), color('#070b12'), pow(up, 0.62));
  const cloudReflect = smoothstep(0.15, 0.72, mx_noise_float(vec3(dir.x.mul(2.1), dir.y.mul(4.0), dir.z.mul(2.1))).mul(0.5).add(0.5))
    .mul(smoothstep(0.05, 0.4, up))
    .mul(0.28);
  const towardMoon = max(dot(dir, vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z)), 0);
  const moonGlint = pow(towardMoon, 900).mul(26).add(pow(towardMoon, 80).mul(0.65)).add(pow(towardMoon, 9).mul(0.08));
  const towardRim = max(dot(dir, vec3(RIM_DIR.x, RIM_DIR.y, RIM_DIR.z)), 0);
  const rimGlint = pow(towardRim, 140).mul(0.55);
  return sky
    .add(color('#2d4354').mul(cloudReflect))
    .add(color('#e2f0ff').mul(moonGlint))
    .add(color('#9cc0d6').mul(rimGlint)) as Vec3Node;
}

function schlickFresnel(normal: Vec3Node, f0: number): FloatNode {
  const facing = clamp(dot(normal, positionViewDirection), 0, 1);
  return float(f0).add(float(1 - f0).mul(pow(float(1).sub(facing), 5))) as FloatNode;
}

export default defineRoom('jp-visages-synthesis', {
  async mount(ctx) {
    const eyeStudy = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('eyes') === 'compare';
    const [layout, headLods] = await Promise.all([sharedSynthesisLayout(), loadHeadLods()]);
    const root = new THREE.Group();
    ctx.scene.add(root);
    const roomBrightness = uniform(1);
    const bloodBrightness = uniform(1);
    const bloodShallow = uniform(new THREE.Color('#961018'));
    const bloodDeep = uniform(new THREE.Color('#340206'));
    const bloodGlow = uniform(new THREE.Color('#52060c'));
    const bloodTrail = uniform(new THREE.Color('#5c0407'));

    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const textures: THREE.Texture[] = [];
    const instanced: THREE.InstancedMesh[] = [];

    const ownGeo = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const ownMat = <T extends THREE.Material>(m: T): T => {
      materials.push(m);
      return m;
    };
    const ownTex = <T extends THREE.Texture>(t: T): T => {
      textures.push(t);
      return t;
    };

    ctx.setTerrainHeight(terrainHeightAt);
    ctx.setWalkBounds(WALK_BOUNDS);
    const avenueCollider = createVisageCollider(layout.plan.heads, layout.plan.pillars);
    ctx.setCollider(eyeStudy ? eyeStudyCollider(avenueCollider) : avenueCollider);
    if (eyeStudy) ctx.configureSpawn({ position: [0, 0, 34], yaw: 0, pitch: 0.12 });

    const moonTuple = [MOON_DIR.x, MOON_DIR.y, MOON_DIR.z] as const;
    const [cobbleData, stoneNoiseData, envSkyData, relief] = await Promise.all([
      cobbleMapPixels(),
      stoneNoisePixels(),
      reflectionSkyPixels(moonTuple),
      new THREE.TextureLoader().loadAsync(reliefUrl),
    ]);
    ownTex(relief);
    // The black strokes of the supplied SVG, inverted and softly bevelled into a metric height profile.
    relief.colorSpace = THREE.NoColorSpace;
    const headIndex = layout.plan.heads.reduce((best, h, i, heads) =>
      h.x * h.x + h.z * h.z < heads[best].x ** 2 + heads[best].z ** 2 ? i : best, 0);
    const headMatrix = layout.allHeadMatrices[headIndex];
    const sockets = [layout.headAssets.leftEyeCenter, layout.headAssets.rightEyeCenter]
      .map(center => center.clone().applyMatrix4(headMatrix));
    const eyeSize = layout.headAssets.eyeRadius * layout.plan.heads[headIndex].scale;
    // Surface hits at the projected centres of the exposed eyeballs, measured through
    // the lids from the pentagram. These landmarks are in the normalized head mesh.
    const irises = [new THREE.Vector3(0.8814, 3.3508, 2.1897), new THREE.Vector3(-0.8580, 3.3523, 2.1878)]
      .map(iris => iris.applyMatrix4(headMatrix));
    const prayer = mountPrayer(ctx, root, irises, eyeSize);
    const socketDistance = min(positionWorld.distance(vec3(sockets[0])), positionWorld.distance(vec3(sockets[1])));

    const cobbleTex = ownTex(
      new THREE.DataTexture(
        cobbleData,
        COBBLE_TEX_SIZE,
        COBBLE_TEX_SIZE,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      ),
    );
    cobbleTex.wrapS = THREE.RepeatWrapping;
    cobbleTex.wrapT = THREE.RepeatWrapping;
    cobbleTex.magFilter = THREE.LinearFilter;
    cobbleTex.minFilter = THREE.LinearMipmapLinearFilter;
    cobbleTex.generateMipmaps = true;
    cobbleTex.colorSpace = THREE.NoColorSpace;
    cobbleTex.needsUpdate = true;

    const stoneNoiseTex = ownTex(
      new THREE.DataTexture(
        stoneNoiseData,
        STONE_NOISE_SIZE,
        STONE_NOISE_SIZE,
        THREE.RGBAFormat,
        THREE.UnsignedByteType,
      ),
    );
    stoneNoiseTex.wrapS = THREE.RepeatWrapping;
    stoneNoiseTex.wrapT = THREE.RepeatWrapping;
    stoneNoiseTex.magFilter = THREE.LinearFilter;
    stoneNoiseTex.minFilter = THREE.LinearMipmapLinearFilter;
    stoneNoiseTex.generateMipmaps = true;
    stoneNoiseTex.colorSpace = THREE.NoColorSpace;
    stoneNoiseTex.needsUpdate = true;

    const reflectionEnv = ownTex(
      new THREE.DataTexture(
        envSkyData,
        ENV_SKY_WIDTH,
        ENV_SKY_HEIGHT,
        THREE.RGBAFormat,
        THREE.FloatType,
      ),
    );
    reflectionEnv.mapping = THREE.EquirectangularReflectionMapping;
    reflectionEnv.needsUpdate = true;

    ctx.onDispose(() => {
      ctx.scene.remove(root);
      ctx.scene.backgroundNode = null;
      ctx.scene.fog = null;
      for (const im of instanced) im.dispose();
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    });

    // -------------------------------------------------------------------------
    // 0. MOONLIT CLOUD SKY, EXPONENTIAL NIGHT FOG & READABLE CHIAROSCURO LIGHTS
    // -------------------------------------------------------------------------
    {
      const dir = normalWorldGeometry;
      const up = clamp(dir.y, 0, 1);
      const skyBase = mix(color(VOID_DARK), color(SKY_ZENITH), smoothstep(0.0, 0.72, up));
      const cloudCoord = vec3(dir.x.mul(2.1), dir.y.mul(4.8), dir.z.mul(2.1)).add(
        vec3(time.mul(0.005), 0, time.mul(-0.003)),
      );
      const cloudNoise = mx_fractal_noise_float(cloudCoord, 4, 2, 0.5);
      const clouds = smoothstep(-0.08, 0.62, cloudNoise).mul(smoothstep(0.03, 0.36, up));
      const towardMoon = max(dot(dir, vec3(MOON_DIR.x, MOON_DIR.y, MOON_DIR.z)), 0);
      const moonDisc = smoothstep(0.99935, 0.99962, towardMoon).mul(1.55);
      const moonHalo = pow(towardMoon, 260).mul(0.38).add(pow(towardMoon, 14).mul(0.08));
      const cloudLit = mix(color('#152634'), color('#294156'), pow(towardMoon, 3).mul(0.75));
      ctx.scene.backgroundNode = mix(skyBase, cloudLit, clouds.mul(0.78))
        .add(color('#d8e8ff').mul(moonDisc.add(moonHalo))).mul(roomBrightness);
    }

    // Exponential fog swallows the 392 m rows seamlessly before the 450 m far plane.
    ctx.scene.fog = new THREE.FogExp2(VOID_DARK, 0.0062);

    // Keep the moonlit edges readable, with deeper shadows across the forgotten avenue.
    root.add(new THREE.HemisphereLight('#4b6378', '#22060a', 0.44));

    const keyMoon = new THREE.DirectionalLight('#d8ecfa', 1.75);
    keyMoon.position.copy(MOON_DIR).multiplyScalar(120);
    root.add(keyMoon);

    for (const [x, tint, intensity] of [
      [-1, '#9ab8cc', 0.55],
      [1, '#a2b2cc', 0.51],
    ] as const) {
      const crossFill = new THREE.DirectionalLight(tint, intensity);
      crossFill.position.set(x * 110, 52, 24);
      root.add(crossFill);
    }

    const rimMoon = new THREE.DirectionalLight('#86aec6', 0.60);
    rimMoon.position.copy(RIM_DIR).multiplyScalar(120);
    root.add(rimMoon);

    const crimsonBounce = new THREE.DirectionalLight('#9f1119', 0.28);
    crimsonBounce.position.set(0, -85, 10);
    root.add(crimsonBounce);

    await ctx.breathe();

    // Gentle extra radial horizon merge so far silhouettes fade cleanly without any hard edge.
    const distFromEye = positionWorld.sub(cameraPosition).length();
    const keepVis = float(1).sub(smoothstep(DARK_NEAR, DARK_FAR, distFromEye).mul(0.85));

    const trail = new RippleTrail();
    const rippleClock = uniform(0);
    const impacts = Array.from({ length: RIPPLE_CAPACITY }, () => new THREE.Vector4(0, 0, -100, 0));
    const rippleData = uniformArray<'vec4'>(impacts, 'vec4');
    const isWet = (x: number, z: number) => poolCoverage(x, z, stoneNoiseData, cobbleData) > .7;

    // -------------------------------------------------------------------------
    // 1. SINGLE-LAYER COBBLESTONE ROAD, UNEVEN DIRT VERGES & INTEGRATED BLOOD POOLS
    // -------------------------------------------------------------------------
    {
      const p = positionWorld;
      const groundMat = ownMat(
        new THREE.MeshStandardNodeMaterial({
          metalness: 0.02,
          envMap: reflectionEnv,
          envMapIntensity: 0.75,
        }),
      );

      // Feathered irregular transition from central cobbled road into uneven dirt banks.
      const edgeNoise = mx_noise_float(vec3(p.x.mul(0.28), 0, p.z.mul(0.28))).mul(0.75);
      const onPath = float(1).sub(
        smoothstep(
          float(PATH_HALF_WIDTH - 0.65).add(edgeNoise),
          float(PATH_HALF_WIDTH + 0.85).add(edgeNoise),
          abs(p.x),
        ),
      );

      // Organic non-Voronoi mineral & grain samples for internal stone wear, dirt, and puddle warp.
      const broad = texture(stoneNoiseTex, p.xz.mul(0.024));
      const medium = texture(stoneNoiseTex, p.xz.mul(0.11).add(vec2(0.31, 0.17)));
      const fineGrain = texture(stoneNoiseTex, p.xz.mul(0.48).add(vec2(0.13, 0.67)));

      // ONE coherent single-layer cobblestone layout (no second competing Voronoi network!).
      const macroRoadWarp = vec2(broad.r.sub(0.5), broad.g.sub(0.5)).mul(0.032);
      const cobbleUV = p.xz.mul(0.165).add(macroRoadWarp);
      const cobbleSample = texture(cobbleTex, cobbleUV);
      const cobbleEdge = cobbleSample.r;
      const stoneId = cobbleSample.g;
      const stoneCrown = cobbleSample.b;
      const stoneFracture = cobbleSample.a;

      const cobbleTop = smoothstep(0.06, 0.21, cobbleEdge);
      const stoneWear = fineGrain.b.mul(0.6).add(medium.b.mul(0.4));
      // Coherent per-stone pale limestone shading with subtle internal grain & rare hairline crack.
      const stoneTone = clamp(stoneId.mul(0.62).add(broad.r.mul(0.26)).add(stoneWear.mul(0.12)), 0, 1);
      const individualCobble = mix(color('#586673'), color('#aebdc4'), stoneTone)
        .mul(stoneWear.mul(0.18).add(0.88))
        .mul(float(1).sub(stoneFracture.mul(0.48)));
      const mortarColor = color('#161a22').mul(fineGrain.b.mul(0.28).add(0.84));
      const pathColor = mix(mortarColor, individualCobble, cobbleTop);

      // Textured uneven dirt & fine gravel beside the cobbled path (inspired by Claude's dirt, readable in moonlight).
      const dirtClods = mx_noise_float(vec3(p.x.mul(1.15), p.y.mul(0.8), p.z.mul(1.15))).mul(0.5).add(0.5);
      const dirtPebbles = mx_noise_float(vec3(p.x.mul(4.2), 0.7, p.z.mul(4.2))).mul(0.5).add(0.5);
      const dirtGrit = mx_noise_float(vec3(p.x.mul(14.5), 1.9, p.z.mul(14.5))).mul(0.5).add(0.5);
      const dirtBroad = mx_noise_float(vec3(p.x.mul(0.16), 0.2, p.z.mul(0.16))).mul(0.5).add(0.5);
      const dirtShade = clamp(dirtBroad.mul(0.5).add(dirtClods.mul(0.32)).add(dirtPebbles.mul(0.18)), 0, 1);
      // Darker earth further beneath the looming jaws, grittier near the road verge.
      const vergeBright = float(1).sub(smoothstep(PATH_HALF_WIDTH, 22, abs(p.x)));
      const dirtColor = mix(
        mix(color('#1a1d24'), color('#383d46'), dirtShade),
        mix(color('#292d36'), color('#575f6a'), dirtShade),
        vergeBright.mul(0.7),
      ).mul(dirtGrit.mul(0.24).add(0.84));

      const dryGround = mix(dirtColor, pathColor, onPath);

      // Richly integrated organic blood pools (Neon's organic pools + mortar-joint wicking).
      const poolWarp = vec2(broad.g.sub(0.5), medium.r.sub(0.5)).mul(0.12);
      const poolA = texture(stoneNoiseTex, p.xz.mul(0.036).add(poolWarp)).r;
      const poolB = texture(stoneNoiseTex, p.xz.mul(0.072).add(vec2(0.42, 0.81)).sub(poolWarp.mul(0.6))).g;
      const poolField = poolA.mul(0.62).add(poolB.mul(0.38));

      // Keep both portal thresholds (Z = ±36.25) clean while concentrating pools along the corridor.
      const nearPortalA = smoothstep(2.4, 7.6, p.xz.sub(vec2(0, 36.25)).length());
      const nearPortalB = smoothstep(2.4, 7.6, p.xz.sub(vec2(0, -36.25)).length());
      const portalClear = nearPortalA.mul(nearPortalB);
      const corridorBias = float(1).sub(smoothstep(8.5, 22, abs(p.x)));
      // Blood wicks slightly further along recessed cobblestone mortar seams around pool borders!
      const mortarCreep = float(1).sub(cobbleTop).mul(onPath).mul(0.034);
      const poolRaw = poolField
        .mul(float(0.64).add(corridorBias.mul(0.36)))
        .mul(float(0.56).add(portalClear.mul(0.44)))
        .add(mortarCreep);

      const poolMask = smoothstep(0.542, 0.58, poolRaw);
      const poolDepth = smoothstep(0.558, 0.72, poolRaw);
      const wetHalo = smoothstep(0.492, 0.564, poolRaw).mul(float(1).sub(poolMask));

      // Dampen & darken stone/dirt around every wet crimson rim.
      const dampGround = dryGround.mul(float(1).sub(wetHalo.mul(0.46)));

      // Muted crimson shallows retain contrast against the nearly black deep patches.
      const liquidShimmer = texture(
        stoneNoiseTex,
        p.xz.mul(0.21).add(vec2(time.mul(0.011), time.mul(-0.008))),
      ).r;
      const liquidBase = mix(bloodShallow, bloodDeep, poolDepth.mul(0.84).add(liquidShimmer.mul(0.16))).mul(bloodBrightness);

      // Dual ambient ripples + persistent waves from individual foot impacts.
      const rippleA = texture(stoneNoiseTex, p.xz.mul(0.26).add(vec2(time.mul(0.022), time.mul(0.016)))).g;
      const rippleB = texture(stoneNoiseTex, p.xz.mul(0.41).add(vec2(time.mul(-0.019), time.mul(0.025)))).g;
      const ambientRipple = rippleA.add(rippleB).mul(0.5).sub(0.5).mul(0.009);
      let stepWave: FloatNode = float(0);
      for (let i = 0; i < RIPPLE_CAPACITY; i++) {
        const impact = rippleData.element(i);
        const age = max(rippleClock.sub(impact.z), 0);
        const radius = p.xz.sub(impact.xy).length();
        const width = age.mul(.065).add(.16);
        const q = radius.sub(age.mul(1.45)).div(width);
        // A soft crest/trough packet expands from a fixed impact, then dissipates.
        const pulse = float(1).sub(q.mul(q)).mul(exp(q.mul(q).negate()));
        const fade = float(1).sub(smoothstep(0, RIPPLE_LIFETIME, age));
        stepWave = stepWave.add(pulse.mul(fade).mul(impact.w).mul(.009)) as FloatNode;
      }
      // Subtle slow droplet rings expanding periodically on the crimson surface.
      const cellXZ = floor(p.xz.mul(0.18));
      const dropPhase = fract(time.mul(0.18).add(hash(cellXZ.x.mul(17.3).add(cellXZ.y.mul(31.7)))));
      const dropCenter = cellXZ.add(vec2(0.5, 0.5)).div(0.18);
      const dropDist = p.xz.sub(dropCenter).length();
      const dropRing = exp(dropDist.sub(dropPhase.mul(2.4)).pow(2).mul(-18))
        .mul(float(1).sub(dropPhase))
        .mul(0.0045);
      const liquidHeight = ambientRipple.add(stepWave).add(dropRing);

      // Metric height relief (in metres): crisp raised beveled cobbles vs uneven gritty dirt vs glassy liquid.
      const cobbleHeight = stoneCrown
        .mul(float(0.048).add(stoneId.mul(0.024)))
        .add(stoneWear.mul(0.008))
        .sub(stoneFracture.mul(0.018));
      const dirtHeight = dirtClods.mul(0.042).add(dirtPebbles.mul(0.02)).add(dirtGrit.mul(0.012));
      const groundHeight = mix(dirtHeight, cobbleHeight, onPath);
      const finalHeight = mix(groundHeight, liquidHeight, poolMask);

      const engravingUv = p.xz.mul(vec2(1, -1)).div(RING_RADIUS * 2).add(0.5);
      const engraving = texture(relief, engravingUv).r.mul(float(1).sub(poolMask));
      groundMat.normalNode = bumpNormal(finalHeight.sub(engraving.mul(0.031)) as FloatNode);

      // Mirror sky/moon reflection & subtle arterial depth luminance on the wet red liquid.
      const poolFresnel = schlickFresnel(normalView as Vec3Node, 0.045);
      const poolMirror = mirroredSky(reflectVector as Vec3Node).mul(poolFresnel).mul(0.6);
      const arterialGlow = bloodGlow.mul(float(0.07).add(float(1).sub(poolDepth).mul(0.045))).mul(bloodBrightness);

      groundMat.colorNode = mix(dampGround, liquidBase, poolMask).mul(float(1).sub(engraving.mul(0.25))).mul(keepVis);
      // Ultra-matte cobbles (0.95) & dirt (0.98), damp wet rims (0.42), mirror-glossy crimson pools (0.05).
      const dryRough = mix(float(0.98), float(0.95), onPath);
      groundMat.roughnessNode = mix(mix(dryRough, float(0.42), wetHalo), float(0.05), poolMask);
      groundMat.emissiveNode = poolMirror.add(arterialGlow).mul(poolMask).mul(keepVis)
        .add(color('#ae63de').mul(engraving).mul(prayer.glow).mul(1.65));

      const groundMesh = new THREE.Mesh(ownGeo(copyOfGeometry(layout.groundGeometry)), groundMat);
      groundMesh.frustumCulled = false;
      root.add(groundMesh);
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 2. ENDLESS COLOSSAL ANCIENT STONE HEADS (NEAR/FAR LOD) + GLOSSY BLACK EYES
    // -------------------------------------------------------------------------
    {
      const { skin, eyes, leftEyeCenter, rightEyeCenter, eyeRadius } = layout.headAssets;

      // 2a. Ancient weathered limestone skin shader:
      //     Neon's pale cyan-ash stone & dark smudges + cavernous eye sockets +
      //     Claude's convincingly recessed & asymmetrically patchy face cracks +
      //     Claude's thin multi-rivulet blood trails weeping from the eyes.
      const skinMat = ownMat(new THREE.MeshStandardNodeMaterial({ metalness: 0.0 }));
      const lp = positionGeometry;
      const ln = normalGeometry;
      const weep = attribute<'float'>('aWeep', 'float');
      // aCrack: (seedX, seedY, crackAngle, crackDensity)
      const crackAttr = attribute<'vec4'>('aCrack', 'vec4');

      const instShift = vec3(
        crackAttr.x.mul(17.3),
        crackAttr.y.mul(13.1),
        crackAttr.x.add(crackAttr.y).mul(11.7),
      );

      // 3D mineral mottling, fine limestone grain, and vertical dark weathering smudges (no 2D tiling!).
      const mottle = mx_fractal_noise_float(lp.mul(0.48).add(instShift.mul(0.35)), 3, 2, 0.5).mul(0.5).add(0.5);
      const grain = mx_noise_float(lp.mul(3.8).add(instShift)).mul(0.5)
        .add(mx_noise_float(lp.mul(10.5).add(instShift.mul(1.7))).mul(0.25));
      const smudges = mx_noise_float(vec3(lp.x.mul(1.6).add(instShift.x), lp.y.mul(0.22).add(instShift.y), lp.z.mul(1.6)));
      const smudgeMask = smoothstep(0.02, 0.52, smudges).mul(0.56);
      // Broad soot/mineral deposits break up the clean stone; stretched runoff stains
      // cross the brows and cheeks, with a different weathering pattern on each head.
      const deposits = mx_fractal_noise_float(lp.mul(0.72).add(instShift.mul(0.63)), 3, 2, 0.5);
      const depositMask = smoothstep(-0.16, 0.32, deposits).mul(0.62);

      // Asymmetric, patchy, convincingly recessed face cracks (3D warped Worley cells).
      const crackWarp = vec3(
        mx_noise_float(lp.mul(1.45).add(instShift)),
        mx_noise_float(lp.mul(1.45).add(instShift).add(19.7)),
        mx_noise_float(lp.mul(1.45).add(instShift).add(37.1)),
      ).mul(0.28);
      const crackCells = mx_worley_noise_vec2(lp.mul(0.56).add(instShift.mul(0.4)).add(crackWarp));
      const cellEdge = crackCells.y.sub(crackCells.x);
      const rawCrack = float(1).sub(smoothstep(0.0, 0.068, cellEdge));

      // Directional side bias per head so cracks cluster asymmetrically (e.g. only one cheek/brow on many faces).
      const sideDirX = cos(crackAttr.z);
      const sideDirY = sin(crackAttr.z);
      const sideProj = lp.x.mul(sideDirX).add(lp.y.sub(2.6).mul(sideDirY)).mul(0.32);
      const patchField = mx_noise_float(lp.mul(0.36).add(instShift.mul(0.5)));
      const density = crackAttr.w;
      const crackThreshold = float(0.68).sub(density.mul(0.52));
      const crackZone = smoothstep(
        crackThreshold,
        crackThreshold.add(0.42),
        patchField.mul(0.62).add(sideProj.mul(0.58)).add(0.38),
      );
      const crack = rawCrack.mul(crackZone);

      // Subtle chipped pale limestone spalling adjacent to deep cracks.
      const spall = smoothstep(0.055, 0.14, cellEdge)
        .mul(float(1).sub(smoothstep(0.14, 0.28, cellEdge)))
        .mul(crackZone)
        .mul(smoothstep(0.1, 0.55, mx_noise_float(lp.mul(2.1).add(instShift))));

      // Neon's stark pale moonlit cyan-ash limestone palette with weathering smudges.
      const paleStone = color('#c6d8de');
      const midStone = color('#768a96');
      const deepCrevice = color('#090c12');
      let skinColor: Vec3Node = mix(midStone, paleStone, smoothstep(0.22, 0.8, mottle)) as Vec3Node;
      skinColor = skinColor.mul(grain.mul(0.16).add(0.9)) as Vec3Node;
      skinColor = skinColor.mul(float(1).sub(smudgeMask)) as Vec3Node;
      skinColor = mix(skinColor, color('#303332'), depositMask) as Vec3Node;
      skinColor = mix(skinColor, color('#b6c1c4'), spall.mul(0.17)) as Vec3Node;

      // Cavernous darkened eye sockets so the glossy black eyes gleam out of deep shadow.
      const dLeftEye = lp.sub(vec3(leftEyeCenter.x, leftEyeCenter.y, leftEyeCenter.z)).length();
      const dRightEye = lp.sub(vec3(rightEyeCenter.x, rightEyeCenter.y, rightEyeCenter.z)).length();
      const dEye = min(dLeftEye, dRightEye);
      const socketAO = float(1).sub(smoothstep(eyeRadius * 1.05, eyeRadius * 2.2, dEye));
      skinColor = mix(skinColor, color('#0b0e15'), socketAO.mul(0.76)) as Vec3Node;

      // Thin multi-rivulet blood trails weeping down the cheeks from both eye sockets (Claude's signature touch).
      let tears: FloatNode = float(0);
      for (const eyeCenter of [leftEyeCenter, rightEyeCenter]) {
        const ex = eyeCenter.x;
        const ey = eyeCenter.y;
        const ez = eyeCenter.z;
        const below = float(ey).sub(lp.y);
        const dx = lp.x
          .sub(ex)
          .add(mx_noise_float(vec3(lp.y.mul(2.5), crackAttr.x.mul(7.3).add(ex * 5.1), ez)).mul(0.055));
        const lane = dx.mul(9.2);
        const laneId = floor(lane);
        const inLane = abs(fract(lane).sub(0.5));
        const laneSeed = laneId.add(crackAttr.x.mul(97)).add(ex * 19);
        const trailLen = hash(laneSeed.add(1000)).mul(2.65).add(0.85);
        const flowing = smoothstep(0.42, 0.52, hash(laneSeed.add(2000)));
        const rivulet = flowing
          .mul(float(1).sub(smoothstep(0.045, 0.155, inLane)))
          .mul(smoothstep(eyeRadius * 0.52, eyeRadius * 0.92, below))
          .mul(float(1).sub(smoothstep(trailLen.mul(0.62), trailLen, below)))
          .mul(float(1).sub(smoothstep(eyeRadius * 0.68, eyeRadius * 1.08, abs(lp.x.sub(ex)))));
        const lowerLid = float(1)
          .sub(smoothstep(eyeRadius * 0.58, eyeRadius * 1.05, abs(lp.x.sub(ex))))
          .mul(smoothstep(eyeRadius * 0.4, eyeRadius * 0.72, below))
          .mul(float(1).sub(smoothstep(eyeRadius * 0.9, eyeRadius * 1.28, below)));
        tears = max(tears, max(rivulet, lowerLid.mul(0.78))) as FloatNode;
      }
      const bloodTrails = tears.mul(smoothstep(0.06, 0.36, ln.z)).mul(weep);

      // Apply deeply recessed cracks, base dirt/rubble contact grime, and glossy wet crimson blood trails.
      skinColor = mix(skinColor, deepCrevice, crack.mul(0.9)) as Vec3Node;
      const baseGrime = float(1).sub(smoothstep(0.0, 6.2, positionWorld.y));
      skinColor = mix(skinColor, color('#1c212a'), baseGrime.mul(0.66)) as Vec3Node;
      skinColor = mix(skinColor, bloodTrail.mul(bloodBrightness), bloodTrails) as Vec3Node;

      // Subtle cold moonlight rim along silhouettes so distant visages read before vanishing into fog.
      const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3.2);
      const coldRim = color('#58768b').mul(rim).mul(0.18).mul(float(1).sub(socketAO.mul(0.8)));

      // Metric bump height: deep recessed cracks (-0.145 m equivalent) + limestone surface texture + subtle raised wet trails.
      const skinHeight = grain
        .mul(0.022)
        .add(mottle.mul(0.042))
        .sub(crack.mul(0.145))
        .sub(spall.mul(0.036))
        .add(bloodTrails.mul(0.008));

      skinMat.colorNode = skinColor.mul(keepVis);
      skinMat.roughnessNode = mix(float(0.94), float(0.22), bloodTrails);
      skinMat.normalNode = bumpNormal(skinHeight as FloatNode);
      skinMat.emissiveNode = coldRim.mul(keepVis).add(color('#83afff')
        .mul(float(1).sub(smoothstep(eyeSize * 0.85, eyeSize * 1.85, socketDistance))).mul(prayer.light).mul(0.56));

      const addHeadBatch = (
        templateGeo: THREE.BufferGeometry,
        heads: HeadPlacement[],
        matrices: THREE.Matrix4[],
      ) => {
        if (!heads.length) return;
        const geo = ownGeo(copyOfGeometry(templateGeo));
        const weepArr = new Float32Array(heads.length);
        const crackArr = new Float32Array(heads.length * 4);
        for (let i = 0; i < heads.length; i++) {
          const h = heads[i];
          weepArr[i] = h.weeping;
          crackArr[i * 4] = h.seed;
          crackArr[i * 4 + 1] = ((h.seed * 7.31) % 1 + 1) % 1;
          crackArr[i * 4 + 2] = h.crackAngle;
          crackArr[i * 4 + 3] = h.crackDensity;
        }
        geo.setAttribute('aWeep', new THREE.InstancedBufferAttribute(weepArr, 1));
        geo.setAttribute('aCrack', new THREE.InstancedBufferAttribute(crackArr, 4));
        const mesh = new THREE.InstancedMesh(geo, skinMat, heads.length);
        instanced.push(mesh);
        matrices.forEach((m, i) => mesh.setMatrixAt(i, m));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.frustumCulled = false;
        root.add(mesh);
      };

      const eyeMat = ownMat(createWinningEyes(MOON_DIR));
      eyeMat.emissiveNode = (eyeMat.emissiveNode as Vec3Node).add(vec3(6, 7, 8)
        .mul(float(1).sub(smoothstep(eyeSize * 1.4, eyeSize * 2, socketDistance))).mul(prayer.light));
      const visibleHeads = createVisibleHeads(
        layout.plan.heads, layout.allHeadMatrices,
        [skin, ...headLods.map(lod => lod.skin)],
        [eyes, ...headLods.map(lod => lod.eyes)], skinMat, eyeMat,
      );
      root.add(...visibleHeads.meshes);
      const previousBeforeRender = ctx.scene.onBeforeRender;
      ctx.scene.onBeforeRender = function(...args) {
        previousBeforeRender.call(this, ...args);
        visibleHeads.update(args[2]);
      };
      ctx.onDispose(() => {
        ctx.scene.onBeforeRender = previousBeforeRender;
        visibleHeads.dispose();
      });

      if (eyeStudy) {
        // 2b. Glossy obsidian-black eyeballs combining Codex's HDR environment reflections
        //     with Claude's razor-sharp mirror moon glint & Fresnel sheen.
        const studySynthesisMat = ownMat(
          new THREE.MeshPhysicalNodeMaterial({
            roughness: 0.03,
            metalness: 0.14,
            clearcoat: 1.0,
            clearcoatRoughness: 0.015,
            envMap: reflectionEnv,
            envMapIntensity: 2.35,
          }),
        );

        const eyeFresnel = schlickFresnel(normalView as Vec3Node, 0.065);
        const eyeMirror = mirroredSky(reflectVector as Vec3Node).mul(eyeFresnel);
        // Faint crimson under-glint catching the blood pools below on the lower curve of each eyeball.
        const reflWorld = reflectVector as Vec3Node;
        const crimsonUnderGlint = pow(max(dot(reflWorld, vec3(0, -0.78, 0.62).normalize()), 0), 22).mul(0.28);

        studySynthesisMat.colorNode = color('#010204');
        studySynthesisMat.emissiveNode = eyeMirror.add(color('#b8141c').mul(crimsonUnderGlint)).mul(keepVis);

        // A compact frontal lineup in the real avenue. All four skins share exactly
        // the same attributes and material, so weathering cannot bias the eye choice.
        const matrices = EYE_STUDY_HEADS.map(h => new THREE.Matrix4().compose(
          new THREE.Vector3(h.x, h.y, h.z), new THREE.Quaternion(),
          new THREE.Vector3(h.scale, h.scale, h.scale),
        ));
        addHeadBatch(skin, EYE_STUDY_HEADS, matrices);
        const studyEnv = ownTex(await studyReflectionMap(ctx.breathe));
        const eyeGeo = ownGeo(copyOfGeometry(eyes));
        const plinthGeo = ownGeo(new THREE.BoxGeometry(6.0, 1.6, 6.0));
        const plinthMat = ownMat(new THREE.MeshStandardNodeMaterial({ color: '#30383e', roughness: 0.98 }));
        for (const [i, h] of EYE_STUDY_HEADS.entries()) {
          const selected = studyEyeMaterial(EYE_STUDY_KEY[i], studySynthesisMat, studyEnv, MOON_DIR, RIM_DIR);
          if (selected !== studySynthesisMat) ownMat(selected);
          const sampleEyes = new THREE.InstancedMesh(eyeGeo, selected, 1);
          sampleEyes.setMatrixAt(0, matrices[i]);
          sampleEyes.instanceMatrix.needsUpdate = true;
          sampleEyes.frustumCulled = false;
          instanced.push(sampleEyes);
          root.add(sampleEyes);

          const plinth = new THREE.Mesh(plinthGeo, plinthMat);
          plinth.position.set(h.x, 0.8, h.z);
          root.add(plinth);
          ctx.addPlatform({ minX: h.x - 3, maxX: h.x + 3, minZ: h.z - 3, maxZ: h.z + 3, topY: 1.6 });

          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 256;
          const ink = canvas.getContext('2d')!;
          ink.fillStyle = '#111820';
          ink.fillRect(0, 0, 256, 256);
          ink.strokeStyle = '#71818a';
          ink.lineWidth = 5;
          ink.strokeRect(8, 8, 240, 240);
          ink.fillStyle = '#e3e9ed';
          ink.font = 'bold 178px sans-serif';
          ink.textAlign = 'center';
          ink.textBaseline = 'middle';
          ink.fillText(EYE_STUDY_LABELS[i], 128, 137);
          const labelTex = ownTex(new THREE.CanvasTexture(canvas));
          labelTex.colorSpace = THREE.SRGBColorSpace;
          const label = new THREE.Mesh(
            ownGeo(new THREE.PlaneGeometry(1.8, 1.8)),
            ownMat(new THREE.MeshBasicNodeMaterial({ map: labelTex, toneMapped: false, side: THREE.DoubleSide })),
          );
          label.position.set(h.x, 10.3, h.z + 0.3);
          root.add(label);
          await ctx.breathe();
        }
      }
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 3. NON-TILED FRACTURED RUBBLE, VERGE STONES & COLLAPSED STATUE SHARDS
    // -------------------------------------------------------------------------
    {
      const rubbleMat = ownMat(new THREE.MeshStandardNodeMaterial({ roughness: 0.96, metalness: 0 }));
      const lp = positionGeometry;
      const wp = positionWorld;
      const wn = normalWorld;
      // aRubble: (seedX, seedY, seedZ, shade) — gives every boulder unique 3D stone coordinates!
      const rubbleMeta = attribute<'vec4'>('aRubble', 'vec4');
      const sp = lp.mul(1.85).add(rubbleMeta.xyz);

      const rockBroad = mx_fractal_noise_float(sp.mul(0.65), 3, 2, 0.5).mul(0.5).add(0.5);
      const rockGrain = mx_noise_float(sp.mul(3.4)).mul(0.5).add(mx_noise_float(sp.mul(9.2)).mul(0.25));
      // Subtle world-scale grime variation so nearby rubble grounds naturally with the earth.
      const worldVar = mx_noise_float(wp.mul(0.22)).mul(0.5).add(0.5);
      const topMoonDust = smoothstep(0.22, 0.88, wn.y);

      const shade = rubbleMeta.w;
      const baseTone = clamp(shade.mul(0.58).add(rockBroad.mul(0.27)).add(worldVar.mul(0.15)), 0, 1);
      let rockColor: Vec3Node = mix(color('#272e38'), color('#aebec6'), baseTone) as Vec3Node;
      rockColor = mix(rockColor, color('#bccbd2'), topMoonDust.mul(0.22)) as Vec3Node;
      rockColor = rockColor.mul(rockGrain.mul(0.2).add(0.88)) as Vec3Node;

      // Subtle dark damp/crimson stain near the base of low stones sitting close to blood pools.
      const baseContact = float(1).sub(smoothstep(0.0, 0.22, wp.y));
      const poolStainNoise = mx_noise_float(vec3(wp.x.mul(0.18), 0.4, wp.z.mul(0.18))).mul(0.5).add(0.5);
      rockColor = mix(rockColor, color('#3b070b'), baseContact.mul(smoothstep(0.52, 0.78, poolStainNoise)).mul(0.58)) as Vec3Node;

      rubbleMat.colorNode = rockColor.mul(keepVis);
      rubbleMat.normalNode = bumpNormal(rockBroad.mul(0.025).add(rockGrain.mul(0.018)) as FloatNode);

      layout.rockShapes.forEach((shape, i) => {
        const mats = layout.rockMatrices[i];
        if (!mats.length) return;
        for (const group of spatialGroups(mats)) {
          const geo = ownGeo(copyOfGeometry(shape));
          const metadata = new Float32Array(group.length * 4);
          group.forEach((source, slot) => metadata.set(layout.rockMeta[i].subarray(source * 4, source * 4 + 4), slot * 4));
          geo.setAttribute('aRubble', new THREE.InstancedBufferAttribute(metadata, 4));
          const im = new THREE.InstancedMesh(geo, rubbleMat, group.length);
          instanced.push(im);
          group.forEach((source, slot) => im.setMatrixAt(slot, mats[source]));
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          root.add(im);
        }
      });
    }

    await ctx.breathe();

    // -------------------------------------------------------------------------
    // 4. JAGGED RUINED MONOLITH PILLARS (3D NON-TILED STRATA & WEATHERING)
    // -------------------------------------------------------------------------
    {
      const pillarMat = ownMat(new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 }));
      const lp = positionGeometry;
      const wp = positionWorld;
      const pillarMeta = attribute<'vec4'>('aPillar', 'vec4');
      const sp = vec3(lp.x.mul(1.8), lp.y.mul(5.5), lp.z.mul(1.8)).add(pillarMeta.xyz);

      const strata = mx_fractal_noise_float(vec3(sp.x.mul(0.45), sp.y.mul(0.18), sp.z.mul(0.45)), 3, 2, 0.5)
        .mul(0.5)
        .add(0.5);
      const grain = mx_noise_float(sp.mul(2.8)).mul(0.5).add(0.5);
      const cells = mx_worley_noise_vec2(sp.mul(0.55));
      const fissureZone = smoothstep(0.18, 0.62, mx_noise_float(sp.mul(0.32).add(5.4)));
      const fissure = float(1).sub(smoothstep(0.0, 0.065, cells.y.sub(cells.x))).mul(fissureZone);

      let pillarStone: Vec3Node = mix(
        color('#1a222c'),
        color('#6e8290'),
        clamp(strata.mul(0.68).add(pillarMeta.w.mul(0.32)), 0, 1),
      ) as Vec3Node;
      pillarStone = pillarStone.mul(grain.mul(0.18).add(0.88)).mul(float(1).sub(fissure.mul(0.68))) as Vec3Node;
      const baseDark = float(1).sub(smoothstep(0.0, 5.5, wp.y));
      pillarStone = mix(pillarStone, color('#11151d'), baseDark.mul(0.55)) as Vec3Node;

      const rim = pow(float(1).sub(clamp(dot(normalView, positionViewDirection), 0, 1)), 3.4);

      pillarMat.colorNode = pillarStone.mul(keepVis);
      pillarMat.normalNode = bumpNormal(strata.mul(0.04).add(grain.mul(0.015)).sub(fissure.mul(0.1)) as FloatNode);
      pillarMat.emissiveNode = color('#41586a').mul(rim).mul(0.22).mul(keepVis);

      layout.pillarShapes.forEach((shape, i) => {
        const mats = layout.pillarMatrices[i];
        if (!mats.length) return;
        for (const group of spatialGroups(mats)) {
          const geo = ownGeo(copyOfGeometry(shape));
          const metadata = new Float32Array(group.length * 4);
          group.forEach((source, slot) => metadata.set(layout.pillarMeta[i].subarray(source * 4, source * 4 + 4), slot * 4));
          geo.setAttribute('aPillar', new THREE.InstancedBufferAttribute(metadata, 4));
          const im = new THREE.InstancedMesh(geo, pillarMat, group.length);
          instanced.push(im);
          group.forEach((source, slot) => im.setMatrixAt(slot, mats[source]));
          im.instanceMatrix.needsUpdate = true;
          im.computeBoundingSphere();
          root.add(im);
        }
      });
    }

    // Include analytic reflections and rim accents in room brightness, not just
    // direct lights, so the slider doesn't leave bright self-lit surfaces behind.
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardNodeMaterial && material.emissiveNode) {
        material.emissiveNode = (material.emissiveNode as Vec3Node).mul(roomBrightness);
      }
    }
    const lights: Array<{ light: THREE.Light; base: number }> = [];
    root.traverse(object => {
      if (object instanceof THREE.Light) lights.push({ light: object, base: object.intensity });
    });
    const reflective = materials.filter((m): m is THREE.MeshStandardNodeMaterial =>
      m instanceof THREE.MeshStandardNodeMaterial && m.envMap !== null,
    ).map(material => ({ material, base: material.envMapIntensity }));
    const baseHue = new THREE.Color('#961018').getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
    const tinted = [
      { node: bloodDeep, base: new THREE.Color('#340206') },
      { node: bloodGlow, base: new THREE.Color('#52060c') },
      { node: bloodTrail, base: new THREE.Color('#5c0407') },
    ];
    let tuning: VisagesTuning = { ...DEFAULT_TUNING };
    const apply = (next: typeof tuning) => {
      tuning = { ...next };
      roomBrightness.value = next.roomBrightness;
      bloodBrightness.value = next.bloodBrightness;
      for (const { light, base } of lights) light.intensity = base * next.roomBrightness;
      for (const { material, base } of reflective) material.envMapIntensity = base * next.roomBrightness;
      bloodShallow.value.set(next.bloodColor);
      const hue = bloodShallow.value.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
      for (const { node, base } of tinted) {
        const hsl = base.getHSL({ h: 0, s: 0, l: 0 }, THREE.SRGBColorSpace);
        node.value.setHSL(hsl.h + hue.h - baseHue.h, hsl.s + hue.s - baseHue.s, hsl.l, THREE.SRGBColorSpace);
      }
    };
    // Approved defaults must apply before any dev-only browser overrides.
    apply(DEFAULT_TUNING);
    if (import.meta.env.DEV) {
      const [{ readTuning, mountDevControls }, { enableTuningShortcut }] = await Promise.all([
        import('./devControls'), import('./tuningShortcut'),
      ]);
      apply(readTuning());
      ctx.onActivate(() => enableTuningShortcut(() => mountDevControls(tuning, apply)));
    }

    const clearTrail = () => {
      trail.reset();
      impacts.forEach(v => v.w = 0);
    };
    ctx.onActivate(() => { clearTrail(); return clearTrail; });
    ctx.onUpdate((dt) => {
      rippleClock.value += dt;
      const feet = ctx.player?.position;
      if (feet) trail.update(feet.x, feet.y, feet.z, terrainHeightAt(feet.x, feet.z), rippleClock.value, isWet);
      trail.impacts.forEach((impact, i) => impacts[i].set(impact.x, impact.z, impact.born, impact.strength));
    });
  },
});
