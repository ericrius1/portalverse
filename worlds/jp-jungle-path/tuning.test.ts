import { describe, expect, it } from 'vitest';
import { jungleDefaults, layerDepth, layerHeightScale, normalizeSettings } from './tuning';

describe('Jungle tuning', () => {
  it('resets to the exact approved depth and height arrangement', () => {
    const approved = [0.95, 2.95, 5.25, 7.85, 10.75, 13.95, 17.45];
    approved.forEach((depth, layer) => {
      expect(layerDepth(layer, jungleDefaults)).toBeCloseTo(depth, 10);
      expect(layerHeightScale(layer, jungleDefaults)).toBe(1);
    });
  });
  it('separates whole-hedge distance, first gap, and outward gap growth', () => {
    const farther = { ...jungleDefaults, pathDistance: 4 };
    for (let layer = 0; layer < 7; layer++) {
      expect(layerDepth(layer, farther) - layerDepth(layer, jungleDefaults)).toBeCloseTo(3.05, 10);
    }
    const growing = { ...jungleDefaults, layerGap: 3, gapMultiplier: 1.2 };
    expect(layerDepth(1, growing) - layerDepth(0, growing)).toBeCloseTo(3);
    const gaps = Array.from({ length: 6 }, (_, i) => layerDepth(i + 1, growing) - layerDepth(i, growing));
    for (let i = 1; i < gaps.length; i++) expect(gaps[i]).toBeGreaterThan(gaps[i - 1]);
    expect(layerDepth(6, growing)).toBeGreaterThan(layerDepth(6, { ...growing, gapMultiplier: 1 }));
  });
  it('exaggerates outer height without raising the first screen', () => {
    const taller = { ...jungleDefaults, heightMultiplier: 2.5 };
    expect(layerHeightScale(0, taller)).toBe(1);
    expect(layerHeightScale(3, taller)).toBe(1.75);
    expect(layerHeightScale(6, taller)).toBe(2.5);
  });
  it('recovers from invalid saved settings and bounds extreme values', () => {
    expect(normalizeSettings(null)).toEqual(jungleDefaults);
    expect(normalizeSettings({ density: NaN, pathDistance: '3' })).toEqual(jungleDefaults);
    const bounded = normalizeSettings({ density: -2, heightMultiplier: 200, gapMultiplier: Infinity });
    expect(bounded.density).toBe(0.25);
    expect(bounded.heightMultiplier).toBe(2.5);
    expect(bounded.gapMultiplier).toBe(1);
  });
});
