/// <reference types="vite/client" />
/**
 * VISAGES — CLAUDE VARIANT (`jp-visages-claude`)
 *
 * Two rows of colossal stone heads, buried to the chin, stare at each other across
 * a rough cobbled path. Their skin is ancient weathered stone, cracked and streaked;
 * their eyes are polished black and catch the moon. Some of them weep blood, and it
 * lies in wet red pools along the path. The rows never end: they run on past both
 * portals for hundreds of metres until they are swallowed by the dark.
 *
 * The heads are the supplied `female_human_head_game.glb`, used upright as modelled
 * (see `headModel.ts`): split into skin and eyeballs, shoulders trimmed off because
 * they are always buried, and a decimated copy for heads deep in the fog. Everything
 * repeated (heads, eyes, stones) is instanced.
 */
import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
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
  mix,
  mod,
  mx_fractal_noise_float,
  mx_noise_float,
  mx_worley_noise_vec2,
  normalGeometry,
  normalView,
  normalWorldGeometry,
  positionGeometry,
  positionView,
  positionViewDirection,
  positionWorld,
  pow,
  reflectVector,
  sin,
  smoothstep,
  time,
  vec2,
  vec3,
} from 'three/tsl';
import { defineRoom } from '@portalverse/core/portal/defineRoom';
import { breathe, disposeObject, loadGLB } from '@portalverse/core/rooms/kit';
import headUrl from './assets/female_human_head_game.glb?url';
import { processHead, type HeadParts, type MeshPart } from './headModel';
import {
  HEAD_SCALE,
  PATH_HALF_WIDTH,
  ROW_REACH,
  WALK_HALF_WIDTH,
  bloodPools,
  headPlacements,
  poolOutline,
  stones,
  terrainHeight,
} from './layout';

type FloatNode = THREE.Node<'float'>;
type Vec3Node = THREE.Node<'vec3'>;

const FOG = '#0b0c12';
const ZENITH = '#030406';
const MOON = new THREE.Vector3(0.08, 0.84, -0.54).normalize();
/** Heads nearer the middle than this (along Z) get the full-detail skin. */
const NEAR_REACH = 140;
/** Skin below this height (model units) is always underground. */
const TRIM_BELOW = 2.3;

// ---------------------------------------------------------------------------
// The head model, processed once per page and shared by every mount.

let headParts: Promise<HeadParts> | null = null;

function loadHeadParts(): Promise<HeadParts> {
  headParts ??= (async () => {
    const gltf = await loadGLB(headUrl);
    try {
      gltf.scene.updateMatrixWorld(true);
      let mesh: THREE.Mesh | undefined;
      gltf.scene.traverse(object => {
        if (!mesh && (object as THREE.Mesh).isMesh) mesh = object as THREE.Mesh;
      });
      if (!mesh) throw new Error('jp-visages-claude: head model has no mesh');
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      const position = new Float32Array(geometry.getAttribute('position').array);
      const normal = new Float32Array(geometry.getAttribute('normal').array);
      const index = geometry.index
        ? Uint32Array.from(geometry.index.array)
        : Uint32Array.from({ length: position.length / 3 }, (_, i) => i);
      geometry.dispose();
      return await processHead(position, normal, index, { trimBelowY: TRIM_BELOW, farCell: 0.16, pause: breathe });
    } finally {
      disposeObject(gltf.scene);
    }
  })().catch(error => {
    headParts = null;
    throw error;
  });
  return headParts;
}

function partGeometry(part: MeshPart): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(part.position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(part.normal, 3));
  geometry.setIndex(new THREE.BufferAttribute(part.index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

// ---------------------------------------------------------------------------
// Rocks: a few jagged shapes made once, faceted.

const ROCK_VARIANTS = 4;
let rockShapes: Float32Array[] | null = null;

function rockPositions(): Float32Array[] {
  if (rockShapes) return rockShapes;
  rockShapes = [];
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    const base = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
    const array = base.getAttribute('position').array as Float32Array;
    const out = new Float32Array(array.length);
    for (let i = 0; i < array.length; i += 3) {
      const x = array[i];
      const y = array[i + 1];
      const z = array[i + 2];
      // Offset depends only on the corner's position, so shared corners stay joined.
      const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + v * 19.17) * 43758.5453;
      const jitter = 0.72 + (h - Math.floor(h)) * 0.5;
      // Chop one side flat-ish so stones sit like broken fragments.
      const chop = y < -0.35 ? 0.6 : 1;
      out[i] = x * jitter;
      out[i + 1] = y * jitter * chop;
      out[i + 2] = z * jitter;
    }
    base.dispose();
    rockShapes.push(out);
  }
  return rockShapes;
}

// ---------------------------------------------------------------------------
// Shading helpers.

/** Perturb the view-space normal by a height field in metres (screen-space derivatives). */
function bumpNormal(height: FloatNode): Vec3Node {
  return Fn(() => {
    const dpdx = positionView.dFdx();
    const dpdy = positionView.dFdy();
    const r1 = dpdy.cross(normalView);
    const r2 = normalView.cross(dpdx);
    const det = dpdx.dot(r1).mul(faceDirection);
    const grad = det.sign().mul(r1.mul(height.dFdx()).add(r2.mul(height.dFdy())));
    return det.abs().mul(normalView).sub(grad).normalize();
  })() as Vec3Node;
}

/** What a polished surface mirrors: the dark sky, faint cloud light and a hard moon glint. */
function mirrored(dir: Vec3Node): Vec3Node {
  const up = clamp(dir.y, 0, 1);
  const sky = mix(color('#1a2026'), color('#0a0c10'), pow(up, 0.6));
  const toward = max(dot(dir, vec3(MOON.x, MOON.y, MOON.z)), 0);
  const glint = pow(toward, 1200).mul(40).add(pow(toward, 90).mul(0.6)).add(pow(toward, 8).mul(0.05));
  return sky.add(color('#dce6ff').mul(glint)) as Vec3Node;
}

function fresnel(normal: Vec3Node, f0: number): FloatNode {
  const facing = clamp(dot(normal, positionViewDirection), 0, 1);
  return float(f0).add(float(1 - f0).mul(pow(float(1).sub(facing), 5))) as FloatNode;
}

/** Ancient stone skin with cracks, stains and (per instance) tears of blood from the eyes. */
function stoneSkinMaterial(parts: HeadParts): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0 });
  const p = positionWorld;
  const g = positionGeometry;
  const weep = attribute<'float'>('aWeep', 'float');

  const grain = mx_noise_float(p.mul(1.9)).mul(0.5).add(mx_noise_float(p.mul(5.3)).mul(0.25));
  const mottle = mx_fractal_noise_float(p.mul(0.07), 3, 2, 0.5);
  const streaks = mx_noise_float(vec3(p.x.mul(0.5), p.y.mul(0.035), p.z.mul(0.5)));
  const warp = vec3(mx_noise_float(p.mul(0.4)), mx_noise_float(p.mul(0.4).add(17.3)), 0).mul(0.35);
  const cells = mx_worley_noise_vec2(p.mul(0.16).add(warp));
  const zone = smoothstep(-0.2, 0.3, mx_noise_float(p.mul(0.045).add(7.1)));
  const crack = float(1).sub(smoothstep(0.0, 0.07, cells.y.sub(cells.x))).mul(zone);
  const spall = smoothstep(0.42, 0.55, mx_noise_float(p.mul(0.23).add(3.3)));
  const lichen = smoothstep(0.35, 0.7, mx_noise_float(p.mul(0.12).add(31.7)))
    .mul(smoothstep(0.1, 0.6, normalGeometry.y));

  // Blood running from each eye down the cheek: a few thin rivulets of uneven length.
  let tears: FloatNode = float(0);
  for (const [ex, ey, ez] of parts.eyeCenters) {
    const below = float(ey).sub(g.y);
    const dx = g.x.sub(ex).add(mx_noise_float(vec3(g.y.mul(2.6), ex * 7.3, ez)).mul(0.06));
    const lane = dx.mul(9);
    const id = floor(lane);
    const inLane = abs(fract(lane).sub(0.5));
    const length = hash(id.add(1000 + ex * 13)).mul(2.4).add(0.9);
    // Only some lanes carry a rivulet.
    const flowing = smoothstep(0.4, 0.5, hash(id.add(2000 + ex * 31)));
    const line = flowing.mul(float(1).sub(smoothstep(0.05, 0.16, inLane)))
      .mul(smoothstep(parts.eyeRadius * 0.55, parts.eyeRadius * 0.95, below))
      .mul(float(1).sub(smoothstep(length.mul(0.6), length, below)))
      .mul(float(1).sub(smoothstep(parts.eyeRadius * 0.7, parts.eyeRadius * 1.1, abs(g.x.sub(ex)))));
    const lid = float(1).sub(smoothstep(parts.eyeRadius * 0.6, parts.eyeRadius * 1.1, abs(g.x.sub(ex))))
      .mul(smoothstep(parts.eyeRadius * 0.4, parts.eyeRadius * 0.75, below))
      .mul(float(1).sub(smoothstep(parts.eyeRadius * 0.9, parts.eyeRadius * 1.3, below)));
    tears = max(tears, max(line, lid.mul(0.8))) as FloatNode;
  }
  const blood = tears.mul(smoothstep(0.05, 0.35, normalGeometry.z)).mul(weep);

  let stone: Vec3Node = mix(color('#4b5059'), color('#a3a9ab'), smoothstep(-0.45, 0.5, mottle)) as Vec3Node;
  stone = stone.mul(grain.mul(0.18).add(0.88)) as Vec3Node;
  stone = stone.mul(float(1).sub(smoothstep(0.1, 0.6, streaks).mul(0.35))) as Vec3Node;
  stone = mix(stone, color('#4f5648'), lichen.mul(0.35)) as Vec3Node;
  stone = mix(stone, color('#b7b2a8'), spall.mul(0.3)) as Vec3Node;
  stone = mix(stone, color('#0a0a0c'), crack.mul(0.9)) as Vec3Node;
  stone = mix(color('#24201f'), stone, smoothstep(0, 9, p.y)) as Vec3Node;
  material.colorNode = mix(stone, color('#5a0306'), blood);
  material.roughnessNode = mix(float(0.95), float(0.3), blood);
  const height = grain.mul(0.025).add(mottle.mul(0.05)).sub(crack.mul(0.12)).sub(spall.mul(0.05)).add(blood.mul(0.008));
  material.normalNode = bumpNormal(height as FloatNode);
  return material;
}

/** Polished black eyes mirroring the sky and the moon. */
function blackEyeMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ color: '#020203', roughness: 0.05, metalness: 0 });
  material.emissiveNode = mirrored(reflectVector as Vec3Node).mul(fresnel(normalView as Vec3Node, 0.06));
  return material;
}

/** Rough matte ground: a cobbled path of worn stones, dusty grit off the path, dried stains. */
function groundMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const p = positionWorld;
  const edge = mx_noise_float(vec3(p.x.mul(0.35), 0, p.z.mul(0.35))).mul(0.7);
  const onPath = float(1).sub(smoothstep(float(PATH_HALF_WIDTH - 0.5).add(edge), float(PATH_HALF_WIDTH + 0.7).add(edge), abs(p.x)));
  const cobbleWarp = vec2(mx_noise_float(p.mul(0.9)), mx_noise_float(p.mul(0.9).add(5.2))).mul(0.25);
  const cobbles = mx_worley_noise_vec2(p.xz.mul(1.25).add(cobbleWarp));
  const top = smoothstep(0.03, 0.22, cobbles.y.sub(cobbles.x));
  const grit = mx_noise_float(p.mul(9)).mul(0.5).add(mx_noise_float(p.mul(23)).mul(0.25));
  const pick = mx_noise_float(p.mul(1.6).add(41.2)).mul(0.5).add(0.5);
  const cobble = mix(color('#3f3c42'), color('#6d6a70'), pick.mul(0.7).add(grit.mul(0.3)));
  const path = mix(color('#121013'), cobble, top).mul(grit.mul(0.2).add(0.88));
  const dirt = mix(color('#1b191d'), color('#343238'), mx_noise_float(p.mul(0.3)).mul(0.5).add(0.5)).mul(grit.mul(0.3).add(0.82));
  const stain = smoothstep(0.5, 0.75, mx_noise_float(p.mul(0.16).add(11.3))).mul(onPath).mul(0.75);
  material.colorNode = mix(mix(dirt, path, onPath), color('#2a0507'), stain);
  const height = onPath.mul(top.mul(0.045).add(grit.mul(0.008)))
    .add(float(1).sub(onPath).mul(grit.mul(0.02).add(mx_noise_float(p.mul(1.3)).mul(0.035))));
  material.normalNode = bumpNormal(height as FloatNode);
  return material;
}

/** Wet blood: deep red, mirror-smooth, gently stirring, with a darker meniscus at the edge. */
function bloodMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0 });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -2;
  material.polygonOffsetUnits = -2;
  const p = positionWorld;
  const rim = attribute<'float'>('aRim', 'float');
  const centre = attribute<'vec3'>('aCentre', 'vec3');
  // A slow drip lands in each pool now and then, and its rings spread out.
  const age = fract(time.mul(0.22).add(centre.z));
  const dist = p.xz.sub(centre.xy).length();
  const ring = exp(dist.sub(age.mul(2.6)).pow(2).mul(-26)).mul(float(1).sub(age)).mul(0.006);
  const stir = mx_noise_float(vec3(p.x.mul(1.8), p.z.mul(1.8), time.mul(0.25))).mul(0.003);
  material.normalNode = bumpNormal(ring.add(stir).add(rim.pow(3).mul(0.01)) as FloatNode);
  // Outside the normal pass, normalView and reflectVector already carry the rippled normal.
  material.colorNode = mix(color('#3a0004'), color('#160002'), smoothstep(0.75, 1, rim));
  material.emissiveNode = mirrored(reflectVector as Vec3Node).mul(fresnel(normalView as Vec3Node, 0.04)).mul(0.9)
    .add(color('#5c0208').mul(float(1).sub(rim.mul(0.55))).mul(0.35));
  return material;
}

function stoneMaterial(): THREE.MeshStandardNodeMaterial {
  const material = new THREE.MeshStandardNodeMaterial({ roughness: 1, metalness: 0 });
  const p = positionWorld;
  const grain = mx_noise_float(p.mul(3.1)).mul(0.5).add(mx_noise_float(p.mul(11)).mul(0.25));
  material.colorNode = mix(color('#2f2d33'), color('#6c6d70'), mx_noise_float(p.mul(0.6)).mul(0.5).add(0.5)).mul(grain.mul(0.2).add(0.9));
  material.normalNode = bumpNormal(grain.mul(0.02) as FloatNode);
  return material;
}

// ---------------------------------------------------------------------------

export default defineRoom('jp-visages-claude', {
  async mount(ctx) {
    const root = new THREE.Group();
    ctx.scene.add(root);
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const instanced: THREE.InstancedMesh[] = [];
    const ownGeometry = <T extends THREE.BufferGeometry>(g: T) => (geometries.push(g), g);
    const ownMaterial = <T extends THREE.Material>(m: T) => (materials.push(m), m);
    ctx.onDispose(() => {
      ctx.scene.remove(root);
      ctx.scene.backgroundNode = null;
      ctx.scene.fog = null;
      for (const mesh of instanced) mesh.dispose();
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    });

    // --- Night, fog and light -------------------------------------------------
    {
      const dir = normalWorldGeometry;
      const up = dir.y;
      const sky = mix(color(FOG), color(ZENITH), smoothstep(0, 0.7, up));
      const clouds = smoothstep(-0.1, 0.6, mx_fractal_noise_float(vec3(dir.x.mul(2.2), dir.y.mul(5), dir.z.mul(2.2)).add(time.mul(0.004)), 4, 2, 0.5))
        .mul(smoothstep(0.02, 0.35, up));
      const toward = max(dot(dir, vec3(MOON.x, MOON.y, MOON.z)), 0);
      const moon = smoothstep(0.99935, 0.9996, toward).mul(1.4).add(pow(toward, 300).mul(0.35)).add(pow(toward, 12).mul(0.05));
      ctx.scene.backgroundNode = mix(sky, color('#13232a'), clouds.mul(0.75)).add(color('#cfdcff').mul(moon));
    }
    ctx.scene.fog = new THREE.FogExp2(FOG, 0.0085);
    root.add(new THREE.HemisphereLight('#56647a', '#2b0b10', 0.85));
    const moonlight = new THREE.DirectionalLight('#d6e2ff', 1.7);
    moonlight.position.copy(MOON).multiplyScalar(100);
    root.add(moonlight);
    // Each row's faces catch a cold side light from across the path; a faint red bounce rises from below.
    for (const [x, tint, strength] of [[-1, '#a9b9cc', 1.05], [1, '#b3a7cf', 0.95]] as const) {
      const fill = new THREE.DirectionalLight(tint, strength);
      fill.position.set(x * 100, 45, -20);
      root.add(fill);
    }
    const bounce = new THREE.DirectionalLight('#8a1016', 0.4);
    bounce.position.set(0, -100, 10);
    root.add(bounce);

    // --- Ground ---------------------------------------------------------------
    ctx.setTerrainHeight(terrainHeight);
    ctx.setWalkBounds({ minX: -WALK_HALF_WIDTH, maxX: WALK_HALF_WIDTH, minZ: -95, maxZ: 95 });
    {
      const xs: number[] = [];
      for (let x = -220; x < -24; x += 4) xs.push(x);
      for (let x = -24; x <= 24; x += 1) xs.push(x);
      for (let x = 28; x <= 220; x += 4) xs.push(x);
      const zs: number[] = [];
      for (let z = -ROW_REACH - 10; z <= ROW_REACH + 10; z += 2.5) zs.push(z);
      const position = new Float32Array(xs.length * zs.length * 3);
      let o = 0;
      for (const z of zs) {
        for (const x of xs) {
          position[o++] = x;
          position[o++] = terrainHeight(x, z);
          position[o++] = z;
        }
        await ctx.breathe();
      }
      const index = new Uint32Array((xs.length - 1) * (zs.length - 1) * 6);
      o = 0;
      for (let j = 0; j < zs.length - 1; j++) {
        for (let i = 0; i < xs.length - 1; i++) {
          const a = j * xs.length + i;
          const b = a + 1;
          const c = a + xs.length;
          const d = c + 1;
          index[o++] = a; index[o++] = c; index[o++] = b;
          index[o++] = b; index[o++] = c; index[o++] = d;
        }
      }
      const geometry = ownGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setIndex(new THREE.BufferAttribute(index, 1));
      geometry.computeVertexNormals();
      root.add(new THREE.Mesh(geometry, ownMaterial(groundMaterial())));
    }
    await ctx.breathe();

    // --- The heads --------------------------------------------------------------
    const parts = await loadHeadParts();
    await ctx.breathe();
    {
      const eyeY = parts.eyeCenters.length
        ? parts.eyeCenters.reduce((sum, e) => sum + e[1], 0) / parts.eyeCenters.length
        : parts.crownY * 0.68;
      const placements = headPlacements();
      const near = placements.filter(h => Math.abs(h.z) < NEAR_REACH);
      const far = placements.filter(h => Math.abs(h.z) >= NEAR_REACH);
      const skinMaterial = ownMaterial(stoneSkinMaterial(parts));
      const eyeMaterial = ownMaterial(blackEyeMaterial());
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      const at = new THREE.Vector3();
      const size = new THREE.Vector3();
      const matrixFor = (h: (typeof placements)[number]) => {
        const s = HEAD_SCALE * h.scale;
        at.set(h.x, terrainHeight(h.x, h.z) - (eyeY - h.burial) * s, h.z);
        rotation.setFromAxisAngle(up, h.yaw);
        return matrix.compose(at, rotation, size.setScalar(s));
      };
      const rows = (part: MeshPart, list: typeof placements, material: THREE.Material, weeping: boolean) => {
        const geometry = ownGeometry(partGeometry(part));
        if (weeping) {
          geometry.setAttribute('aWeep', new THREE.InstancedBufferAttribute(Float32Array.from(list, h => h.weeping), 1));
        }
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        list.forEach((h, i) => mesh.setMatrixAt(i, matrixFor(h)));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        instanced.push(mesh);
        root.add(mesh);
      };
      rows(parts.skin, near, skinMaterial, true);
      await ctx.breathe();
      rows(parts.skinFar, far, skinMaterial, true);
      await ctx.breathe();
      rows(parts.eyes, placements, eyeMaterial, false);
    }
    await ctx.breathe();

    // --- Pools of blood -----------------------------------------------------------
    {
      const pools = bloodPools();
      const SEGMENTS = 56;
      const vertices = pools.length * (SEGMENTS * 2 + 1);
      const position = new Float32Array(vertices * 3);
      const rim = new Float32Array(vertices);
      const centre = new Float32Array(vertices * 3);
      const index: number[] = [];
      let v = 0;
      for (const pool of pools) {
        const outline = poolOutline(pool, SEGMENTS);
        const first = v;
        const put = (x: number, z: number, r: number) => {
          position.set([x, 0.012, z], v * 3);
          rim[v] = r;
          centre.set([pool.x, pool.z, pool.phase % 1], v * 3);
          return v++;
        };
        put(pool.x, pool.z, 0);
        // An inner ring at 85 % so the meniscus darkening has room to show.
        for (const point of outline) put(pool.x + (point.x - pool.x) * 0.85, pool.z + (point.z - pool.z) * 0.85, 0.85);
        for (const point of outline) put(point.x, point.z, 1);
        for (let i = 0; i < SEGMENTS; i++) {
          const a = first + 1 + i;
          const b = first + 1 + ((i + 1) % SEGMENTS);
          const oa = a + SEGMENTS;
          const ob = b + SEGMENTS;
          index.push(first, b, a, a, b, ob, a, ob, oa);
        }
      }
      const geometry = ownGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertices * 3).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
      geometry.setAttribute('aRim', new THREE.BufferAttribute(rim, 1));
      geometry.setAttribute('aCentre', new THREE.BufferAttribute(centre, 3));
      geometry.setIndex(index);
      const mesh = new THREE.Mesh(geometry, ownMaterial(bloodMaterial()));
      mesh.renderOrder = 1;
      root.add(mesh);
    }
    await ctx.breathe();

    // --- Stones ---------------------------------------------------------------------
    {
      const shapes = rockPositions();
      const all = stones(ROCK_VARIANTS);
      const material = ownMaterial(stoneMaterial());
      const matrix = new THREE.Matrix4();
      const rotation = new THREE.Quaternion();
      const euler = new THREE.Euler();
      const at = new THREE.Vector3();
      const size = new THREE.Vector3();
      const tint = new THREE.Color();
      for (let variant = 0; variant < ROCK_VARIANTS; variant++) {
        const list = all.filter(s => s.variant === variant);
        const geometry = ownGeometry(new THREE.BufferGeometry());
        geometry.setAttribute('position', new THREE.BufferAttribute(shapes[variant], 3));
        geometry.computeVertexNormals();
        const mesh = new THREE.InstancedMesh(geometry, material, list.length);
        list.forEach((s, i) => {
          rotation.setFromEuler(euler.set(s.rx, s.ry, s.rz));
          mesh.setMatrixAt(i, matrix.compose(at.set(s.x, s.y, s.z), rotation, size.set(s.sx, s.sy, s.sz)));
          // Big shards are pale like the heads they fell from; small stones are darker grit.
          const pale = THREE.MathUtils.smoothstep(s.sy, 0.4, 1.4);
          mesh.setColorAt(i, tint.setScalar(0.65 + s.shade * 0.35 + pale * 0.45));
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        instanced.push(mesh);
        root.add(mesh);
        await ctx.breathe();
      }
    }

    // --- Ash drifting down through the dark ------------------------------------------
    {
      const MOTES = 900;
      const position = new Float32Array(MOTES * 9);
      const seed = new Float32Array(MOTES * 12);
      let r = 0x9e3779b9;
      const rand = () => {
        r = (r * 1664525 + 1013904223) >>> 0;
        return r / 4294967296;
      };
      for (let i = 0; i < MOTES; i++) {
        const cx = (rand() * 2 - 1) * 26;
        const cy = rand() * 34;
        const cz = (rand() * 2 - 1) * 140;
        const speed = 0.25 + rand() * 0.45;
        const s = 0.025 + rand() * 0.035;
        const corners = [[0, s, 0], [-s, -s * 0.6, s * 0.3], [s, -s * 0.5, -s * 0.3]];
        corners.forEach(([x, y, z], k) => {
          position.set([x, y, z], (i * 3 + k) * 3);
          seed.set([cx, cy, cz, speed], (i * 3 + k) * 4);
        });
      }
      const geometry = ownGeometry(new THREE.BufferGeometry());
      geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
      geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
      const material = ownMaterial(new THREE.MeshBasicNodeMaterial({
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
      }));
      const s = attribute<'vec4'>('aSeed', 'vec4');
      const fall = mod(s.y.sub(time.mul(s.w)), 34);
      const spin = time.mul(s.w.mul(3)).add(s.x);
      const corner = positionGeometry;
      const turned = vec3(corner.x.mul(cos(spin)).sub(corner.z.mul(sin(spin))), corner.y, corner.x.mul(sin(spin)).add(corner.z.mul(cos(spin))));
      material.positionNode = vec3(
        s.x.add(sin(time.mul(0.3).add(s.z)).mul(0.9)),
        fall,
        s.z.add(cos(time.mul(0.23).add(s.x)).mul(0.9)),
      ).add(turned);
      material.colorNode = color('#b9b6bf');
      material.opacityNode = smoothstep(0, 3, fall).mul(0.55);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      root.add(mesh);
    }
  },
});
