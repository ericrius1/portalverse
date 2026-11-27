/**
 * Where everything in the Visages room goes: the ground's shape, the two rows of
 * heads, the pools of blood and the scattered stones. Pure data, seeded, so the
 * room looks the same on every visit and the layout can be tested without a GPU.
 */
import { seededRandom } from '@portalverse/core/rooms/kit';

/** Engine portal positions (entrance +Z, exit −Z), both at x = 0. */
export const PORTAL_Z = 36.25;
/** The ground is dead level within this distance of the centre line. */
export const PATH_FLAT = 5.5;
/** The visible cobbled path's half width (inside the level strip). */
export const PATH_HALF_WIDTH = 4.2;
/** How far the rows, ground and stones run each way, deep into the fog past both portals. */
export const ROW_REACH = 440;
/** Distance from the centre line to each head's centre. */
export const ROW_X = 36;
/** Spacing between heads along a row. */
export const HEAD_SPACING = 38;
/** Model units to metres: the bust is ~6 units chin to crown, so heads stand ~40 m tall. */
export const HEAD_SCALE = 7;
/** Players stay between the rows, clear of the noses even when flying. */
export const WALK_HALF_WIDTH = 12;

const smooth = (edge0: number, edge1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Ground height: level along the path, rising into rough mounds where the heads are buried. */
export function terrainHeight(x: number, z: number): number {
  const ax = Math.abs(x);
  if (ax <= PATH_FLAT) return 0;
  const rise = smooth(PATH_FLAT, 16, ax);
  const bumps = 0.35 * Math.sin(x * 0.21 + z * 0.17) * Math.sin(z * 0.11 - x * 0.05)
    + 0.2 * Math.sin(x * 0.9 + z * 0.6) * Math.sin(z * 0.73 + x * 0.31);
  return rise * (0.9 + bumps) + smooth(18, 32, ax) * 1.4 + smooth(55, 120, ax) * 5;
}

export interface HeadPlacement {
  x: number;
  z: number;
  /** Rotation about Y; the model faces +Z, so this turns it to face the path. */
  yaw: number;
  /** Multiplier on HEAD_SCALE. */
  scale: number;
  /** How far below its eyes (model units) the ground meets the head: ~3 puts the chin at the ground. */
  burial: number;
  /** 0..1, how heavily this one weeps. */
  weeping: number;
}

/** Two facing rows of heads from deep behind the entrance to deep beyond the exit. */
export function headPlacements(seed = 4417): HeadPlacement[] {
  const rand = seededRandom(seed);
  const heads: HeadPlacement[] = [];
  const steps = Math.floor(ROW_REACH / HEAD_SPACING);
  for (let k = -steps; k < steps; k++) {
    const zRow = HEAD_SPACING / 2 + k * HEAD_SPACING;
    for (const side of [-1, 1]) {
      // Left row (x < 0) faces +X, right row faces −X: every face looks across the path.
      const facing = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      heads.push({
        x: side * (ROW_X + rand() * 3),
        z: zRow + (rand() - 0.5) * 5,
        yaw: facing + (rand() - 0.5) * 0.16,
        scale: 0.92 + rand() * 0.18,
        burial: 2.6 + rand() * 0.8,
        weeping: rand() < 0.65 ? 0.45 + rand() * 0.55 : rand() * 0.25,
      });
    }
  }
  return heads;
}

export interface Pool {
  x: number;
  z: number;
  /** Radius along the pool's long axis. */
  radius: number;
  /** Short axis / long axis. */
  aspect: number;
  angle: number;
  /** Seeds the wobble of the outline. */
  phase: number;
}

/** Pools of blood lying in the path, never touching each other or the portals. */
export function bloodPools(seed = 9191): Pool[] {
  const rand = seededRandom(seed);
  const pools: Pool[] = [];
  for (let attempt = 0; attempt < 400 && pools.length < 34; attempt++) {
    const radius = 0.5 + rand() * rand() * 2.6;
    const aspect = 0.45 + rand() * 0.5;
    const x = (rand() * 2 - 1) * Math.max(0, PATH_HALF_WIDTH + 0.4 - radius * 1.25);
    const z = (rand() * 2 - 1) * 210;
    const pool = { x, z, radius, aspect, angle: rand() * Math.PI, phase: rand() * 100 };
    if (Math.abs(Math.abs(z) - PORTAL_Z) < radius * 1.3 + 2.5) continue;
    if (pools.some(p => Math.hypot(p.x - x, p.z - z) < (p.radius + radius) * 1.3 + 0.3)) continue;
    pools.push(pool);
  }
  return pools;
}

/**
 * The outline of a pool as a fan around its centre: `rim` is 0 at the centre and
 * 1 at the edge. Radius wobbles so each pool has its own spill shape.
 */
export function poolOutline(pool: Pool, segments = 56): Array<{ x: number; z: number }> {
  const points: Array<{ x: number; z: number }> = [];
  const c = Math.cos(pool.angle);
  const s = Math.sin(pool.angle);
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const wobble = 1
      + 0.18 * Math.sin(t * 2 + pool.phase)
      + 0.12 * Math.sin(t * 3 + pool.phase * 1.7)
      + 0.07 * Math.sin(t * 7 + pool.phase * 2.3);
    const lx = Math.cos(t) * pool.radius * wobble;
    const lz = Math.sin(t) * pool.radius * pool.aspect * wobble;
    points.push({ x: pool.x + lx * c - lz * s, z: pool.z + lx * s + lz * c });
  }
  return points;
}

export interface Stone {
  variant: number;
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  rx: number;
  ry: number;
  rz: number;
  /** 0..1 brightness variation. */
  shade: number;
}

/** Pebbles in the path, stones along its edges and big fallen shards around the heads. */
export function stones(variants: number, seed = 7321): Stone[] {
  const rand = seededRandom(seed);
  const out: Stone[] = [];
  const add = (x: number, z: number, size: number, flat: number, sinkFraction: number) => {
    const sy = size * flat;
    out.push({
      variant: Math.floor(rand() * variants),
      x,
      y: terrainHeight(x, z) + sy * (0.5 - sinkFraction),
      z,
      sx: size * (0.8 + rand() * 0.5),
      sy,
      sz: size * (0.8 + rand() * 0.5),
      rx: (rand() - 0.5) * 0.5,
      ry: rand() * Math.PI * 2,
      rz: (rand() - 0.5) * 0.5,
      shade: rand(),
    });
  };
  // Pebbles and small stones bedded in the path.
  for (let i = 0; i < 900; i++) {
    const size = 0.05 + rand() * rand() * 0.28;
    add((rand() * 2 - 1) * (PATH_HALF_WIDTH + 1.2), (rand() * 2 - 1) * 260, size, 0.5 + rand() * 0.3, 0.45);
  }
  // Loose stones gathered along the path's edges.
  for (let i = 0; i < 420; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const size = 0.25 + rand() * rand() * 0.9;
    add(side * (PATH_HALF_WIDTH + 0.6 + rand() * 9), (rand() * 2 - 1) * 300, size, 0.45 + rand() * 0.35, 0.35);
  }
  // Fallen shards and boulders heaped around the buried heads, all the way into the dark.
  for (let i = 0; i < 520; i++) {
    const side = rand() < 0.5 ? -1 : 1;
    const size = 0.8 + rand() * rand() * 3.4;
    add(side * (14 + rand() * 40), (rand() * 2 - 1) * ROW_REACH, size, 0.35 + rand() * 0.5, 0.3);
  }
  return out;
}
