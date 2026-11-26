import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { RoomCollider, TerrainHeight, WorldContext } from '@portalverse/core/types';
import { threshold } from '@portalverse/core/portal/roomLayout';
import {
  ARM_SWING,
  FREEZE_SECONDS,
  GUST_SECONDS,
  HOLE_RADIUS,
  LAKE_Y,
  MONSTER_MAX_SPEED,
  MONSTER_REACH,
  PATH_HALF_WIDTH,
  PLATE_TOP,
  RIM_RADIUS,
  SWITCHES,
  confine,
  createClimate,
  createMonster,
  createPlates,
  createSlide,
  flip,
  groundAt,
  gustStrength,
  pathAt,
  slideStep,
  stepClimate,
  stepMonster,
  stepPlates,
  walkHeight,
  YELL_RANGE,
  YELL_SECONDS,
  createBurn,
  createYell,
  pathTiles,
  stepBurn,
  stepYell,
  tileKnit,
} from './logic';
import { seededRandom } from '@portalverse/core/rooms/kit';

const DT = 1 / 60;
const RADIUS = 0.35;

describe('layout', () => {
  it('is level at both portals and both switches', () => {
    for (const end of ['entrance', 'exit'] as const) {
      const [x, , z] = threshold(end).position;
      expect(walkHeight(x, z)).toBeCloseTo(0, 5);
      expect(groundAt(x, z).surface).toBe('path');
    }
    for (const s of SWITCHES) expect(walkHeight(s.plate.x, s.plate.z)).toBeCloseTo(0, 2);
  });

  it('has an unbroken walkable path from portal to portal along both arms', () => {
    for (const side of [-1, 1]) {
      for (let z = 36.25; z >= -36.25; z -= 0.25) {
        // Follow the centre line: straight, then around the hole.
        const x = Math.abs(z) >= 16 ? 0 : side * ARM_SWING * Math.cos((Math.PI * z) / 32);
        const g = groundAt(x, z);
        expect(g.surface, `at ${x.toFixed(1)}, ${z}`).toBe('path');
        expect(g.y).toBeGreaterThanOrEqual(-0.01);
        // Hilly, but never more than a couple of metres up.
        expect(g.y).toBeLessThan(2);
        expect(Math.hypot(x, z)).toBeGreaterThan(RIM_RADIUS + RADIUS);
      }
    }
  });

  it('puts lakes beside the path, a short hop down', () => {
    let lakes = 0;
    for (let x = -22; x <= 22; x += 1) {
      for (let z = -40; z <= 40; z += 1) {
        const g = groundAt(x, z);
        if (g.surface !== 'lake') continue;
        lakes++;
        expect(Math.abs(g.y - LAKE_Y)).toBeLessThan(0.1);
      }
    }
    expect(lakes).toBeGreaterThan(300);
    // A lake right beside an arm.
    expect(groundAt(-18.5, 0).surface).toBe('lake');
    expect(pathAt(-18.5, 0).distance).toBeGreaterThan(3);
  });

  it('keeps players out of the hole and inside the cave', () => {
    const [x, z] = confine(1, 1, RADIUS);
    expect(Math.hypot(x, z)).toBeCloseTo(RIM_RADIUS + RADIUS, 5);
    const [wx, wz] = confine(40, 0, RADIUS);
    expect(Math.abs(wx)).toBeLessThan(25);
    expect(wz).toBe(0);
  });
});

describe('fire and ice', () => {
  it('starts on fire, freezes over a few seconds, and thaws back', () => {
    const c = createClimate();
    expect(c.mode).toBe('fire');
    flip(c);
    expect(c.gust).toBe(GUST_SECONDS);
    for (let t = 0; t < FREEZE_SECONDS + 0.1; t += DT) stepClimate(c, DT);
    expect(c.frost).toBe(1);
    expect(c.gust).toBeGreaterThan(0);
    for (let t = 0; t < 1.5; t += DT) stepClimate(c, DT);
    expect(c.gust).toBe(0);
    flip(c);
    expect(c.gust).toBe(0);
    for (let t = 0; t < FREEZE_SECONDS + 0.1; t += DT) stepClimate(c, DT);
    expect(c.frost).toBe(0);
  });

  it('reverses from wherever it is when flipped mid-change', () => {
    const c = createClimate();
    flip(c);
    for (let t = 0; t < 1; t += DT) stepClimate(c, DT);
    const mid = c.frost;
    expect(mid).toBeGreaterThan(0.2);
    flip(c);
    stepClimate(c, DT);
    expect(c.frost).toBeLessThan(mid);
  });

  it('blows hard at first, then fades', () => {
    const c = createClimate();
    flip(c);
    const samples: number[] = [];
    for (let t = 0; t < GUST_SECONDS + 0.5; t += DT) {
      stepClimate(c, DT);
      samples.push(gustStrength(c));
    }
    expect(Math.max(...samples)).toBeGreaterThan(0.95);
    expect(samples[samples.length - 1]).toBe(0);
  });
});

describe('pressure plates', () => {
  const plate = SWITCHES[0].plate;
  it('flips once per step onto a plate', () => {
    const plates = createPlates();
    expect(stepPlates(plates, { x: plate.x, y: PLATE_TOP, z: plate.z })).toBe(true);
    expect(stepPlates(plates, { x: plate.x, y: PLATE_TOP, z: plate.z })).toBe(false);
    expect(stepPlates(plates, { x: 0, y: 0, z: plate.z })).toBe(false);
    expect(stepPlates(plates, { x: plate.x, y: PLATE_TOP, z: plate.z })).toBe(true);
  });

  it('is never touched by walking the path, and ignores fliers', () => {
    const plates = createPlates();
    for (let z = 36; z >= -36; z -= 0.2) {
      for (const x of [-1.5, 0, 1.5]) expect(stepPlates(plates, { x, y: 0, z })).toBe(false);
    }
    expect(stepPlates(plates, { x: plate.x, y: 3, z: plate.z })).toBe(false);
  });
});

describe('slipping and wind', () => {
  const frozen = () => {
    const c = createClimate();
    c.mode = 'ice';
    c.frost = 1;
    return c;
  };
  const walk = (climate: ReturnType<typeof createClimate>, start: [number, number], dir: [number, number], seconds: number, speed = 8.2) => {
    const slide = createSlide();
    let [x, z] = start;
    const y = walkHeight(x, z);
    const steps: number[] = [];
    for (let t = 0; t < seconds; t += DT) {
      const to = [x + dir[0] * speed * DT, y, z + dir[1] * speed * DT] as const;
      const [nx, nz] = slideStep(slide, climate, [x, y, z], to, RADIUS, DT);
      steps.push(Math.hypot(nx - x, nz - z) / DT);
      [x, z] = [nx, nz];
    }
    return { slide, x, z, steps };
  };

  it('moves exactly as asked on the path and on lava', () => {
    const { steps } = walk(createClimate(), [-17, -2], [0, 1], 1);
    expect(steps[steps.length - 1]).toBeCloseTo(8.2, 1);
  });

  it('builds speed slowly on ice and keeps gliding after you stop', () => {
    const c = frozen();
    const { slide, x, z, steps } = walk(c, [-19.5, 2], [0, 1], 0.5);
    expect(steps[0]).toBeLessThan(1);
    expect(steps[steps.length - 1]).toBeLessThan(8.2);
    // Let go: still sliding.
    const y = walkHeight(x, z);
    const [nx, nz] = slideStep(slide, c, [x, y, z], [x, y, z], RADIUS, DT);
    expect(Math.hypot(nx - x, nz - z) / DT).toBeGreaterThan(1);
  });

  it('pushes you back with the gust, but you can still walk into it', () => {
    const c = createClimate();
    flip(c);
    stepClimate(c, 0.3);
    const slide = createSlide();
    const at: [number, number, number] = [0, walkHeight(0, 20), 20];
    // Standing still, the gust (out of the hollow) pushes you towards the entrance.
    const [, z] = slideStep(slide, c, at, at, RADIUS, DT);
    expect(z).toBeGreaterThan(20);
    // Walking towards the hollow still gets you there.
    const into = createSlide();
    let z2 = 20;
    for (let i = 0; i < 30; i++) {
      const y = walkHeight(0, z2);
      [, z2] = slideStep(into, c, [0, y, z2], [0, y, z2 - 8.2 * DT], RADIUS, DT);
    }
    expect(z2).toBeLessThan(19.5);
  });

  it('never slides you into the hole', () => {
    const c = frozen();
    const slide = createSlide();
    let [x, z] = [0, 12];
    for (let i = 0; i < 300; i++) {
      const y = walkHeight(x, z);
      [x, z] = slideStep(slide, c, [x, y, z], [x, y, z - 8.2 * DT], RADIUS, DT);
      expect(Math.hypot(x, z)).toBeGreaterThanOrEqual(RIM_RADIUS + RADIUS - 1e-6);
    }
  });

  it('does not carry momentum across a long jump such as a spawn', () => {
    const slide = createSlide();
    const [x, z] = slideStep(slide, frozen(), [-17, LAKE_Y, -4], [0, 0, 34], RADIUS, DT);
    expect([x, z]).toEqual([0, 34]);
  });
});

describe('the monster', () => {
  it('follows the player with a top speed, and stays inside the hole', () => {
    const m = createMonster();
    let max = 0;
    let t = 0;
    for (let i = 0; i < 600; i++, t += DT) {
      const before = [m.x, m.z];
      stepMonster(m, DT, t, { x: 0, z: 30 });
      max = Math.max(max, Math.hypot(m.x - before[0], m.z - before[1]) / DT);
      expect(Math.hypot(m.x, m.z)).toBeLessThanOrEqual(MONSTER_REACH + 1e-6);
    }
    expect(max).toBeLessThanOrEqual(MONSTER_MAX_SPEED + 1e-6);
    expect(m.z).toBeGreaterThan(MONSTER_REACH - 0.3);
    // Facing the player (+z is yaw 0).
    expect(Math.abs(m.yaw)).toBeLessThan(0.1);
  });

  it('lags behind when the player walks around him', () => {
    const m = createMonster();
    let t = 0;
    for (let i = 0; i < 600; i++, t += DT) stepMonster(m, DT, t, { x: 0, z: 14 });
    // Run around the east arm in about two seconds.
    let lag = 0;
    for (let i = 0; i < 120; i++, t += DT) {
      const a = (i / 120) * Math.PI;
      const p = { x: Math.sin(a) * 11, z: Math.cos(a) * 11 };
      stepMonster(m, DT, t, p);
      const wantAngle = Math.atan2(p.x, p.z);
      const hasAngle = Math.atan2(m.x, m.z);
      lag = Math.max(lag, Math.abs(Math.atan2(Math.sin(wantAngle - hasAngle), Math.cos(wantAngle - hasAngle))));
    }
    expect(lag).toBeGreaterThan(0.5);
    expect(HOLE_RADIUS).toBeGreaterThan(MONSTER_REACH);
  });
});

describe('the yell', () => {
  const monsterAt = () => createMonster();
  it('only yells at players who are close, and is over within a few seconds', () => {
    const rand = seededRandom(3);
    const y = createYell(rand);
    const m = monsterAt();
    for (let t = 0; t < 30; t += DT) stepYell(y, DT, rand, m, { x: 0, z: YELL_RANGE + 5 });
    expect(y.t).toBe(-1);
    let started = -1;
    let ended = -1;
    for (let t = 0; t < 20 && ended < 0; t += DT) {
      stepYell(y, DT, rand, m, { x: 0, z: 10 });
      if (started < 0 && y.t >= 0) started = t;
      if (started >= 0 && y.t < 0) ended = t;
    }
    expect(started).toBeGreaterThanOrEqual(0);
    expect(ended - started).toBeLessThanOrEqual(YELL_SECONDS + 0.05);
    expect(YELL_SECONDS).toBeLessThanOrEqual(3);
  });

  it('blows the player off the path', () => {
    const rand = seededRandom(4);
    const y = createYell(rand);
    y.cooldown = 0;
    const m = monsterAt();
    // Standing on the east arm, beside him.
    let x = ARM_SWING;
    let z = 0;
    const slide = createSlide();
    const climate = createClimate();
    for (let t = 0; t < 3; t += DT) {
      const shove = stepYell(y, DT, rand, m, { x, z });
      const h = walkHeight(x, z);
      [x, z] = slideStep(slide, climate, [x, h, z], [x, h, z], RADIUS, DT, shove);
    }
    expect(pathAt(x, z).distance).toBeGreaterThan(PATH_HALF_WIDTH + 0.5);
    expect(groundAt(x, z).surface).toBe('lake');
  });
});

describe('catching fire', () => {
  it('sets you alight in the lava, keeps burning a moment, and goes out', () => {
    const b = createBurn();
    const lava = { x: -18.5, y: LAKE_Y, z: 0 };
    for (let t = 0; t < 1; t += DT) stepBurn(b, DT, 0, lava);
    expect(b.level).toBe(1);
    for (let t = 0; t < 1; t += DT) stepBurn(b, DT, 0, { x: 0, y: 0, z: 30 });
    expect(b.level).toBe(1);
    for (let t = 0; t < 4; t += DT) stepBurn(b, DT, 0, { x: 0, y: 0, z: 30 });
    expect(b.level).toBe(0);
  });

  it('does not burn on the path or on ice', () => {
    const b = createBurn();
    for (let t = 0; t < 1; t += DT) stepBurn(b, DT, 0, { x: 0, y: 0, z: 30 });
    for (let t = 0; t < 1; t += DT) stepBurn(b, DT, 1, { x: -18.5, y: LAKE_Y, z: 0 });
    expect(b.level).toBe(0);
  });
});

describe('path tiles', () => {
  it('cover the path and knit together outward from the switch that was flipped', () => {
    const tiles = pathTiles(seededRandom(1));
    expect(tiles.length).toBeGreaterThan(200);
    // Mixed sizes: big slabs, middling stones and small chips.
    const sizes = tiles.map(t => t.size);
    expect(sizes.filter(s => s > 2.4).length).toBeGreaterThan(10);
    expect(sizes.filter(s => s > 1.3 && s < 2).length).toBeGreaterThan(20);
    expect(sizes.filter(s => s < 1.2).length).toBeGreaterThan(40);
    const c = createClimate();
    flip(c, SWITCHES[0].plate);
    for (let t = 0; t < 1.2; t += DT) stepClimate(c, DT);
    const near = tileKnit(c, SWITCHES[0].plate.x, SWITCHES[0].plate.z);
    const far = tileKnit(c, 0, -36);
    expect(near).toBeGreaterThan(far);
    for (let t = 0; t < FREEZE_SECONDS; t += DT) stepClimate(c, DT);
    for (const tile of tiles) expect(tileKnit(c, tile.x, tile.z)).toBe(1);
  });
});

describe('room', () => {
  it('mounts, comes alive, flips to ice when you step on a plate, and cleans up', async () => {
    const { default: room } = await import('./index');
    const scene = new THREE.Scene();
    const updates: Array<(dt: number, elapsed: number) => void> = [];
    const cleanups: Array<() => void> = [];
    let terrain: TerrainHeight | null = null;
    let collider: RoomCollider | null = null;
    const player = { position: new THREE.Vector3(0, 0, 34), camera: new THREE.PerspectiveCamera() };
    await room.mount({
      scene,
      mode: 'active',
      player,
      breathe: async () => {},
      addPlatform: () => {},
      setTerrainHeight: (fn: TerrainHeight) => { terrain = fn; },
      setCollider: (c: RoomCollider) => { collider = c; },
      setWalkBounds: () => {},
      onUpdate: (fn: (dt: number, elapsed: number) => void) => updates.push(fn),
      onDispose: (fn: () => void) => cleanups.push(fn),
    } as unknown as WorldContext);

    expect(room.manifest.name).toBe('Frostfire Hollow');
    expect(terrain).not.toBeNull();
    expect(collider).not.toBeNull();
    for (const name of ['cave-floor', 'lakes', 'pool', 'monster', 'monster-horn', 'icicles', 'switches', 'path-columns', 'crystals', 'player-flames', 'light-shaft', 'falling-rocks', 'cold-breath', 'fire-breath']) {
      expect(scene.getObjectByName(name), name).toBeDefined();
    }
    const run = (seconds: number) => {
      for (let i = 0; i < seconds * 60; i++) for (const u of updates) u(DT, i * DT);
    };
    run(2);
    const plate = SWITCHES[0].plate;
    player.position.set(plate.x, PLATE_TOP, plate.z);
    run(FREEZE_SECONDS + 1);
    const icicles = scene.getObjectByName('icicles') as THREE.InstancedMesh;
    const m = new THREE.Matrix4();
    icicles.getMatrixAt(0, m);
    expect(new THREE.Vector3().setFromMatrixScale(m).y).toBeGreaterThan(0.5);

    const disposed = vi.fn();
    let resources = 0;
    const seen = new Set<unknown>();
    scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      // Sprites share three's own geometry, which is not the room's to dispose.
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
    expect(disposed.mock.calls.length).toBeGreaterThanOrEqual(resources);
    expect(scene.children).toHaveLength(0);
  });
});

describe('the monster rig', () => {
  it('keeps his arms out of the rim when he reaches for a player at the edge', async () => {
    const { createMonster: createRig } = await import('./monster');
    const { createClimateUniforms, createResources } = await import('./materials');
    const { HOLE_RADIUS: R, groundAt: ground } = await import('./logic');
    const res = createResources();
    const rig = createRig(res, createClimateUniforms(), seededRandom(3));
    const m = { x: 3.4, z: 0, vx: 0, vz: 0, yaw: Math.PI / 2, headYaw: Math.PI / 2, bob: -1.6 }; // sunk low, so his arms would hit the rim
    const player = { x: 9, z: 0 };
    const at = new THREE.Vector3();
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      const t = i / 60;
      const roaring = t > 5 && t < 7;
      rig.update(m, 1 / 60, t, { windup: roaring ? 1 : 0, roar: roaring ? 1 : 0, open: roaring ? 1 : 0 }, player);
      if (i < 90) continue; // let the springs settle in from the rest pose
      rig.group.traverse(o => {
        if (!o.name.startsWith('arm-')) return;
        o.getWorldPosition(at);
        if (Math.hypot(at.x, at.z) < R - 0.4) return;
        worst = Math.max(worst, ground(at.x, at.z).y - at.y);
      });
    }
    expect(worst).toBeLessThan(0.25);
    res.dispose();
  });
});

describe('the quake', () => {
  it('rains rocks from the ceiling while it shakes, and they land and clear away after', async () => {
    const { createRubble } = await import('./rubble');
    const { createClimateUniforms, createResources } = await import('./materials');
    const res = createResources();
    const rubble = createRubble(res, createClimateUniforms(), seededRandom(5));
    const m = new THREE.Matrix4();
    const shown = () => {
      const ys: number[] = [];
      for (let i = 0; i < rubble.mesh.count; i++) {
        rubble.mesh.getMatrixAt(i, m);
        // Hidden rocks are scaled to nothing.
        if (Math.hypot(m.elements[0], m.elements[1], m.elements[2]) > 1e-4) ys.push(m.elements[13]);
      }
      return ys;
    };
    const player = { x: 0, z: 30 };
    for (let t = 0; t < 0.5; t += 1 / 60) rubble.update(1 / 60, 1, player);
    const falling = shown();
    expect(falling.length).toBeGreaterThan(5);
    expect(Math.max(...falling)).toBeGreaterThan(6);
    for (let t = 0; t < 2; t += 1 / 60) rubble.update(1 / 60, 0, player);
    // Down on the ground by now, none hanging in the air.
    expect(Math.max(...shown())).toBeLessThan(2.5);
    for (let t = 0; t < 4; t += 1 / 60) rubble.update(1 / 60, 0, player);
    expect(shown()).toHaveLength(0);
    res.dispose();
  });
});

describe('the breath', () => {
  it('breathes fire as the lava monster and freezing smoke as the ice monster', async () => {
    const { createEffects } = await import('./effects');
    const { createClimateUniforms, createResources } = await import('./materials');
    const res = createResources();
    const fx = createEffects(res, createClimateUniforms(), seededRandom(8));
    const fire = fx.group.getObjectByName('fire-breath')!;
    const cold = fx.group.getObjectByName('cold-breath')!;
    const mouth = new THREE.Vector3(0, 3, 0);
    const target = new THREE.Vector3(0, 1, 10);
    const still = { strength: 0, dir: [0, 1] as const, warm: 1 };
    const roar = (ice: boolean) => {
      for (let t = 0; t < 0.3; t += 1 / 60) {
        fx.breath(1 / 60, mouth, target, 1, ice);
        fx.update(1 / 60, t, still, null, 0);
      }
    };
    roar(false);
    expect(fire.visible).toBe(true);
    expect(cold.visible).toBe(false);
    for (let t = 0; t < 3; t += 1 / 60) fx.update(1 / 60, t, still, null, 0);
    expect(fire.visible).toBe(false);
    roar(true);
    expect(cold.visible).toBe(true);
    expect(fire.visible).toBe(false);
    res.dispose();
  });
});
