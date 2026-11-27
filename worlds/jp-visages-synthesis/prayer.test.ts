import { describe, expect, it } from 'vitest';
import { BEAM_RADIUS, Prayer, RING_RADIUS } from './prayer';

describe('Visages prayer', () => {
  it('reaches full glow at three seconds and reveals the prayer prompt one second later', () => {
    const p = new Prayer();
    p.update(10, RING_RADIUS, 0, 0, true);
    expect(p.glow).toBe(0);
    expect(p.ringGlow).toBe(0);
    p.update(10.175, RING_RADIUS, 0, 0, true);
    expect(p.glow).toBeGreaterThan(0.237);
    expect(p.glow).toBeLessThan(0.263);
    expect(p.ringGlow).toBe(0);
    p.update(10.35, RING_RADIUS, 0, 0, true);
    expect(p.glow).toBeGreaterThanOrEqual(0.475);
    expect(p.glow).toBeLessThanOrEqual(0.525);
    p.update(12.5, RING_RADIUS, 0, 0, true);
    expect(p.glow).toBeGreaterThanOrEqual(0.475);
    expect(p.glow).toBeLessThanOrEqual(0.525);
    expect(p.ringGlow).toBe(0);
    p.update(12.8, RING_RADIUS, 0, 0, true);
    expect(p.glow).toBeGreaterThan(0.5);
    expect(p.glow).toBeLessThan(1);
    expect(p.ringGlow).toBeGreaterThan(0);
    expect(p.ringGlow).toBeLessThan(1);
    expect(p.invoke(12.8)).toBe(false);
    p.update(13, RING_RADIUS, 0, 0, true);
    expect(p.glow).toBe(1);
    expect(p.ringGlow).toBe(1);
    expect(p.invoke(13)).toBe(false);
    p.update(13.99, RING_RADIUS, 0, 0, true);
    expect(p.ready).toBe(false);
    p.update(14, RING_RADIUS, 0, 0, true);
    expect(p.ready).toBe(true);
    expect(p.invoke(14)).toBe(true);
    expect(p.invoke(14)).toBe(false);
  });

  it.each([30, 60, 120])('preserves charge and prayer readiness while walking within the pentagram at %s fps', fps => {
    const p = new Prayer();
    for (let frame = 0; frame <= fps * 8; frame++) {
      const t = frame / fps;
      p.update(t, Math.sin(t), 0, Math.cos(t), true);
      if (t < 0.35) expect(p.glow).toBeLessThan(0.525);
      else if (t <= 2.55) {
        expect(p.glow).toBeGreaterThanOrEqual(0.475);
        expect(p.glow).toBeLessThanOrEqual(0.525);
      }
      if (t <= 2.55) expect(p.ringGlow).toBe(0);
      if (t >= 3) {
        expect(p.glow).toBe(1);
        expect(p.ringGlow).toBe(1);
      }
      expect(p.ready).toBe(t >= 4);
    }
  });

  it.each([[0, false], [RING_RADIUS + 0.01, true]] as const)(
    'requires a fresh dwell after leaving or jumping (x=%s, grounded=%s)', (x, grounded) => {
      const p = new Prayer();
      p.update(0, 0, 0, 0, true);
      p.update(7, 0, 0, 0, true);
      p.update(7.1, x, 0, 0, grounded);
      expect(p.ready).toBe(false);
      expect(p.glow).toBe(1);
      expect(p.ringGlow).toBe(1);
      p.update(7.275, x, 0, 0, grounded);
      expect(p.glow).toBeCloseTo(0.5);
      expect(p.ringGlow).toBeCloseTo(0.5);
      p.update(7.46, x, 0, 0, grounded);
      expect(p.glow).toBe(0);
      expect(p.ringGlow).toBe(0);
      p.update(8, 0, 0, 0, true);
      expect(p.glow).toBe(0);
      p.update(10.99, 0, 0, 0, true);
      expect(p.ready).toBe(false);
      p.update(11, 0, 0, 0, true);
      expect(p.glow).toBe(1);
      expect(p.ready).toBe(false);
      p.update(11.99, 0, 0, 0, true);
      expect(p.ready).toBe(false);
      p.update(12, 0, 0, 0, true);
      expect(p.ready).toBe(true);
    },
  );

  it('flickers subtly during the dim phase, eases off from that strength, and blends re-entry', () => {
    const p = new Prayer();
    p.update(0, 0, 0, 0, true);
    const samples = [];
    for (let frame = 30; frame < 150; frame++) {
      p.update(frame / 60, 0, 0, 0, true);
      samples.push(p.glow);
    }
    expect(Math.max(...samples) - Math.min(...samples)).toBeGreaterThan(0.02);
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.475);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.525);
    const before = p.glow;
    p.update(2.5, 0, 0, 0, false);
    expect(p.glow).toBe(before);
    p.update(2.675, 0, 0, 0, false);
    expect(p.glow).toBeCloseTo(before / 2);
    const fading = p.glow;
    p.update(2.7, 0, 0, 0, true);
    expect(p.glow).toBe(fading);
    expect(p.ringGlow).toBe(0);
    expect(p.ready).toBe(false);
    p.update(3.1, 0, 0, 0, true);
    expect(p.glow).toBeGreaterThanOrEqual(0.475);
    expect(p.glow).toBeLessThanOrEqual(0.525);
  });

  it('keeps the gaze through jumps and crossing the ring, fades outside its range, then rearms', () => {
    const p = new Prayer();
    p.update(0, 0, 0, 0, true);
    p.update(7, 0, 0, 0, true);
    p.invoke(7);
    p.update(8, BEAM_RADIUS, 0, 0, false);
    expect(p.light).toBe(1);
    p.update(8.36, BEAM_RADIUS, 0, 0, false);
    expect(p.glow).toBe(0);
    p.update(9, BEAM_RADIUS, 1, 0, false);
    p.update(9.175, 0, 0, 0, true);
    expect(p.light).toBeCloseTo(0.5);
    p.update(9.36, 0, 0, 0, true);
    expect(p.light).toBe(0);
    p.update(10, 0, 0, 0, true);
    p.update(17, 0, 0, 0, true);
    expect(p.ready).toBe(true);
  });
});
