/**
 * The Palace Lagoon's continuous walkable pathway:
 *   1. An Earth-style teak boardwalk (inspired by Earth's `robolab/jamwalk.ts`) launching from the entrance bank
 *      (z = +34.4), curving in a gentle S over the north reflecting lagoon cove, landing on the rotunda podium,
 *      and gliding straight through the tall north arch (x = 0, z = +18.6 -> +4.2).
 *   2. An inlaid Arabic 8-point star compass plaza just inside the north arch at (0, 0.05, +1.5).
 *   3. A trippy ascending celestial sky-path spiraling 360° inside the rotunda nave (clear of all 8 piers)
 *      from y = 0.05 up to an octagonal sky balcony at (0, 24.8, -6.5), then arching straight into the
 *      center of the dome-roof portal at (0, 27.4, -14).
 *
 * Pure math shared by the procedural mesh builder (`mesh.ts`), room terrain/collision (`index.ts`), and tests.
 */
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
  /** 0 = earthly teak boardwalk, 0..1 = transition, 1 = celestial sky-path */
  celestial: number;
  /** Section tag */
  section: 'boardwalk' | 'arch' | 'spiral' | 'summit';
}

export interface RoundDeck {
  x: number;
  y: number;
  z: number;
  r: number;
  /** 0 = entry star plaza, 1 = celestial summit balcony */
  celestial: number;
}

const [CX, CZ] = PALACE.at;

export const BOARDWALK_HALF_W = 1.48;
export const SPIRAL_HALF_W = 1.62;
export const SUMMIT_ARCH_HALF_W = 1.55;

/** Where the dome-roof portal crossing threshold sits (just above the dome's cornice foot at 25.4 m). */
export const DOME_PORTAL_Y = 26.2;
export const DOME_PORTAL_CENTER: V3 = [CX, DOME_PORTAL_Y, CZ];

/** The two circular/octagonal inlaid decks along the journey. */
export const ENTRY_PLAZA: RoundDeck = { x: CX, y: 0.06, z: CZ + 15.5, r: 3.1, celestial: 0.25 };
export const SUMMIT_DECK: RoundDeck = { x: CX, y: 24.8, z: CZ + 7.5, r: 3.25, celestial: 1.0 };

/** Arrival spawn when entering Palace Lagoon backwards from the next room's entrance portal. */
export const DOME_ARRIVAL_SPAWN = {
  position: [SUMMIT_DECK.x, SUMMIT_DECK.y, SUMMIT_DECK.z] as V3,
  yaw: Math.PI,
  pitch: -0.1,
};

const smooth01 = (x: number): number => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};
const smoothstep = (a: number, b: number, x: number): number => smooth01((x - a) / (b - a));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Evaluate the boardwalk & north-arch approach for t in [0, 1] (z from +34.4 down to ENTRY_PLAZA.z = +1.5). */
export function boardwalkPos(t: number): V3 {
  const z = mix(34.4, ENTRY_PLAZA.z, t);
  // Gentle S-curve over the water cove (z in [19.4, 33.4]), easing dead-center at x = 0 before the podium & arch.
  const waterPhase = smooth01((33.4 - z) / 14.0);
  const archEnv = Math.sin(Math.PI * waterPhase);
  const x = z > 19.4 && z < 33.4 ? 1.85 * archEnv * Math.sin(Math.PI * waterPhase * 0.95) : 0;
  // Arched gently above the lagoon surface (WATER_Y = -0.8), flush at bank (0.02) and podium (0.06).
  const waterLift = z > 18.8 && z < 34.0 ? 0.30 * Math.pow(Math.sin(Math.PI * smooth01((34.0 - z) / 15.2)), 1.2) : 0;
  const y = mix(0.02, ENTRY_PLAZA.y, smoothstep(34.4, 18.5, z)) + waterLift;
  return [x, y, z];
}

/**
 * Evaluate the trippy ascending spiral inside the rotunda for v in [0, 1]:
 * Starts level across ENTRY_PLAZA (0, 0.06, +1.5), lifts off smoothly at the plaza rim, and sweeps
 * a full 360° panoramic loop inside the 18.5 m nave (always >= 4 m clear of all 8 piers), landing
 * level onto SUMMIT_DECK (0, 24.8, -6.5).
 */
export function spiralPos(v: number): V3 {
  const angle = Math.PI / 2 - Math.PI * 2 * (0.9 * v + 0.1 * v * v);
  // Radius glides smoothly inward from 15.5 m at the entry plaza to 7.5 m at the summit balcony.
  const r = mix(15.5, 7.5, smoothstep(0.04, 0.95, v));
  // Stay flush across both circular plazas' footprints (v <= 0.045 and v >= 0.955) so neither ramp clips its star medallion.
  const u = Math.min(1, Math.max(0, (v - 0.045) / 0.91));
  const climb = mix(u, u * u * (3 - 2 * u), 0.35);
  const y = mix(ENTRY_PLAZA.y, SUMMIT_DECK.y, climb);
  return [CX + r * Math.cos(angle), y, CZ + r * Math.sin(angle)];
}

/**
 * Final sweeping crystal-gold arch from SUMMIT_DECK (0, 24.8, -6.5) straight into the center of the dome-roof
 * portal at (0, 27.4, -14.5), staying level across the summit medallion before arching up through DOME_PORTAL_Y (26.2 m).
 */
export function summitArchPos(w: number): V3 {
  const z = mix(SUMMIT_DECK.z - 2.2, CZ - 0.5, w);
  const u = Math.min(1, Math.max(0, (w - 0.08) / 0.92));
  const y = mix(SUMMIT_DECK.y, 27.4, smooth01(u * 0.85 + 0.15 * u * u));
  return [CX, y, z];
}

function buildSamples(): PathFrame[] {
  const raw: Array<{ p: V3; halfW: number; celestial: number; section: PathFrame['section'] }> = [];

  // 1. Boardwalk over water + through north arch (80 segments)
  const nBoard = 80;
  for (let i = 0; i <= nBoard; i++) {
    const t = i / nBoard;
    const p = boardwalkPos(t);
    const overWater = p[2] > 18.8;
    raw.push({
      p,
      halfW: BOARDWALK_HALF_W,
      celestial: smoothstep(12.0, 1.5, p[2]) * 0.25,
      section: overWater ? 'boardwalk' : 'arch',
    });
  }

  // 2. Ascending trippy spiral inside the rotunda (144 segments)
  const nSpiral = 144;
  for (let i = 1; i <= nSpiral; i++) {
    const v = i / nSpiral;
    raw.push({
      p: spiralPos(v),
      halfW: SPIRAL_HALF_W,
      celestial: 0.25 + 0.75 * smoothstep(0.0, 0.32, v),
      section: 'spiral',
    });
  }

  // 3. Final luminous arch from summit deck right through the dome portal (24 segments)
  const nSummit = 24;
  for (let i = 0; i <= nSummit; i++) {
    const w = i / nSummit;
    raw.push({
      p: summitArchPos(w),
      halfW: SUMMIT_ARCH_HALF_W,
      celestial: 1.0,
      section: 'summit',
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
    // Keep tangent continuous within each section so the summit deck's 90° turn stays crisp.
    const samePrev = i > 0 && (raw[i - 1].section === cur.section || (raw[i - 1].section === 'boardwalk' && cur.section === 'arch'));
    const sameNext = i + 1 < raw.length && (raw[i + 1].section === cur.section || (cur.section === 'boardwalk' && raw[i + 1].section === 'arch'));
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
export const BOARDWALK_RANGE: readonly [number, number] = [0, 80];
export const SPIRAL_RANGE: readonly [number, number] = [80, 224];
export const SUMMIT_RANGE: readonly [number, number] = [225, 249];

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

/**
 * Highest walkable surface on the boardwalk, star plaza, ascending spiral, or summit arch at (x, z)
 * reachable from feet height `fromY`. Returns -Infinity when off the path.
 */
export function pathSurface(x: number, z: number, fromY = Infinity): number {
  if (x < PATH_BOX[0] || x > PATH_BOX[1] || z < PATH_BOX[2] || z > PATH_BOX[3]) return -Infinity;
  const stepTolerance = 0.85;
  let best = -Infinity;

  const consider = (y: number) => {
    if (y > best && fromY >= y - stepTolerance) best = y;
  };

  // Round inlaid plazas (entry star compass & summit sky balcony)
  for (const d of [ENTRY_PLAZA, SUMMIT_DECK]) {
    if (Math.hypot(x - d.x, z - d.z) <= d.r + 0.12) consider(d.y);
  }

  // Walkable segments across all three strips (skipping the disconnect between spiral end and summit start)
  const ranges = [BOARDWALK_RANGE, SPIRAL_RANGE, SUMMIT_RANGE] as const;
  for (const [start, end] of ranges) {
    for (let i = start; i < end; i++) {
      const a = PATH_FRAMES[i];
      const b = PATH_FRAMES[i + 1];
      const abx = b.p[0] - a.p[0];
      const abz = b.p[2] - a.p[2];
      const l2 = abx * abx + abz * abz;
      if (l2 < 1e-8) continue;
      const u = Math.min(1, Math.max(0, ((x - a.p[0]) * abx + (z - a.p[2]) * abz) / l2));
      const px = a.p[0] + abx * u;
      const pz = a.p[2] + abz * u;
      const hw = a.halfW + (b.halfW - a.halfW) * u + 0.12;
      const dx = x - px;
      const dz = z - pz;
      if (dx * dx + dz * dz <= hw * hw) {
        const py = a.p[1] + (b.p[1] - a.p[1]) * u;
        consider(py);
      }
    }
  }
  return best;
}

/** True if (x, z) is on or immediately beside the boardwalk over the water (for pile/lantern placement & tests). */
export function isOverWater(x: number, z: number, waterAt: (x: number, z: number) => number): boolean {
  return waterAt(x, z) < WATER_Y;
}
