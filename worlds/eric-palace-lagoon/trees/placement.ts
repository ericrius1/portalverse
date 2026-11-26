/**
 * Where the grove stands. The hero trees are placed by hand round the Palace (each composition named below); the
 * understory (shrubs, ferns) is scattered round them by a seeded hand; the woods on the hills round the horizon are
 * scattered by noise, beyond where anyone walks. Everything is decided here once, at module load (a few hundred
 * checks: well under a millisecond), so TREE_TRUNKS is ready for the room's collider before anything draws.
 *
 * Kept clear: the walk (|x| < 4 from the approach lawn to beyond the exit), both portals and their previews (x within
 * 8 m of the path near z = ±36.25), the rotunda's podium, the colonnade and the hall (collide.ts nearPalace), the
 * lagoon (willows on its bank excepted), and the setting sun's corridor across the lagoon seen from the walk (only
 * low things there, so the sun goes down in a clear notch between the far shore's trees).
 */
import { LAGOON, lagoonSdf, terrainHeight, PALACE } from '../layout';
import { nearPalace } from '../collide';
import { SPECIES, speciesIndex } from './species';

export interface Placed {
  species: string;
  /** its foot (m, the room's) */
  x: number;
  y: number;
  z: number;
  /** its size against its kind's, its height's own stretch, its turn (radians), its seed (0..1) */
  s: number;
  sy: number;
  yaw: number;
  seed: number;
  /** a tree of the woods round the horizon (drawn at its far level only) */
  woods: boolean;
  /** its crown's radius here (m), for spacing and the map */
  r: number;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** the sun goes down this way (timeOfDay.ts SUN_AZ, 38° from -z toward +x) */
const SUN = [Math.sin((38 * Math.PI) / 180), -Math.cos((38 * Math.PI) / 180)] as const;
/** how far (degrees) (x, z) is off the setting sun's line as seen from the walk's sunset stretch (z 8..36 on x = 0) */
function offSunLine(x: number, z: number): number {
  let best = 180;
  for (const z0 of [36, 26, 16, 8]) {
    const dx = x, dz = z - z0, d = Math.hypot(dx, dz) || 1;
    const c = (dx * SUN[0] + dz * SUN[1]) / d;
    best = Math.min(best, (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI);
  }
  return best;
}

/** a point on the lagoon's bank: at `z`, on its west (palace) or east (far) side, `d` metres out from the water */
export function bank(z: number, side: 'west' | 'east', d: number): [number, number] {
  const dir = side === 'west' ? -1 : 1;
  let x = LAGOON.x;
  for (let k = 0; k < 400; k++) {
    if (lagoonSdf(x, z) >= d) break;
    x += dir * 0.5;
  }
  return [x, z];
}

/** why a tree can't stand here (null: it can) */
export function blocked(sp: string, x: number, z: number, r: number): string | null {
  const S = SPECIES[speciesIndex(sp)];
  const low = S.h < 3;
  // the walk, from the approach lawn through the rotunda and on (a low plant's leaves kept off it too)
  if (z > -90 && z < 62 && Math.abs(x) < 4 + (low ? r : S.trunk + 0.5)) return 'walk';
  // the portals and their previews
  if (Math.abs(x) < 8 + (low ? 0 : Math.min(r, 3)) && (Math.abs(z - 36.25) < 9 || Math.abs(z + 36.25) < 9)) return 'portal';
  // the podium
  if (Math.hypot(x - PALACE.at[0], z - PALACE.at[1]) < 37 + (low ? 0 : 1)) return 'podium';
  // the water (a willow on its very bank)
  const s = lagoonSdf(x, z);
  if (s < (sp === 'willow' ? 1.2 : low ? 1.5 : 3)) return 'lagoon';
  // the setting sun's notch over the far shore: nothing tall in it
  if (!low && x > 60 && offSunLine(x, z) < 5.5) return 'sun';
  // the Palace (a tree's crown kept off the colonnade and the hall; a shrub may stand closer)
  if (nearPalace(x, z, low ? 0.8 : Math.min(r + 0.5, 13))) return 'palace';
  return null;
}

// ------------------------------------------------------------------ the hero trees, by hand
/** species, x, z, size (1 its kind's), [yaw] */
type Hero = [string, number, number, number, number?];

const HEROES: Hero[] = [
  // the approach (sunset, where the walk starts): Italian cypresses framing the entrance bank & north reflecting lagoon cove;
  // a jacaranda on the lagoon bank; the grandmother oak behind; willows trailing in the sunset water
  ['cypress', -11.8, 36.5, 1.0],
  ['cypress', 12.5, 36.5, 1.04],
  ['cypress', 16.0, 41.5, 0.92],
  ['cypress', 12.5, 44.5, 0.95],
  ['jacaranda', 24, 40, 1.0],
  ['oak', 22, 47, 0.92],
  ['willow', ...bank(42, 'west', 1.8), 1.0],
  ['willow', ...bank(56, 'west', 1.6), 0.92],
  ['willow', ...bank(72, 'west', 1.8), 1.05],

  // the night garden, south of the rotunda (out past the exit's arch): flowering trees that glow, a lantern oak,
  // willows on the bank
  ['jacaranda', 10, -60, 0.95],
  ['cherry', -9, -60, 0.8],
  ['oak', 22, -76, 0.82],
  ['cherry', 34, -56, 0.75],
  ['willow', ...bank(-62, 'west', 1.7), 0.95],
  ['willow', ...bank(-82, 'west', 1.6), 1.0],
  ['willow', ...bank(-101, 'west', 1.8), 0.9],

  // the lagoon's north end and the meadow beyond the hall's tip
  ['willow', 66, 89, 1.0],
  ['willow', 92, 86, 0.95],
  ['oak', 48, 115, 1.1],
  ['cherry', 24, 104, 0.85],
  ['jacaranda', 78, 124, 0.95],
  ['monterey', 112, 132, 1.0],
  ['cherry', 8, 136, 0.9],
  ['oak', -28, 146, 1.0],
  ['jacaranda', -62, 138, 0.9],

  // the lagoon's south end and the meadow beyond the colonnade's south wing (the night's: glowing trees, oaks hung
  // with lanterns)
  ['willow', 62, -118, 1.0],
  ['jacaranda', 50, -134, 0.95],
  ['oak', 30, -150, 1.0],
  ['cherry', 10, -132, 0.85],
  ['cherry', 72, -150, 0.8],
  ['jacaranda', -12, -168, 0.9],
  ['oak', -48, -170, 1.05],

  // the far shore (east), against the sunset and in the water's mirror: willows on the bank, Monterey cypresses and
  // oaks behind; the setting sun's notch (blocked() 'sun') kept clear
  ['willow', ...bank(58, 'east', 1.6), 1.0],
  ['willow', ...bank(22, 'east', 1.7), 1.05],
  ['willow', ...bank(-18, 'east', 1.6), 0.95],
  ['willow', ...bank(-52, 'east', 1.8), 1.0],
  ['monterey', 134, 66, 1.1, 0.4],
  ['monterey', 141, 18, 1.15, 2.2],
  ['oak', 136, -12, 1.05],
  ['monterey', 130, -42, 1.0, 1.1],
  ['cypress', 124, 38, 1.1], ['cypress', 128, 44, 1.0], ['cypress', 121, 46, 0.95],
  ['monterey', 146, -72, 1.1, 3.0],
  ['jacaranda', 125, 2, 0.9],
  ['cherry', 132, 92, 0.85],

  // behind the hall to the west, on the rise toward the hills
  ['oak', -122, -40, 1.1],
  ['oak', -118, 40, 1.0],
  ['monterey', -128, 90, 1.05, 4.0],
  ['monterey', -126, -100, 1.0, 5.0],
  ['jacaranda', -112, 4, 0.9],
];

// ------------------------------------------------------------------ placing
function makeHeroes(): Placed[] {
  const r = rng(424242);
  const out: Placed[] = [];
  for (const [sp, x, z, s, yaw] of HEROES) {
    const S = SPECIES[speciesIndex(sp)];
    const rad = S.r * s;
    const why = blocked(sp, x, z, rad);
    if (why) {
      if ((import.meta as any).env?.DEV ?? true) console.warn(`[grove] ${sp} at (${x.toFixed(1)}, ${z.toFixed(1)}) left out: ${why}`);
      continue;
    }
    out.push({
      species: sp, x, z, y: terrainHeight(x, z) - 0.15, s, sy: 0.92 + 0.16 * r(), yaw: yaw ?? r() * Math.PI * 2, seed: r(), woods: false, r: rad,
    });
  }
  return out;
}

/** shrubs and ferns: round the hero trees' feet, along the podium's foot, by the colonnade */
async function makeUnderstory(heroes: Placed[]): Promise<Placed[]> {
  const r = rng(9001);
  const r2 = rng(31337);
  const out: Placed[] = [];
  // (the candidates first, then each tested, a breath every few milliseconds: the Palace's columns make the test dear)
  const asks: [string, number, number, number][] = [];
  const free = (x: number, z: number, rad: number) => {
    for (const t of heroes) {
      if (t.species === 'cypress' && Math.hypot(x - t.x, z - t.z) < 2.6 + rad) return false;
      if (Math.hypot(x - t.x, z - t.z) < Math.max(1.6, SPECIES[speciesIndex(t.species)].trunk * t.s * 2.2) + rad) return false;
    }
    for (const t of out) if (Math.hypot(x - t.x, z - t.z) < (t.r + rad) * 0.75) return false;
    return true;
  };
  const put = (sp: string, x: number, z: number, s: number) => { asks.push([sp, x, z, s]); };
  // ferns and shrubs in the shade round each oak and under the flowering trees
  for (const t of heroes) {
    if (t.species === 'oak') {
      for (let k = 0; k < 14; k++) {
        const a = r() * Math.PI * 2, d = 2.5 + r() * t.r * 0.75;
        put(r() < 0.7 ? 'fern' : 'shrub', t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.7 + 0.6 * r());
      }
    } else if (t.species === 'jacaranda' || t.species === 'cherry') {
      for (let k = 0; k < 5; k++) {
        const a = r() * Math.PI * 2, d = 2 + r() * t.r * 0.8;
        put(r() < 0.5 ? 'fern' : 'shrub', t.x + Math.cos(a) * d, t.z + Math.sin(a) * d, 0.7 + 0.5 * r());
      }
    } else if (t.species === 'cypress' && Math.abs(t.z) < 40) {
      // (a clipped shrub at each approach cypress's foot, toward the path)
      put('shrub', t.x + Math.sign(t.x) * -0.2 + Math.sign(t.x) * 2.8, t.z + 2.6, 0.6);
      put('shrub', t.x + Math.sign(t.x) * 2.8, t.z - 2.6, 0.55);
    }
  }
  // flowering shrubs along the podium's foot, a ring broken by the walk and the lagoon front
  for (let k = 0; k < 40; k++) {
    const a = (k / 40) * Math.PI * 2 + (r() - 0.5) * 0.08;
    const d = 38.5 + r() * 2.5;
    put('shrub', PALACE.at[0] + Math.cos(a) * d, PALACE.at[1] + Math.sin(a) * d, 0.55 + 0.35 * r());
  }
  let since = performance.now();
  for (const [sp, x, z, s] of asks) {
    if (performance.now() - since > 3) {
      await new Promise(resolve => setTimeout(resolve, 0));
      since = performance.now();
    }
    const rad = SPECIES[speciesIndex(sp)].r * s;
    if (!free(x, z, rad) || blocked(sp, x, z, rad)) continue;
    out.push({ species: sp, x, z, y: terrainHeight(x, z) - 0.05, s, sy: 0.85 + 0.3 * r2(), yaw: r2() * Math.PI * 2, seed: r2(), woods: false, r: rad });
  }
  return out;
}

/** the woods on the hills round the horizon, outside where anyone walks: clumps of pines, oaks and Monterey
 *  cypresses by noise, none in the sunset's notch */
function makeWoods(): Placed[] {
  const r = rng(7777);
  const out: Placed[] = [];
  const noise = (x: number, z: number) =>
    0.5 + 0.25 * Math.sin(x * 0.021 + 1.3) * Math.cos(z * 0.017 - 0.4) + 0.25 * Math.sin(x * 0.047 - z * 0.039 + 2.2);
  const step = 22;
  for (let gx = -460; gx <= 520; gx += step) {
    for (let gz = -520; gz <= 480; gz += step) {
      const x = gx + (r() - 0.5) * step * 0.9, z = gz + (r() - 0.5) * step * 0.9;
      // (beyond the walk bounds, inside the land the room draws)
      if (x > -165 && x < 175 && z > -185 && z < 160) continue;
      const far = Math.hypot(x + 50, z);
      if (far > 560) continue;
      const n = noise(x, z);
      const keep = smoothstep(0.5, 0.7, n) * (1 - smoothstep(420, 560, far));
      if (r() > keep) continue;
      if (offSunLine(x, z) < 6.5) continue;
      if (lagoonSdf(x, z) < 4) continue;
      const pick = r();
      const sp = pick < 0.5 ? 'pine' : pick < 0.78 ? 'oak' : 'monterey';
      const s = 0.75 + 0.5 * r();
      out.push({ species: sp, x, z, y: terrainHeight(x, z) - 0.3, s, sy: 0.85 + 0.3 * r(), yaw: r() * Math.PI * 2, seed: r(), woods: true, r: SPECIES[speciesIndex(sp)].r * s });
    }
  }
  return out;
}

const heroes = makeHeroes();
/** the grove's trees and woods (the understory comes after: understory()) */
export const PLACED: readonly Placed[] = [...heroes, ...makeWoods()];

/** a tree's trunk to walk round (a shrub's whole bush; a tree's trunk and its root flare) */
function trunkOf(t: Placed): readonly [number, number, number] {
  const S = SPECIES[speciesIndex(t.species)];
  const rad = t.species === 'shrub' ? S.r * t.s * 0.55 : S.trunk * t.s * 1.25 + 0.15;
  return [t.x, t.z, rad] as const;
}

/**
 * Trunks to walk round: (x, z, radius) in the room (the woods are beyond the walk bounds; ferns are walked through).
 * The trees' are here from the start; the shrubs' are added to this same array when the understory is placed.
 */
export const TREE_TRUNKS: Array<readonly [number, number, number]> = PLACED.filter(t => !t.woods).map(trunkOf);

let understoryOnce: Promise<Placed[]> | null = null;
/** the shrubs and ferns, placed once (a few milliseconds, in breaths), their bushes added to TREE_TRUNKS */
export function understory(): Promise<Placed[]> {
  return (understoryOnce ??= makeUnderstory(heroes).then(list => {
    for (const t of list) if (t.species === 'shrub') TREE_TRUNKS.push(trunkOf(t));
    return list;
  }));
}
