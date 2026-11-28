import { describe, expect, it } from 'vitest';
import { createPlatterFrame, GLYPH_PIXELS, RING_PIXELS } from './cues';
import { rackField } from './layout';
import { sampleSolo, soloEvent, SPECIALS } from './specials';

describe('white solo sequences', () => {
  it('visits every module once on each platter, top to bottom, with only one zero lit', () => {
    for (const count of [7, 13]) {
      for (let lap = 0; lap < count; lap++) {
        for (let module = 0; module < RING_PIXELS / GLYPH_PIXELS; module++) {
          const time = (lap + (module + 0.5) / 32) * SPECIALS.lapSeconds;
          let lit = 0;
          for (let platter = 0; platter < count; platter++) {
            const frame = createPlatterFrame();
            sampleSolo({ rack: 0, kind: 'descent', time, seed: 0 }, platter, count, frame);
            if (frame.intensity) {
              lit++;
              expect(platter).toBe(count - 1 - lap);
              expect(frame.head).toBe(module * GLYPH_PIXELS);
              expect(frame.tail).toBe(0);
              expect(frame.heads).toBe(1);
            }
          }
          expect(lit).toBe(1);
        }
      }
    }
  });

  it('alternates bounded solo events with quiet gaps on real nearby racks', () => {
    const racks = rackField();
    const candidates = racks.flatMap((r, i) => Math.abs(r.x) < 13 && Math.abs(r.z) < 30 ? [i] : []);
    const counts = racks.map(r => r.platters);
    expect(candidates.length).toBeGreaterThan(1);
    for (let slot = 0; slot < 20; slot++) {
      const start = slot * SPECIALS.interval;
      expect(soloEvent(start, candidates, counts)).toBeNull();
      const event = soloEvent(start + 8, candidates, counts)!;
      expect(candidates).toContain(event.rack);
      expect(event.kind).toBe(slot % 2 ? 'descent' : 'sparkle');
      expect(soloEvent(start + 8, candidates, counts)).toEqual(event);
      expect(soloEvent(start + 22, candidates, counts)).toBeNull();
    }
  });

  it('sparkles independently, with dark intervals and repeatable module-aligned flashes', () => {
    const heads = new Set<number>();
    let lit = 0;
    let dark = 0;
    let differing = 0;
    for (let i = 0; i < 600; i++) {
      const event = { rack: 0, kind: 'sparkle' as const, time: i / 100, seed: 4 };
      const frame = createPlatterFrame();
      sampleSolo(event, 0, 13, frame);
      const again = createPlatterFrame();
      sampleSolo(event, 0, 13, again);
      expect(again).toEqual(frame);
      expect(frame.head % GLYPH_PIXELS).toBe(0);
      expect(frame.intensity).toBeGreaterThanOrEqual(0);
      expect(frame.intensity).toBeLessThanOrEqual(1);
      if (frame.intensity) { lit++; heads.add(frame.head); } else dark++;
      sampleSolo(event, 1, 13, again);
      if (again.intensity !== frame.intensity) differing++;
    }
    expect(heads.size).toBeGreaterThan(10);
    expect(lit).toBeGreaterThan(100);
    expect(dark).toBeGreaterThan(100);
    expect(differing).toBeGreaterThan(100);
  });
});
