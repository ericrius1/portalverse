/**
 * Cue lists for the platter displays, after a lighting console.
 *
 * A tower is a fixture group and each platter is a fixture in it, counted from
 * the bottom. A program is a looping cue list. Each cue fades some attributes
 * (dimmer, tail, phase...) to new values, with a fan of per-platter delays so the
 * change runs up or down the tower. The rotation rate belongs to the program, so
 * a glyph's position is speed × time and never jumps when a cue fires or the
 * loop wraps.
 *
 * Everything here is a pure function of time. The room samples it once a frame
 * with the engine's shared clock, so the active view, every portal preview and
 * every snapshot show the same frame. There's no timer, no Math.random and no
 * Date.now. This file doesn't import three.js, so the tests run it directly.
 */

/** LED columns around one platter: 32 modules of 8 × 8. */
export const RING_PIXELS = 256;
/** Pixels across one glyph (and down the whole display). */
export const GLYPH_PIXELS = 8;

/** Fade curves. `ignite` is a deterministic power-on flicker; `snap` changes at once. */
export type Easing = 'linear' | 'smooth' | 'in' | 'out' | 'snap' | 'ignite';

/** Everything a cue can change on a platter. */
export interface ChaseLook {
  /** Dimmer, 0..1. */
  intensity: number;
  /** Echoes trailing each head. A fractional value fades the last echo in. */
  tail: number;
  /** Brightness of each echo relative to the one ahead of it, 0..1. */
  falloff: number;
  /** How far each platter's glyph trails the one below it, in glyph widths. */
  phase: number;
  /** Heads spaced evenly round the ring: 1, 2, 4 or 8. Changes at once. */
  heads: number;
  /** Index into the glyph atlas (`GLYPHS` in glyphs.ts). Changes at once. */
  glyph: number;
  /** Pixels from one echo to the next; 8 puts them in neighbouring modules. Changes at once. */
  spacing: number;
}

export interface Cue {
  /** For people reading the program. */
  label: string;
  /** Seconds from this cue's GO to the next cue's GO. */
  hold: number;
  /** Seconds each platter takes to fade to this cue's look. */
  fade: number;
  /** Seconds added per platter, counted from `from`. 0 fades the whole tower at once. */
  delay?: number;
  /** The end of the tower the delay fan starts from. Default `'bottom'`. */
  from?: 'bottom' | 'top';
  /** Default `'smooth'`. */
  easing?: Easing;
  /** Only the attributes listed here change. The rest carry over from earlier cues. */
  look: Partial<ChaseLook>;
}

export interface ChaseProgram {
  name: string;
  /** Laps per second for every head. Negative runs the other way. */
  speed: number;
  /** `'alternate'` reverses every other platter, so neighbouring rings counter-rotate. */
  direction?: 'same' | 'alternate';
  /** Starting values for anything the cues never set. */
  base: ChaseLook;
  cues: readonly Cue[];
  /** Seconds the tower waits after the last cue before the loop starts again. */
  rest: number;
  /** Each tower adds up to this many seconds of rest, picked from its seed, so towers drift apart. */
  restJitter?: number;
}

/** Attribute slots in a compiled look. */
export const LOOK_KEYS = ['intensity', 'tail', 'falloff', 'phase', 'heads', 'glyph', 'spacing'] as const;
type LookKey = (typeof LOOK_KEYS)[number];
const SLOT: Record<LookKey, number> = { intensity: 0, tail: 1, falloff: 2, phase: 3, heads: 4, glyph: 5, spacing: 6 };
/** Attributes that crossfade. The rest change the moment a platter's fade starts. */
const CONTINUOUS = 4;
const LOOK_SIZE = LOOK_KEYS.length;

interface CompiledCue {
  readonly label: string;
  readonly start: number;
  readonly fade: number;
  readonly delay: number;
  readonly fromTop: boolean;
  readonly ease: (p: number) => number;
  /** Slots this cue sets, and their values. */
  readonly slots: readonly number[];
  readonly values: readonly number[];
}

export interface CompiledProgram {
  readonly name: string;
  readonly speed: number;
  readonly alternate: boolean;
  /** Where every platter is once all the cues have run, which is also where each loop starts. */
  readonly settled: Float64Array;
  readonly cues: readonly CompiledCue[];
  /** Seconds from the first cue's GO to the end of the last cue's hold. */
  readonly length: number;
  readonly rest: number;
  readonly restJitter: number;
}

const EASINGS: Record<Easing, (p: number) => number> = {
  linear: p => p,
  smooth: p => p * p * (3 - 2 * p),
  in: p => p * p,
  out: p => 1 - (1 - p) * (1 - p),
  snap: p => (p > 0 ? 1 : 0),
  // A quick flash, a stutter, then a ramp up to full.
  ignite: p => (p >= 1 ? 1 : p < 0.08 ? 1 : p < 0.18 ? 0.05 : p < 0.27 ? 0.8 : p < 0.42 ? 0.12 : 0.55 + 0.45 * EASINGS.smooth((p - 0.42) / 0.58)),
};

export function ease(easing: Easing, p: number): number {
  return EASINGS[easing](Math.min(1, Math.max(0, p)));
}

/** Heads must divide the ring evenly so every one has the same run of pixels. */
const HEAD_COUNTS = new Set([1, 2, 4, 8]);

function checkLook(look: Partial<ChaseLook>, where: string): void {
  for (const [key, value] of Object.entries(look) as Array<[LookKey, number]>) {
    if (!(key in SLOT)) throw new Error(`${where}: unknown attribute "${key}"`);
    if (!Number.isFinite(value)) throw new Error(`${where}: ${key} must be a finite number`);
  }
  if (look.heads !== undefined && !HEAD_COUNTS.has(look.heads)) throw new Error(`${where}: heads must be 1, 2, 4 or 8`);
  if (look.spacing !== undefined && (!Number.isInteger(look.spacing) || look.spacing < GLYPH_PIXELS)) {
    throw new Error(`${where}: spacing must be a whole number of pixels, at least ${GLYPH_PIXELS}`);
  }
  if (look.glyph !== undefined && (!Number.isInteger(look.glyph) || look.glyph < 0)) throw new Error(`${where}: glyph must be an atlas index`);
  if (look.tail !== undefined && look.tail < 0) throw new Error(`${where}: tail can't be negative`);
}

/**
 * Check a program and precompute its cue start times. Every platter's last fade
 * has to finish before the loop wraps, so the start of a loop always matches the
 * end of the one before; `maxPlatters` is the tallest tower it will run on.
 */
export function compileProgram(program: ChaseProgram, maxPlatters: number): CompiledProgram {
  if (!(program.speed !== 0 && Number.isFinite(program.speed))) throw new Error(`${program.name}: speed must be non-zero`);
  if (!Number.isInteger(maxPlatters) || maxPlatters < 1) throw new Error(`${program.name}: maxPlatters must be a positive integer`);
  if (!Number.isFinite(program.rest) || program.rest < 0) throw new Error(`${program.name}: rest must be finite and non-negative`);
  const restJitter = program.restJitter ?? 0;
  if (!Number.isFinite(restJitter) || restJitter < 0) throw new Error(`${program.name}: restJitter must be finite and non-negative`);
  checkLook(program.base, `${program.name} base`);
  const settled = new Float64Array(LOOK_SIZE);
  for (const key of LOOK_KEYS) settled[SLOT[key]] = program.base[key];

  let start = 0;
  const cues: CompiledCue[] = [];
  for (const cue of program.cues) {
    const where = `${program.name} cue "${cue.label}"`;
    checkLook(cue.look, where);
    const delay = cue.delay ?? 0;
    if (![cue.hold, cue.fade, delay].every(value => Number.isFinite(value) && value >= 0)) {
      throw new Error(`${where}: hold, fade and delay must be finite and non-negative`);
    }
    const slots: number[] = [];
    const values: number[] = [];
    for (const key of LOOK_KEYS) {
      const value = cue.look[key];
      if (value === undefined) continue;
      slots.push(SLOT[key]);
      values.push(value);
      settled[SLOT[key]] = value;
    }
    cues.push({ label: cue.label, start, fade: cue.fade, delay, fromTop: cue.from === 'top', ease: EASINGS[cue.easing ?? 'smooth'], slots, values });
    start += cue.hold;
  }

  const length = start;
  if (!Number.isFinite(length + program.rest + restJitter) || length + program.rest <= 0) {
    throw new Error(`${program.name}: loop duration must be finite and positive`);
  }
  for (const cue of cues) {
    const finish = cue.start + cue.delay * (maxPlatters - 1) + cue.fade;
    if (finish > length + program.rest + 1e-9) {
      throw new Error(`${program.name} cue "${cue.label}" is still fading at ${finish.toFixed(2)} s, after the loop ends at ${(length + program.rest).toFixed(2)} s`);
    }
  }
  return {
    name: program.name,
    speed: program.speed,
    alternate: program.direction === 'alternate',
    settled,
    cues,
    length,
    rest: program.rest,
    restJitter,
  };
}

/** A tiny integer hash (one round of mulberry32), so a seed always gives the same numbers. */
export function hash01(seed: number, salt: number): number {
  let t = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x85ebca6b)) + 0x6d2b79f5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** When one tower runs its program: its own loop length, where it starts in it, and how its glyphs are turned. */
export interface TowerTiming {
  /** Seconds per loop for this tower. */
  readonly period: number;
  /** Seconds this tower runs ahead of the shared clock. */
  readonly offset: number;
  /** Laps the heads are turned at time zero, so towers don't line up. */
  readonly angle: number;
}

export function towerTiming(program: CompiledProgram, seed: number): TowerTiming {
  const period = program.length + program.rest + program.restJitter * hash01(seed, 1);
  return { period, offset: hash01(seed, 2) * period, angle: hash01(seed, 3) };
}

/** Seconds into the tower's current loop, in [0, period). */
export function loopTime(timing: TowerTiming, time: number): number {
  const local = (time + timing.offset) % timing.period;
  return local < 0 ? local + timing.period : local;
}

/**
 * The look of one platter at a point in its tower's loop. Cues are layered in
 * order: each starts from whatever the cues before it produce and blends toward
 * its own values as its fade runs, so overlapping fades stay continuous.
 */
export function sampleLook(program: CompiledProgram, local: number, platter: number, platters: number, out: Float64Array): Float64Array {
  out.set(program.settled);
  for (const cue of program.cues) {
    const order = cue.fromTop ? platters - 1 - platter : platter;
    const start = cue.start + cue.delay * order;
    // At the GO itself the old look still holds, so a loop's first cue can't fire at the wrap.
    if (local <= start) continue;
    const w = cue.fade > 0 ? cue.ease(Math.min(1, (local - start) / cue.fade)) : 1;
    for (let i = 0; i < cue.slots.length; i++) {
      const slot = cue.slots[i];
      out[slot] = slot < CONTINUOUS ? out[slot] + (cue.values[i] - out[slot]) * w : cue.values[i];
    }
  }
  return out;
}

/** +1 or -1: which way this platter's glyphs run round the ring. */
export function platterDirection(program: CompiledProgram, platter: number): number {
  const sign = program.speed < 0 ? -1 : 1;
  return program.alternate && platter % 2 === 1 ? -sign : sign;
}

/**
 * Where the lead glyph's first column is, in pixels round the ring [0, 256).
 * Every platter turns at the program's speed; `phase` sets each one that many
 * glyph widths behind the platter below, in its own direction of travel.
 */
export function headPixel(program: CompiledProgram, timing: TowerTiming, time: number, platter: number, phase: number): number {
  const dir = platterDirection(program, platter);
  const laps = Math.abs(program.speed) * time + timing.angle;
  const px = dir * (laps * RING_PIXELS - phase * GLYPH_PIXELS * platter);
  const wrapped = px % RING_PIXELS;
  return wrapped < 0 ? wrapped + RING_PIXELS : wrapped;
}

/** One platter's display on one frame: what the shader needs. */
export interface PlatterFrame {
  head: number;
  dir: number;
  intensity: number;
  tail: number;
  falloff: number;
  heads: number;
  glyph: number;
  spacing: number;
}

export function createPlatterFrame(): PlatterFrame {
  return { head: 0, dir: 1, intensity: 0, tail: 0, falloff: 0, heads: 1, glyph: 0, spacing: GLYPH_PIXELS };
}

/** Sample one platter into `out`, reusing `scratch` (length 7), so nothing is allocated per frame. */
export function samplePlatter(
  program: CompiledProgram,
  timing: TowerTiming,
  time: number,
  platter: number,
  platters: number,
  out: PlatterFrame,
  scratch: Float64Array = new Float64Array(LOOK_SIZE),
): PlatterFrame {
  const look = sampleLook(program, loopTime(timing, time), platter, platters, scratch);
  out.intensity = Math.min(1, Math.max(0, look[0]));
  out.tail = Math.max(0, look[1]);
  out.falloff = Math.min(1, Math.max(0, look[2]));
  out.heads = look[4];
  out.glyph = look[5];
  out.spacing = look[6];
  out.dir = platterDirection(program, platter);
  out.head = headPixel(program, timing, time, platter, look[3]);
  return out;
}

/** Make a scratch buffer for `samplePlatter`. */
export function createLookScratch(): Float64Array {
  return new Float64Array(LOOK_SIZE);
}
