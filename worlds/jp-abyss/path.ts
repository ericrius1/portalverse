/**
 * Layout for the abyss walk, kept free of rendering so it can be tested: the
 * crooked centreline, the Voronoi stepping stones cut along it, how each stone
 * drifts, and the height the player walks at (none past the edge: you fall).
 */
import { NO_GROUND } from '@portalverse/core/engine/falling';
import { ROUTE_LENGTH } from '@portalverse/core/portal/roomLayout';

/** A point on the ground plane, as [x, z]. */
export type Point = [number, number];

export const GATE_Z = ROUTE_LENGTH / 2;
export const PATH_HALF_WIDTH = 2.5;
/** Stones run a little past each gate so you can turn round there. */
export const PATH_END = 45;
/** How far a stone's top tilts, per metre of its drift amplitude. */
export const TILT = 0.3;

const ROW = 1.65;
const A_SWING = 5.6;
const B_SWING = 0.7;
const C_SWING = 1.1;
/** Edges shorter than this are merged, so the chamfer never folds over itself. */
const MIN_EDGE = 0.22;

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/** Where the bends stop: every term of `pathX` reaches zero, level, at ±BEND_END. */
const BEND_END = 32;

/** 1 along the winding middle of the room, 0 on the straight runs through each gate. */
export function windiness(z: number): number {
  return Math.abs(z) < BEND_END ? 1 : 0;
}

/** 1 where stones drift freely, easing to 0 so the stones at each gate hold still. */
export function restlessness(z: number): number {
  return 1 - smooth(26, 32.5, Math.abs(z));
}

/**
 * The centreline swings side to side out of step with itself, so the bends never
 * repeat. Each pair of waves is matched so the path meets the straight runs at the
 * gates with no kink.
 */
export function pathX(z: number): number {
  if (!windiness(z)) return 0;
  const k = Math.PI / BEND_END;
  return (
    A_SWING * (Math.sin(k * z) + 0.5 * Math.sin(2 * k * z)) +
    B_SWING * (Math.sin(3 * k * z) + 0.75 * Math.sin(4 * k * z)) +
    C_SWING * (1 - Math.cos(2 * k * z))
  );
}

/** The path also rises and dips a little, so it reads as floating rather than built. */
export function pathY(z: number): number {
  if (!windiness(z)) return 0;
  const k = Math.PI / BEND_END;
  return 0.85 * (Math.sin(2 * k * z) - 0.5 * Math.sin(4 * k * z));
}

function pathGradient(z: number): number {
  return (pathY(z + 0.01) - pathY(z - 0.01)) / 0.02;
}

export interface PathSample {
  x: number;
  z: number;
  /** Distance walked along the path from the entrance end. */
  s: number;
  /** Unit direction of travel, toward the exit (-Z). */
  tx: number;
  tz: number;
}

/** The centreline from the entrance end (+Z) to the exit end (-Z). */
export function centreline(step = 0.1): PathSample[] {
  const samples: PathSample[] = [];
  const count = Math.round((2 * PATH_END) / step);
  for (let i = 0; i <= count; i++) {
    const z = PATH_END - i * step;
    const x = pathX(z);
    const prev = samples[i - 1];
    samples.push({ x, z, s: prev ? prev.s + Math.hypot(x - prev.x, z - prev.z) : 0, tx: 0, tz: 0 });
  }
  for (let i = 0; i < samples.length; i++) {
    const a = samples[Math.max(0, i - 1)];
    const b = samples[Math.min(samples.length - 1, i + 1)];
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    samples[i].tx = (b.x - a.x) / length;
    samples[i].tz = (b.z - a.z) / length;
  }
  return samples;
}

/** The point `s` metres along the centreline, continuing straight past either end. */
export function sampleAt(line: PathSample[], s: number): PathSample {
  const first = line[0];
  const last = line[line.length - 1];
  if (s <= 0) return { ...first, x: first.x + first.tx * s, z: first.z + first.tz * s, s };
  if (s >= last.s) return { ...last, x: last.x + last.tx * (s - last.s), z: last.z + last.tz * (s - last.s), s };
  let lo = 0;
  let hi = line.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const a = line[lo];
  const b = line[hi];
  const f = (s - a.s) / (b.s - a.s || 1);
  return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, s, tx: a.tx, tz: a.tz };
}

/** Horizontal distance from (x, z) to the nearest centreline sample. */
export function distanceToPath(line: PathSample[], x: number, z: number): number {
  // Find roughly where the path is nearest from every tenth sample, then check every sample around there.
  const COARSE = 10;
  const squared = (p: PathSample) => (p.x - x) ** 2 + (p.z - z) ** 2;
  let near = 0;
  let best = Infinity;
  for (let i = 0; i < line.length; i += COARSE) {
    const d = squared(line[i]);
    if (d < best) {
      best = d;
      near = i;
    }
  }
  for (let i = Math.max(0, near - 2 * COARSE); i <= Math.min(line.length - 1, near + 2 * COARSE); i++) {
    best = Math.min(best, squared(line[i]));
  }
  return Math.sqrt(best);
}

// --- Convex polygon helpers (counter-clockwise in x/z, i.e. positive shoelace area) ---

export function polygonArea(poly: Point[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    sum += x1 * z2 - x2 * z1;
  }
  return sum / 2;
}

export function polygonCentroid(poly: Point[]): Point {
  let cx = 0;
  let cz = 0;
  let twiceArea = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    const cross = x1 * z2 - x2 * z1;
    twiceArea += cross;
    cx += (x1 + x2) * cross;
    cz += (z1 + z2) * cross;
  }
  return [cx / (3 * twiceArea), cz / (3 * twiceArea)];
}

/** Keep the part of `poly` where nx·x + nz·z <= d. */
export function clipPolygon(poly: Point[], nx: number, nz: number, d: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + nz * a[1] - d;
    const db = nx * b[0] + nz * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const f = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
  }
  return out;
}

/** Drop vertices that sit too close to the one before. Removing a vertex keeps a convex polygon convex. */
function mergeShortEdges(poly: Point[], minEdge: number): Point[] {
  const out = [...poly];
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const a = out[i];
      const b = out[(i + 1) % out.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < minEdge) {
        out.splice((i + 1) % out.length, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Move every vertex inward so each edge sits `d` further in. Same vertex count, for building chamfers. */
export function insetVertices(poly: Point[], d: number): Point[] {
  const n = poly.length;
  const normals = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Left of the edge is inside for a counter-clockwise polygon.
    return [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] as Point;
  });
  return poly.map((v, i) => {
    const n1 = normals[(i - 1 + n) % n];
    const n2 = normals[i];
    const k = d / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
    return [v[0] + (n1[0] + n2[0]) * k, v[1] + (n1[1] + n2[1]) * k] as Point;
  });
}

export function pointInPolygon(poly: Point[], x: number, z: number): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]) < 0) return false;
  }
  return true;
}

// --- Stones ---

export interface Stone {
  /** Crosswise generation row on the winding path. Loose stones have no row. */
  pathRow?: number;
  /** The Voronoi site the stone was cut around. Nearest site decides which stone you stand on. */
  site: Point;
  cx: number;
  cz: number;
  /** Outline of the stone's sides, convex and counter-clockwise, in world x/z. */
  polygon: Point[];
  /** Resting height of the top face at the centroid, and how the top slopes. */
  topY: number;
  slopeX: number;
  slopeZ: number;
  thickness: number;
  chamfer: number;
  /** How far the rocky underside hangs below the slab. */
  depth: number;
  radius: number;
  /** Drift: amplitude in metres, speed multiplier, and four phases. */
  amp: number;
  speed: number;
  phases: [number, number, number, number];
  /** 0..1, how strongly the stone's cracks glow. */
  glow: number;
  seed: number;
  walkable: boolean;
}

/**
 * How a stone has drifted from rest at time `t`: a rise and a tilt, each a few
 * sine waves out of step, like drei's Float. The stone shader repeats this exactly.
 */
export function stoneMotion(stone: Stone, t: number): { rise: number; sx: number; sz: number } {
  const a = t * stone.speed;
  const [p1, p2, p3, q] = stone.phases;
  const rise = stone.amp * (0.6 * Math.sin(a * 0.61 + p1) + 0.3 * Math.sin(a * 1.13 + p2) + 0.1 * Math.sin(a * 2.3 + p3));
  const tilt = stone.amp * TILT;
  return { rise, sx: tilt * Math.sin(a * 0.47 + q), sz: tilt * Math.cos(a * 0.39 + q * 1.3) };
}

/** Height of a stone's top face above (x, z) at time `t`, held level past the stone's own edge. */
export function stoneTopAt(stone: Stone, x: number, z: number, t: number): number {
  let dx = x - stone.cx;
  let dz = z - stone.cz;
  const reach = Math.hypot(dx, dz);
  if (reach > stone.radius) {
    dx *= stone.radius / reach;
    dz *= stone.radius / reach;
  }
  const { rise, sx, sz } = stoneMotion(stone, t);
  return stone.topY + rise + (stone.slopeX + sx) * dx + (stone.slopeZ + sz) * dz;
}

/** Cut the stepping stones: a jittered grid of sites along the path, each grown into its Voronoi cell, gapped and chipped. */
export function buildPathStones(rand: () => number, line = centreline()): Stone[] {
  const length = line[line.length - 1].s;
  let row = 0;
  const sites: Array<{ p: Point; real: boolean; outer: boolean; row: number }> = [];
  const keep = (p: Point, real: boolean, outer: boolean) => {
    const distance = distanceToPath(line, p[0], p[1]);
    if (real) {
      // Inside a bend, rows crowd together: skip sites that would make slivers.
      if (distance > PATH_HALF_WIDTH - 0.15) return;
      // Sites come row by row along the path, so only the last few rows can be this close.
      for (let i = Math.max(0, sites.length - 60); i < sites.length; i++) {
        const o = sites[i];
        if (o.real && Math.hypot(o.p[0] - p[0], o.p[1] - p[1]) < 1.05) return;
      }
    } else if (distance < PATH_HALF_WIDTH + 0.5) {
      return;
    }
    sites.push({ p, real, outer, row });
  };
  for (let s = -3 * ROW; s <= length + 3 * ROW; s += ROW * (0.85 + rand() * 0.3), row++) {
    const inside = s > 0.4 && s < length - 0.4;
    const shift = row % 2 ? 0.55 : -0.55;
    const across = (t: number) => {
      const q = sampleAt(line, s + (rand() - 0.5) * 0.6);
      return [q.x - q.tz * t, q.z + q.tx * t] as Point;
    };
    for (let j = -2; j <= 2; j++) {
      const t = shift + j * 1.65;
      if (Math.abs(t) > PATH_HALF_WIDTH - 0.3) continue;
      keep(across(t + (rand() - 0.5) * 0.5), inside, Math.abs(t) > 1.3);
    }
    for (const side of [-1, 1]) {
      keep(across(side * (PATH_HALF_WIDTH + 0.95 + (rand() - 0.5) * 0.5)), false, false);
      keep(across(side * (PATH_HALF_WIDTH + 2.6)), false, false);
    }
  }

  const stones: Stone[] = [];
  for (const site of sites) {
    if (!site.real) continue;
    const [sx, sz] = site.p;
    const calm = restlessness(sz);
    // Now and then an outer stone is simply missing, except at the gates.
    if (site.outer && calm > 0.5 && rand() < 0.12) continue;
    const gap = 0.12 + rand() * 0.2;
    const half = 2.4 - gap / 2;
    let poly: Point[] = [[sx - half, sz - half], [sx + half, sz - half], [sx + half, sz + half], [sx - half, sz + half]];
    for (const other of sites) {
      if (other === site) continue;
      const nx = other.p[0] - sx;
      const nz = other.p[1] - sz;
      if (Math.abs(nx) > 5 || Math.abs(nz) > 5) continue;
      const span = Math.hypot(nx, nz);
      poly = clipPolygon(poly, nx, nz, nx * (sx + nx / 2) + nz * (sz + nz / 2) - (span * gap) / 2);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    // Chip a corner or two off, as if broken long ago.
    const chips = rand() < 0.55 ? 1 + Math.floor(rand() * 2) : 0;
    for (let c = 0; c < chips && poly.length >= 3; c++) {
      const [ax, az] = polygonCentroid(poly);
      const [vx, vz] = poly[Math.floor(rand() * poly.length)];
      const reach = Math.hypot(vx - ax, vz - az);
      const nx = (vx - ax) / reach;
      const nz = (vz - az) / reach;
      poly = clipPolygon(poly, nx, nz, nx * ax + nz * az + reach * (0.72 + rand() * 0.16));
    }
    poly = mergeShortEdges(poly, MIN_EDGE);
    if (poly.length < 3 || polygonArea(poly) < 0.35) continue;
    const [cx, cz] = polygonCentroid(poly);
    const radius = Math.max(...poly.map(([x, z]) => Math.hypot(x - cx, z - cz)));
    stones.push({
      pathRow: site.row,
      site: site.p,
      cx,
      cz,
      polygon: poly,
      topY: pathY(cz) + (rand() - 0.5) * 0.05 * calm,
      slopeX: (rand() - 0.5) * 0.025 * calm,
      slopeZ: pathGradient(cz) + (rand() - 0.5) * 0.025 * calm,
      thickness: 0.32 + rand() * 0.22,
      chamfer: 0.05 + rand() * 0.03,
      depth: 0.5 + radius * (0.45 + rand() * 0.6),
      radius,
      amp: (0.06 + rand() * 0.06) * calm,
      speed: 0.7 + rand() * 0.6,
      phases: [rand() * 6.283, rand() * 6.283, rand() * 6.283, rand() * 6.283],
      glow: rand() < 0.3 ? 0.5 + rand() * 0.5 : rand() * 0.15,
      seed: rand(),
      walkable: true,
    });
  }
  return stones;
}

/** Loose stones adrift in the void around the path, at many depths, for scale. */
export function buildStrayStones(rand: () => number, line = centreline()): Stone[] {
  const stones: Stone[] = [];
  let attempts = 0;
  while (stones.length < 46 && attempts++ < 2000) {
    const angle = rand() * Math.PI * 2;
    const distance = 9 + Math.pow(rand(), 1.4) * 115;
    const cx = Math.sin(angle) * distance;
    const cz = Math.cos(angle) * distance * 0.85;
    if (distanceToPath(line, cx, cz) < 7.5) continue;
    // Keep the view through each gate clear.
    if (Math.abs(cx) < 7 && Math.abs(cz) > 26) continue;
    const near = distance < 24;
    const size = (near ? 0.9 : 1.4) + rand() * (near ? 1.6 : 3.4);
    let poly: Point[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      poly.push([cx + Math.cos(a) * size, cz + Math.sin(a) * size]);
    }
    for (let c = 0; c < 3 + Math.floor(rand() * 3); c++) {
      const a = rand() * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      poly = clipPolygon(poly, nx, nz, nx * cx + nz * cz + size * (0.55 + rand() * 0.35));
    }
    poly = mergeShortEdges(poly, MIN_EDGE * 1.5);
    if (poly.length < 3) continue;
    const [px, pz] = polygonCentroid(poly);
    const radius = Math.max(...poly.map(([x, z]) => Math.hypot(x - px, z - pz)));
    stones.push({
      site: [px, pz],
      cx: px,
      cz: pz,
      polygon: poly,
      topY: near ? -22 + rand() * 28 : -60 + rand() * 72,
      slopeX: (rand() - 0.5) * 0.3,
      slopeZ: (rand() - 0.5) * 0.3,
      thickness: 0.45 + rand() * 0.6,
      chamfer: 0.07 + rand() * 0.04,
      depth: radius * (0.9 + rand() * 1.1),
      radius,
      amp: 0.3 + rand() * 0.6,
      speed: 0.25 + rand() * 0.3,
      phases: [rand() * 6.283, rand() * 6.283, rand() * 6.283, rand() * 6.283],
      glow: rand() < 0.4 ? 0.4 + rand() * 0.6 : rand() * 0.2,
      seed: rand(),
      walkable: false,
    });
  }
  return stones;
}

/** How far past a stone's edge your footing still holds, so the gaps between stones never drop you. */
export const FOOTING = 0.45;
/** Distance over which the walking height blends from one stone to the next. */
const BLEND = 0.35;

/** Horizontal distance from (x, z) to a convex polygon: 0 inside it. */
export function distanceToPolygon(poly: Point[], x: number, z: number): number {
  if (pointInPolygon(poly, x, z)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    const ex = bx - ax;
    const ez = bz - az;
    const f = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez)));
    best = Math.min(best, Math.hypot(ax + ex * f - x, az + ez * f - z));
  }
  return best;
}

/**
 * The surface the player walks on. It rises and falls with the stones, but blends
 * smoothly from one stone to the next instead of stepping at each edge or dipping
 * into the gaps. Past the edge of the path there is no ground.
 */
export class Walkway {
  private readonly cells = new Map<string, number[]>();
  private static readonly CELL = 3.5;

  constructor(readonly stones: Stone[]) {
    for (const [index, stone] of stones.entries()) {
      const key = Walkway.key(Math.floor(stone.cx / Walkway.CELL), Math.floor(stone.cz / Walkway.CELL));
      const list = this.cells.get(key);
      if (list) list.push(index);
      else this.cells.set(key, [index]);
    }
  }

  private static key(i: number, j: number): string {
    return `${i},${j}`;
  }

  /** Inclusive stone indices across the path at this step, in their original construction order. */
  stepSpan(index: number, fullWidth: boolean): [number, number] {
    let first = index;
    let last = index;
    const row = this.stones[index].pathRow;
    if (fullWidth && row !== undefined) {
      while (first > 0 && this.stones[first - 1].pathRow === row) first--;
      while (last + 1 < this.stones.length && this.stones[last + 1].pathRow === row) last++;
    }
    return [first, last];
  }

  /** In a walkable crack, the nearest slab edge supplies the footstep. */
  stoneAtFeet(x: number, y: number, z: number, t: number): number {
    const footing = this.footingAt(x, z, t);
    return Math.abs(y - footing.height) < 0.015 ? footing.index : -1;
  }

  /** Height at (x, z) and time `t`: each nearby stone's top, weighted by how close its edge is. */
  heightAt(x: number, z: number, t: number): number {
    return this.footingAt(x, z, t).height;
  }

  private footingAt(x: number, z: number, t: number): { height: number; index: number } {
    const i = Math.floor(x / Walkway.CELL);
    const j = Math.floor(z / Walkway.CELL);
    let total = 0;
    let weighted = 0;
    let nearest = Infinity;
    let nearestIndex = -1;
    for (let di = -2; di <= 2; di++) {
      for (let dj = -2; dj <= 2; dj++) {
        for (const index of this.cells.get(Walkway.key(i + di, j + dj)) ?? []) {
          const stone = this.stones[index];
          const d = distanceToPolygon(stone.polygon, x, z);
          if (d > FOOTING + 3 * BLEND) continue;
          if (d < nearest || (d === nearest && index < nearestIndex)) {
            nearest = d;
            nearestIndex = index;
          }
          const w = Math.exp(-((d / BLEND) ** 2));
          total += w;
          weighted += w * stoneTopAt(stone, x, z, t);
        }
      }
    }
    return nearest > FOOTING ? { height: NO_GROUND, index: -1 } : { height: weighted / total, index: nearestIndex };
  }
}
