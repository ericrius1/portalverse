/**
 * Where everything stands, in metres, from the imperial sizes in the brief:
 * 4 ft square racks 10–20 ft tall, holding 4 in platters with 12 in between.
 * Pure data and maths (no three.js), so the tests can check it directly.
 */
import { hash01 } from './cues';

const FOOT = 0.3048;
const INCH = FOOT / 12;

/** The 4 ft grid everything snaps to: rack footprints and walkway plates. */
export const MODULE = 4 * FOOT;
export const RACK_HALF = MODULE / 2;
/** Square tube at the rack's corners. */
export const POST = 2 * INCH;
export const RAIL = 1.5 * INCH;
export const PLINTH = 4 * INCH;
export const LID = 2 * INCH;
export const PLATTER_HEIGHT = 4 * INCH;
export const PLATTER_GAP = 12 * INCH;
export const PLATTER_PITCH = PLATTER_HEIGHT + PLATTER_GAP;
/** One LED pitch: 8 down the 4 in rim of a platter. */
export const LED_PITCH = PLATTER_HEIGHT / 8;
/** 256 LEDs round the rim (32 modules of 8), so each module is exactly square. */
export const PLATTER_RADIUS = (256 * LED_PITCH) / (2 * Math.PI);
export const SPINDLE_RADIUS = 0.6 * INCH;

/** Racks hold this many platters: 7 make a rack about 10.8 ft tall, 13 about 18.8 ft. */
export const MIN_PLATTERS = 7;
export const MAX_PLATTERS = 13;

/** The matte walkway: four plates wide, running a few metres past both portals. */
export const WALKWAY_HALF_WIDTH = 2 * MODULE;
export const WALKWAY_HALF_LENGTH = 33 * MODULE;
/** The mirror floor's big plates, 32 ft square, with seams on the walkway's edges. */
export const FLOOR_PLATE = 8 * MODULE;

/** How far the rack field reaches along the room. */
const FIELD_HALF_LENGTH = 56;
/** Distance from the walkway's centre line to each rank of racks, in modules. */
const RANKS = [8, 13, 18, 24];
/** Racks in a rank sit this many modules apart, centre to centre. */
const SLOT = 3;

export interface Rack {
  readonly index: number;
  readonly x: number;
  readonly z: number;
  readonly platters: number;
  /** Top of the lid. */
  readonly height: number;
  readonly seed: number;
}

/** Plinth, then each platter on its gap, then a last gap under the lid. */
export function rackHeight(platters: number): number {
  return PLINTH + platters * PLATTER_PITCH + PLATTER_GAP + LID;
}

/** Height of the middle of platter `k` (0 at the bottom). */
export function platterCenterY(k: number): number {
  return PLINTH + PLATTER_GAP + k * PLATTER_PITCH + PLATTER_HEIGHT / 2;
}

/** Heights of the rail frames, in the middle of every third gap. */
export function railHeights(platters: number): number[] {
  const heights: number[] = [];
  for (let gap = 3; gap < platters; gap += 3) heights.push(PLINTH + gap * PLATTER_PITCH + PLATTER_GAP / 2);
  return heights;
}

let field: Rack[] | undefined;

/**
 * Ranks of racks either side of the walkway, in runs of three to six with
 * gaps between. Odd ranks are offset half a slot so the eye can see between
 * them, and the back ranks run taller. The same racks every time.
 */
export function rackField(): Rack[] {
  if (field) return field;
  const racks: Rack[] = [];
  RANKS.forEach((modules, rank) => {
    for (const side of [-1, 1]) {
      const x = side * modules * MODULE;
      const lane = rank * 2 + (side > 0 ? 1 : 0);
      const stagger = rank % 2 === 1 ? SLOT / 2 : 0;
      const first = Math.ceil((-FIELD_HALF_LENGTH / MODULE - stagger) / SLOT);
      const last = Math.floor((FIELD_HALF_LENGTH / MODULE - stagger) / SLOT);
      let slot = first + Math.floor(hash01(lane, 10) * 3);
      let run = 0;
      while (slot <= last) {
        if (run === 0) run = 3 + Math.floor(hash01(lane * 97 + slot, 11) * 4);
        const seed = (lane + 1) * 1000 + (slot - first);
        const z = (slot * SLOT + stagger) * MODULE;
        const tall = rank / (RANKS.length - 1);
        const span = MAX_PLATTERS - MIN_PLATTERS;
        const platters = MIN_PLATTERS + Math.min(span, Math.floor((hash01(seed, 12) * 0.75 + tall * 0.35) * (span + 1)));
        racks.push({ index: racks.length, x, z, platters, height: rackHeight(platters), seed });
        slot++;
        run--;
        if (run === 0) slot += 1 + Math.floor(hash01(seed, 13) * (rank < 2 ? 3 : 4));
      }
    }
  });
  field = racks;
  return racks;
}

/** Feet within this much of a rack's top step up onto it when they come down on it. */
const LANDING = 0.6;
/** Buckets for finding the racks near a point. */
const CELL = 4;

/**
 * Racks are solid up to their lids and flat on top: walk into one and you slide
 * along it; fly over one and you can land on it.
 */
export class RackCollision {
  private readonly cells = new Map<number, Rack[]>();

  constructor(readonly racks: readonly Rack[]) {
    for (const rack of racks) {
      const reach = RACK_HALF + 1;
      for (let cx = Math.floor((rack.x - reach) / CELL); cx <= Math.floor((rack.x + reach) / CELL); cx++) {
        for (let cz = Math.floor((rack.z - reach) / CELL); cz <= Math.floor((rack.z + reach) / CELL); cz++) {
          const key = this.key(cx, cz);
          const list = this.cells.get(key);
          if (list) list.push(rack);
          else this.cells.set(key, [rack]);
        }
      }
    }
  }

  private key(cx: number, cz: number): number {
    return (cx + 512) * 1024 + (cz + 512);
  }

  near(x: number, z: number): readonly Rack[] {
    return this.cells.get(this.key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? [];
  }

  /** The floor (0) or the lid of the rack underfoot, if the feet came down on top of it. */
  heightAt = (x: number, z: number, fromY?: number): number => {
    for (const rack of this.near(x, z)) {
      if (Math.abs(x - rack.x) <= RACK_HALF && Math.abs(z - rack.z) <= RACK_HALF && (fromY ?? 0) >= rack.height - LANDING) {
        return rack.height;
      }
    }
    return 0;
  };

  /** Push a step out of every rack whose sides are at the feet's height. */
  move = (from: Readonly<[number, number, number]>, to: Readonly<[number, number, number]>, radius: number): [number, number] => {
    let x = to[0];
    let z = to[2];
    const feet = Math.max(from[1], to[1]);
    for (let pass = 0; pass < 2; pass++) {
      for (const rack of this.near(x, z)) {
        if (feet >= rack.height - 0.05) continue;
        const dx = x - rack.x;
        const dz = z - rack.z;
        const cx = Math.min(RACK_HALF, Math.max(-RACK_HALF, dx));
        const cz = Math.min(RACK_HALF, Math.max(-RACK_HALF, dz));
        const ox = dx - cx;
        const oz = dz - cz;
        const d = Math.hypot(ox, oz);
        if (d >= radius) continue;
        if (d > 1e-6) {
          x = rack.x + cx + (ox / d) * radius;
          z = rack.z + cz + (oz / d) * radius;
        } else if (RACK_HALF - Math.abs(dx) < RACK_HALF - Math.abs(dz)) {
          // Inside the footprint: leave by the nearest side.
          x = rack.x + Math.sign(dx || 1) * (RACK_HALF + radius);
        } else {
          z = rack.z + Math.sign(dz || 1) * (RACK_HALF + radius);
        }
      }
    }
    return [x, z];
  };
}
