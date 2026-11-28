import { breathe } from '@portalverse/core/rooms/kit';

export const COBBLE_TEX_SIZE = 512;
export const STONE_NOISE_SIZE = 256;
export const ENV_SKY_WIDTH = 256;
export const ENV_SKY_HEIGHT = 128;

const hash2 = (x: number, y: number, seed: number): number => {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

const fade = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

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

let cachedCobble: Promise<Uint8Array> | undefined;
let cachedStoneNoise: Promise<Uint8Array> | undefined;
let cachedReflectionSky: Promise<Float32Array> | undefined;

/**
 * Seamless 512×512 RGBA single-layer cobblestone atlas shared across mounts.
 * Structurally eliminates nested "cobblestones-within-cobblestones" by defining
 * ONE primary hand-laid stone network:
 *  - R: exact edge distance to the nearest mortar joint (0 in mortar, 1 inside stone)
 *  - G: flat per-stone constant ID/tone (unique per winning stone cell)
 *  - B: beveled convex stone crown elevation (raised rounded stone top, deep joint drop)
 *  - A: occasional hairline fracture confined strictly inside ~28% of stones (never crossing mortar)
 */
export function cobbleMapPixels(): Promise<Uint8Array> {
  cachedCobble ??= buildCobblePixels();
  return cachedCobble;
}

async function buildCobblePixels(): Promise<Uint8Array> {
  const size = COBBLE_TEX_SIZE;
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;

  // Slightly staggered ancient flagstone/cobble grid: 7 stones across × 9 stones along.
  const cols = 7;
  const rows = 9;

  for (let y = 0; y < size; y++) {
    const v0 = y * inv;
    for (let x = 0; x < size; x++) {
      const u0 = x * inv;

      // Gentle low-frequency warp so joints meander organically like hand-fitted ancient stone.
      const wu = (tileFbm(u0, v0, 6, 2, 911) - 0.5) * 0.022;
      const wv = (tileFbm(u0 + 0.37, v0 + 0.19, 6, 2, 977) - 0.5) * 0.022;
      const u = ((u0 + wu) % 1 + 1) % 1;
      const v = ((v0 + wv) % 1 + 1) % 1;

      const gx = u * cols;
      const gy = v * rows;
      const cx = Math.floor(gx);
      const cy = Math.floor(gy);

      let d1 = 1e9;
      let d2 = 1e9;
      let bestNx = 0;
      let bestNy = 0;
      let bestRelX = 0;
      let bestRelY = 0;

      for (let dy = -1; dy <= 1; dy++) {
        const ny = ((cy + dy) % rows + rows) % rows;
        // Stagger odd rows slightly so stones read as laid masonry rather than a grid.
        const rowShift = (ny & 1) === 1 ? 0.32 : 0;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ((cx + dx) % cols + cols) % cols;
          const jx = 0.22 + 0.56 * hash2(nx, ny, 307);
          const jy = 0.22 + 0.56 * hash2(nx, ny, 419);
          const px = cx + dx + ((jx + rowShift) % 1);
          const py = cy + dy + jy;
          const rx = gx - px;
          const ry = gy - py;
          // Mildly soften Euclidean distance into squircle-like rounded cobble shapes.
          const dist = Math.hypot(rx, ry);
          if (dist < d1) {
            d2 = d1;
            d1 = dist;
            bestNx = nx;
            bestNy = ny;
            bestRelX = rx;
            bestRelY = ry;
          } else if (dist < d2) {
            d2 = dist;
          }
        }
      }

      // Edge distance (0 at mortar seam, 1 near stone core).
      const edgeDist = clamp01((d2 - d1) * 1.65);

      // Per-stone constant brightness/height ID.
      const stoneId = hash2(bestNx, bestNy, 709);

      // Beveled stone crown: crisp rise out of the mortar joint + gentle convex stone top.
      const bevel = smoothstep(0.05, 0.24, edgeDist);
      const dome = 0.74 + 0.26 * clamp01(1 - d1 * 1.15);
      // Slight subtle chipped edge irregularity along the bevel shoulder.
      const chipNoise = tileValue(u0, v0, 28, 1103);
      const crown = clamp01(bevel * (dome - (1 - bevel) * chipNoise * 0.14));

      // Occasional single hairline fracture strictly inside ~28% of individual stones.
      let fracture = 0;
      const crackRoll = hash2(bestNx, bestNy, 1301);
      if (crackRoll > 0.72 && edgeDist > 0.1) {
        const angle = hash2(bestNx, bestNy, 1451) * Math.PI;
        const offset = (hash2(bestNx, bestNy, 1597) - 0.5) * 0.22;
        const ca = Math.cos(angle);
        const sa = Math.sin(angle);
        const along = bestRelX * ca + bestRelY * sa;
        const across = -bestRelX * sa + bestRelY * ca + offset;
        const meander = Math.sin(along * 8.5 + crackRoll * 20) * 0.045;
        const lineDist = Math.abs(across + meander);
        const lineMask = 1 - smoothstep(0.012, 0.048, lineDist);
        // Taper fracture smoothly inside the stone's own border so it never competes with mortar.
        const insideMask = smoothstep(0.1, 0.26, edgeDist);
        fracture = lineMask * insideMask;
      }

      const idx = (y * size + x) * 4;
      data[idx] = Math.round(edgeDist * 255);
      data[idx + 1] = Math.round(stoneId * 255);
      data[idx + 2] = Math.round(crown * 255);
      data[idx + 3] = Math.round(fracture * 255);
    }
    if ((y & 15) === 15) await breathe();
  }

  return data;
}

/**
 * Seamless 256×256 RGBA pure organic mineral & grain texture (NO Voronoi!).
 * Used for stone wear, mineral mottling, uneven dirt grain, and liquid domain warp.
 *  - R: broad mineral mottling / strata fBM
 *  - G: medium stone roughness / puddle domain warp fBM
 *  - B: fine gritty pore & limestone grain fBM
 *  - A: anisotropic vertical weathering streaks
 */
export function stoneNoisePixels(): Promise<Uint8Array> {
  cachedStoneNoise ??= buildStoneNoisePixels();
  return cachedStoneNoise;
}

async function buildStoneNoisePixels(): Promise<Uint8Array> {
  const size = STONE_NOISE_SIZE;
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;

  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      const u = x * inv;
      const idx = (y * size + x) * 4;
      data[idx] = Math.round(tileFbm(u, v, 4, 4, 101) * 255);
      data[idx + 1] = Math.round(tileFbm(u, v, 10, 3, 211) * 255);
      data[idx + 2] = Math.round(tileFbm(u, v, 20, 3, 317) * 255);
      const streak = tileValue(u, v, 24, 521) * 0.55 + tileValue(u, v * 0.25, 16, 613) * 0.45;
      data[idx + 3] = Math.round(streak * 255);
    }
    if ((y & 15) === 15) await breathe();
  }

  return data;
}

/**
 * Small HDR equirectangular reflection sky shared across mounts.
 * Gives the polished obsidian eyes and glossy crimson blood pools rich reflections of
 * the moonlit clouds, a crisp lunar disc, faint moonlit corridor silhouettes on ±X,
 * and a deep crimson glow from the pools below.
 */
export function reflectionSkyPixels(moonDir: readonly [number, number, number]): Promise<Float32Array> {
  cachedReflectionSky ??= buildReflectionSkyPixels(moonDir);
  return cachedReflectionSky;
}

async function buildReflectionSkyPixels(moonDir: readonly [number, number, number]): Promise<Float32Array> {
  const width = ENV_SKY_WIDTH;
  const height = ENV_SKY_HEIGHT;
  const data = new Float32Array(width * height * 4);

  const [mx, my, mz] = moonDir;

  for (let y = 0; y < height; y++) {
    // Equirectangular: v = 0 at south pole (-Y), v = 1 at north pole (+Y) in Three DataTexture (flipY=false default? Wait: Three DataTexture flipY=false puts row 0 at bottom).
    const v = (y + 0.5) / height;
    const phi = (v - 0.5) * Math.PI; // -pi/2..+pi/2
    const cosPhi = Math.cos(phi);
    const dy = Math.sin(phi);

    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const theta = (u - 0.5) * Math.PI * 2;
      const dx = Math.sin(theta) * cosPhi;
      const dz = Math.cos(theta) * cosPhi;

      // Sky gradient & moonlit storm cloud streaks in upper hemisphere.
      const up = Math.max(0, dy);
      let r = 0.014 + (1 - up) * 0.04;
      let g = 0.02 + (1 - up) * 0.065;
      let b = 0.032 + (1 - up) * 0.09;

      if (dy > 0) {
        const cloud = tileFbm(u * 2, v * 2, 4, 3, 823);
        const cloudBand = smoothstep(0.05, 0.35, dy) * (1 - smoothstep(0.65, 0.96, dy)) * smoothstep(0.38, 0.78, cloud);
        r += cloudBand * 0.42;
        g += cloudBand * 0.58;
        b += cloudBand * 0.72;
      }

      // Crisp moon disc + soft atmospheric lunar halo aligned with MOON_DIR.
      const towardMoon = Math.max(0, dx * mx + dy * my + dz * mz);
      const moonDisc = smoothstep(0.9965, 0.999, towardMoon) * 14.0;
      const moonHalo = Math.pow(towardMoon, 60) * 1.8 + Math.pow(towardMoon, 8) * 0.22;
      r += (moonDisc + moonHalo) * 0.84;
      g += (moonDisc + moonHalo) * 0.93;
      b += (moonDisc + moonHalo) * 1.05;

      // Subtle moonlit horizon strips echoing the pale stone faces along ±X.
      const corridorStrip =
        Math.exp(-Math.pow((dy - 0.14) / 0.16, 2)) *
        Math.pow(Math.abs(dx), 3) *
        (0.55 + 0.45 * Math.pow(Math.cos(dz * Math.PI * 5), 2));
      r += corridorStrip * 0.55;
      g += corridorStrip * 0.72;
      b += corridorStrip * 0.82;

      // Faint glossy arterial crimson bounce from the blood-pooled road below.
      if (dy < 0.05) {
        const down = Math.max(0, -dy);
        const redGlow = Math.exp(-Math.pow((down - 0.35) / 0.32, 2)) * (0.28 + 0.35 * Math.pow(Math.abs(dz), 2));
        r += redGlow * 0.52;
        g += redGlow * 0.04;
        b += redGlow * 0.06;
      }

      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 1;
    }
    if ((y & 7) === 7) await breathe();
  }

  return data;
}
