import { describe, expect, it } from 'vitest';
import { decimate, processHead } from './headModel';
import {
  HEAD_SCALE,
  PATH_FLAT,
  PORTAL_Z,
  ROW_REACH,
  WALK_HALF_WIDTH,
  bloodPools,
  headPlacements,
  poolOutline,
  stones,
  terrainHeight,
} from './layout';

/** A closed box (8 corners, 12 triangles), offset by `o`. */
function box(o: [number, number, number], s: number) {
  const position: number[] = [];
  for (let i = 0; i < 8; i++) position.push(o[0] + (i & 1 ? s : 0), o[1] + (i & 2 ? s : 0), o[2] + (i & 4 ? s : 0));
  const faces = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  return { position, faces };
}

describe('visages layout', () => {
  it('keeps the path level through both portals', () => {
    for (const z of [PORTAL_Z, -PORTAL_Z, 0]) {
      for (let x = -PATH_FLAT; x <= PATH_FLAT; x += 0.5) expect(terrainHeight(x, z)).toBe(0);
    }
  });

  it('lines the path with two facing rows that run far past both portals', () => {
    const heads = headPlacements();
    const left = heads.filter(h => h.x < 0);
    const right = heads.filter(h => h.x > 0);
    expect(left.length).toBe(right.length);
    for (const h of left) expect(Math.cos(h.yaw - Math.PI / 2)).toBeGreaterThan(0.95);
    for (const h of right) expect(Math.cos(h.yaw + Math.PI / 2)).toBeGreaterThan(0.95);
    const zs = heads.map(h => h.z);
    expect(Math.min(...zs)).toBeLessThan(-ROW_REACH + 50);
    expect(Math.max(...zs)).toBeGreaterThan(ROW_REACH - 50);
    // Even the biggest head's nose (~2.8 model units ahead of its centre) stays out of reach.
    for (const h of heads) expect(Math.abs(h.x) - 2.9 * HEAD_SCALE * h.scale).toBeGreaterThan(WALK_HALF_WIDTH);
  });

  it('puts the blood pools on the level path, apart from each other and clear of the portals', () => {
    const pools = bloodPools();
    expect(pools.length).toBeGreaterThan(15);
    for (const pool of pools) {
      for (const point of poolOutline(pool)) {
        expect(Math.abs(point.x)).toBeLessThan(PATH_FLAT);
        expect(Math.abs(Math.abs(point.z) - PORTAL_Z)).toBeGreaterThan(1);
      }
    }
  });

  it('beds stones into the ground', () => {
    for (const s of stones(4).slice(0, 200)) expect(s.y).toBeLessThan(terrainHeight(s.x, s.z) + s.sy * 0.5);
  });
});

describe('head model processing', () => {
  it('splits loose eyeballs from the skin, centres between the eyes and trims buried triangles', async () => {
    const skin = box([-3, 0, -2], 6);
    const eyeA = box([-1.5, 6, 3.5], 1);
    const eyeB = box([0.5, 6, 3.5], 1);
    const position = new Float32Array([...skin.position, ...eyeA.position, ...eyeB.position]);
    const index = [...skin.faces, ...eyeA.faces.map(i => i + 8), ...eyeB.faces.map(i => i + 16)];
    const normal = new Float32Array(position.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0));
    const parts = await processHead(position, normal, index, { trimBelowY: 1, farCell: 0.5 });
    expect(parts.eyes.index.length).toBe(72);
    expect(parts.eyeCenters).toHaveLength(2);
    expect(parts.eyeCenters[0][0]).toBeCloseTo(-1, 5);
    expect(parts.eyeCenters[1][0]).toBeCloseTo(1, 5);
    // The bottom face of the skin box lies entirely below y = 1 and is dropped.
    expect(parts.skin.index.length).toBe(36 - 6);
  });

  it('decimates without leaving degenerate triangles', async () => {
    const rows = 40;
    const position: number[] = [];
    const normal: number[] = [];
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= rows; i++) {
      position.push(i / rows, 0, j / rows);
      normal.push(0, 1, 0);
    }
    const index: number[] = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < rows; i++) {
      const a = j * (rows + 1) + i;
      index.push(a, a + rows + 1, a + 1, a + 1, a + rows + 1, a + rows + 2);
    }
    const part = { position: new Float32Array(position), normal: new Float32Array(normal), index: new Uint32Array(index) };
    const coarse = await decimate(part, 0.1);
    expect(coarse.index.length).toBeLessThan(part.index.length / 4);
    for (let t = 0; t < coarse.index.length; t += 3) {
      const [a, b, c] = coarse.index.slice(t, t + 3);
      expect(new Set([a, b, c]).size).toBe(3);
    }
  });
});
