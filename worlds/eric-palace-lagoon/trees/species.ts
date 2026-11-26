/**
 * The grove's kinds of tree: how each is grown (grow.ts, in metres) and how it's lit (trees.wgsl's Species uniform).
 * After Earth's (github.com/ericrius1/world: web/src/trees/species.ts), made for this room: a few monumental kinds
 * hand-placed round the Palace rather than a city's census.
 *
 * Colours are linear albedo (the room's grass is 0.03..0.11), the glows linear HDR light (the moon is ~0.2).
 */
export type V3 = [number, number, number];

/** the leaf atlas's layers (leaves.wgsl) */
export const LAYER = {
  /** broad lobed leaves (the cherry's, the magnolia's) */
  broad: 0,
  /** small dense leaves (the live oak's) */
  small: 1,
  /** glossy ovals (the shrubs') */
  glossy: 2,
  /** narrow grey-green blades (the willow's crown) */
  narrow: 3,
  /** sprays of scale leaves (the cypresses') */
  sprays: 4,
  /** a willow's hanging strand: a whip of narrow leaves down v */
  strand: 5,
  /** a cluster of small open flowers (the jacaranda's, the cherry's) */
  blossom: 6,
  /** needles in tufts (the hills' pines) */
  needles: 7,
  /** a fern's frond (along v) */
  fern: 8,
} as const;
export const LAYERS = 9;

export type Shape = 'oak' | 'column' | 'tiers' | 'weeping' | 'vase' | 'round' | 'shrub' | 'cone' | 'fern';

export interface Species {
  name: string;
  shape: Shape;
  /** its height and crown radius as grown (m): each tree is this, scaled a little its own way (placement.ts) */
  h: number;
  r: number;
  /** where its crown starts, of its height */
  base: number;
  /** the trunk's radius at its foot (m) */
  trunk: number;
  /** leaf cards: how many, their half size (m), their layer */
  cards: number;
  card: number;
  leaf: number;
  /** cards tipped toward the sky (0 hanging/out .. 1 flat to the sky) */
  toSky: number;
  flowers?: { n: number; size: number; layer: number };
  /** a weeping tree's hanging strands: how many, their segments, their half width (m) */
  strands?: { n: number; segs: number; width: number };
  /** lantern-fruit hanging under the crown (glow.wgsl), how many a tree */
  lanterns?: number;
  /** glow-seeds rising from the crown at night (glow.wgsl): this tree is an emitter */
  seeds?: boolean;

  // ---- the light (trees.wgsl Species)
  /** the leaves' albedo, and the tint of their lit side (warmer, yellower) */
  leafCol: V3;
  leafLit: V3;
  /** the light through the leaves toward the key light: its colour (times the key light) */
  through: V3;
  bark: V3;
  /** moss on the bark's tops (0..1) */
  moss: number;
  /** the flowers' albedo */
  bloom: V3;
  /** the flowers' glow at night (HDR), and how much the crown's leaves take of it */
  glow: V3;
  glowLeaves: number;
  /** the strands' tips at night (a willow's: bioluminescent) */
  tipGlow: V3;
  /** the leaves' sheen (0 matte .. 1 glossy) */
  gloss: number;
}

const SP: Species[] = [
  {
    // a monumental live oak: a short massive trunk splitting low into sinuous limbs, a sculpted crown of cumulus
    // clumps wider than it is tall; amber lantern-fruit hang under it at night
    name: 'oak', shape: 'oak', h: 17, r: 13.5, base: 0.27, trunk: 1.05,
    cards: 2600, card: 1.25, leaf: LAYER.small, toSky: 0.45,
    lanterns: 14,
    leafCol: [0.026, 0.058, 0.014], leafLit: [1.1, 1.05, 0.72], through: [0.34, 0.4, 0.06],
    bark: [0.1, 0.085, 0.07], moss: 0.55, bloom: [0, 0, 0], glow: [1.5, 0.82, 0.34], glowLeaves: 0.05,
    tipGlow: [0, 0, 0], gloss: 0.35,
  },
  {
    // an Italian cypress: a dark flame of a column, classical beside the Palace
    name: 'cypress', shape: 'column', h: 16.5, r: 2.0, base: 0.06, trunk: 0.32,
    cards: 1500, card: 0.55, leaf: LAYER.sprays, toSky: 0.2,
    leafCol: [0.012, 0.036, 0.02], leafLit: [1.0, 1.05, 0.85], through: [0.16, 0.24, 0.05],
    bark: [0.12, 0.08, 0.06], moss: 0.1, bloom: [0, 0, 0], glow: [0, 0, 0], glowLeaves: 0,
    tipGlow: [0, 0, 0], gloss: 0.15,
  },
  {
    // a Monterey cypress: wind-sculpted flat tiers on a few leaning leaders, a silhouette against the sunset
    name: 'monterey', shape: 'tiers', h: 16, r: 11, base: 0.3, trunk: 0.85,
    cards: 1500, card: 1.3, leaf: LAYER.sprays, toSky: 0.65,
    leafCol: [0.022, 0.042, 0.018], leafLit: [1.15, 1.05, 0.65], through: [0.22, 0.3, 0.05],
    bark: [0.1, 0.075, 0.06], moss: 0.2, bloom: [0, 0, 0], glow: [0, 0, 0], glowLeaves: 0,
    tipGlow: [0, 0, 0], gloss: 0.15,
  },
  {
    // a weeping willow on the bank: its curtain of strands trailing toward the water, their tips glowing faint teal
    // at night like something from the deep
    name: 'willow', shape: 'weeping', h: 13.5, r: 9, base: 0.35, trunk: 0.7,
    cards: 650, card: 1.0, leaf: LAYER.narrow, toSky: 0.1,
    strands: { n: 420, segs: 5, width: 0.32 },
    seeds: true,
    leafCol: [0.066, 0.115, 0.018], leafLit: [1.12, 1.08, 0.7], through: [0.55, 0.62, 0.1],
    bark: [0.11, 0.1, 0.085], moss: 0.3, bloom: [0, 0, 0], glow: [0.15, 0.9, 0.75], glowLeaves: 0.02,
    tipGlow: [0.06, 0.5, 0.42], gloss: 0.25,
  },
  {
    // a jacaranda: a vase of limbs under an umbrella of violet bloom, its petals glowing violet-blue at night and
    // shedding glow-seeds
    name: 'jacaranda', shape: 'vase', h: 11, r: 7.5, base: 0.45, trunk: 0.4,
    cards: 900, card: 0.95, leaf: LAYER.small, toSky: 0.55,
    flowers: { n: 1300, size: 0.8, layer: LAYER.blossom },
    lanterns: 6, seeds: true,
    leafCol: [0.032, 0.07, 0.018], leafLit: [1.1, 1.05, 0.75], through: [0.4, 0.45, 0.1],
    bark: [0.13, 0.11, 0.095], moss: 0.05, bloom: [0.3, 0.22, 0.5], glow: [0.3, 0.2, 1.0], glowLeaves: 0.06,
    tipGlow: [0, 0, 0], gloss: 0.2,
  },
  {
    // a flowering cherry: a round spreading crown all rose blossom, glowing rose at night
    name: 'cherry', shape: 'round', h: 8.5, r: 6.5, base: 0.32, trunk: 0.36,
    cards: 700, card: 0.85, leaf: LAYER.broad, toSky: 0.5,
    flowers: { n: 1500, size: 0.75, layer: LAYER.blossom },
    lanterns: 5, seeds: true,
    leafCol: [0.036, 0.072, 0.02], leafLit: [1.1, 1.05, 0.78], through: [0.45, 0.45, 0.12],
    bark: [0.1, 0.065, 0.06], moss: 0.05, bloom: [0.6, 0.34, 0.42], glow: [0.9, 0.28, 0.5], glowLeaves: 0.06,
    tipGlow: [0, 0, 0], gloss: 0.3,
  },
  {
    // a rounded flowering shrub (camellia-like): glossy leaves, pale flowers glowing faint aqua at night
    name: 'shrub', shape: 'shrub', h: 2.4, r: 2.1, base: 0.0, trunk: 0.06,
    cards: 320, card: 0.5, leaf: LAYER.glossy, toSky: 0.45,
    flowers: { n: 40, size: 0.22, layer: LAYER.blossom },
    leafCol: [0.025, 0.05, 0.022], leafLit: [1.15, 1.1, 0.7], through: [0.2, 0.28, 0.06],
    bark: [0.08, 0.07, 0.05], moss: 0, bloom: [0.55, 0.42, 0.42], glow: [0.1, 0.32, 0.36], glowLeaves: 0.01,
    tipGlow: [0, 0, 0], gloss: 0.7,
  },
  {
    // the hills' conifers (the woods round the horizon): a dense cone
    name: 'pine', shape: 'cone', h: 19, r: 4.2, base: 0.15, trunk: 0.4,
    cards: 700, card: 1.3, leaf: LAYER.needles, toSky: 0.35,
    leafCol: [0.02, 0.04, 0.02], leafLit: [1.1, 1.05, 0.7], through: [0.15, 0.22, 0.05],
    bark: [0.1, 0.07, 0.05], moss: 0.1, bloom: [0, 0, 0], glow: [0, 0, 0], glowLeaves: 0,
    tipGlow: [0, 0, 0], gloss: 0.1,
  },
  {
    // ground ferns under the oaks
    name: 'fern', shape: 'fern', h: 1.1, r: 1.3, base: 0, trunk: 0,
    cards: 16, card: 1, leaf: LAYER.fern, toSky: 0.6,
    leafCol: [0.035, 0.07, 0.02], leafLit: [1.2, 1.15, 0.6], through: [0.4, 0.5, 0.08],
    bark: [0.05, 0.05, 0.03], moss: 0, bloom: [0, 0, 0], glow: [0.2, 0.8, 0.5], glowLeaves: 0.0,
    tipGlow: [0.25, 0.85, 0.55], gloss: 0.2,
  },
];

export const SPECIES: readonly Species[] = SP;
export const speciesIndex = (name: string): number => {
  const i = SP.findIndex(s => s.name === name);
  if (i < 0) throw new Error(`no species ${name}`);
  return i;
};
