import { breathe, seededRandom } from '@portalverse/core/rooms/kit';

/**
 * A small seamless noise image, made once and shared by every mount, so the fog,
 * smoke and stone shaders can sample texture instead of computing noise per pixel.
 *   R: soft fractal noise   G: the same at another scale   B: distance to cell edges (cracks at 0)   A: fine speckle
 */
export const NOISE_SIZE = 256;

let pixels: Promise<Uint8Array> | undefined;

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

/** Fractal value noise, one octave per period, each half the weight of the last. */
function fractalPlane(rand: () => number, periods: number[]): Float32Array {
  const plane = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  periods.forEach((period, octave) => {
    const values = lattice(period, rand);
    const weight = 0.5 ** octave;
    for (let y = 0; y < NOISE_SIZE; y++) {
      for (let x = 0; x < NOISE_SIZE; x++) {
        plane[y * NOISE_SIZE + x] += weight * valueNoise(values, period, x / NOISE_SIZE, y / NOISE_SIZE);
      }
    }
  });
  return plane;
}

/** F2 − F1 of a jittered grid of points that wraps every `cells` cells: 0 on the borders between cells. */
function cellEdgePlane(rand: () => number, cells: number): Float32Array {
  const points = new Float32Array(cells * cells * 2);
  for (let i = 0; i < points.length; i++) points[i] = rand();
  const plane = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  for (let py = 0; py < NOISE_SIZE; py++) {
    const y = (py / NOISE_SIZE) * cells;
    const yi = Math.floor(y);
    for (let px = 0; px < NOISE_SIZE; px++) {
      const x = (px / NOISE_SIZE) * cells;
      const xi = Math.floor(x);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = yi + dy;
        const row = ((cy % cells) + cells) % cells;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = xi + dx;
          const wrapped = row * cells + (((cx % cells) + cells) % cells);
          const ox = cx + points[wrapped * 2] - x;
          const oy = cy + points[wrapped * 2 + 1] - y;
          const d = Math.sqrt(ox * ox + oy * oy);
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      plane[py * NOISE_SIZE + px] = f2 - f1;
    }
  }
  return plane;
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

/** The texture's pixels, built on first use a channel at a time so no frame stalls. */
export function abyssNoisePixels(): Promise<Uint8Array> {
  pixels ??= buildPixels();
  return pixels;
}

async function buildPixels(): Promise<Uint8Array> {
  const rand = seededRandom(1307);
  // Built in this order so each channel draws the same random numbers every time.
  const makers = [
    () => fractalPlane(rand, [4, 8, 16, 32, 64]),
    () => fractalPlane(rand, [6, 12, 24, 48]),
    () => cellEdgePlane(rand, 9),
    () => fractalPlane(rand, [64, 128]),
  ];
  const planes: Float32Array[] = [];
  for (const make of makers) {
    planes.push(make());
    await breathe();
  }
  planes.forEach(normalise);
  const out = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  for (let i = 0; i < NOISE_SIZE * NOISE_SIZE; i++) {
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(planes[c][i] * 255);
  }
  return out;
}
