/**
 * The room's named chase programs (see README.md for how cues work). Timings
 * use the shared soundtrack's nominal 88 BPM. Tower offsets are independent;
 * this sets their pace, not sample-accurate synchronization with audio playback.
 */
import { compileProgram, hash01, type ChaseProgram, type CompiledProgram } from './cues';
import { GLYPH } from './glyphs';
import { MAX_PLATTERS } from './layout';

export const BPM = 88;
export const BEAT = 60 / BPM;

/**
 * The relay, run by most towers. A glyph circles the bottom platter; one beat
 * later the next platter lights a glyph width behind it, and so on up until
 * the whole tower spins in a staircase. Then the bottom glyph grows a tail of
 * fading echoes and each platter above follows a beat later. The tails draw
 * back from the top, the tower goes dark from the top, and it rests.
 */
export const RELAY: ChaseProgram = {
  name: 'relay',
  speed: 1 / (8 * BEAT), // a lap every two bars
  base: { intensity: 0, tail: 0, falloff: 0.72, phase: 1, heads: 1, glyph: GLYPH.slashedZero, spacing: 8 },
  cues: [
    { label: 'rise', hold: 16 * BEAT, fade: 0.55, delay: BEAT, from: 'bottom', easing: 'ignite', look: { intensity: 1 } },
    { label: 'trail', hold: 24 * BEAT, fade: 4 * BEAT, delay: BEAT, from: 'bottom', easing: 'smooth', look: { tail: 9 } },
    { label: 'retract', hold: 12 * BEAT, fade: 4 * BEAT, delay: BEAT / 2, from: 'top', easing: 'smooth', look: { tail: 0 } },
    { label: 'release', hold: 8 * BEAT, fade: BEAT, delay: BEAT / 2, from: 'top', easing: 'out', look: { intensity: 0 } },
  ],
  rest: 20 * BEAT,
  restJitter: 32 * BEAT,
};

/**
 * The tower lights from the top down as one straight column of glyphs, then
 * twists into a helix as the phase crossfades from 0 to 2 glyphs a platter,
 * grows short tails, untwists and goes out.
 */
export const TWIST: ChaseProgram = {
  name: 'twist',
  speed: -1 / (12 * BEAT),
  base: { intensity: 0, tail: 0, falloff: 0.68, phase: 0, heads: 1, glyph: GLYPH.slashedZero, spacing: 8 },
  cues: [
    { label: 'column', hold: 8 * BEAT, fade: 0.45, delay: BEAT / 4, from: 'top', easing: 'ignite', look: { intensity: 1 } },
    { label: 'twist', hold: 14 * BEAT, fade: 12 * BEAT, easing: 'smooth', look: { phase: 2 } },
    { label: 'trail', hold: 12 * BEAT, fade: 4 * BEAT, delay: BEAT / 2, from: 'bottom', easing: 'smooth', look: { tail: 5 } },
    { label: 'untwist', hold: 10 * BEAT, fade: 8 * BEAT, easing: 'smooth', look: { phase: 0, tail: 0 } },
    { label: 'release', hold: 6 * BEAT, fade: 2 * BEAT, delay: BEAT / 4, from: 'bottom', easing: 'out', look: { intensity: 0 } },
  ],
  rest: 20 * BEAT,
  restJitter: 32 * BEAT,
};

/** Two heads a ring, neighbouring rings turning opposite ways, like the dials of a combination lock. */
export const WEAVE: ChaseProgram = {
  name: 'weave',
  speed: 1 / (10 * BEAT),
  direction: 'alternate',
  base: { intensity: 0, tail: 0, falloff: 0.6, phase: 0.5, heads: 2, glyph: GLYPH.slashedZero, spacing: 8 },
  cues: [
    { label: 'rise', hold: 12 * BEAT, fade: 0.45, delay: BEAT / 2, from: 'bottom', easing: 'ignite', look: { intensity: 0.85 } },
    { label: 'trail', hold: 20 * BEAT, fade: 6 * BEAT, delay: BEAT / 2, from: 'bottom', easing: 'smooth', look: { tail: 3 } },
    { label: 'release', hold: 10 * BEAT, fade: 3 * BEAT, delay: BEAT / 2, from: 'top', easing: 'out', look: { intensity: 0, tail: 0 } },
  ],
  rest: 20 * BEAT,
  restJitter: 32 * BEAT,
};

/** How often each program is picked for a tower. The relay leads. */
export const PROGRAM_MIX: ReadonlyArray<{ program: ChaseProgram; weight: number }> = [
  { program: RELAY, weight: 0.7 },
  { program: TWIST, weight: 0.18 },
  { program: WEAVE, weight: 0.12 },
];

let compiled: CompiledProgram[] | undefined;

/** Every program in `PROGRAM_MIX`, compiled once and shared by all mounts. */
export function compiledPrograms(): CompiledProgram[] {
  compiled ??= PROGRAM_MIX.map(({ program }) => compileProgram(program, MAX_PLATTERS));
  return compiled;
}

/** The index (into `PROGRAM_MIX`) of the program a tower with this seed runs. */
export function programFor(seed: number): number {
  const total = PROGRAM_MIX.reduce((sum, entry) => sum + entry.weight, 0);
  let pick = hash01(seed, 4) * total;
  for (let i = 0; i < PROGRAM_MIX.length; i++) {
    pick -= PROGRAM_MIX[i].weight;
    if (pick < 0) return i;
  }
  return 0;
}
