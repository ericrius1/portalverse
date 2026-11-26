import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { PlatformCollider, WorldContext } from '@portalverse/core/types';
import { seededRandom } from '@portalverse/core/rooms/kit';
import { threshold } from '@portalverse/core/portal/roomLayout';
import {
  BEE_BELOW,
  BEE_HOVER_Y,
  BEE_MOUTH,
  HYDRANT,
  JUMP_REACH,
  PUDDLE_LIFE,
  ROAD_HALF_WIDTH,
  createDrip,
  createHunt,
  goldenPlantSpots,
  puddleSize,
  roadCenterX,
  roadDistance,
  stepDrip,
  stepHunt,
  treeSpots,
  type Point,
} from './logic';
import { TILE_COUNT, TILE_FADE, roadPoint, stepGlow, tileAt, tileBounds, tileCenter } from './tiles';

const DT = 1 / 60;

/** The room draws its sign on a canvas, which Node lacks. Records the text drawn. */
function stubCanvas(): string[] {
  const written: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get: (target, key: string) =>
      target[key] ?? (key === 'fillText' ? (text: string) => written.push(text) : () => {}),
    set: (target, key: string, value) => { target[key] = value; return true; },
  });
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => context }),
  });
  return written;
}
beforeEach(() => { stubCanvas(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('road', () => {
  it('meets both portals head on', () => {
    for (const end of ['entrance', 'exit'] as const) {
      expect(roadCenterX(threshold(end).position[2])).toBeCloseTo(0, 5);
    }
  });

  it('twists back and forth between them', () => {
    let turns = 0;
    let previous = 0;
    for (let z = -32; z < 32; z += 0.5) {
      const slope = Math.sign(roadCenterX(z + 0.5) - roadCenterX(z));
      if (slope && previous && slope !== previous) turns++;
      if (slope) previous = slope;
    }
    expect(turns).toBeGreaterThanOrEqual(5);
    const xs = Array.from({ length: 129 }, (_, i) => roadCenterX(-32 + i * 0.5));
    expect(Math.max(...xs)).toBeGreaterThan(4);
    expect(Math.min(...xs)).toBeLessThan(-4);
  });
});

describe('road edges', () => {
  it('bends gently enough that the inside edge never folds over itself', () => {
    const e = 0.01;
    for (let z = -46; z <= 46; z += 0.1) {
      const [a, b, c] = [roadCenterX(z - e), roadCenterX(z), roadCenterX(z + e)];
      const slope = (c - a) / (2 * e);
      const bend = Math.abs(c - 2 * b + a) / (e * e);
      const radius = (1 + slope * slope) ** 1.5 / bend;
      expect(radius, `at z=${z.toFixed(1)}`).toBeGreaterThan(ROAD_HALF_WIDTH + 0.15);
    }
  });
});

describe('scenery placement', () => {
  it('puts the hydrant near the middle, off the road and clear of the central corridor', () => {
    expect(Math.abs(HYDRANT.x)).toBeGreaterThan(4);
    expect(Math.hypot(HYDRANT.x, HYDRANT.z)).toBeLessThan(10);
    expect(roadDistance(HYDRANT.x, HYDRANT.z)).toBeGreaterThan(ROAD_HALF_WIDTH + 1);
  });

  it('surrounds the room with trees that stay off the road and corridor', () => {
    const trees = treeSpots(seededRandom(1));
    expect(trees.some(t => t.x < -10)).toBe(true);
    expect(trees.some(t => t.x > 10)).toBe(true);
    expect(trees.some(t => t.z < -40)).toBe(true);
    expect(trees.some(t => t.z > 40)).toBe(true);
    for (const t of trees) {
      if (Math.abs(t.z) <= 47) expect(Math.abs(t.x)).toBeGreaterThan(10);
    }
  });

  it('keeps golden plants off the road, the corridor and the hydrant', () => {
    const plants = goldenPlantSpots(seededRandom(2));
    expect(plants.length).toBeGreaterThan(60);
    for (const p of plants) {
      expect(Math.abs(p.x)).toBeGreaterThan(4);
      expect(roadDistance(p.x, p.z)).toBeGreaterThan(ROAD_HALF_WIDTH);
      expect(Math.hypot(p.x - HYDRANT.x, p.z - HYDRANT.z)).toBeGreaterThan(1.5);
    }
  });
});

describe('honey', () => {
  it('falls, leaves a puddle that is gone within a few seconds, then drips again', () => {
    const rand = seededRandom(3);
    const drip = createDrip({ x: 12, y: 15, z: 0 }, rand);
    const history: string[] = [];
    let puddleSeconds = 0;
    for (let i = 0; i < 60 * 40; i++) {
      stepDrip(drip, DT, rand);
      if (history.at(-1) !== drip.phase) history.push(drip.phase);
      if (drip.phase === 'puddle') puddleSeconds += DT;
      expect(drip.y).toBeGreaterThanOrEqual(0);
    }
    expect(history.join(' ')).toContain('falling puddle waiting falling puddle');
    const puddles = history.filter(p => p === 'puddle').length;
    expect(puddleSeconds / puddles).toBeLessThanOrEqual(PUDDLE_LIFE + 2 * DT);
    expect(PUDDLE_LIFE).toBeLessThanOrEqual(5);
  });

  it('grows a puddle from nothing and shrinks it back to nothing', () => {
    expect(puddleSize(0)).toBe(0);
    expect(puddleSize(PUDDLE_LIFE / 2)).toBe(1);
    expect(puddleSize(PUDDLE_LIFE)).toBe(0);
  });
});

describe('bee and birds', () => {
  const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

  it('hovers just out of jump height', () => {
    const clearance = BEE_HOVER_Y - BEE_BELOW - JUMP_REACH;
    expect(clearance).toBeGreaterThan(0);
    expect(clearance).toBeLessThan(1);
  });

  const huntSeeds = Array.from({ length: 12 }, (_, i) => i + 1);
  it.each(huntSeeds)('eats each bird without dropping low or teleporting (seed %i)', seed => {
    const rand = seededRandom(seed);
    const hunt = createHunt(rand);
    let spawned = 0;
    let eaten = 0;
    let age = 0;
    for (let i = 0; i < 60 * 120; i++) {
      const before = { ...hunt.bee };
      const event = stepHunt(hunt, DT, rand);
      if (event === 'spawn') { spawned++; age = 0; }
      if (event === 'eat') {
        eaten++;
        expect(distance(hunt.bee, hunt.bird!)).toBeLessThanOrEqual(BEE_MOUTH + 0.5);
      }
      if (hunt.mode === 'hunting') age += DT;
      expect(age).toBeLessThan(10);
      expect(hunt.bee.y).toBeGreaterThanOrEqual(BEE_HOVER_Y);
      expect(distance(before, hunt.bee)).toBeLessThan(0.4);
      // Over the open middle of the room, clear of trunks and branches.
      for (const thing of [hunt.bee, hunt.bird]) {
        if (!thing) continue;
        expect(Math.abs(thing.x)).toBeLessThanOrEqual(7);
        expect(Math.abs(thing.z)).toBeLessThanOrEqual(30);
        expect(thing.y).toBeLessThanOrEqual(BEE_HOVER_Y + 3.5);
      }
    }
    expect(spawned).toBeGreaterThanOrEqual(5);
    expect(spawned - eaten).toBeLessThanOrEqual(1);
  });

  it('removes the bird after chewing and goes back to patrolling', () => {
    const rand = seededRandom(5);
    const hunt = createHunt(rand);
    while (stepHunt(hunt, DT, rand) !== 'eat');
    expect(hunt.mode).toBe('eating');
    for (let i = 0; i < 90; i++) stepHunt(hunt, DT, rand);
    expect(hunt.mode).toBe('patrol');
    expect(hunt.bird).toBeNull();
  });
});

describe('room', () => {
  it('mounts with a walkable path and a bee out of reach, and cleans up after itself', async () => {
    const { default: room } = await import('./index');
    const scene = new THREE.Scene();
    const platforms: PlatformCollider[] = [];
    const updates: Array<(dt: number, elapsed: number) => void> = [];
    const cleanups: Array<() => void> = [];
    await room.mount({
      scene,
      mode: 'preview',
      player: null,
      addPlatform: (p: PlatformCollider) => platforms.push(p),
      onUpdate: (fn: (dt: number, elapsed: number) => void) => updates.push(fn),
      onDispose: (fn: () => void) => cleanups.push(fn),
    } as unknown as WorldContext);

    expect(room.manifest.name).toBe('Honey in da Hood Ya Heard');
    expect(platforms).toContainEqual(expect.objectContaining({ topY: 0, minZ: -46, maxZ: 46 }));
    const bee = scene.getObjectByName('bee')!;
    for (let i = 0; i < 60 * 30; i++) {
      for (const update of updates) update(DT, i * DT);
      if (i % 90 === 0) {
        scene.updateMatrixWorld(true);
        expect(new THREE.Box3().setFromObject(bee).min.y).toBeGreaterThan(JUMP_REACH);
      }
    }
    for (const name of ['bee-jacket', 'bee-tie', 'fire-hydrant', 'golden-plants', 'honey-puddles', 'road']) {
      expect(scene.getObjectByName(name), name).toBeDefined();
    }

    const disposed = vi.fn();
    let resources = 0;
    const seen = new Set<unknown>();
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      // Every sprite shares three's own geometry, which is not the room's to dispose.
      const geometry = (object as THREE.Sprite).isSprite ? undefined : mesh.geometry;
      for (const r of [geometry, mesh.material as THREE.Material | undefined]) {
        if (r && !seen.has(r)) {
          seen.add(r);
          resources++;
          r.addEventListener('dispose' as never, disposed);
        }
      }
    });
    for (const cleanup of cleanups) cleanup();
    expect(disposed).toHaveBeenCalledTimes(resources);
    expect(scene.children).toHaveLength(0);
  });
});

describe('road tiles', () => {
  it('pave the whole road with large slabs that span its width', () => {
    for (let i = 0; i < TILE_COUNT; i++) {
      const { from, to, left, right } = tileBounds(i);
      // Long enough that the far end of your slab shows in first person.
      expect(to - from).toBeGreaterThan(4.5);
      expect(to - from).toBeLessThan(5.6);
      expect(right - left).toBeGreaterThan(2);
      for (const offset of [left + 0.1, 0, right - 0.1]) {
        const { x, z } = roadPoint((from + to) / 2, offset);
        expect(tileAt(x, z), `tile ${i}`).toBe(i);
      }
    }
    for (let z = -45; z <= 45; z += 0.1) expect(tileAt(roadCenterX(z), z)).toBeGreaterThanOrEqual(0);
  });

  it('has nothing to step on beside or beyond the road', () => {
    expect(tileAt(HYDRANT.x, HYDRANT.z)).toBe(-1);
    expect(tileAt(roadCenterX(0) + 3, 0)).toBe(-1);
    expect(tileAt(0, 60)).toBe(-1);
    expect(tileAt(0, -60)).toBe(-1);
  });

  it('lights the tile underfoot at once and fades it out after you leave', () => {
    const glow = new Float32Array(3);
    expect(stepGlow(glow, 1, DT)).toBe(true);
    expect([...glow]).toEqual([0, 1, 0]);
    stepGlow(glow, 2, TILE_FADE / 2);
    expect(glow[1]).toBeCloseTo(0.5);
    expect(glow[2]).toBe(1);
    stepGlow(glow, -1, TILE_FADE);
    expect([...glow]).toEqual([0, 0, 0]);
    expect(stepGlow(glow, -1, DT)).toBe(false);
  });

  it('light under a player on foot, but not under one in the air', async () => {
    const { default: room } = await import('./index');
    const scene = new THREE.Scene();
    const updates: Array<(dt: number, elapsed: number) => void> = [];
    const cleanups: Array<() => void> = [];
    let player: { position: THREE.Vector3 } | null = null;
    await room.mount({
      scene,
      get player() { return player; },
      addPlatform: () => {},
      onUpdate: (fn: (dt: number, elapsed: number) => void) => updates.push(fn),
      onDispose: (fn: () => void) => cleanups.push(fn),
    } as unknown as WorldContext);
    const geometry = (scene.getObjectByName('road-tiles') as THREE.Mesh).geometry;
    const glow = geometry.getAttribute('glow');
    const perTile = glow.count / TILE_COUNT;
    const glowOf = (tile: number) => glow.getX(tile * perTile);
    const brightest = () => Math.max(...(glow.array as Float32Array));
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += DT) for (const update of updates) update(DT, t);
    };

    const { x, z } = tileCenter(15);
    player = { position: new THREE.Vector3(x, 2, z) };
    run(0.2);
    expect(brightest()).toBe(0);

    player.position.y = 0;
    run(0.2);
    expect(glowOf(15)).toBe(1);
    expect(glowOf(16)).toBe(0);
    // Light also rises from the lit tile, and only from that one.
    const halo = (scene.getObjectByName('tile-glow') as THREE.Mesh).geometry;
    const rising = halo.getAttribute('glow');
    const perHalo = rising.count / TILE_COUNT;
    expect(rising.getX(15 * perHalo)).toBe(1);
    expect(rising.getX(16 * perHalo)).toBe(0);
    halo.computeBoundingBox();
    // Tall enough to see around you, but well below eye height (1.65 m).
    expect(halo.boundingBox!.max.y).toBeGreaterThan(0.9);
    expect(halo.boundingBox!.max.y).toBeLessThan(1.2);

    player = null;
    run(TILE_FADE / 2);
    expect(glowOf(15)).toBeGreaterThan(0.3);
    expect(glowOf(15)).toBeLessThan(0.7);
    run(TILE_FADE);
    expect(brightest()).toBe(0);
    for (const cleanup of cleanups) cleanup();
  });
});

describe('hydrant speech bubble', () => {
  it('says "honey time" in Japanese only while a player is near', async () => {
    const written = stubCanvas();
    const { default: room } = await import('./index');
    const scene = new THREE.Scene();
    const updates: Array<(dt: number, elapsed: number) => void> = [];
    const cleanups: Array<() => void> = [];
    let player: { position: THREE.Vector3 } | null = null;
    await room.mount({
      scene,
      get player() { return player; },
      addPlatform: () => {},
      onUpdate: (fn: (dt: number, elapsed: number) => void) => updates.push(fn),
      onDispose: (fn: () => void) => cleanups.push(fn),
    } as unknown as WorldContext);
    const bubble = scene.getObjectByName('speech-bubble') as THREE.Sprite;
    const stand = (x: number, y: number, z: number) => {
      player = { position: new THREE.Vector3(x, y, z) };
      for (const update of updates) update(DT, 0);
    };

    expect(written).toContain('はちみつタイム');
    expect(bubble.visible).toBe(false);
    stand(HYDRANT.x - 3, 0, HYDRANT.z);
    expect(bubble.visible).toBe(true);
    stand(HYDRANT.x - 12, 0, HYDRANT.z);
    expect(bubble.visible).toBe(false);
    stand(HYDRANT.x, 20, HYDRANT.z);
    expect(bubble.visible, 'flying high above').toBe(false);
    stand(HYDRANT.x, 0, HYDRANT.z + 3);
    player = null;
    for (const update of updates) update(DT, 0);
    expect(bubble.visible).toBe(false);

    const disposed = vi.fn();
    bubble.material.map!.addEventListener('dispose', disposed);
    for (const cleanup of cleanups) cleanup();
    expect(disposed).toHaveBeenCalledOnce();
  });
});
