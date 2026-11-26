import { seededRandom } from '@portalverse/core/rooms/kit';

/**
 * A small seamless noise image, made once and shared by every mount, so the fog,
 * smoke and stone shaders can sample texture instead of computing noise per pixel.
 *   R: soft fractal noise   G: the same at another scale   B: distance to cell edges (cracks at 0)   A: fine speckle
 */
export const NOISE_SIZE = 256;

let pixels: Uint8Array | undefined;

function lattice(period: number, rand: () => number): Float32Array {
  const values = new Float32Array(period * period);
  for (let i = 0; i < values.length; i++) values[i] = rand();
  return values;
}

/** Smooth value noise that wraps every `period` lattice cells. */
function valueNoise(values: Float32Array, period: number, u: number, v: number): number {
  const x = u * period;
  const y = v * period;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = values[y0 * period + x0];
  const b = values[y0 * period + x1];
  const c = values[y1 * period + x0];
  const d = values[y1 * period + x1];
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

function fractal(rand: () => number, periods: number[]): (u: number, v: number) => number {
  const octaves = periods.map((period, i) => ({ period, weight: 0.5 ** i, values: lattice(period, rand) }));
  return (u, v) => octaves.reduce((sum, o) => sum + o.weight * valueNoise(o.values, o.period, u, v), 0);
}

/** F2 − F1 of a jittered grid of points that wraps every `cells` cells: 0 on the borders between cells. */
function cellEdges(rand: () => number, cells: number): (u: number, v: number) => number {
  const points = new Float32Array(cells * cells * 2);
  for (let i = 0; i < points.length; i++) points[i] = rand();
  return (u, v) => {
    const x = u * cells;
    const y = v * cells;
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    let f1 = Infinity;
    let f2 = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const wrapped = (((cy % cells) + cells) % cells) * cells + (((cx % cells) + cells) % cells);
        const d = Math.hypot(cx + points[wrapped * 2] - x, cy + points[wrapped * 2 + 1] - y);
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    return f2 - f1;
  };
}

/** Stretch to the full 0..1 range. */
function normalise(values: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const value of values) {
    lo = Math.min(lo, value);
    hi = Math.max(hi, value);
  }
  for (let i = 0; i < values.length; i++) values[i] = (values[i] - lo) / (hi - lo);
}

export function abyssNoisePixels(): Uint8Array {
  if (pixels) return pixels;
  const rand = seededRandom(1307);
  const channels = [
    fractal(rand, [4, 8, 16, 32, 64]),
    fractal(rand, [6, 12, 24, 48]),
    cellEdges(rand, 9),
    fractal(rand, [64, 128]),
  ];
  const planes = channels.map(() => new Float32Array(NOISE_SIZE * NOISE_SIZE));
  for (let y = 0; y < NOISE_SIZE; y++) {
    for (let x = 0; x < NOISE_SIZE; x++) {
      const u = x / NOISE_SIZE;
      const v = y / NOISE_SIZE;
      channels.forEach((channel, c) => {
        planes[c][y * NOISE_SIZE + x] = channel(u, v);
      });
    }
  }
  planes.forEach(normalise);
  pixels = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  for (let i = 0; i < NOISE_SIZE * NOISE_SIZE; i++) {
    for (let c = 0; c < 4; c++) pixels[i * 4 + c] = Math.round(planes[c][i] * 255);
  }
  return pixels;
}
