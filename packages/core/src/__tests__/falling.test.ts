import { describe, expect, it } from 'vitest';
import type * as THREE from 'three/webgpu';
import { defineRoom } from '../portal/defineRoom';
import { RoomInstance } from '../engine/RoomInstance';
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
