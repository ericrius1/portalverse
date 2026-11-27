import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  buildVisageSynthesisPlan,
  createVisageCollider,
  ENTRANCE_Z,
  EXIT_Z,
  HEAD_PAIR_HALF_COUNT,
  HEAD_ROW_X,
  HEAD_SPACING,
  NEAR_LOD_Z,
  PATH_FLAT_HALF_WIDTH,
  terrainHeightAt,
} from './layout';
import {
  COBBLE_TEX_SIZE,
  cobbleMapPixels,
  ENV_SKY_HEIGHT,
  ENV_SKY_WIDTH,
  reflectionSkyPixels,
  STONE_NOISE_SIZE,
  stoneNoisePixels,
} from './textures';
import { decimateGeometry } from './headGeometry';

describe('jp-visages-synthesis layout, terrain, and collider', () => {
  const plan = buildVisageSynthesisPlan();

  it('places two endless opposing rows of upright heads facing inward well past both portals', () => {
    const expectedPairs = HEAD_PAIR_HALF_COUNT * 2 + 1;
    expect(plan.heads).toHaveLength(expectedPairs * 2);

    const left = plan.heads.filter(h => h.side === -1);
    const right = plan.heads.filter(h => h.side === 1);
    expect(left).toHaveLength(expectedPairs);
    expect(right).toHaveLength(expectedPairs);

    for (const h of left) {
      expect(h.x).toBeLessThan(-HEAD_ROW_X + 1.5);
      expect(Math.abs(h.yaw - Math.PI / 2)).toBeLessThan(0.1);
    }
    for (const h of right) {
      expect(h.x).toBeGreaterThan(HEAD_ROW_X - 1.5);
      expect(Math.abs(h.yaw + Math.PI / 2)).toBeLessThan(0.1);
    }

    // Endless procession stretches well past both portals (±36.25 m) and splits into near + far LOD.
    const minZ = Math.min(...plan.heads.map(h => h.z));
    const maxZ = Math.max(...plan.heads.map(h => h.z));
    expect(minZ).toBeLessThan(EXIT_Z - 320);
    expect(maxZ).toBeGreaterThan(ENTRANCE_Z + 320);
    expect(maxZ - minZ).toBeGreaterThanOrEqual(HEAD_PAIR_HALF_COUNT * 2 * HEAD_SPACING - 6);

    const nearCount = plan.heads.filter(h => Math.abs(h.z) <= NEAR_LOD_Z).length;
    const farCount = plan.heads.filter(h => Math.abs(h.z) > NEAR_LOD_Z).length;
    expect(nearCount).toBeGreaterThan(20);
    expect(farCount).toBeGreaterThan(10);

    // Varied weeping and asymmetric crack attributes across statues.
    const distinctCrackAngles = new Set(plan.heads.map(h => Math.round(h.crackAngle * 10)));
    expect(distinctCrackAngles.size).toBeGreaterThan(15);
    expect(plan.heads.some(h => h.weeping > 0.5)).toBe(true);
    expect(plan.heads.some(h => h.weeping < 0.2)).toBe(true);
  });

  it('keeps the central portal-to-portal path dead level at y = 0 and clear of obstacles', () => {
    for (let z = EXIT_Z - 20; z <= ENTRANCE_Z + 20; z += 2.5) {
      for (const x of [-PATH_FLAT_HALF_WIDTH + 0.5, -2, 0, 2, PATH_FLAT_HALF_WIDTH - 0.5]) {
        expect(terrainHeightAt(x, z)).toBe(0);
      }
    }
    expect(terrainHeightAt(0, ENTRANCE_Z)).toBe(0);
    expect(terrainHeightAt(0, EXIT_Z)).toBe(0);

    // Uneven sculpted dirt banks rise beside the path outside PATH_FLAT_HALF_WIDTH.
    const bankHeights = [-20, -5, 10, 25].map(z => terrainHeightAt(12, z));
    expect(Math.min(...bankHeights)).toBeGreaterThan(0.1);
    expect(Math.max(...bankHeights) - Math.min(...bankHeights)).toBeGreaterThan(0.15);

    // No rubble right inside either portal threshold.
    for (const r of plan.rubble) {
      const nearEntrance = Math.abs(r.x) < 4.5 && Math.abs(r.z - ENTRANCE_Z) < 5.5;
      const nearExit = Math.abs(r.x) < 4.5 && Math.abs(r.z - EXIT_Z) < 5.5;
      expect(nearEntrance || nearExit).toBe(false);
    }
  });

  it('slides players out of colossal heads while leaving the central corridor unobstructed', () => {
    const collider = createVisageCollider(plan.heads, plan.pillars);

    for (let z = EXIT_Z; z <= ENTRANCE_Z; z += 4) {
      const [nx, nz] = collider.move([0, 0, z], [0, 0, z - 1], 0.45, 1.7);
      expect(nx).toBeCloseTo(0, 6);
      expect(nz).toBeCloseTo(z - 1, 6);
    }

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
});

describe('jp-visages-synthesis procedural textures and LOD decimation', () => {
  it('builds a coherent single-layer cobblestone atlas, non-Voronoi grain map, and HDR reflection sky', async () => {
    const [cobble, grain, sky] = await Promise.all([
      cobbleMapPixels(),
      stoneNoisePixels(),
      reflectionSkyPixels([-0.24, 0.72, -0.65]),
    ]);

    expect(cobble.length).toBe(COBBLE_TEX_SIZE * COBBLE_TEX_SIZE * 4);
    expect(grain.length).toBe(STONE_NOISE_SIZE * STONE_NOISE_SIZE * 4);
    expect(sky.length).toBe(ENV_SKY_WIDTH * ENV_SKY_HEIGHT * 4);

    // Cobble atlas has distinct mortar seams (low R), stone interiors (high R), varied stone IDs (G),
    // raised crowns (B), and sparse within-stone fractures (A > 0 on a minority of texels).
    let mortarCount = 0;
    let stoneCount = 0;
    let fractureCount = 0;
    const distinctIds = new Set<number>();
    for (let i = 0; i < cobble.length; i += 16) {
      const edge = cobble[i];
      const id = cobble[i + 1];
      const fracture = cobble[i + 3];
      if (edge < 20) mortarCount++;
      if (edge > 120) {
        stoneCount++;
        distinctIds.add(id);
      }
      if (fracture > 64) fractureCount++;
    }
    expect(mortarCount).toBeGreaterThan(100);
    expect(stoneCount).toBeGreaterThan(1000);
    expect(distinctIds.size).toBeGreaterThan(20);
    // Rare within-stone fractures should cover only a small fraction of stone texels.
    expect(fractureCount).toBeGreaterThan(20);
    expect(fractureCount).toBeLessThan(stoneCount * 0.25);

    // HDR reflection sky contains bright moon radiance (> 2.0) and dark midnight tones (< 0.1).
    let maxVal = 0;
    let minVal = Infinity;
    for (let i = 0; i < sky.length; i += 4) {
      if (sky[i + 2] > maxVal) maxVal = sky[i + 2];
      if (sky[i] < minVal) minVal = sky[i];
    }
    expect(maxVal).toBeGreaterThan(2.0);
    expect(minVal).toBeLessThan(0.1);
  });

  it('decimates a high-detail mesh cleanly for distant LOD heads', async () => {
    const sphere = new THREE.SphereGeometry(2, 32, 24);
    const far = await decimateGeometry(sphere, 0.5, async () => {});
    const srcTris = sphere.index!.count / 3;
    const farTris = far.index!.count / 3;
    expect(farTris).toBeGreaterThan(20);
    expect(farTris).toBeLessThan(srcTris * 0.6);
    sphere.dispose();
    far.dispose();
  });
});
