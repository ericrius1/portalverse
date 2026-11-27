/**
 * The soundtrack's mixing decisions, kept free of Web Audio so they can be tested.
 *
 * Every stem is an 8-bar loop at 88 BPM in G-sharp minor / B major (Suno's takes were
 * retuned into one key and to concert pitch), so any stems play together in tune and on
 * the beat. Each room plays its own blend (its vibe) as one "song", and only that song:
 * crossing a portal sweeps the current song out and drops the next room's song in from
 * its top on the next beat, the way a DJ mixes between records in the same key.
 */

export const MUSIC_BPM = 88;
export const BEAT_SECONDS = 60 / MUSIC_BPM;
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
  'jp-reef': { 'lagoon-bed': 1, 'shimmer-bells': 0.45 },
  'jp-loft': { 'lofi-bed': 1, 'soft-beat': 0.6 },
  // The abyss stems lean on A and G naturals for their eerie colour: they only play alone.
  'jp-abyss': { 'abyss-bed': 1, 'abyss-motif': 0.8 },
  'jp-visages': { 'abyss-bed': 1, 'abyss-motif': 0.55 },
  'jp-visages-claude': { 'abyss-bed': 1, 'abyss-motif': 0.6 },
  'jp-visages-codex': { 'abyss-bed': 0.85, 'abyss-motif': 0.35 },
  'jp-visages-synthesis': { 'abyss-bed': 1, 'abyss-motif': 0.58 },
  'eric-palace-lagoon': { 'golden-bed': 1, 'lagoon-bed': 0.6, 'shimmer-bells': 0.5 },
  'laser-lab': { 'holo-bed': 0.9, 'soft-beat': 0.7 },
  'alpine-sled': { 'shimmer-bells': 0.9, 'golden-bed': 0.5 },
  'eric-biolum-grove': { 'shimmer-bells': 0.8, 'lagoon-bed': 0.5, 'holo-bed': 0.35 },
  'eric-sun-observatory': { 'golden-bed': 1, 'shimmer-bells': 0.5, 'holo-bed': 0.15 },
  'honey-hood': { 'lofi-bed': 0.9, 'soft-beat': 0.8, 'golden-bed': 0.3 },
  'doug-cassette-station': { 'lofi-bed': 0.95, 'shimmer-bells': 0.55, 'holo-bed': 0.3, 'soft-beat': 0.35 },
  'frostfire-hollow': { 'abyss-bed': 0.8, 'soft-beat': 0.5, 'shimmer-bells': 0.45 },
};
export const DEFAULT_VIBE: Vibe = { 'holo-bed': 0.6, 'shimmer-bells': 0.4, 'golden-bed': 0.3 };

export const vibeFor = (roomId: string | null | undefined): Vibe =>
  (roomId && ROOM_VIBES[roomId]) || DEFAULT_VIBE;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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

/**
 * The first beat on a song's grid at least `lead` seconds from now: where the next song
 * drops in, so the change lands on the beat.
 */
export function nextBeat(now: number, songStart: number, lead = 0.3, beat = BEAT_SECONDS): number {
  const n = Math.ceil((now + lead - songStart) / beat - 1e-9);
  return songStart + Math.max(0, n) * beat;
}

/** The start of the next phrase on a song's grid after `now`. */
export function nextPhraseStart(now: number, songStart: number, phraseSeconds = PHRASE_SECONDS): number {
  if (now < songStart) return songStart;
  return songStart + (Math.floor((now - songStart) / phraseSeconds + 1e-9) + 1) * phraseSeconds;
}

/** The stems a room's song uses, loudest first. */
export function stemsFor(vibe: Vibe): StemId[] {
  return STEM_IDS.filter(id => (vibe[id] ?? 0) > 0).sort((a, b) => (vibe[b] ?? 0) - (vibe[a] ?? 0));
}
