import { describe, expect, it } from 'vitest';
import { jungleDefaults, gapCurves, heightCurves, jungleOriginal, layerDepth, layerHeightOffset, layerLeafSize, normalizeSettings } from './tuning';

describe('Jungle tuning', () => {
  it('resets to the exact approved depth and height arrangement', () => {
    const approved = [0.95, 2.95, 5.25, 7.85, 10.75, 13.95, 17.45];
    approved.forEach((depth, layer) => {
      expect(layerDepth(layer, jungleDefaults)).toBeCloseTo(depth, 10);
      expect(layerHeightOffset(layer, jungleDefaults)).toBeCloseTo(0);
      expect(layerLeafSize(layer, jungleOriginal)).toBe(1);
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
  it('keeps the front fixed and concentrates height at the back', () => {
    const taller = { ...jungleDefaults, heightMultiplier: 2.5 };
    expect(layerHeightOffset(0, taller)).toBe(0);
    expect(layerHeightOffset(6, taller)).toBeCloseTo(12.06);
    const steep = { ...taller, heightCurve: 'steep' as const };
    expect(layerHeightOffset(3, steep)).toBeLessThan(layerHeightOffset(3, taller));
    expect(layerHeightOffset(6, steep)).toBe(layerHeightOffset(6, taller));
    for (const heightCurve of Object.keys(heightCurves) as Array<keyof typeof heightCurves>) {
      expect(layerHeightOffset(0, { ...taller, heightCurve })).toBe(0);
    }
  });
  it('offers distinct gap curves while preserving clearance and the first gap', () => {
    for (const gapCurve of Object.keys(gapCurves) as Array<keyof typeof gapCurves>) {
      const settings = { ...jungleDefaults, gapCurve };
      expect(layerDepth(0, settings)).toBe(settings.pathDistance);
      expect(layerDepth(1, settings) - layerDepth(0, settings)).toBeCloseTo(settings.layerGap);
      for (let layer = 1; layer < 7; layer++) expect(layerDepth(layer, settings)).toBeGreaterThan(layerDepth(layer - 1, settings));
    }
    expect(layerDepth(6, { ...jungleDefaults, gapCurve: 'even' })).toBeCloseTo(12.95);
    expect(layerDepth(3, { ...jungleDefaults, gapCurve: 'back-loaded' })).toBeLessThan(layerDepth(3, jungleDefaults));
  });
  it('interpolates leaf sizes from either endpoint independently of density', () => {
    const sizes = { ...jungleDefaults, leafSizeNear: 0.3, leafSizeFar: 1.2 };
    expect(layerLeafSize(0, sizes)).toBeCloseTo(0.3);
    expect(layerLeafSize(3, sizes)).toBeCloseTo(0.75);
    expect(layerLeafSize(6, sizes)).toBeCloseTo(1.2);
    for (let layer = 0; layer < 7; layer++) {
      expect(layerLeafSize(layer, { ...sizes, density: 2 })).toBe(layerLeafSize(layer, sizes));
      expect(layerLeafSize(layer, { ...sizes, leafSizeNear: 0.5, leafSizeFar: 0.5 })).toBe(0.5);
    }
  });
  it('recovers from invalid saved settings and bounds extreme values', () => {
    expect(normalizeSettings(null)).toEqual(jungleDefaults);
    expect(normalizeSettings({ heightCurve: 'invalid', gapCurve: '__proto__' })).toEqual(jungleDefaults);
    expect(normalizeSettings({ density: 1.4 }).leafSizeNear).toBe(0.65);
    expect(normalizeSettings({ density: NaN, pathDistance: '3' })).toEqual(jungleDefaults);
    const bounded = normalizeSettings({ density: -2, heightMultiplier: 200, gapMultiplier: Infinity });
    expect(bounded.density).toBe(0.25);
    expect(bounded.heightMultiplier).toBe(2.5);
    expect(bounded.gapMultiplier).toBe(1);
  });
});
