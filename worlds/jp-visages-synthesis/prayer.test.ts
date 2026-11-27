import { describe, expect, it } from 'vitest';
import { BEAM_RADIUS, Prayer, RING_RADIUS } from './prayer';

describe('Visages prayer', () => {
  it('wakes at six seconds and accepts one prayer at seven', () => {
    const p = new Prayer();
    p.update(10, RING_RADIUS, 0, 0, true);
    p.update(15.99, 0, 0, 0, true);
    expect(p.glow).toBe(0);
    p.update(16.25, 0, 0, 0, true);
    expect(p.glow).toBeGreaterThan(0);
    expect(p.invoke(16.99)).toBe(false);
    p.update(17, 0, 0, 0, true);
    expect(p.invoke(17)).toBe(true);
    expect(p.invoke(17)).toBe(false);
  });

  it.each([[0, false], [RING_RADIUS + 0.01, true]] as const)(
    'requires a fresh dwell after leaving or jumping (x=%s, grounded=%s)', (x, grounded) => {
      const p = new Prayer();
      p.update(0, 0, 0, 0, true);
      p.update(7, 0, 0, 0, true);
      p.update(7.1, x, 0, 0, grounded);
      expect(p.ready).toBe(false);
      expect(p.glow).toBe(0);
      p.update(8, 0, 0, 0, true);
      p.update(14.99, 0, 0, 0, true);
      expect(p.ready).toBe(false);
      p.update(15, 0, 0, 0, true);
      expect(p.ready).toBe(true);
    },
  );

  it('keeps the gaze through jumps and crossing the ring, fades outside its range, then rearms', () => {
    const p = new Prayer();
    p.update(0, 0, 0, 0, true);
    p.update(7, 0, 0, 0, true);
    p.invoke(7);
    p.update(8, BEAM_RADIUS, 0, 0, false);
    expect(p.light).toBe(1);
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
