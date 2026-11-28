/**
 * 8 × 8 glyphs for the platter displays, top row first ('X' is a lit LED).
 * The shader reads them from a small atlas: one 8-pixel row per glyph row,
 * glyphs stacked down the texture. Add a glyph here and name it in `GLYPH`.
 */

const BITMAPS = {
  /** The relay's mark: a zero with a slash through it. */
  slashedZero: [
    '..XXXX..',
    '.X....X.',
    '.X...XX.',
    '.X..X.X.',
    '.X.X..X.',
    '.XX...X.',
    '.X....X.',
    '..XXXX..',
  ],
  zero: [
    '..XXXX..',
    '.X....X.',
    '.X....X.',
    '.X....X.',
    '.X....X.',
    '.X....X.',
    '.X....X.',
    '..XXXX..',
  ],
  block: [
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
    'XXXXXXXX',
  ],
  dot: [
    '........',
    '........',
    '........',
    '...XX...',
    '...XX...',
    '........',
    '........',
    '........',
  ],
} as const;

export type GlyphName = keyof typeof BITMAPS;
const NAMES = Object.keys(BITMAPS) as GlyphName[];

/** Atlas index of each glyph, for a cue's `glyph`. */
export const GLYPH = Object.fromEntries(NAMES.map((name, i) => [name, i])) as Record<GlyphName, number>;
export const GLYPH_COUNT = NAMES.length;

/** Whether the LED at column `x` (left to right), row `y` (top down) of a glyph is lit. */
export function glyphBit(glyph: number, x: number, y: number): boolean {
  return BITMAPS[NAMES[glyph]][y][x] === 'X';
}

/** The share of a glyph's 64 LEDs that are lit, which is how bright it looks from far away. */
export function glyphDensity(glyph: number): number {
  let lit = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) if (glyphBit(glyph, x, y)) lit++;
  return lit / 64;
}

let pixels: Uint8Array | undefined;

/**
 * RGBA8 atlas pixels, 8 wide and 8 × GLYPH_COUNT tall: red is the LED, green is
 * the glyph's density (the same for every texel of a glyph). Built once.
 */
export function glyphAtlasPixels(): Uint8Array {
  if (pixels) return pixels;
  pixels = new Uint8Array(8 * 8 * GLYPH_COUNT * 4);
  for (let g = 0; g < GLYPH_COUNT; g++) {
    const density = Math.round(glyphDensity(g) * 255);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = ((g * 8 + y) * 8 + x) * 4;
        pixels[i] = glyphBit(g, x, y) ? 255 : 0;
        pixels[i + 1] = density;
        pixels[i + 3] = 255;
      }
    }
  }
  return pixels;
}
