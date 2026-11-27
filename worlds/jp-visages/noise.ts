import { breathe } from '@portalverse/core/rooms/kit';

export const NOISE_SIZE = 256;

const hash2 = (x: number, y: number, seed: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const fade = (t: number) => t * t * (3 - 2 * t);

/** Tileable value noise on a `period × period` grid. */
function tileValue(u: number, v: number, period: number, seed: number): number {
  const x = u * period;
  const y = v * period;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const ix0 = ((x0 % period) + period) % period;
  const iy0 = ((y0 % period) + period) % period;
  const ix1 = (ix0 + 1) % period;
  const iy1 = (iy0 + 1) % period;
  const a = hash2(ix0, iy0, seed);
  const b = hash2(ix1, iy0, seed);
  const c = hash2(ix0, iy1, seed);
  const d = hash2(ix1, iy1, seed);
  return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
}

/** Tileable multi-octave fBM in [0, 1]. */
function tileFbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += tileValue(u, v, period, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/** Tileable Voronoi edge distance (0 on sharp stone cracks, 1 inside cells). */
function tileVoronoiEdge(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells;
  const y = v * cells;
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  let d1 = 1e9;
  let d2 = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    const ny = ((cy + dy) % cells + cells) % cells;
    for (let dx = -1; dx <= 1; dx++) {
      const nx = ((cx + dx) % cells + cells) % cells;
      const px = cx + dx + 0.15 + 0.7 * hash2(nx, ny, seed);
      const py = cy + dy + 0.15 + 0.7 * hash2(nx, ny, seed + 7919);
      const dist = Math.hypot(px - x, py - y);
      if (dist < d1) {
        d2 = d1;
        d1 = dist;
      } else if (dist < d2) {
        d2 = dist;
      }
    }
  }
  return Math.min(1, Math.max(0, (d2 - d1) * 1.6));
}

let cachedPixels: Promise<Uint8Array> | undefined;

/**
 * Seamless 256×256 RGBA procedural stone texture shared across mounts:
 *  - R: broad mineral mottling / strata
 *  - G: fine gritty limestone grain & puddle domain warp
 *  - B: sharp Voronoi fracture edge distance (0 = deep crack)
 *  - A: anisotropic vertical weathering / stain streaks
 */
export function visageNoisePixels(): Promise<Uint8Array> {
  cachedPixels ??= buildPixels();
  return cachedPixels;
}

async function buildPixels(): Promise<Uint8Array> {
  const size = NOISE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;

  // Channel R: broad mineral mottling
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const n = tileFbm(u, v, 4, 4, 101);
      data[(y * size + x) * 4] = Math.round(n * 255);
    }
    if ((y & 31) === 31) await breathe();
  }

  // Channel G: fine gritty stone grain
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const n = tileFbm(u, v, 12, 3, 211);
      data[(y * size + x) * 4 + 1] = Math.round(n * 255);
    }
    if ((y & 31) === 31) await breathe();
  }

  // Channel B: Voronoi crack network (two scales combined for primary + hairline fissures)
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const coarse = tileVoronoiEdge(u, v, 6, 307);
      const fine = tileVoronoiEdge(u + 0.17, v + 0.31, 14, 419);
      const combined = Math.min(coarse, 0.35 + fine * 0.65);
      data[(y * size + x) * 4 + 2] = Math.round(combined * 255);
    }
    if ((y & 15) === 15) await breathe();
  }

  // Channel A: vertically stretched weathering / weeping tear streaks
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const streak = tileValue(u, v, 24, 521) * 0.55 + tileValue(u, v * 0.25, 16, 613) * 0.45;
      data[(y * size + x) * 4 + 3] = Math.round(streak * 255);
    }
    if ((y & 31) === 31) await breathe();
  }

  return data;
}
