import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { defineRoom } from '../portal/defineRoom';
import { RoomInstance } from '../engine/RoomInstance';
import { AvatarController } from '../engine/AvatarController';
import { DEEPEST_FALL, NO_GROUND, respawnHeight } from '../engine/falling';

const renderer = {} as THREE.WebGPURenderer;

describe('falling out of a room', () => {
  it('keeps a floor everywhere unless the room allows falling', async () => {
    const room = await RoomInstance.mount(defineRoom('eric-world', { mount: () => {} }), renderer);
    expect(room.falling).toBeNull();
    expect(respawnHeight(room.falling)).toBeNull();
  });

  it('offers a respawn below the height the room sets', async () => {
    const room = await RoomInstance.mount(defineRoom('jp-abyss', {
      mount: ctx => ctx.allowFalling({ respawnBelow: -76 }),
    }), renderer);
    expect(room.falling).toEqual({ respawnBelow: -76 });
    expect(respawnHeight(room.falling)).toBe(-76);
  });

  it('still catches players who fall past every floor in a room with ground further down', async () => {
    const room = await RoomInstance.mount(defineRoom('jp-abyss', {
      mount: ctx => {
        ctx.allowFalling();
        ctx.setTerrainHeight((x, z) => (Math.abs(x) < 3 && Math.abs(z) < 40 ? 0 : -80));
      },
    }), renderer);
    expect(respawnHeight(room.falling)).toBe(DEEPEST_FALL);
    expect(DEEPEST_FALL).toBeLessThan(-80);
  });

  it('treats NO_GROUND as lower than any floor', () => {
    expect(Math.max(NO_GROUND, -1e6)).toBe(-1e6);
    expect(Number.isFinite(NO_GROUND)).toBe(false);
  });
});

describe('respawning after a fall', () => {
  let windowTarget: EventTarget;

  beforeEach(() => {
    windowTarget = new EventTarget();
    vi.stubGlobal('window', windowTarget);
    vi.stubGlobal('document', new EventTarget());
    vi.stubGlobal('HTMLInputElement', class {});
    vi.stubGlobal('HTMLTextAreaElement', class {});
    vi.stubGlobal('HTMLSelectElement', class {});
  });

  afterEach(() => vi.unstubAllGlobals());

  it('restores mobile virtual movement, look, and ground jumping immediately after respawn', () => {
    const avatar = new AvatarController(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      new EventTarget() as unknown as HTMLElement,
      '#38bdf8',
    );
    // Floor only near origin; NO_GROUND elsewhere so walking off drops the player.
    avatar.setWorldCollision(
      [],
      (x, z) => (Math.abs(x) < 4 && Math.abs(z) < 4 ? 0 : NO_GROUND),
      -120,
    );
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0 });

    // Walk off the ledge using mobile virtual stick until fallen below -76.
    avatar.setVirtualMove(1, 0, true);
    for (let i = 0; i < 300; i++) {
      avatar.update(1 / 60, i / 60, false);
      if (avatar.position.y < -76) break;
    }
    expect(avatar.position.y).toBeLessThan(-76);

    // Fall state locks input and zeroes virtual controls.
    avatar.setInputLocked(true);
    avatar.update(1 / 60, 5, true);

    // Respawn unlocks input and places avatar back on the solid entrance platform.
    avatar.setInputLocked(false);
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0, flying: false });

    // Mobile look, jump, and stick movement all respond immediately on the first frame.
    avatar.applyLookDelta(40, -10, 0.005);
    expect(avatar.yaw).not.toBe(0);

    avatar.pressJumpOrFly();
    avatar.setVirtualMove(1, 0, false);
    avatar.update(1 / 60, 5.1, false);
    expect(avatar.position.y).toBeGreaterThan(0);
    expect(Math.hypot(avatar.position.x, avatar.position.z)).toBeGreaterThan(0);
  });
});
