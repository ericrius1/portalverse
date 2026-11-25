/** The road's paving: where each tile lies and how it glows. No renderer dependencies. */
import { ROAD_HALF_WIDTH, roadCenterX, type Spot } from './logic';

/** Width of the kerb along each side of the road, outside the tiles. */
export const KERB_WIDTH = 0.22;
const PAVED_HALF = ROAD_HALF_WIDTH - KERB_WIDTH;
/** Roughly how long each slab is. Each one spans the road. */
const SLAB_LENGTH = 5;
const END = 46;
/** Seconds a tile takes to go dark after you step off it. */
export const TILE_FADE = 1.5;

// The middle of the road, sampled finely, with the distance travelled to each sample.
const samples: Array<{ x: number; z: number; s: number }> = [];
for (let i = 0; i <= END * 40; i++) {
  const z = -END + i / 20;
  const x = roadCenterX(z);
  const last = samples[i - 1];
  samples.push({ x, z, s: last ? last.s + Math.hypot(x - last.x, z - last.z) : 0 });
}
const LENGTH = samples[samples.length - 1].s;
export const TILE_COUNT = Math.round(LENGTH / SLAB_LENGTH);
const TILE_LENGTH = LENGTH / TILE_COUNT;

/** Unit vector across the road at a sample, pointing toward +X. */
function across(i: number): Spot {
  const a = samples[Math.max(0, i - 1)];
  const b = samples[Math.min(samples.length - 1, i + 1)];
  const length = Math.hypot(b.x - a.x, b.z - a.z);
  return { x: (b.z - a.z) / length, z: -(b.x - a.x) / length };
}

/** The ground position `s` metres along the road and `offset` metres to its side. */
export function roadPoint(s: number, offset: number): Spot {
  let low = 0;
  let high = samples.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (samples[middle].s <= s) low = middle;
    else high = middle;
  }
  const a = samples[low];
  const b = samples[high];
  const t = (s - a.s) / (b.s - a.s);
  const normal = across(t < 0.5 ? low : high);
  return {
    x: a.x + (b.x - a.x) * t + normal.x * offset,
    z: a.z + (b.z - a.z) * t + normal.z * offset,
  };
}

/** A tile's extent along and across the road. */
export function tileBounds(tile: number) {
  return { from: tile * TILE_LENGTH, to: (tile + 1) * TILE_LENGTH, left: -PAVED_HALF, right: PAVED_HALF };
}

export function tileCenter(tile: number): Spot {
  const { from, to, left, right } = tileBounds(tile);
  return roadPoint((from + to) / 2, (left + right) / 2);
}

/** The tile under a ground position, or -1 off the paving. */
export function tileAt(x: number, z: number): number {
  if (Math.abs(z) > END) return -1;
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const distance = (samples[i].x - x) ** 2 + (samples[i].z - z) ** 2;
    if (distance < best) {
      best = distance;
      nearest = i;
    }
  }
  const sample = samples[nearest];
  const normal = across(nearest);
  const dx = x - sample.x;
  const dz = z - sample.z;
  const offset = dx * normal.x + dz * normal.z;
  if (Math.abs(offset) >= PAVED_HALF || best >= PAVED_HALF ** 2) return -1;
  // The part of the gap to the sample that runs along the road.
  const along = sample.s + dx * -normal.z + dz * normal.x;
  return Math.min(TILE_COUNT - 1, Math.max(0, Math.floor(along / TILE_LENGTH)));
}

/**
 * Light the tile being stood on (-1 for none) and dim the rest.
 * Returns whether any brightness changed.
 */
export function stepGlow(glow: Float32Array, standing: number, dt: number): boolean {
  let changed = false;
  for (let i = 0; i < glow.length; i++) {
    const next = i === standing ? 1 : Math.max(0, glow[i] - dt / TILE_FADE);
    if (next !== glow[i]) {
      glow[i] = next;
      changed = true;
    }
  }
  return changed;
}
