import type { Vec3Tuple, WorldManifest } from '../types';

export type ConstellationCategory = 'fauna' | 'aliens' | 'plants' | 'concepts';

export interface ConstellationStar {
  /** Normalized tangent-plane X coordinate in roughly [-1, 1]. */
  x: number;
  /** Normalized tangent-plane Y coordinate in roughly [-1, 1]. */
  y: number;
  /** Visual brightness/magnitude weight (0.45 = subtle, 1.0 = primary, 1.35 = hero beacon). */
  mag: number;
}

export interface ConstellationArtStroke {
  /** Ordered normalized [x, y] control points in the same [-1, 1] space as stars. */
  points: ReadonlyArray<readonly [number, number]>;
  closed?: boolean;
  /** Soft fill opacity for subtle Uranometria-style celestial wash (0 = stroke only). */
  fillOpacity?: number;
}

export interface ConstellationSpec {
  readonly id: string;
  readonly name: string;
  readonly latinName: string;
  readonly category: ConstellationCategory;
  readonly categoryLabel: string;
  readonly description: string;
  /** Primary starlight hex color. */
  readonly color: string;
  /** Secondary nebula/halo hex color. */
  readonly secondaryColor: string;
  /** Horizontal sky angle in degrees around the cosmic dome (0 = -Z, 90 = +X). */
  readonly azimuthDeg: number;
  /** Vertical sky elevation in degrees above horizon (-12 to +66). */
  readonly elevationDeg: number;
  /** Angular half-span of the constellation artwork on the sky dome in degrees. */
  readonly angularSpanDeg: number;
  /** Distance from cosmic origin in meters. */
  readonly distance: number;
  readonly stars: readonly ConstellationStar[];
  readonly edges: ReadonlyArray<readonly [number, number]>;
  readonly artStrokes: readonly ConstellationArtStroke[];
}

export const CONSTELLATION_CATEGORIES: ReadonlyArray<{
  id: 'all' | ConstellationCategory;
  label: string;
}> = [
  { id: 'all', label: 'All Skies' },
  { id: 'fauna', label: 'Creatures' },
  { id: 'aliens', label: 'Aliens' },
  { id: 'plants', label: 'Plants' },
  { id: 'concepts', label: 'Concepts' },
];

/**
 * Twelve hand-crafted celestial constellations spanning creatures (including the
 * Great Buffalo, Star Whale, and Lunar Moth), cosmic aliens & flying saucers,
 * botanical flora (Monstera, Lotus, World Tree), and timeless concepts
 * (Infinity Loop, Luminous Idea, Hourglass of Time, Golden Spiral).
 */
export const COSMIC_CONSTELLATIONS: readonly ConstellationSpec[] = [
  // 1. BUFFALO (Fauna) — prominent right in front of the initial overview gaze!
  {
    id: 'buffalo',
    name: 'The Great Buffalo',
    latinName: 'Bison Astralis',
    category: 'fauna',
    categoryLabel: 'Creatures',
    description:
      'A thunder-shouldered prairie spirit striding across the northern stardrift, its curved horns crowned with warm amber giants.',
    color: '#fbbf24',
    secondaryColor: '#f97316',
    azimuthDeg: -16,
    elevationDeg: 28,
    angularSpanDeg: 18,
    distance: 158,
    stars: [
      { x: -0.92, y: 0.24, mag: 1.1 }, // 0: nose / muzzle
      { x: -0.78, y: 0.42, mag: 1.0 }, // 1: brow
      { x: -0.84, y: 0.66, mag: 1.25 }, // 2: front horn tip
      { x: -0.6, y: 0.62, mag: 1.15 }, // 3: back horn tip
      { x: -0.58, y: 0.46, mag: 0.95 }, // 4: crown behind horn
      { x: -0.26, y: 0.62, mag: 1.35 }, // 5: massive shoulder hump apex
      { x: 0.12, y: 0.44, mag: 1.0 }, // 6: mid-back dip
      { x: 0.56, y: 0.36, mag: 1.05 }, // 7: hip crest
      { x: 0.82, y: 0.14, mag: 0.9 }, // 8: rump
      { x: 0.96, y: -0.08, mag: 0.8 }, // 9: tail tuft
      { x: -0.72, y: -0.02, mag: 0.95 }, // 10: shaggy beard tip
      { x: -0.46, y: -0.14, mag: 1.05 }, // 11: broad chest base
      { x: -0.08, y: -0.12, mag: 0.85 }, // 12: deep belly
      { x: 0.36, y: -0.06, mag: 0.9 }, // 13: flank tuck
      { x: -0.48, y: -0.62, mag: 1.0 }, // 14: front-left hoof
      { x: -0.22, y: -0.56, mag: 0.9 }, // 15: front-right hoof
      { x: 0.44, y: -0.6, mag: 0.95 }, // 16: hind-left hoof
      { x: 0.68, y: -0.54, mag: 0.9 }, // 17: hind-right hoof
      { x: -0.72, y: 0.28, mag: 1.15 }, // 18: bright eye star
      { x: -0.28, y: 0.2, mag: 1.2 }, // 19: heart of the buffalo
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 4],
      [4, 3],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [0, 10],
      [10, 11],
      [11, 12],
      [12, 13],
      [13, 8],
      [11, 14],
      [12, 15],
      [13, 16],
      [8, 17],
      [5, 19],
      [19, 11],
      [19, 6],
      [1, 18],
    ],
    artStrokes: [
      {
        points: [
          [-0.92, 0.24],
          [-0.78, 0.42],
          [-0.58, 0.46],
          [-0.26, 0.62],
          [0.12, 0.44],
          [0.56, 0.36],
          [0.82, 0.14],
          [0.68, -0.54],
          [0.56, -0.1],
          [0.44, -0.6],
          [0.36, -0.06],
          [-0.08, -0.12],
          [-0.22, -0.56],
          [-0.34, -0.14],
          [-0.48, -0.62],
          [-0.52, -0.12],
          [-0.72, -0.02],
        ],
        closed: true,
        fillOpacity: 0.16,
      },
      {
        points: [
          [-0.78, 0.42],
          [-0.9, 0.56],
          [-0.84, 0.66],
        ],
      },
      {
        points: [
          [-0.62, 0.46],
          [-0.64, 0.58],
          [-0.6, 0.62],
        ],
      },
      {
        points: [
          [0.82, 0.14],
          [0.92, 0.04],
          [0.96, -0.08],
        ],
      },
    ],
  },

  // 2. ALIENS — Star Visitor
  {
    id: 'star-visitor',
    name: 'The Star Visitor',
    latinName: 'Xenos Salutans',
    category: 'aliens',
    categoryLabel: 'Aliens',
    description:
      'A curious traveler from beyond the outer rim, lifting a slender three-fingered hand in peaceful greeting across the nebula.',
    color: '#34d399',
    secondaryColor: '#22d3ee',
    azimuthDeg: 28,
    elevationDeg: 32,
    angularSpanDeg: 16,
    distance: 154,
    stars: [
      { x: 0.0, y: 0.78, mag: 1.25 }, // 0: domed crown
      { x: -0.34, y: 0.62, mag: 1.0 }, // 1: left temple
      { x: 0.34, y: 0.62, mag: 1.0 }, // 2: right temple
      { x: -0.26, y: 0.24, mag: 0.9 }, // 3: left cheek
      { x: 0.26, y: 0.24, mag: 0.9 }, // 4: right cheek
      { x: 0.0, y: 0.06, mag: 1.05 }, // 5: pointed chin
      { x: -0.18, y: 0.42, mag: 1.35 }, // 6: left almond eye
      { x: 0.18, y: 0.42, mag: 1.35 }, // 7: right almond eye
      { x: -0.26, y: 0.94, mag: 1.1 }, // 8: left antenna orb
      { x: 0.26, y: 0.94, mag: 1.1 }, // 9: right antenna orb
      { x: 0.0, y: -0.14, mag: 0.85 }, // 10: collarbone
      { x: -0.3, y: -0.24, mag: 0.9 }, // 11: left shoulder
      { x: 0.3, y: -0.24, mag: 0.95 }, // 12: right shoulder
      { x: 0.0, y: -0.64, mag: 0.9 }, // 13: slender torso base
      { x: -0.44, y: -0.66, mag: 0.85 }, // 14: left hand resting
      { x: 0.56, y: 0.04, mag: 1.0 }, // 15: raised elbow
      { x: 0.72, y: 0.42, mag: 1.2 }, // 16: waving palm
      { x: 0.62, y: 0.64, mag: 0.9 }, // 17: finger 1
      { x: 0.78, y: 0.66, mag: 0.95 }, // 18: finger 2
      { x: 0.9, y: 0.54, mag: 0.85 }, // 19: finger 3
    ],
    edges: [
      [0, 1],
      [1, 3],
      [3, 5],
      [5, 4],
      [4, 2],
      [2, 0],
      [1, 8],
      [2, 9],
      [6, 7],
      [5, 10],
      [10, 11],
      [10, 12],
      [11, 13],
      [12, 13],
      [11, 14],
      [12, 15],
      [15, 16],
      [16, 17],
      [16, 18],
      [16, 19],
    ],
    artStrokes: [
      {
        points: [
          [0.0, 0.78],
          [-0.22, 0.74],
          [-0.36, 0.58],
          [-0.28, 0.24],
          [0.0, 0.06],
          [0.28, 0.24],
          [0.36, 0.58],
          [0.22, 0.74],
        ],
        closed: true,
        fillOpacity: 0.16,
      },
      {
        points: [
          [-0.28, 0.48],
          [-0.14, 0.46],
          [-0.08, 0.36],
          [-0.22, 0.36],
        ],
        closed: true,
        fillOpacity: 0.32,
      },
      {
        points: [
          [0.28, 0.48],
          [0.14, 0.46],
          [0.08, 0.36],
          [0.22, 0.36],
        ],
        closed: true,
        fillOpacity: 0.32,
      },
      {
        points: [
          [-0.3, -0.24],
          [0.3, -0.24],
          [0.16, -0.64],
          [-0.16, -0.64],
        ],
        closed: true,
        fillOpacity: 0.12,
      },
    ],
  },

  // 3. PLANTS — Cosmic Monstera
  {
    id: 'monstera',
    name: 'The Cosmic Monstera',
    latinName: 'Monstera Caelestis',
    category: 'plants',
    categoryLabel: 'Plants',
    description:
      'A lush split-leaf botanical frond unfurling in deep space, catching starlight along every emerald rib and curling tendril.',
    color: '#4ade80',
    secondaryColor: '#14b8a6',
    azimuthDeg: 64,
    elevationDeg: 22,
    angularSpanDeg: 16,
    distance: 152,
    stars: [
      { x: -0.06, y: -0.88, mag: 1.0 }, // 0: stem base
      { x: 0.0, y: -0.44, mag: 1.05 }, // 1: leaf heart notch
      { x: 0.02, y: -0.02, mag: 1.2 }, // 2: lower midrib
      { x: 0.04, y: 0.42, mag: 1.25 }, // 3: upper midrib
      { x: 0.04, y: 0.84, mag: 1.3 }, // 4: leaf apex tip
      { x: -0.58, y: -0.46, mag: 0.95 }, // 5: bottom-left lobe
      { x: -0.78, y: -0.08, mag: 1.1 }, // 6: mid-left lobe
      { x: -0.68, y: 0.34, mag: 1.05 }, // 7: upper-left lobe
      { x: -0.38, y: 0.66, mag: 0.95 }, // 8: top-left lobe
      { x: 0.6, y: -0.42, mag: 0.95 }, // 9: bottom-right lobe
      { x: 0.8, y: -0.04, mag: 1.1 }, // 10: mid-right lobe
      { x: 0.7, y: 0.38, mag: 1.05 }, // 11: upper-right lobe
      { x: 0.4, y: 0.68, mag: 0.95 }, // 12: top-right lobe
      { x: -0.42, y: -0.74, mag: 0.85 }, // 13: side vine sprout
      { x: -0.62, y: -0.66, mag: 0.9 }, // 14: sprout tendril curl
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [1, 5],
      [2, 6],
      [3, 7],
      [3, 8],
      [1, 9],
      [2, 10],
      [3, 11],
      [3, 12],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 4],
      [9, 10],
      [10, 11],
      [11, 12],
      [12, 4],
      [0, 13],
      [13, 14],
    ],
    artStrokes: [
      {
        points: [
          [0.0, -0.44],
          [-0.36, -0.58],
          [-0.64, -0.42],
          [-0.4, -0.22],
          [-0.8, -0.08],
          [-0.46, 0.14],
          [-0.7, 0.34],
          [-0.36, 0.48],
          [-0.4, 0.68],
          [0.04, 0.84],
          [0.42, 0.68],
          [0.36, 0.48],
          [0.72, 0.38],
          [0.46, 0.14],
          [0.82, -0.04],
          [0.42, -0.22],
          [0.64, -0.42],
          [0.36, -0.56],
        ],
        closed: true,
        fillOpacity: 0.17,
      },
    ],
  },

  // 4. CONCEPTS — The Seam Loop (Infinity / Möbius)
  {
    id: 'infinity',
    name: 'The Seam Loop',
    latinName: 'Infinitas',
    category: 'concepts',
    categoryLabel: 'Concepts',
    description:
      'An unbroken cosmic lemniscate mirroring Portalverse itself — walk far enough through any doorway and the loop gently returns you home.',
    color: '#38bdf8',
    secondaryColor: '#818cf8',
    azimuthDeg: 102,
    elevationDeg: 36,
    angularSpanDeg: 17,
    distance: 156,
    stars: [
      { x: 0.0, y: 0.0, mag: 1.4 }, // 0: nexus crossing
      { x: -0.34, y: 0.3, mag: 1.05 }, // 1: left-upper inner
      { x: -0.74, y: 0.36, mag: 1.15 }, // 2: left-upper outer
      { x: -0.94, y: 0.02, mag: 1.25 }, // 3: left apex
      { x: -0.74, y: -0.34, mag: 1.1 }, // 4: left-lower outer
      { x: -0.34, y: -0.28, mag: 1.0 }, // 5: left-lower inner
      { x: 0.34, y: 0.28, mag: 1.0 }, // 6: right-upper inner
      { x: 0.74, y: 0.34, mag: 1.15 }, // 7: right-upper outer
      { x: 0.94, y: -0.02, mag: 1.25 }, // 8: right apex
      { x: 0.74, y: -0.36, mag: 1.1 }, // 9: right-lower outer
      { x: 0.34, y: -0.3, mag: 1.05 }, // 10: right-lower inner
      { x: -0.58, y: 0.0, mag: 0.9 }, // 11: left focus jewel
      { x: 0.58, y: 0.0, mag: 0.9 }, // 12: right focus jewel
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 0],
      [0, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 10],
      [10, 0],
      [2, 11],
      [4, 11],
      [7, 12],
      [9, 12],
    ],
    artStrokes: [
      {
        points: [
          [0.0, 0.0],
          [-0.34, 0.3],
          [-0.74, 0.36],
          [-0.94, 0.02],
          [-0.74, -0.34],
          [-0.34, -0.28],
          [0.0, 0.0],
          [0.34, 0.28],
          [0.74, 0.34],
          [0.94, -0.02],
          [0.74, -0.36],
          [0.34, -0.3],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
    ],
  },

  // 5. ALIENS — The Star Saucer (UFO & Tractor Beam)
  {
    id: 'saucer',
    name: 'The Star Saucer',
    latinName: 'Discus Ignotus',
    category: 'aliens',
    categoryLabel: 'Aliens',
    description:
      'A tilted silver-lime craft skimming above the galactic plane, trailing a prism beam of drifting curiosity.',
    color: '#a3e635',
    secondaryColor: '#2dd4bf',
    azimuthDeg: 140,
    elevationDeg: 24,
    angularSpanDeg: 17,
    distance: 158,
    stars: [
      { x: -0.06, y: 0.64, mag: 1.2 }, // 0: dome peak
      { x: -0.42, y: 0.48, mag: 1.0 }, // 1: dome left
      { x: 0.36, y: 0.52, mag: 1.0 }, // 2: dome right
      { x: -0.88, y: 0.22, mag: 1.25 }, // 3: hull far-left
      { x: -0.44, y: 0.16, mag: 1.1 }, // 4: rim beacon 1
      { x: 0.02, y: 0.14, mag: 1.3 }, // 5: rim beacon center
      { x: 0.46, y: 0.18, mag: 1.1 }, // 6: rim beacon 3
      { x: 0.9, y: 0.28, mag: 1.25 }, // 7: hull far-right
      { x: -0.48, y: 0.02, mag: 0.9 }, // 8: lower keel left
      { x: 0.48, y: 0.04, mag: 0.9 }, // 9: lower keel right
      { x: -0.58, y: -0.82, mag: 1.05 }, // 10: tractor beam left base
      { x: 0.56, y: -0.78, mag: 1.05 }, // 11: tractor beam right base
      { x: -0.04, y: -0.34, mag: 1.15 }, // 12: ascending sparkle upper
      { x: 0.06, y: -0.62, mag: 0.95 }, // 13: ascending sparkle lower
    ],
    edges: [
      [1, 0],
      [0, 2],
      [3, 1],
      [2, 7],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [3, 8],
      [8, 9],
      [9, 7],
      [8, 10],
      [9, 11],
      [10, 11],
      [5, 12],
      [12, 13],
    ],
    artStrokes: [
      {
        points: [
          [-0.42, 0.48],
          [-0.24, 0.62],
          [-0.06, 0.64],
          [0.18, 0.62],
          [0.36, 0.52],
          [0.44, 0.3],
          [-0.46, 0.26],
        ],
        closed: true,
        fillOpacity: 0.2,
      },
      {
        points: [
          [-0.88, 0.22],
          [-0.44, 0.32],
          [0.44, 0.34],
          [0.9, 0.28],
          [0.48, 0.04],
          [-0.48, 0.02],
        ],
        closed: true,
        fillOpacity: 0.16,
      },
      {
        points: [
          [-0.34, 0.02],
          [0.34, 0.04],
          [0.56, -0.78],
          [-0.58, -0.82],
        ],
        closed: true,
        fillOpacity: 0.11,
      },
    ],
  },

  // 6. CONCEPTS — The Luminous Idea (Lightbulb / Spark of Invention)
  {
    id: 'idea',
    name: 'The Luminous Idea',
    latinName: 'Cogito',
    category: 'concepts',
    categoryLabel: 'Concepts',
    description:
      'A glowing filament of pure imagination suspended between worlds, pulsing with rays of sudden inspiration.',
    color: '#fde047',
    secondaryColor: '#fb923c',
    azimuthDeg: 176,
    elevationDeg: 34,
    angularSpanDeg: 16,
    distance: 155,
    stars: [
      { x: 0.0, y: 0.7, mag: 1.25 }, // 0: bulb top
      { x: -0.42, y: 0.52, mag: 1.05 }, // 1: upper-left glass
      { x: 0.42, y: 0.52, mag: 1.05 }, // 2: upper-right glass
      { x: -0.46, y: 0.12, mag: 1.0 }, // 3: mid-left glass
      { x: 0.46, y: 0.12, mag: 1.0 }, // 4: mid-right glass
      { x: -0.22, y: -0.26, mag: 0.95 }, // 5: neck left
      { x: 0.22, y: -0.26, mag: 0.95 }, // 6: neck right
      { x: -0.18, y: -0.54, mag: 0.9 }, // 7: screw base left
      { x: 0.18, y: -0.54, mag: 0.9 }, // 8: screw base right
      { x: 0.0, y: -0.68, mag: 1.0 }, // 9: base contact tip
      { x: 0.0, y: 0.24, mag: 1.4 }, // 10: blazing filament core
      { x: 0.0, y: 0.96, mag: 1.0 }, // 11: top ray
      { x: -0.76, y: 0.72, mag: 0.95 }, // 12: top-left ray
      { x: 0.76, y: 0.72, mag: 0.95 }, // 13: top-right ray
      { x: -0.84, y: 0.2, mag: 0.9 }, // 14: left ray
      { x: 0.84, y: 0.2, mag: 0.9 }, // 15: right ray
    ],
    edges: [
      [0, 1],
      [1, 3],
      [3, 5],
      [5, 7],
      [7, 9],
      [9, 8],
      [8, 6],
      [6, 4],
      [4, 2],
      [2, 0],
      [5, 6],
      [7, 8],
      [5, 10],
      [6, 10],
      [0, 11],
      [1, 12],
      [2, 13],
      [3, 14],
      [4, 15],
    ],
    artStrokes: [
      {
        points: [
          [0.0, 0.7],
          [-0.42, 0.52],
          [-0.46, 0.12],
          [-0.22, -0.26],
          [0.22, -0.26],
          [0.46, 0.12],
          [0.42, 0.52],
        ],
        closed: true,
        fillOpacity: 0.18,
      },
      {
        points: [
          [-0.2, -0.26],
          [0.2, -0.26],
          [0.16, -0.56],
          [0.0, -0.68],
          [-0.16, -0.56],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
    ],
  },

  // 7. PLANTS — The Lotus of Worlds
  {
    id: 'lotus',
    name: 'The Lotus of Worlds',
    latinName: 'Nelumbo Infinita',
    category: 'plants',
    categoryLabel: 'Plants',
    description:
      'Petals of rose starlight blooming out of dark cosmic waters, opening gently around a heart of pearl.',
    color: '#f472b6',
    secondaryColor: '#fbcfe8',
    azimuthDeg: -146,
    elevationDeg: 24,
    angularSpanDeg: 17,
    distance: 154,
    stars: [
      { x: 0.0, y: 0.76, mag: 1.35 }, // 0: center petal peak
      { x: -0.24, y: 0.24, mag: 1.05 }, // 1: inner-left petal curve
      { x: 0.24, y: 0.24, mag: 1.05 }, // 2: inner-right petal curve
      { x: 0.0, y: -0.22, mag: 1.25 }, // 3: blossom heart
      { x: -0.56, y: 0.48, mag: 1.15 }, // 4: mid-left petal tip
      { x: 0.56, y: 0.48, mag: 1.15 }, // 5: mid-right petal tip
      { x: -0.9, y: 0.06, mag: 1.1 }, // 6: outer-left petal tip
      { x: 0.9, y: 0.06, mag: 1.1 }, // 7: outer-right petal tip
      { x: -0.54, y: -0.26, mag: 0.95 }, // 8: lower-left base
      { x: 0.54, y: -0.26, mag: 0.95 }, // 9: lower-right base
      { x: -0.78, y: -0.54, mag: 0.85 }, // 10: cosmic ripple left
      { x: 0.0, y: -0.62, mag: 0.95 }, // 11: cosmic ripple center
      { x: 0.78, y: -0.54, mag: 0.85 }, // 12: cosmic ripple right
    ],
    edges: [
      [0, 1],
      [1, 3],
      [3, 2],
      [2, 0],
      [3, 4],
      [4, 1],
      [3, 5],
      [5, 2],
      [4, 8],
      [8, 6],
      [6, 4],
      [5, 9],
      [9, 7],
      [7, 5],
      [8, 3],
      [3, 9],
      [10, 11],
      [11, 12],
    ],
    artStrokes: [
      {
        points: [
          [0.0, 0.76],
          [-0.24, 0.24],
          [0.0, -0.22],
          [0.24, 0.24],
        ],
        closed: true,
        fillOpacity: 0.2,
      },
      {
        points: [
          [0.0, -0.22],
          [-0.56, 0.48],
          [-0.54, -0.26],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
      {
        points: [
          [0.0, -0.22],
          [0.56, 0.48],
          [0.54, -0.26],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
      {
        points: [
          [-0.54, -0.26],
          [-0.9, 0.06],
          [-0.46, 0.22],
        ],
        closed: true,
        fillOpacity: 0.12,
      },
      {
        points: [
          [0.54, -0.26],
          [0.9, 0.06],
          [0.46, 0.22],
        ],
        closed: true,
        fillOpacity: 0.12,
      },
    ],
  },

  // 8. FAUNA — The Star Whale
  {
    id: 'star-whale',
    name: 'The Star Whale',
    latinName: 'Cetus Somnium',
    category: 'fauna',
    categoryLabel: 'Creatures',
    description:
      'A gentle leviathan swimming through sapphire star-currents, trailing shimmering constellations in its wake.',
    color: '#60a5fa',
    secondaryColor: '#38bdf8',
    azimuthDeg: -108,
    elevationDeg: 34,
    angularSpanDeg: 18,
    distance: 162,
    stars: [
      { x: -0.92, y: 0.04, mag: 1.2 }, // 0: broad forehead / rostrum
      { x: -0.58, y: 0.34, mag: 1.1 }, // 1: crown
      { x: -0.1, y: 0.4, mag: 1.25 }, // 2: arched back
      { x: 0.38, y: 0.22, mag: 1.05 }, // 3: dorsal ridge
      { x: 0.68, y: -0.02, mag: 1.0 }, // 4: tail stock
      { x: 0.94, y: 0.32, mag: 1.25 }, // 5: upper tail fluke
      { x: 0.88, y: -0.34, mag: 1.1 }, // 6: lower tail fluke
      { x: -0.68, y: -0.24, mag: 1.0 }, // 7: lower jaw
      { x: -0.22, y: -0.26, mag: 1.05 }, // 8: grooved belly
      { x: 0.28, y: -0.14, mag: 0.95 }, // 9: ventral taper
      { x: -0.3, y: -0.68, mag: 1.15 }, // 10: sweeping pectoral fin tip
      { x: -0.62, y: 0.04, mag: 1.3 }, // 11: luminous whale eye
      { x: -0.5, y: 0.62, mag: 0.9 }, // 12: starlight spout 1
      { x: -0.36, y: 0.74, mag: 0.85 }, // 13: starlight spout 2
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [4, 6],
      [0, 7],
      [7, 8],
      [8, 9],
      [9, 4],
      [8, 10],
      [7, 10],
      [0, 11],
      [1, 12],
      [12, 13],
    ],
    artStrokes: [
      {
        points: [
          [-0.92, 0.04],
          [-0.58, 0.34],
          [-0.1, 0.4],
          [0.38, 0.22],
          [0.68, -0.02],
          [0.94, 0.32],
          [0.78, 0.0],
          [0.88, -0.34],
          [0.62, -0.08],
          [0.28, -0.14],
          [-0.22, -0.26],
          [-0.68, -0.24],
        ],
        closed: true,
        fillOpacity: 0.16,
      },
      {
        points: [
          [-0.44, -0.22],
          [-0.3, -0.68],
          [-0.14, -0.26],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
    ],
  },

  // 9. CONCEPTS — The Hourglass of Time
  {
    id: 'hourglass',
    name: 'The Hourglass of Time',
    latinName: 'Chronos',
    category: 'concepts',
    categoryLabel: 'Concepts',
    description:
      'Twin crystal chambers tilted gently in the void, measuring epochs not in seconds, but in passing footsteps and starlight.',
    color: '#c084fc',
    secondaryColor: '#93c5fd',
    azimuthDeg: -68,
    elevationDeg: 26,
    angularSpanDeg: 15,
    distance: 156,
    stars: [
      { x: -0.56, y: 0.76, mag: 1.15 }, // 0: top cap left
      { x: 0.56, y: 0.76, mag: 1.15 }, // 1: top cap right
      { x: -0.44, y: 0.42, mag: 1.0 }, // 2: upper bulb left
      { x: 0.44, y: 0.42, mag: 1.0 }, // 3: upper bulb right
      { x: 0.0, y: 0.0, mag: 1.4 }, // 4: narrow waist pinch
      { x: -0.44, y: -0.42, mag: 1.0 }, // 5: lower bulb left
      { x: 0.44, y: -0.42, mag: 1.0 }, // 6: lower bulb right
      { x: -0.56, y: -0.76, mag: 1.15 }, // 7: bottom cap left
      { x: 0.56, y: -0.76, mag: 1.15 }, // 8: bottom cap right
      { x: 0.0, y: 0.34, mag: 0.95 }, // 9: upper sand crest
      { x: 0.0, y: -0.26, mag: 0.95 }, // 10: falling grain
      { x: 0.0, y: -0.56, mag: 1.1 }, // 11: lower sand peak
    ],
    edges: [
      [0, 1],
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 4],
      [4, 5],
      [4, 6],
      [5, 7],
      [6, 8],
      [7, 8],
      [9, 4],
      [4, 10],
      [10, 11],
      [5, 11],
      [6, 11],
    ],
    artStrokes: [
      {
        points: [
          [-0.56, 0.76],
          [0.56, 0.76],
          [0.44, 0.42],
          [0.0, 0.0],
          [-0.44, 0.42],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
      {
        points: [
          [0.0, 0.0],
          [0.44, -0.42],
          [0.56, -0.76],
          [-0.56, -0.76],
          [-0.44, -0.42],
        ],
        closed: true,
        fillOpacity: 0.14,
      },
    ],
  },

  // 10. PLANTS — The World Tree (High Upper Hemisphere)
  {
    id: 'world-tree',
    name: 'The World Tree',
    latinName: 'Arbor Mundi',
    category: 'plants',
    categoryLabel: 'Plants',
    description:
      'An ancient banyan of starlight whose branches shelter drifting worlds while its glowing roots reach into the deep abyss.',
    color: '#2dd4bf',
    secondaryColor: '#fde68a',
    azimuthDeg: -38,
    elevationDeg: 58,
    angularSpanDeg: 17,
    distance: 150,
    stars: [
      { x: 0.0, y: -0.34, mag: 1.15 }, // 0: lower trunk
      { x: 0.0, y: 0.14, mag: 1.3 }, // 1: heart of trunk
      { x: -0.44, y: 0.48, mag: 1.1 }, // 2: left main branch
      { x: 0.44, y: 0.48, mag: 1.1 }, // 3: right main branch
      { x: 0.0, y: 0.82, mag: 1.3 }, // 4: crown apex
      { x: -0.82, y: 0.34, mag: 1.0 }, // 5: far-left canopy
      { x: -0.58, y: 0.72, mag: 1.05 }, // 6: upper-left canopy
      { x: 0.58, y: 0.72, mag: 1.05 }, // 7: upper-right canopy
      { x: 0.82, y: 0.34, mag: 1.0 }, // 8: far-right canopy
      { x: -0.62, y: -0.74, mag: 0.95 }, // 9: far-left root
      { x: -0.22, y: -0.84, mag: 0.9 }, // 10: inner-left root
      { x: 0.22, y: -0.84, mag: 0.9 }, // 11: inner-right root
      { x: 0.62, y: -0.74, mag: 0.95 }, // 12: far-right root
    ],
    edges: [
      [0, 1],
      [1, 2],
      [1, 3],
      [1, 4],
      [2, 5],
      [2, 6],
      [6, 4],
      [3, 7],
      [3, 8],
      [7, 4],
      [0, 9],
      [0, 10],
      [0, 11],
      [0, 12],
    ],
    artStrokes: [
      {
        points: [
          [-0.82, 0.34],
          [-0.58, 0.72],
          [0.0, 0.84],
          [0.58, 0.72],
          [0.82, 0.34],
          [0.44, 0.24],
          [-0.44, 0.24],
        ],
        closed: true,
        fillOpacity: 0.16,
      },
    ],
  },

  // 11. CONCEPTS — The Golden Spiral (Harmonia)
  {
    id: 'spiral',
    name: 'The Golden Spiral',
    latinName: 'Harmonia',
    category: 'concepts',
    categoryLabel: 'Concepts',
    description:
      'A logarithmic nautilus of cosmic proportion — the hidden mathematics linking fern fronds, shells, and swirling galaxies.',
    color: '#f472b6',
    secondaryColor: '#38bdf8',
    azimuthDeg: 86,
    elevationDeg: 60,
    angularSpanDeg: 16,
    distance: 152,
    stars: [
      { x: 0.04, y: 0.02, mag: 1.35 }, // 0: spiral eye
      { x: 0.14, y: 0.12, mag: 1.0 }, // 1
      { x: 0.0, y: 0.24, mag: 1.05 }, // 2
      { x: -0.22, y: 0.16, mag: 1.05 }, // 3
      { x: -0.28, y: -0.12, mag: 1.1 }, // 4
      { x: -0.04, y: -0.38, mag: 1.15 }, // 5
      { x: 0.36, y: -0.34, mag: 1.2 }, // 6
      { x: 0.58, y: 0.06, mag: 1.15 }, // 7
      { x: 0.38, y: 0.54, mag: 1.2 }, // 8
      { x: -0.22, y: 0.72, mag: 1.2 }, // 9
      { x: -0.78, y: 0.34, mag: 1.25 }, // 10
      { x: -0.84, y: -0.38, mag: 1.15 }, // 11
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 6],
      [6, 7],
      [7, 8],
      [8, 9],
      [9, 10],
      [10, 11],
    ],
    artStrokes: [
      {
        points: [
          [0.04, 0.02],
          [0.14, 0.12],
          [0.0, 0.24],
          [-0.22, 0.16],
          [-0.28, -0.12],
          [-0.04, -0.38],
          [0.36, -0.34],
          [0.58, 0.06],
          [0.38, 0.54],
          [-0.22, 0.72],
          [-0.78, 0.34],
          [-0.84, -0.38],
        ],
      },
    ],
  },

  // 12. FAUNA — The Lunar Moth (High Southern Sky)
  {
    id: 'lunar-moth',
    name: 'The Lunar Moth',
    latinName: 'Vespera Luna',
    category: 'fauna',
    categoryLabel: 'Creatures',
    description:
      'A velvet-winged celestial navigator whose crescent eyespots glow at eighty-eight beats per minute above the snowglobe belt.',
    color: '#d8b4fe',
    secondaryColor: '#fde68a',
    azimuthDeg: -168,
    elevationDeg: 56,
    angularSpanDeg: 17,
    distance: 152,
    stars: [
      { x: 0.0, y: 0.36, mag: 1.25 }, // 0: head / crescent tiara
      { x: 0.0, y: -0.18, mag: 1.1 }, // 1: abdomen
      { x: -0.22, y: 0.66, mag: 0.95 }, // 2: left plume antenna
      { x: 0.22, y: 0.66, mag: 0.95 }, // 3: right plume antenna
      { x: -0.88, y: 0.44, mag: 1.3 }, // 4: left forewing apex
      { x: -0.68, y: -0.02, mag: 1.05 }, // 5: left forewing edge
      { x: 0.88, y: 0.44, mag: 1.3 }, // 6: right forewing apex
      { x: 0.68, y: -0.02, mag: 1.05 }, // 7: right forewing edge
      { x: -0.52, y: -0.34, mag: 1.0 }, // 8: left hindwing
      { x: 0.52, y: -0.34, mag: 1.0 }, // 9: right hindwing
      { x: -0.32, y: -0.84, mag: 1.15 }, // 10: left swallowtail train
      { x: 0.32, y: -0.84, mag: 1.15 }, // 11: right swallowtail train
      { x: -0.46, y: 0.24, mag: 1.2 }, // 12: left crescent eyespot
      { x: 0.46, y: 0.24, mag: 1.2 }, // 13: right crescent eyespot
    ],
    edges: [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [4, 5],
      [5, 1],
      [0, 6],
      [6, 7],
      [7, 1],
      [1, 8],
      [8, 10],
      [1, 9],
      [9, 11],
      [0, 12],
      [12, 4],
      [0, 13],
      [13, 6],
    ],
    artStrokes: [
      {
        points: [
          [0.0, 0.3],
          [-0.88, 0.44],
          [-0.68, -0.02],
          [-0.52, -0.34],
          [-0.32, -0.84],
          [-0.14, -0.36],
          [0.0, -0.18],
          [0.14, -0.36],
          [0.32, -0.84],
          [0.52, -0.34],
          [0.68, -0.02],
          [0.88, 0.44],
        ],
        closed: true,
        fillOpacity: 0.16,
      },
    ],
  },
];

const DEG2RAD = Math.PI / 180;

export interface ConstellationBasis {
  center: Vec3Tuple;
  right: Vec3Tuple;
  up: Vec3Tuple;
  dir: Vec3Tuple;
}

/**
 * Orthonormal sky-dome tangent basis at a constellation's (azimuthDeg, elevationDeg).
 * Azimuth 0 points down -Z (forward in Portalverse), +90 points +X (right).
 */
export function getConstellationBasis(spec: ConstellationSpec): ConstellationBasis {
  const az = spec.azimuthDeg * DEG2RAD;
  const el = spec.elevationDeg * DEG2RAD;
  const cosEl = Math.cos(el);
  const sinEl = Math.sin(el);

  const dx = Math.sin(az) * cosEl;
  const dy = sinEl;
  const dz = -Math.cos(az) * cosEl;

  // Tangent right vector (perpendicular to dir and world +Y)
  const rx = Math.cos(az);
  const ry = 0;
  const rz = Math.sin(az);

  // Tangent up vector = right x dir (points skyward along the meridian)
  const ux = -Math.sin(az) * sinEl;
  const uy = cosEl;
  const uz = Math.cos(az) * sinEl;

  return {
    dir: [dx, dy, dz],
    center: [dx * spec.distance, dy * spec.distance, dz * spec.distance],
    right: [rx, ry, rz],
    up: [ux, uy, uz],
  };
}

/**
 * Projects a normalized 2D constellation coordinate [-1..1, -1..1] cleanly onto
 * the curved celestial sphere so shapes stay undistorted at every elevation.
 */
export function projectConstellationPoint(
  spec: ConstellationSpec,
  localX: number,
  localY: number,
  radiusScale = 1,
): Vec3Tuple {
  const { dir, right, up } = getConstellationBasis(spec);
  const tanSpan = Math.tan(spec.angularSpanDeg * DEG2RAD);
  const px = dir[0] + right[0] * localX * tanSpan + up[0] * localY * tanSpan;
  const py = dir[1] + right[1] * localX * tanSpan + up[1] * localY * tanSpan;
  const pz = dir[2] + right[2] * localX * tanSpan + up[2] * localY * tanSpan;
  const len = Math.hypot(px, py, pz) || 1;
  const r = spec.distance * radiusScale;
  return [(px / len) * r, (py / len) * r, (pz / len) * r];
}

export interface SnowglobePlacement {
  readonly world: WorldManifest;
  readonly index: number;
  readonly position: Vec3Tuple;
  readonly radius: number;
  /** Orbit angle in radians around the cosmic ring. */
  readonly angle: number;
  /** Phase seed for gentle independent cosmic bobbing. */
  readonly bobPhase: number;
}

export const SNOWGLOBE_RADIUS = 2.65;

/**
 * Arranges all catalog worlds into a sculptural, gently undulating 3D cosmic ring
 * preserving Portalverse's circular portal loop order with generous breathing room
 * between globes regardless of how many community worlds exist in `registry.json`.
 */
export function computeSnowglobeLayout(
  worlds: readonly WorldManifest[],
  globeRadius = SNOWGLOBE_RADIUS,
): SnowglobePlacement[] {
  const n = worlds.length;
  if (n === 0) return [];
  if (n === 1) {
    return [
      {
        world: worlds[0],
        index: 0,
        position: [0, 0, 0],
        radius: globeRadius,
        angle: 0,
        bobPhase: 0,
      },
    ];
  }

  // Ensure minimum center-to-center arc clearance of at least 4.4x globe radius
  const minArcSpacing = globeRadius * 4.55;
  const ringRadius = Math.max(15.5, (n * minArcSpacing) / (Math.PI * 2));
  // Subtle organic spiral tilt + double-wave vertical undulation so it feels truly 3D in space
  const tiltRad = 0.14;

  return worlds.map((world, i) => {
    // Start at the front-near side (+Z) and step clockwise so index 0 greets the viewer
    const angle = (i / n) * Math.PI * 2;
    const radialJitter = Math.sin(i * 2.17) * (globeRadius * 0.55);
    const r = ringRadius + radialJitter;
    const rawX = Math.sin(angle) * r;
    const rawZ = Math.cos(angle) * r;
    const waveY = Math.sin(angle * 2 + 0.45) * 3.1 + Math.cos(angle * 3 - 0.3) * 1.45;
    // Slight galaxy-plane inclination
    const tiltedY = waveY + rawZ * Math.sin(tiltRad);
    const tiltedZ = rawZ * Math.cos(tiltRad);

    return {
      world,
      index: i,
      position: [rawX, tiltedY, tiltedZ],
      radius: globeRadius,
      angle,
      bobPhase: i * 0.93,
    };
  });
}

export function getConstellationById(id: string): ConstellationSpec | undefined {
  return COSMIC_CONSTELLATIONS.find((c) => c.id === id);
}
