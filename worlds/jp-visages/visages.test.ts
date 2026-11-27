import { describe, expect, it } from 'vitest';
import {
  buildVisageScenePlan,
  createVisageCollider,
  ENTRANCE_Z,
  EXIT_Z,
  HEAD_PAIR_HALF_COUNT,
  HEAD_ROW_X,
  HEAD_SPACING,
  PATH_HALF_WIDTH,
  terrainHeightAt,
} from './layout';
import { NOISE_SIZE, visageNoisePixels } from './noise';

describe('jp-visages layout and collider', () => {
  const plan = buildVisageScenePlan();

  it('places two opposing rows of upright heads facing inward well past both portals', () => {
    const expectedPairs = HEAD_PAIR_HALF_COUNT * 2 + 1;
    expect(plan.heads).toHaveLength(expectedPairs * 2);

    const left = plan.heads.filter(h => h.side === -1);
    const right = plan.heads.filter(h => h.side === 1);
    expect(left).toHaveLength(expectedPairs);
    expect(right).toHaveLength(expectedPairs);

    for (const h of left) {
      expect(h.x).toBeLessThan(-HEAD_ROW_X + 1);
      expect(h.yaw).toBeCloseTo(Math.PI / 2, 6);
    }
    for (const h of right) {
      expect(h.x).toBeGreaterThan(HEAD_ROW_X - 1);
      expect(h.yaw).toBeCloseTo(-Math.PI / 2, 6);
    }

    const minZ = Math.min(...plan.heads.map(h => h.z));
    const maxZ = Math.max(...plan.heads.map(h => h.z));
    expect(minZ).toBeLessThan(EXIT_Z - 200);
    expect(maxZ).toBeGreaterThan(ENTRANCE_Z + 200);
    expect(maxZ - minZ).toBeGreaterThanOrEqual(HEAD_PAIR_HALF_COUNT * 2 * HEAD_SPACING - 4);
  });

  it('keeps the central portal-to-portal path level at y = 0 and clear of obstacles', () => {
    for (let z = EXIT_Z - 10; z <= ENTRANCE_Z + 10; z += 2.5) {
      for (const x of [-PATH_HALF_WIDTH + 0.5, -2, 0, 2, PATH_HALF_WIDTH - 0.5]) {
        expect(terrainHeightAt(x, z)).toBe(0);
      }
    }
    expect(terrainHeightAt(0, ENTRANCE_Z)).toBe(0);
    expect(terrainHeightAt(0, EXIT_Z)).toBe(0);

    // No rubble right inside either portal threshold.
    for (const r of plan.rubble) {
      const nearEntrance = Math.abs(r.x) < 4 && Math.abs(r.z - ENTRANCE_Z) < 5;
      const nearExit = Math.abs(r.x) < 4 && Math.abs(r.z - EXIT_Z) < 5;
      expect(nearEntrance || nearExit).toBe(false);
    }
  });

  it('slides players out of colossal heads while leaving the central corridor unobstructed', () => {
    const collider = createVisageCollider(plan.heads, plan.pillars);

    // Walking straight down the center path is never blocked.
    for (let z = EXIT_Z; z <= ENTRANCE_Z; z += 4) {
      const [nx, nz] = collider.move([0, 0, z], [0, 0, z - 1], 0.45, 1.7);
      expect(nx).toBeCloseTo(0, 6);
      expect(nz).toBeCloseTo(z - 1, 6);
    }

    // Walking into the front of a colossal head pushes the player outside its solid radius.
    const sample = plan.heads[0];
    const [px, pz] = collider.move(
      [0, 0, sample.colliderZ],
      [sample.colliderX, 0, sample.colliderZ],
      0.45,
      1.7,
    );
    expect(Math.hypot(px - sample.colliderX, pz - sample.colliderZ)).toBeGreaterThanOrEqual(
      sample.colliderRadius + 0.44,
    );
  });

  it('generates a deterministic seamless procedural stone noise buffer', async () => {
    const pixels = await visageNoisePixels();
    expect(pixels.length).toBe(NOISE_SIZE * NOISE_SIZE * 4);
    let sum = 0;
    for (let i = 0; i < pixels.length; i += 64) sum += pixels[i];
    expect(sum).toBeGreaterThan(0);
  });
});
