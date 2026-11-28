import { describe, expect, it } from 'vitest';
import { RippleTrail, RIPPLE_CAPACITY, poolCoverage, sampleChannel } from './ripples';
import { cobbleMapPixels, stoneNoisePixels } from './textures';

describe('Visages liquid impacts', () => {
  it('leaves fixed origins behind, even while the player moves and stops', () => {
    const trail = new RippleTrail();
    trail.update(0, 0, 0, 0, 0, () => true);
    trail.update(0, 0, 1, 0, .3, () => true);
    const first = { ...trail.impacts[0] };
    trail.update(0, 0, 2, 0, .6, () => true);
    trail.update(0, 0, 2, 0, .9, () => true);
    expect(trail.impacts[0]).toEqual(first);
    expect(trail.impacts.filter(p => p.strength > 0)).toHaveLength(2);
    expect(trail.impacts[0].x * trail.impacts[1].x).toBeLessThan(0);
  });
  it('does not disturb dry ground, flying feet, or a teleport', () => {
    const trail = new RippleTrail();
    trail.update(0, 0, 0, 0, 0, () => true);
    trail.update(0, 0, 1, 0, .3, () => false);
    trail.update(0, 2, 2, 0, .6, () => true);
    trail.update(0, 0, 100, 0, .9, () => true);
    expect(trail.impacts.every(p => p.strength === 0)).toBe(true);
  });
  it('has bounded storage and clears transient state on leaving/re-entering', () => {
    const trail = new RippleTrail();
    for (let i = 0; i < 300; i++) trail.update(0, 0, i, 0, i * .3, () => true);
    expect(trail.impacts).toHaveLength(RIPPLE_CAPACITY);
    expect(Math.min(...trail.impacts.map(p => p.born))).toBeGreaterThan(80);
    trail.reset();
    expect(trail.impacts.every(p => !p.strength)).toBe(true);
  });
  it('samples repeat-wrapped textures and keeps impacts out of the clean portals', async () => {
    const [noise, cobble] = await Promise.all([stoneNoisePixels(), cobbleMapPixels()]);
    expect(sampleChannel(noise, 256, -.13, 1.4, 0)).toBeCloseTo(sampleChannel(noise, 256, .87, .4, 0));
    expect(poolCoverage(0, 36.25, noise, cobble)).toBe(0);
    expect(poolCoverage(0, -36.25, noise, cobble)).toBe(0);
    const coverage = Array.from({ length: 60 }, (_, i) => poolCoverage(0, i - 30, noise, cobble));
    expect(coverage.some(v => v > .7)).toBe(true);
    expect(coverage.some(v => v === 0)).toBe(true);
  });
});
