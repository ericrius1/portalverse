import * as THREE from 'three/webgpu';
import { insetVertices, type Stone } from './path';

/** Per-vertex copies of a stone's drift, so shaders can move each part with its stone. */
function stoneAttributes(stone: Stone): { motion: number[]; phase: number[] } {
  return { motion: [stone.cx, stone.cz, stone.speed, stone.amp], phase: [...stone.phases] };
}

/**
 * Every stone in one mesh: a chamfered slab with a jagged rock hanging beneath it,
 * flat-shaded. Positions are world space at rest; `aMotion`/`aPhase` let the shader
 * drift each stone, and `aLook` holds (glow, seed, rest top height, thickness).
 */
export function buildStoneGeometry(stones: Stone[], rand: () => number): THREE.BufferGeometry {
  const position: number[] = [];
  const normal: number[] = [];
  const motion: number[] = [];
  const phase: number[] = [];
  const look: number[] = [];
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const n = new THREE.Vector3();
  const middle = new THREE.Vector3();
  const inside = new THREE.Vector3();

  for (const stone of stones) {
    const attrs = stoneAttributes(stone);
    const stoneLook = [stone.glow, stone.seed, stone.topY, stone.thickness];
    const plane = (x: number, z: number) => stone.topY + stone.slopeX * (x - stone.cx) + stone.slopeZ * (z - stone.cz);
    const ring = (points: Array<[number, number]>, drop: number) =>
      points.map(([x, z]) => new THREE.Vector3(x, plane(x, z) - drop, z));
    const inset = insetVertices(stone.polygon, stone.chamfer);
    const rings = [
      ring(inset, 0),
      ring(stone.polygon, stone.chamfer),
      ring(stone.polygon, stone.thickness - stone.chamfer),
      ring(inset, stone.thickness),
    ];
    // The rock beneath narrows to an off-centre point, each ring roughly pulled in.
    const bottom = plane(stone.cx, stone.cz) - stone.thickness;
    const tipX = stone.cx + (rand() - 0.5) * stone.radius * 0.35;
    const tipZ = stone.cz + (rand() - 0.5) * stone.radius * 0.35;
    const rim = rings[3];
    for (const [pull, down] of [[0.72, 0.28], [0.42, 0.62]]) {
      rings.push(rim.map(p => {
        const f = pull * (0.85 + rand() * 0.3);
        return new THREE.Vector3(
          tipX + (p.x - tipX) * f,
          bottom - stone.depth * down * (0.8 + rand() * 0.4),
          tipZ + (p.z - tipZ) * f,
        );
      }));
    }
    const tip = new THREE.Vector3(tipX, bottom - stone.depth, tipZ);
    inside.set(stone.cx, plane(stone.cx, stone.cz) - stone.thickness / 2, stone.cz);

    const triangle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      middle.copy(a).add(b).add(c).divideScalar(3).sub(inside);
      // Wind every face outward from the stone's middle.
      const [p, q] = n.dot(middle) < 0 ? [c, b] : [b, c];
      if (n.dot(middle) < 0) n.negate();
      for (const v of [a, p, q]) {
        position.push(v.x, v.y, v.z);
        normal.push(n.x, n.y, n.z);
        motion.push(...attrs.motion);
        phase.push(...attrs.phase);
        look.push(...stoneLook);
      }
    };

    const centre = new THREE.Vector3(stone.cx, plane(stone.cx, stone.cz), stone.cz);
    const top = rings[0];
    for (let i = 0; i < top.length; i++) triangle(centre, top[i], top[(i + 1) % top.length]);
    for (let r = 0; r < rings.length - 1; r++) {
      const upper = rings[r];
      const lower = rings[r + 1];
      for (let i = 0; i < upper.length; i++) {
        const j = (i + 1) % upper.length;
        triangle(upper[i], lower[i], lower[j]);
        triangle(upper[i], lower[j], upper[j]);
      }
    }
    const last = rings[rings.length - 1];
    for (let i = 0; i < last.length; i++) triangle(last[i], last[(i + 1) % last.length], tip);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  geometry.setAttribute('aMotion', new THREE.Float32BufferAttribute(motion, 4));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 4));
  geometry.setAttribute('aLook', new THREE.Float32BufferAttribute(look, 4));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Where a stone's lowest point hangs at rest, for hanging smoke and sparkles under it. */
export function stoneUnderside(stone: Stone): THREE.Vector3 {
  return new THREE.Vector3(stone.cx, stone.topY - stone.thickness - stone.depth * 0.8, stone.cz);
}

export interface Wisp {
  stone: Stone;
  origin: THREE.Vector3;
  width: number;
  length: number;
  seed: number;
}

/**
 * Smoke ribbons hanging from the stones: a strip per wisp with its local shape in
 * `position` (x across, y down), `uv` 0 at the stone, and its anchor and seed in `aOrigin`.
 */
export function buildWispGeometry(wisps: Wisp[]): THREE.BufferGeometry {
  const COLS = 4;
  const ROWS = 20;
  const position: number[] = [];
  const uv: number[] = [];
  const origin: number[] = [];
  const motion: number[] = [];
  const phase: number[] = [];
  const index: number[] = [];
  for (const wisp of wisps) {
    const base = position.length / 3;
    const attrs = stoneAttributes(wisp.stone);
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        const u = c / COLS;
        const v = r / ROWS;
        position.push((u - 0.5) * wisp.width, -v * wisp.length, 0);
        uv.push(u, v);
        origin.push(wisp.origin.x, wisp.origin.y, wisp.origin.z, wisp.seed);
        motion.push(...attrs.motion);
        phase.push(...attrs.phase);
      }
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = base + r * (COLS + 1) + c;
        const b = a + COLS + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('aOrigin', new THREE.Float32BufferAttribute(origin, 4));
  geometry.setAttribute('aMotion', new THREE.Float32BufferAttribute(motion, 4));
  geometry.setAttribute('aPhase', new THREE.Float32BufferAttribute(phase, 4));
  geometry.setIndex(index);
  return geometry;
}

export interface Mote {
  stone: Stone;
  /** Resting position. */
  x: number;
  y: number;
  z: number;
  size: number;
  seed: number;
}

/** Per-instance buffers for a field of camera-facing sprites that ride along with their stones. */
export function moteAttributes(motes: Mote[]): {
  rest: THREE.InstancedBufferAttribute;
  motion: THREE.InstancedBufferAttribute;
  phase: THREE.InstancedBufferAttribute;
} {
  const rest = new Float32Array(motes.length * 4);
  const motion = new Float32Array(motes.length * 4);
  const phase = new Float32Array(motes.length * 4);
  motes.forEach((mote, i) => {
    rest.set([mote.x, mote.y, mote.z, mote.size], i * 4);
    motion.set([mote.stone.cx, mote.stone.cz, mote.stone.speed, mote.stone.amp], i * 4);
    phase.set(mote.stone.phases, i * 4);
    // Each mote keeps its own seed in place of the stone's last phase; the shader only needs three of them.
    phase[i * 4 + 3] = mote.seed;
  });
  return {
    rest: new THREE.InstancedBufferAttribute(rest, 4),
    motion: new THREE.InstancedBufferAttribute(motion, 4),
    phase: new THREE.InstancedBufferAttribute(phase, 4),
  };
}

/**
 * A crooked needle of rock, one unit tall with a base radius of one, faceted and
 * leaning. Instances stretch it into spikes a hundred metres and more high.
 */
export function buildSpikeGeometry(rand: () => number): THREE.BufferGeometry {
  const SIDES = 5;
  const RINGS = 14;
  const leanX = (rand() - 0.5) * 7;
  const leanZ = (rand() - 0.5) * 4;
  const rings: THREE.Vector3[][] = [];
  for (let r = 0; r < RINGS; r++) {
    const h = r / RINGS;
    const radius = Math.pow(1 - h, 1.5) * (0.8 + rand() * 0.4);
    const twist = h * 2.4 + rand() * 0.3;
    const ring: THREE.Vector3[] = [];
    for (let s = 0; s < SIDES; s++) {
      const a = (s / SIDES) * Math.PI * 2 + twist + (rand() - 0.5) * 0.4;
      const reach = radius * (0.75 + rand() * 0.4);
      ring.push(new THREE.Vector3(leanX * h * h + Math.cos(a) * reach, h, leanZ * h * h * h + Math.sin(a) * reach));
    }
    rings.push(ring);
  }
  const tip = new THREE.Vector3(leanX, 1, leanZ);
  const position: number[] = [];
  const push = (...vs: THREE.Vector3[]) => vs.forEach(v => position.push(v.x, v.y, v.z));
  for (let r = 0; r < RINGS - 1; r++) {
    for (let s = 0; s < SIDES; s++) {
      const t = (s + 1) % SIDES;
      push(rings[r][s], rings[r + 1][s], rings[r + 1][t]);
      push(rings[r][s], rings[r + 1][t], rings[r][t]);
    }
  }
  const last = rings[RINGS - 1];
  for (let s = 0; s < SIDES; s++) push(last[s], tip, last[(s + 1) % SIDES]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  geometry.computeVertexNormals();
  return geometry;
}
