import { describe, expect, it } from 'vitest';
import earth from './palace.json';
import { PALACE } from './layout';
import { palaceCollider, palaceSurface } from './collide';

const R = 0.35;
const H = 1.8;

/** Walk from `from` toward (tx, tz) in short steps, as the avatar does, and return where the feet end up. */
function walk(from: [number, number, number], tx: number, tz: number, steps = 400): [number, number] {
  let [x, y, z] = from;
  for (let i = 0; i < steps; i++) {
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const s = Math.min(0.15, d);
    const to: [number, number, number] = [x + (dx / d) * s, y, z + (dz / d) * s];
    [x, z] = palaceCollider.move([x, y, z], to, R, H);
    y = Math.max(0, palaceSurface(x, z, y));
  }
  return [x, z];
}

describe('the Palace to walk round', () => {
  it('stops you at a colonnade column and lets you slide round it', () => {
    const c = earth.circles.find(([, , , top]) => top > 10)!;
    const cos = Math.cos(PALACE.turn), sin = Math.sin(PALACE.turn);
    const dx = c[0] - PALACE.earthCentre[0], dz = c[1] - PALACE.earthCentre[1];
    const cx = dx * cos - dz * sin + PALACE.at[0], cz = dx * sin + dz * cos + PALACE.at[1];
    const [x, z] = palaceCollider.move([cx + 3, 0, cz], [cx, 0, cz], R, H);
    expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(c[2] + R - 1e-6);
  });

  it('lets you walk in from the lagoon through the rotunda\'s arch, onto its podium', () => {
    const [x, z] = walk([-60, 0, 0], PALACE.at[0], PALACE.at[1]);
    expect(Math.hypot(x - PALACE.at[0], z - PALACE.at[1])).toBeLessThan(2);
    expect(palaceSurface(x, z, 0.5)).toBeCloseTo(earth.floor, 5);
  });

  it('gives a flier the dome\'s crown to land on, and nothing to someone walking under it', () => {
    expect(palaceSurface(PALACE.at[0], PALACE.at[1], 60)).toBeCloseTo(earth.top, 3);
    expect(palaceSurface(PALACE.at[0], PALACE.at[1], 0.6)).toBeCloseTo(earth.floor, 5);
  });

  it('leaves the meadow and the path alone', () => {
    expect(palaceCollider.move([0, 0, 0], [0.2, 0, 0.1], R, H)).toEqual([0.2, 0.1]);
    expect(palaceSurface(0, 0, 0)).toBe(-Infinity);
  });
});
