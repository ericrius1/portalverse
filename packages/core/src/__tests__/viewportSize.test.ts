import { describe, expect, it } from 'vitest';
import {
  needsViewportSync,
  resolvePixelRatio,
  resolveViewportSize,
} from '../engine/viewportSize';

describe('viewportSize', () => {
  it('falls back to window height when container has width but zero height before CSS layout (mobile portrait)', () => {
    const vp = resolveViewportSize({
      containerWidth: 390,
      containerHeight: 0,
      windowWidth: 390,
      windowHeight: 844,
    });
    expect(vp.width).toBe(390);
    expect(vp.height).toBe(844);
    expect(vp.aspect).toBeCloseTo(390 / 844, 6);
  });

  it('falls back to window width when container has zero width and positive height', () => {
    const vp = resolveViewportSize({
      containerWidth: 0,
      containerHeight: 844,
      windowWidth: 390,
      windowHeight: 844,
    });
    expect(vp.width).toBe(390);
    expect(vp.height).toBe(844);
    expect(vp.aspect).toBeCloseTo(390 / 844, 6);
  });

  it('falls back to window dimensions when container is 0x0 during initial sheet animation', () => {
    const vp = resolveViewportSize({
      containerWidth: 0,
      containerHeight: 0,
      windowWidth: 430,
      windowHeight: 932,
    });
    expect(vp.width).toBe(430);
    expect(vp.height).toBe(932);
    expect(vp.aspect).toBeCloseTo(430 / 932, 6);
  });

  it('falls back to visualViewport when both container and window report 0', () => {
    const vp = resolveViewportSize({
      containerWidth: 0,
      containerHeight: 0,
      windowWidth: 0,
      windowHeight: 0,
      visualWidth: 393,
      visualHeight: 852,
    });
    expect(vp.width).toBe(393);
    expect(vp.height).toBe(852);
    expect(vp.aspect).toBeCloseTo(393 / 852, 6);
  });

  it('prefers container dimensions over visualViewport when container is laid out (e.g. mobile keyboard open)', () => {
    const vp = resolveViewportSize({
      containerWidth: 430,
      containerHeight: 932,
      windowWidth: 430,
      windowHeight: 932,
      visualWidth: 430,
      visualHeight: 480,
    });
    expect(vp.width).toBe(430);
    expect(vp.height).toBe(932);
    expect(vp.aspect).toBeCloseTo(430 / 932, 6);
  });

  it('guards against negative, NaN, or zero dimensions without producing NaN/Infinity aspect', () => {
    const vp = resolveViewportSize({
      containerWidth: Number.NaN,
      containerHeight: -10,
      windowWidth: 0,
      windowHeight: undefined,
    });
    expect(vp).toEqual({ width: 1, height: 1, aspect: 1 });
    expect(Number.isFinite(vp.aspect)).toBe(true);
  });

  it('clamps devicePixelRatio safely between 1 and profile cap', () => {
    expect(resolvePixelRatio(3, 1.5)).toBe(1.5);
    expect(resolvePixelRatio(1, 2.0)).toBe(1);
    expect(resolvePixelRatio(0, 1.5)).toBe(1);
    expect(resolvePixelRatio(undefined, 1.5)).toBe(1);
  });

  it('detects camera aspect drift, dimension changes, and DPR changes', () => {
    const steady = { width: 390, height: 844, pixelRatio: 1.5, cameraAspect: 390 / 844 };
    expect(needsViewportSync(steady, 390, 844, 1.5)).toBe(false);
    expect(needsViewportSync({ ...steady, cameraAspect: 390 }, 390, 844, 1.5)).toBe(true);
    expect(needsViewportSync({ ...steady, cameraAspect: Number.NaN }, 390, 844, 1.5)).toBe(true);
    expect(needsViewportSync(steady, 844, 390, 1.5)).toBe(true);
    expect(needsViewportSync(steady, 390, 844, 1.0)).toBe(true);
  });
});
