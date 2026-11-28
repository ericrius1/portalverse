import { describe, expect, it } from 'vitest';
import { jungleDefaults, gapCurves, heightCurves, jungleOriginal, layerDepth, layerHeightOffset, layerLeafSize, layerDensity, leafDepthAmplitude, leafDepthSample, normalizeSettings } from './tuning';

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
      expect(layerLeafSize(layer, { ...sizes, densityNear: 2, densityFar: 2 })).toBe(layerLeafSize(layer, sizes));
      expect(layerLeafSize(layer, { ...sizes, leafSizeNear: 0.5, leafSizeFar: 0.5 })).toBe(0.5);
    }
  });
  it('interpolates independent near/far density and migrates the former single setting', () => {
    const settings = { ...jungleDefaults, densityNear: 0.4, densityFar: 1.6 };
    expect(layerDensity(0, settings)).toBeCloseTo(0.4);
    expect(layerDensity(3, settings)).toBeCloseTo(1);
    expect(layerDensity(6, settings)).toBeCloseTo(1.6);
    const migrated = normalizeSettings({ density: 1.35, leafSizeNear: 0.45, heightCurve: 'steep' });
    expect(migrated.densityNear).toBe(1.35);
    expect(migrated.densityFar).toBe(1.35);
    expect(migrated.leafSizeNear).toBe(0.45);
    expect(migrated.heightCurve).toBe('steep');
    const explicit = normalizeSettings({ density: 1.35, densityNear: 0.6, densityFar: 1.7 });
    expect(explicit.densityNear).toBe(0.6);
    expect(explicit.densityFar).toBe(1.7);
  });
  it('varies depth in both directions without consuming placement randomness or closing layer gaps', () => {
    for (let layer = 0; layer < 7; layer++) {
      expect(leafDepthAmplitude(layer, jungleOriginal)).toBe(0);
      const settings = { ...jungleDefaults, leafDepthVariation: 1, layerGap: 0.5 };
      expect(leafDepthAmplitude(layer, settings)).toBeGreaterThan(0);
      const samples = Array.from({ length: 80 }, (_, i) => leafDepthSample(i, layer, 1));
      expect(Math.min(...samples)).toBeLessThan(-0.8);
      expect(Math.max(...samples)).toBeGreaterThan(0.8);
      expect(samples.every(n => Math.abs(n) <= 1)).toBe(true);
      expect(leafDepthSample(27, layer, 1)).toBe(samples[27]);
      if (layer < 6) {
        const gap = layerDepth(layer + 1, settings) - layerDepth(layer, settings);
        expect(leafDepthAmplitude(layer, settings) + leafDepthAmplitude(layer + 1, settings)).toBeLessThan(gap);
      }
    }
  });
  it('recovers from invalid saved settings and bounds extreme values', () => {
    expect(normalizeSettings(null)).toEqual(jungleDefaults);
    expect(normalizeSettings({ heightCurve: 'invalid', gapCurve: '__proto__' })).toEqual(jungleDefaults);
    expect(normalizeSettings({ density: 1.4 }).leafSizeNear).toBe(0.65);
    expect(normalizeSettings({ density: NaN, pathDistance: '3' })).toEqual(jungleDefaults);
    const bounded = normalizeSettings({ density: -2, heightMultiplier: 200, gapMultiplier: Infinity });
    expect(bounded.densityNear).toBe(0.25);
    expect(bounded.densityFar).toBe(0.25);
    expect(bounded.heightMultiplier).toBe(2.5);
    expect(bounded.gapMultiplier).toBe(1);
  });
});
