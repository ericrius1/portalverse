/**
 * The soundtrack's mixing decisions, kept free of Web Audio so they can be tested.
 *
 * Every stem is an 8-bar loop at 88 BPM in D minor, so any of them can play against any
 * other, phase-locked to one shared bar grid. Each room asks for a blend of stems (its
 * vibe) and plays it on its own. Within a few metres of a gate you hear a faint, muffled
 * hint of the room beyond; the switch itself happens as you step through, with a quick
 * crossfade timed to the crossing.
 */

export const MUSIC_BPM = 88;
export const BEATS_PER_BAR = 4;
export const BAR_SECONDS = (60 / MUSIC_BPM) * BEATS_PER_BAR;
/** Every stem loops after this many bars. */
export const LOOP_BARS = 8;
export const LOOP_SECONDS = BAR_SECONDS * LOOP_BARS;
/** Layers change on these phrase boundaries. */
export const PHRASE_BARS = 4;
export const PHRASE_SECONDS = BAR_SECONDS * PHRASE_BARS;

export const STEM_IDS = [
  'abyss-bed',
  'abyss-motif',
  'holo-bed',
  'golden-bed',
  'lagoon-bed',
  'lofi-bed',
  'soft-beat',
  'shimmer-bells',
] as const;
export type StemId = (typeof STEM_IDS)[number];
export type Vibe = Partial<Record<StemId, number>>;

/** How a stem behaves from phrase to phrase. */
export type StemRole = 'bed' | 'motif' | 'beat';
export const STEM_ROLES: Record<StemId, StemRole> = {
  'abyss-bed': 'bed',
  'abyss-motif': 'motif',
  'holo-bed': 'bed',
  'golden-bed': 'bed',
  'lagoon-bed': 'bed',
  'lofi-bed': 'bed',
  'soft-beat': 'beat',
  'shimmer-bells': 'motif',
};

/**
 * Each room's blend of stems (0..1). Add your room here to pick its music; rooms not
 * listed get DEFAULT_VIBE.
 */
export const ROOM_VIBES: Record<string, Vibe> = {
  'eric-world': { 'holo-bed': 1, 'shimmer-bells': 0.45, 'soft-beat': 0.35 },
  'jp-world': { 'golden-bed': 1, 'shimmer-bells': 0.35, 'soft-beat': 0.45 },
  'jp-garden': { 'golden-bed': 0.8, 'shimmer-bells': 0.6, 'lagoon-bed': 0.3, 'soft-beat': 0.4 },
  fishpond: { 'lagoon-bed': 1, 'golden-bed': 0.35, 'soft-beat': 0.35 },
  'jp-reef': { 'lagoon-bed': 1, 'shimmer-bells': 0.45, 'abyss-bed': 0.25 },
  'jp-loft': { 'lofi-bed': 1, 'soft-beat': 0.6 },
  'jp-abyss': { 'abyss-bed': 1, 'abyss-motif': 0.8 },
  'laser-lab': { 'holo-bed': 0.9, 'soft-beat': 0.7, 'abyss-motif': 0.35 },
  'alpine-sled': { 'shimmer-bells': 0.9, 'golden-bed': 0.5, 'abyss-bed': 0.25 },
  'eric-biolum-grove': { 'abyss-bed': 0.55, 'shimmer-bells': 0.8, 'lagoon-bed': 0.35, 'holo-bed': 0.2 },
  'eric-sun-observatory': { 'golden-bed': 1, 'shimmer-bells': 0.5, 'holo-bed': 0.15 },
  'honey-hood': { 'lofi-bed': 0.9, 'soft-beat': 0.8, 'golden-bed': 0.3 },
};
export const DEFAULT_VIBE: Vibe = { 'holo-bed': 0.6, 'shimmer-bells': 0.4, 'golden-bed': 0.3 };

export const vibeFor = (roomId: string | null | undefined): Vibe =>
  (roomId && ROOM_VIBES[roomId]) || DEFAULT_VIBE;

/** How close to a gate (metres) before the room beyond it can be heard at all. */
export const PREVIEW_RADIUS = 10;
/** The loudest the room beyond a gate gets before you cross: a hint, never a second song. */
export const PREVIEW_MAX = 0.3;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

/**
 * How close the player is to a gate, 0 (PREVIEW_RADIUS or further) .. 1 (at the portal).
 */
export function gateCloseness(distanceToGate: number, radius = PREVIEW_RADIUS): number {
  return smoothstep(1 - Math.max(0, distanceToGate) / radius);
}

export interface StemMix {
  /** Loudness, 0..1, before phrase and motion variation. */
  level: number;
  /**
   * How muffled the stem should sound, 0 (open) .. 1 (heard through a wall). The room
   * beyond a gate is heard muffled, opening up only as the player reaches the portal.
   */
  muffle: number;
}

/**
 * The current room's mix, plus a faint, muffled hint of the room beyond the gate the
 * player is walking up to. `closeness` comes from gateCloseness. The real change happens
 * at the crossing: the room switches and the stems crossfade quickly to the new blend.
 * Stems both rooms share never double up, and they stay open.
 */
export function mixVibes(current: Vibe, neighbour: Vibe | null, closeness: number): Record<StemId, StemMix> {
  const c = neighbour ? clamp01(closeness) : 0;
  const preview = PREVIEW_MAX * c;
  const out = {} as Record<StemId, StemMix>;
  for (const id of STEM_IDS) {
    const own = current[id] ?? 0;
    const hint = (neighbour?.[id] ?? 0) * preview;
    const level = Math.max(own, hint);
    out[id] = { level, muffle: hint > own ? 1 - c * c : 0 };
  }
  return out;
}

/** Low-pass cutoff (Hz) for a muffle amount, on an exponential scale. */
export function muffleCutoff(muffle: number, open = 18000, closed = 650): number {
  return open * Math.pow(closed / open, clamp01(muffle));
}

/**
 * Per-phrase variation so the mix never settles into one fixed loop: beds stay up,
 * melodic layers and the beat sometimes thin out or drop for a phrase.
 */
const PHRASE_CHOICES: Record<StemRole, readonly number[]> = {
  bed: [1, 1, 1, 0.8],
  motif: [1, 1, 0.65, 0.35, 0],
  beat: [1, 1, 0.75, 0],
};

export function phraseMultipliers(random: () => number = Math.random): Record<StemId, number> {
  const out = {} as Record<StemId, number>;
  for (const id of STEM_IDS) {
    const choices = PHRASE_CHOICES[STEM_ROLES[id]];
    out[id] = choices[Math.floor(random() * choices.length) % choices.length];
  }
  return out;
}

/** The beat follows the player: quiet when standing still, full when running or flying. */
export function motionMultiplier(role: StemRole, moveNorm: number): number {
  return role === 'beat' ? 0.4 + 0.6 * clamp01(moveNorm) : 1;
}

/** Where in a loop to start a stem so it lands on the shared bar grid. */
export function loopOffset(when: number, transportStart: number, loopSeconds = LOOP_SECONDS): number {
  const t = (when - transportStart) % loopSeconds;
  return t < 0 ? t + loopSeconds : t;
}

/** Seconds until the next phrase boundary on the shared grid. */
export function untilNextPhrase(now: number, transportStart: number, phraseSeconds = PHRASE_SECONDS): number {
  const into = loopOffset(now, transportStart, phraseSeconds);
  return into < 1e-6 ? 0 : phraseSeconds - into;
}
