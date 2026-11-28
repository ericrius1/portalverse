import { GLYPH_PIXELS, RING_PIXELS, hash01, type PlatterFrame } from './cues';
import { GLYPH } from './glyphs';

/** Occasional solo effects, separate from the towers' continuously running cue lists. */
export const SPECIALS = {
  interval: 26,
  delay: 4,
  jitter: 4,
  sparkleSeconds: 6,
  lapSeconds: 0.8,
  sparkleStep: 0.14,
  sparkleDecay: 0.09,
} as const;

export interface SoloEvent {
  rack: number;
  kind: 'sparkle' | 'descent';
  time: number;
  seed: number;
}

/** One shared selection per frame, so two towers can never take the solo together. */
export function soloEvent(time: number, candidates: readonly number[], counts: readonly number[]): SoloEvent | null {
  if (time < 0 || !candidates.length) return null;
  const slot = Math.floor(time / SPECIALS.interval);
  const local = time - slot * SPECIALS.interval - SPECIALS.delay - hash01(slot, 81) * SPECIALS.jitter;
  const rack = candidates[Math.floor(hash01(slot, 82) * candidates.length)];
  const kind = slot % 2 === 0 ? 'sparkle' : 'descent';
  const duration = kind === 'sparkle' ? SPECIALS.sparkleSeconds : counts[rack] * SPECIALS.lapSeconds;
  if (local < 0 || local >= duration) return null;
  return { rack, kind, time: local, seed: slot };
}

/** Override only the solo tower; the normal orange programs keep their original clocks. */
export function sampleSolo(event: SoloEvent, platter: number, count: number, out: PlatterFrame): void {
  out.dir = 1;
  out.tail = 0;
  out.falloff = 0;
  out.heads = 1;
  out.glyph = GLYPH.slashedZero;
  out.spacing = GLYPH_PIXELS;
  const modules = RING_PIXELS / GLYPH_PIXELS;
  if (event.kind === 'descent') {
    const lap = Math.floor(event.time / SPECIALS.lapSeconds);
    const fraction = (event.time - lap * SPECIALS.lapSeconds) / SPECIALS.lapSeconds;
    out.head = Math.min(modules - 1, Math.floor(fraction * modules)) * GLYPH_PIXELS;
    out.intensity = platter === count - 1 - lap ? 1 : 0;
    return;
  }

  // Independently staggered flashes: a new random module, a sharp attack and
  // short decay, with occasional skipped flashes. No all-tower strobe or sine wave.
  const seed = event.seed * 31 + platter;
  const shifted = event.time + hash01(seed, 83) * SPECIALS.sparkleStep;
  const pulse = Math.floor(shifted / SPECIALS.sparkleStep);
  const age = shifted - pulse * SPECIALS.sparkleStep;
  out.head = Math.floor(hash01(seed, pulse * 2 + 84) * modules) * GLYPH_PIXELS;
  const decay = Math.max(0, 1 - age / SPECIALS.sparkleDecay);
  out.intensity = hash01(seed, pulse * 2 + 85) > 0.25 ? decay * decay : 0;
}
