/**
 * The Palace Lagoon's continuous walkable wooden pathway:
 *   1. A long ~63 m weathered teak garden boardwalk launching in the sunlit courtyard behind the monumental
 *      4-column north colonnade portico (-13.05, 61.05), passing dead-center through the garlanded arches
 *      (-6.27, 53.30), sweeping across the golden wildflower meadow, bridging the reflecting lagoon cove,
 *      and gliding straight through the tall rotunda north arch onto the inlaid 8-point star plaza (0, 0.06, +1.5).
 *   2. A single, completely fluid C1-continuous ascending Spanish-cedar spiral inside the rotunda nave
 *      (zero 90° turns, minimum turn radius 7.0 m everywhere, uniform gentle ~17° grade, clear of all 8 piers),
 *      sweeping smoothly into dead center of the Alhambra ceramic dome portal at (0, 26.2, -14) heading straight -Z.
 *
 * Pure math shared by the procedural mesh builder (`mesh.ts`), room terrain/collision (`index.ts`),
 * the dome portal threshold (`domePortal.ts`), and tests.
 */
import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';
import { PALACE, WATER_Y } from '../layout';

export type V3 = [number, number, number];

export interface PathFrame {
  /** World-space deck centerline top position */
  p: V3;
  /** Horizontal unit tangent (pointing forward along the walk) */
  t: [number, number];
  /** Horizontal unit right normal (-tz, tx) */
  n: [number, number];
  /** Half-width of the walkable deck (m) */
  halfW: number;
  /** Cumulative distance along the whole path (m) */
  s: number;
  /** 0 = earthly garden/lagoon boardwalk, 0..1 = transition into Alhambra wood-and-azulejo ascent */
  celestial: number;
  /** Section tag */
  section: 'colonnade' | 'boardwalk' | 'arch' | 'spiral';
}

export interface RoundDeck {
  x: number;
  y: number;
  z: number;
  r: number;
  celestial: number;
}

const [CX, CZ] = PALACE.at;

export const BOARDWALK_HALF_W = 1.48;
export const PORTICO_HALF_W = 1.18;
export const SPIRAL_HALF_W = 1.62;

/** Where the dome-roof portal crossing threshold sits (just above the dome's cornice foot at 25.4 m). */
export const DOME_PORTAL_Y = 26.2;
export const DOME_PORTAL_CENTER: V3 = [CX, DOME_PORTAL_Y, CZ];

/** The inlaid Spanish-cedar & Alhambra 8-point star compass plaza just inside the rotunda's north arch. */
export const ENTRY_PLAZA: RoundDeck = { x: CX, y: 0.06, z: CZ + 15.5, r: 3.1, celestial: 0.25 };

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const smoothstep = (a: number, b: number, x: number): number => smooth01((x - a) / (b - a));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

function catmullRom3(pts: readonly V3[], t: number): V3 {
  const n = pts.length - 1;
  const s = Math.max(0, Math.min(n - 1e-6, t * n));
  const i = Math.floor(s);
  const u = s - i;
  const p0 = pts[Math.max(0, i - 1)];
  const p1 = pts[i];
  const p2 = pts[Math.min(n, i + 1)];
  const p3 = pts[Math.min(n, i + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  const evalK = (k: 0 | 1 | 2) =>
    0.5 * (
      2 * p1[k] +
      (-p0[k] + p2[k]) * u +
      (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u2 +
      (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u3
    );
  return [evalK(0), evalK(1), evalK(2)];
}

/**
 * Ground boardwalk control points (~63 m):
 * Launches just in front of the north colonnade courtyard entrance portal (-13.05, 0, 61.05),
 * glides dead-center through the monumental 4-column garlanded portico (-6.27, 53.30),
 * sweeps across the golden meadow, bridges the reflecting cove, and passes straight through the north arch.
 */
const GROUND_CTRL: readonly V3[] = [
  [-12.20,  0.02, 60.08], // Courtyard launch right in front of the entrance portal
  [ -9.40, -0.06, 56.88], // Approaching north colonnade portico
  [ -6.27, -0.14, 53.30], // Dead-center through the 4-column garlanded portico (above -0.38 stylobate)
  [ -3.10, -0.02, 49.68], // Emerging from the colonnade arches into the wildflower meadow
  [  0.20,  0.06, 44.00], // Sweeping gently across the sunlit lawn
  [  0.65,  0.06, 37.00], // Approaching the reflecting cove north bank
  [  1.45,  0.22, 30.20], // Gentle S-arch out over the reflecting lagoon cove
  [  1.25,  0.34, 24.80], // Crest of the lagoon cove bridge
  [  0.15,  0.18, 19.60], // Landing on the rotunda podium edge
  [  0.00,  0.08, 13.00], // Entering the tall rotunda north arch
  [  0.00,  0.06,  6.50], // Inside the rotunda north arch
  [  0.00,  0.06,  1.50], // ENTRY_PLAZA center
];

/** Evaluate the extended colonnade + meadow + lagoon cove + north-arch boardwalk for t in [0, 1]. */
export function boardwalkPos(t: number): V3 {
  return catmullRom3(GROUND_CTRL, t);
}

/**
 * Exact C1-continuous, wide-radius (minTurnR = 7.0 m) fluid ascending spiral inside the rotunda:
 *   - Segment 1 (outer 270° clockwise around rotunda center): from ENTRY_PLAZA (0, +15.5) east -> south -> west (-14.0, 0),
 *     radius easing smoothly from 15.5 m down to 14.0 m (always >= 3 m clear of the 18.5 m piers).
 *   - Segment 2 (inner 180° clockwise arc, exact constant R = 7.0 m centered at (-7.0, 0)): C1-tangent join at (-14.0, 0)
 *     sweeping smoothly around (-7.0, +7.0) directly into dead-center (0, 0) heading straight south (0, -1)!
 *   - Segment 3 (straight walk-through tail): 5.2 m straight south (0, 0) -> (0, -5.2) carrying walkers cleanly
 *     across the DOME_PORTAL_Y = 26.2 m crossing plane up to y = 27.7 m.
 *
 * Parameterized by horizontal arc-length fraction v in [0, 1] for a rock-steady ~17° grade with zero dips or sharp turns.
 */
const OUTER_ARC_LEN = 70.1;  // ~270° clockwise from r=15.5 to r=14.0
const INNER_ARC_R = 7.0;
const INNER_ARC_LEN = Math.PI * INNER_ARC_R; // 21.991 m
const TAIL_LEN = 5.2;
const SPIRAL_TOTAL_XZ_LEN = OUTER_ARC_LEN + INNER_ARC_LEN + TAIL_LEN; // ~97.29 m
const SPIRAL_CROSS_LEN = OUTER_ARC_LEN + INNER_ARC_LEN; // ~92.09 m (exact point where curve reaches (CX, CZ))
const PLAZA_FLAT_LEN = 3.2; // stay strictly flush with ENTRY_PLAZA across its r = 3.1 m footprint

/** Monotonic C1-smooth spiral elevation from ENTRY_PLAZA.y (0.06) to DOME_PORTAL_Y (26.2) at s = SPIRAL_CROSS_LEN, continuing into tail. */
function spiralHeightAtLen(s: number): number {
  const climbSpan = SPIRAL_CROSS_LEN - PLAZA_FLAT_LEN;
  const targetSlope = (DOME_PORTAL_Y - ENTRY_PLAZA.y) / (climbSpan - 3.0);
  if (s <= PLAZA_FLAT_LEN) return ENTRY_PLAZA.y;
  const ds = s - PLAZA_FLAT_LEN;
  // Gentle 6 m quadratic ease-in from 0 slope to constant `targetSlope` (exact C1 continuity at rim & steady climb after!)
  const easeLen = 6.0;
  if (ds < easeLen) {
    return ENTRY_PLAZA.y + (0.5 * targetSlope * ds * ds) / easeLen;
  }
  return ENTRY_PLAZA.y + 0.5 * targetSlope * easeLen + targetSlope * (ds - easeLen);
}

/** Evaluate the fluid ascending wooden spiral inside the rotunda for v in [0, 1]. */
export function spiralPos(v: number): V3 {
  const s = Math.min(1, Math.max(0, v)) * SPIRAL_TOTAL_XZ_LEN;
  const y = spiralHeightAtLen(s);
  if (s <= OUTER_ARC_LEN) {
    const u = s / OUTER_ARC_LEN;
    const angle = Math.PI / 2 - 1.5 * Math.PI * u;
    // Ease radius from 15.5 to 14.0 with zero radial derivative at u = 1 so tangent at west (-14, 0) is strictly (0, +1)!
    const r = mix(15.5, INNER_ARC_R * 2, smooth01(u));
    return [CX + r * Math.cos(angle), y, CZ + r * Math.sin(angle)];
  }
  if (s <= SPIRAL_CROSS_LEN) {
    const u = (s - OUTER_ARC_LEN) / INNER_ARC_LEN;
    const beta = Math.PI * (1 - u); // PI -> 0 clockwise around (-INNER_ARC_R, 0)
    const lx = -INNER_ARC_R + INNER_ARC_R * Math.cos(beta);
    const lz = INNER_ARC_R * Math.sin(beta);
    return [CX + lx, y, CZ + lz];
  }
  const tail = s - SPIRAL_CROSS_LEN;
  return [CX, y, CZ - tail];
}

function buildSamples(): PathFrame[] {
  const raw: Array<{ p: V3; halfW: number; celestial: number; section: PathFrame['section'] }> = [];

  // 1. Extended colonnade + meadow + lagoon cove + north-arch boardwalk (120 segments)
  const nBoard = 120;
  for (let i = 0; i <= nBoard; i++) {
    const t = i / nBoard;
    const p = boardwalkPos(t);
    // Taper gently through the monumental 4-column portico (-6.27, 53.30) so edges stay ~0.25 m clear of column pedestals
    const porticoDist = Math.hypot(p[0] + 6.27, p[2] - 53.30);
    const porticoPinch = 1 - smoothstep(2.4, 5.2, porticoDist);
    const halfW = mix(BOARDWALK_HALF_W, PORTICO_HALF_W, porticoPinch);
    const section: PathFrame['section'] =
      p[2] > 42.0 ? 'colonnade' : p[2] > 18.8 ? 'boardwalk' : 'arch';
    raw.push({
      p,
      halfW,
      celestial: smoothstep(12.0, 1.5, p[2]) * 0.25,
      section,
    });
  }

  // 2. Single fluid ascending wooden Alhambra spiral straight into the dome portal (192 segments)
  const nSpiral = 192;
  for (let i = 1; i <= nSpiral; i++) {
    const v = i / nSpiral;
    raw.push({
      p: spiralPos(v),
      halfW: SPIRAL_HALF_W,
      celestial: 0.25 + 0.75 * smoothstep(0.0, 0.28, v),
      section: 'spiral',
    });
  }

  const frames: PathFrame[] = [];
  let s = 0;
  for (let i = 0; i < raw.length; i++) {
    const cur = raw[i];
    if (i > 0) {
      const prev = raw[i - 1].p;
      s += Math.hypot(cur.p[0] - prev[0], cur.p[1] - prev[1], cur.p[2] - prev[2]);
    }
    const isGround = (sec: PathFrame['section']) => sec !== 'spiral';
    const samePrev = i > 0 && isGround(raw[i - 1].section) === isGround(cur.section);
    const sameNext = i + 1 < raw.length && isGround(raw[i + 1].section) === isGround(cur.section);
    const a = samePrev ? raw[i - 1].p : cur.p;
    const b = sameNext ? raw[i + 1].p : cur.p;
    let tx = b[0] - a[0];
    let tz = b[2] - a[2];
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    frames.push({
      p: cur.p,
      t: [tx, tz],
      n: [-tz, tx],
      halfW: cur.halfW,
      s,
      celestial: cur.celestial,
      section: cur.section,
    });
  }
  return frames;
}

export const PATH_FRAMES: readonly PathFrame[] = buildSamples();

/** Index ranges for each contiguous strip in PATH_FRAMES. */
export const BOARDWALK_RANGE: readonly [number, number] = [0, 120];
export const SPIRAL_RANGE: readonly [number, number] = [120, 312];

/** Exact frame where the fluid ascending spiral crosses DOME_PORTAL_Y (26.2 m) right at the dome center. */
export const PORTAL_THRESHOLD_FRAME: PathFrame = (() => {
  const crossV = SPIRAL_CROSS_LEN / SPIRAL_TOTAL_XZ_LEN;
  const p = spiralPos(crossV);
  const pPrev = spiralPos(crossV - 0.003);
  const tx = p[0] - pPrev[0];
  const tz = p[2] - pPrev[2];
  const len = Math.hypot(tx, tz) || 1;
  return {
    p,
    t: [tx / len, tz / len],
    n: [-tz / len, tx / len],
    halfW: SPIRAL_HALF_W,
    s: PATH_FRAMES[SPIRAL_RANGE[0]].s + SPIRAL_CROSS_LEN,
    celestial: 1,
    section: 'spiral',
  };
})();

/** Arrival spawn when entering Palace Lagoon backwards from the next room's entrance portal (~7 m down-spiral). */
export const DOME_ARRIVAL_SPAWN = (() => {
  const arrV = (SPIRAL_CROSS_LEN - 7.0) / SPIRAL_TOTAL_XZ_LEN;
  const pos = spiralPos(arrV);
  const back = spiralPos(arrV - 0.01);
  const dx = back[0] - pos[0];
  const dz = back[2] - pos[2];
  return {
    position: pos,
    yaw: Math.atan2(-dx, -dz),
    pitch: -0.1,
  };
})();

/** Precomputed XZ bounding box of the entire path for O(1) early-out in terrainHeight. */
const PATH_BOX = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const f of PATH_FRAMES) {
    minX = Math.min(minX, f.p[0] - f.halfW - 1);
    maxX = Math.max(maxX, f.p[0] + f.halfW + 1);
    minZ = Math.min(minZ, f.p[2] - f.halfW - 1);
    maxZ = Math.max(maxZ, f.p[2] + f.halfW + 1);
  }
  return [minX, maxX, minZ, maxZ] as const;
})();

/** Closest reachable deck point on a single contiguous strip (`start..end`), or null if off-strip. */
function closestOnStrip(
  start: number,
  end: number,
  x: number,
  z: number,
  fromY: number,
  stepTolerance: number,
  extraHalfW = 0.12,
  endMargin = 0.15,
): { y: number; d2: number; px: number; pz: number; nx: number; nz: number; halfW: number; lat: number } | null {
  let bestD2 = Infinity;
  let best: { y: number; d2: number; px: number; pz: number; nx: number; nz: number; halfW: number; lat: number } | null = null;
  for (let i = start; i < end; i++) {
    const a = PATH_FRAMES[i];
    const b = PATH_FRAMES[i + 1];
    const abx = b.p[0] - a.p[0];
    const abz = b.p[2] - a.p[2];
    const l2 = abx * abx + abz * abz;
    if (l2 < 1e-8) continue;
    const rawU = ((x - a.p[0]) * abx + (z - a.p[2]) * abz) / l2;
    const segLen = Math.sqrt(l2);
    if (i === start && rawU * segLen < -endMargin) continue;
    if (i === end - 1 && (rawU - 1) * segLen > endMargin) continue;
    const u = Math.min(1, Math.max(0, rawU));
    const px = a.p[0] + abx * u;
    const pz = a.p[2] + abz * u;
    const baseHw = a.halfW + (b.halfW - a.halfW) * u;
    const hw = baseHw + extraHalfW;
    const dx = x - px;
    const dz = z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 <= hw * hw && d2 < bestD2) {
      const py = a.p[1] + (b.p[1] - a.p[1]) * u;
      if (fromY >= py - stepTolerance) {
        const tx = abx / segLen;
        const tz = abz / segLen;
        const nx = -tz;
        const nz = tx;
        bestD2 = d2;
        best = { y: py, d2, px, pz, nx, nz, halfW: baseHw, lat: dx * nx + dz * nz };
      }
    }
  }
  return best;
}

/**
 * Highest walkable surface on the colonnade boardwalk, star plaza, or fluid ascending spiral at (x, z)
 * reachable from feet height `fromY`. Returns -Infinity when off the path.
 */
export function pathSurface(x: number, z: number, fromY = Infinity): number {
  if (x < PATH_BOX[0] || x > PATH_BOX[1] || z < PATH_BOX[2] || z > PATH_BOX[3]) return -Infinity;
  const stepTolerance = 0.85;
  let best = -Infinity;

  const consider = (y: number) => {
    if (y > best && fromY >= y - stepTolerance) best = y;
  };

  if (Math.hypot(x - ENTRY_PLAZA.x, z - ENTRY_PLAZA.z) <= ENTRY_PLAZA.r + 0.12) {
    consider(ENTRY_PLAZA.y);
  }

  for (const [start, end] of [BOARDWALK_RANGE, SPIRAL_RANGE] as const) {
    const hit = closestOnStrip(start, end, x, z, fromY, stepTolerance);
    if (hit) consider(hit.y);
  }
  return best;
}

/**
 * Gentle guardrail collider matching the visible wood-and-brass handrails along the ascending spiral
 * and over-water lagoon boardwalk. Keeps walkers sliding smoothly around the curve instead of clipping
 * off the edge, while still letting players jump over the 0.92 m rail or fly freely.
 */
export const pathCollider: RoomCollider = {
  move(from: Readonly<Vec3Tuple>, to: Readonly<Vec3Tuple>, radius: number, _height: number): [number, number] {
    let x = to[0];
    let z = to[2];
    if (x < PATH_BOX[0] - 2 || x > PATH_BOX[1] + 2 || z < PATH_BOX[2] - 2 || z > PATH_BOX[3] + 2) {
      return [x, z];
    }
    const fromY = from[1];
    // Open seamlessly onto the circular entry star plaza.
    if (Math.hypot(x - ENTRY_PLAZA.x, z - ENTRY_PLAZA.z) < ENTRY_PLAZA.r - 0.1) {
      return [x, z];
    }
    const guardedStrips: readonly (readonly [number, number, boolean])[] = [
      [SPIRAL_RANGE[0], SPIRAL_RANGE[1], false],
      [BOARDWALK_RANGE[0], BOARDWALK_RANGE[1], true],
    ];
    for (const [start, end, waterOnly] of guardedStrips) {
      if (waterOnly && (from[2] < 19.3 || from[2] > 32.7 || z < 19.3 || z > 32.7)) continue;
      const fromHit = closestOnStrip(start, end, from[0], from[2], fromY + 0.5, 0.85, 0.1, 0.05);
      if (!fromHit) continue;
      if (fromY < fromHit.y - 0.55 || fromY > fromHit.y + 0.78) continue;
      const toHit = closestOnStrip(start, end, x, z, fromY + 0.8, 0.95, 1.4, 0.05);
      if (!toHit) continue;
      const maxLat = Math.max(0.25, toHit.halfW - radius - 0.06);
      if (Math.abs(toHit.lat) > maxLat) {
        const clamped = Math.sign(toHit.lat) * maxLat;
        x = toHit.px + toHit.nx * clamped;
        z = toHit.pz + toHit.nz * clamped;
      }
      break;
    }
    return [x, z];
  },
};

/** True if (x, z) is on or immediately beside the boardwalk over the water (for pile/lantern placement & tests). */
export function isOverWater(x: number, z: number, waterAt: (x: number, z: number) => number): boolean {
  return waterAt(x, z) < WATER_Y;
}
