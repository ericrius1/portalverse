import { describe, expect, it } from 'vitest';
import { NO_GROUND, seededRandom } from '@portalverse/core/rooms/kit';
import {
  GATE_Z,
  PATH_END,
  PATH_HALF_WIDTH,
  Walkway,
  buildPathStones,
  buildStrayStones,
  centreline,
  distanceToPath,
  pathX,
  distanceToPolygon,
  pathY,
  pointInPolygon,
  sampleAt,
  polygonArea,
  stoneMotion,
  stoneTopAt,
} from './path';

const line = centreline();
const stones = buildPathStones(seededRandom(7), line);
const walkway = new Walkway(stones);
const times = [0, 1.3, 7.7, 42.1, 300.5];

describe('abyss path', () => {
  it('runs straight and level through both gates and passes the default spawn', () => {
    for (const z of [GATE_Z, -GATE_Z, 40, -40]) {
      expect(pathX(z)).toBe(0);
      expect(pathY(z)).toBe(0);
    }
    expect(pathX(0)).toBeCloseTo(0, 9);
    expect(pathY(0)).toBeCloseTo(0, 9);
  });

  it('meets the straight runs without a kink', () => {
    for (const z of [31.999, -31.999]) {
      expect(Math.abs(pathX(z))).toBeLessThan(1e-3);
      expect(Math.abs((pathX(z) - pathX(z - Math.sign(z) * 0.01)) / 0.01)).toBeLessThan(0.01);
    }
  });

  it('cuts convex stones that never overlap', () => {
    expect(stones.length).toBeGreaterThan(100);
    for (const stone of stones) {
      expect(polygonArea(stone.polygon)).toBeGreaterThan(0.3);
      expect(pointInPolygon(stone.polygon, stone.cx, stone.cz)).toBe(true);
    }
    for (const a of stones) {
      for (const b of stones) {
        if (a === b || Math.hypot(a.cx - b.cx, a.cz - b.cz) > a.radius + b.radius) continue;
        for (const [x, z] of a.polygon) expect(pointInPolygon(b.polygon, x, z)).toBe(false);
      }
    }
  });

  it('has ground along the middle of the path, gaps included', () => {
    // Further out, an occasional missing edge stone leaves a hole to fall through.
    for (let i = 0; i < line.length; i += 2) {
      const p = line[i];
      for (const t of [-1, -0.5, 0, 0.5, 1]) {
        const x = p.x - p.tz * t;
        const z = p.z + p.tx * t;
        expect(walkway.heightAt(x, z, 5), `no ground at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThan(-2);
      }
    }
  });

  it('keeps the stones at the gates still and level', () => {
    for (const t of times) {
      for (const z of [GATE_Z, -GATE_Z]) {
        for (const x of [-1.5, 0, 1.5]) expect(walkway.heightAt(x, z, t)).toBeCloseTo(0, 9);
      }
    }
  });

  it('drifts the middle stones a little, and puts you on top of the stone under you', () => {
    const moving = stones.filter(s => s.amp > 0);
    expect(moving.length).toBeGreaterThan(stones.length / 2);
    for (const stone of moving) {
      for (const t of times) expect(Math.abs(stoneMotion(stone, t).rise)).toBeLessThanOrEqual(stone.amp + 1e-9);
    }
    // Well inside a stone, its neighbours don't pull on the height.
    const roomy = moving.filter(s => s.polygon.every((_, i) => {
      const a = s.polygon[i];
      const b = s.polygon[(i + 1) % s.polygon.length];
      const ex = b[0] - a[0];
      const ez = b[1] - a[1];
      return Math.abs((s.cx - a[0]) * ez - (s.cz - a[1]) * ex) / Math.hypot(ex, ez) > 0.65;
    }));
    expect(roomy.length).toBeGreaterThan(10);
    for (const stone of roomy) {
      for (const t of times) expect(walkway.heightAt(stone.cx, stone.cz, t)).toBeCloseTo(stoneTopAt(stone, stone.cx, stone.cz, t), 2);
    }
    expect(Math.abs(walkway.heightAt(0, 0, 0))).toBeLessThan(0.25);
  });

  it('changes height smoothly underfoot, with no steps at the gaps', () => {
    for (const t of times) {
      for (const across of [-1, 0, 1]) {
        let last: number | undefined;
        for (let s = 0; s < line[line.length - 1].s; s += 0.05) {
          const p = sampleAt(line, s);
          const h = walkway.heightAt(p.x - p.tz * across, p.z + p.tx * across, t);
          if (last !== undefined) expect(Math.abs(h - last)).toBeLessThan(0.04);
          last = h;
        }
      }
    }
  });

  it('has no ground past the edge of the path or beyond its ends', () => {
    for (const i of [Math.floor(line.length / 3), Math.floor(line.length / 2), Math.floor((2 * line.length) / 3)]) {
      const p = line[i];
      for (const side of [-1, 1]) {
        const x = p.x - p.tz * side * (PATH_HALF_WIDTH + 4);
        const z = p.z + p.tx * side * (PATH_HALF_WIDTH + 4);
        expect(walkway.heightAt(x, z, 3)).toBe(NO_GROUND);
      }
    }
    expect(walkway.heightAt(0, PATH_END + 3, 0)).toBe(NO_GROUND);
    expect(walkway.heightAt(0, -PATH_END - 3, 0)).toBe(NO_GROUND);
    const stone = stones[0];
    expect(distanceToPolygon(stone.polygon, stone.cx, stone.cz)).toBe(0);
  });

  it('keeps loose stones clear of the path and the views through the gates', () => {
    for (const stone of buildStrayStones(seededRandom(8), line)) {
      expect(stone.walkable).toBe(false);
      expect(distanceToPath(line, stone.cx, stone.cz)).toBeGreaterThan(7);
      if (Math.abs(stone.cz) > 26) expect(Math.abs(stone.cx)).toBeGreaterThanOrEqual(7 - stone.radius);
    }
  });
});
