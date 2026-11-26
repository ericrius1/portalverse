import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import { AvatarController } from '../engine/AvatarController';

class FakeElement {}
class FakeInput extends FakeElement {}

const FRAME = 1 / 60;
let windowTarget: EventTarget;

beforeEach(() => {
  windowTarget = new EventTarget();
  vi.stubGlobal('window', windowTarget);
  vi.stubGlobal('document', new EventTarget());
  vi.stubGlobal('HTMLInputElement', FakeInput);
  vi.stubGlobal('HTMLTextAreaElement', class {});
  vi.stubGlobal('HTMLSelectElement', class {});
});
afterEach(() => vi.unstubAllGlobals());

function key(type: 'keydown' | 'keyup', code: string, extra: { repeat?: boolean; target?: object } = {}) {
  const event = new Event(type);
  Object.defineProperty(event, 'code', { value: code });
  Object.defineProperty(event, 'repeat', { value: extra.repeat ?? false });
  if (extra.target) Object.defineProperty(event, 'target', { value: extra.target });
  windowTarget.dispatchEvent(event);
}

function setup() {
  const onMode = vi.fn();
  const avatar = new AvatarController(
    new THREE.Scene(), new THREE.PerspectiveCamera(), new EventTarget() as unknown as HTMLElement,
    '#ffffff', undefined, undefined, undefined, undefined, onMode,
  );
  avatar.applySpawn({ position: [0, 0, 0], yaw: 0 });
  const run = (frames: number, locked = false) => {
    for (let i = 0; i < frames; i++) avatar.update(FRAME, i * FRAME, locked);
  };
  /** Horizontal movement produced by one frame. */
  const drift = () => {
    const { x, z } = avatar.position;
    run(1);
    return { x: avatar.position.x - x, z: avatar.position.z - z };
  };
  /** Platformer mode, running forward (-Z) at full speed with W then released. */
  const coasting = () => {
    avatar.setMovementMode('platformer');
    key('keydown', 'KeyW');
    run(30);
    key('keyup', 'KeyW');
  };
  return { avatar, onMode, run, drift, coasting };
}

describe.each(['classic', 'platformer'] as const)('one-way landing in %s', mode => {
  it('catches a fast descent and allows passing beneath the same surface', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode(mode);
    avatar.setWorldCollision([], (_x, _z, fromY = Infinity) => fromY >= -12 ? -12 : -Infinity, -100);
    avatar.applySpawn({ position: [0, 18, 0], yaw: 0 });
    run(240);
    expect(avatar.position.y).toBe(-12);
    avatar.applySpawn({ position: [0, -14, 0], yaw: 0 });
    run(10);
    expect(avatar.position.y).toBeLessThan(-14);
  });
});

describe('movement mode toggle', () => {
  it('starts in classic and G switches both ways', () => {
    const { avatar, onMode } = setup();
    expect(avatar.movementMode).toBe('classic');
    key('keydown', 'KeyG');
    expect(avatar.movementMode).toBe('platformer');
    expect(onMode).toHaveBeenLastCalledWith('platformer');
    key('keydown', 'KeyG');
    expect(avatar.movementMode).toBe('classic');
    expect(onMode).toHaveBeenLastCalledWith('classic');
  });

  it('ignores a held G, G typed into a field, and G while a menu is open', () => {
    const { avatar } = setup();
    key('keydown', 'KeyG', { repeat: true });
    key('keydown', 'KeyG', { target: new FakeInput() });
    avatar.setInputLocked(true);
    key('keydown', 'KeyG');
    expect(avatar.movementMode).toBe('classic');
  });
});

describe('platformer momentum in the controller', () => {
  it('coasts after the key is released', () => {
    const { coasting, drift } = setup();
    coasting();
    expect(drift().z).toBeLessThan(0);
  });

  const resets: Array<[string, (s: ReturnType<typeof setup>) => void]> = [
    ['a menu', s => { s.avatar.setInputLocked(true); s.run(1, true); s.avatar.setInputLocked(false); }],
    ['a portal walk-through', s => s.run(1, true)],
    ['losing window focus', () => windowTarget.dispatchEvent(new Event('blur'))],
    ['spawning', s => s.avatar.applySpawn({ position: [0, 0, 0], yaw: 0 })],
    ['toggling flight twice', s => { s.avatar.toggleFlight(); s.avatar.toggleFlight(); s.avatar.position.y = 0; s.run(1); s.avatar.position.y = 0; }],
  ];

  it.each(resets)('is cleared by %s', (_name, reset) => {
    const s = setup();
    s.coasting();
    reset(s);
    expect(s.drift()).toEqual({ x: 0, z: 0 });
  });

  it('does not fire a queued jump after losing focus', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode('platformer');
    key('keydown', 'Space');
    windowTarget.dispatchEvent(new Event('blur'));
    run(1);
    expect(avatar.position.y).toBe(0);
  });

  it('jumps on a quick tap that is released before the next frame', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode('platformer');
    key('keydown', 'Space');
    key('keyup', 'Space');
    run(2);
    expect(avatar.position.y).toBeGreaterThan(0);
    expect(avatar.velocityY).toBeGreaterThan(0);
  });

  it('stores no momentum while pushing into the world boundary', () => {
    const { avatar, run, drift } = setup();
    avatar.setMovementMode('platformer');
    avatar.applySpawn({ position: [0, 0, -94], yaw: 0 });
    key('keydown', 'KeyW');
    run(60);
    expect(avatar.position.z).toBe(-95);
    key('keyup', 'KeyW');
    key('keydown', 'KeyS');
    expect(drift().z).toBeGreaterThan(0);
  });

  it('cannot jump in mid-air after leaving flight', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode('platformer');
    avatar.toggleFlight();
    run(1);
    avatar.position.y = 5;
    avatar.toggleFlight();
    key('keydown', 'Space');
    key('keyup', 'Space');
    key('keydown', 'Space');
    run(1);
    expect(avatar.velocityY).toBeLessThan(0);
    expect(avatar.isFlying).toBe(false);
  });

  it('stops after switching modes mid-run and releasing the key', () => {
    const { avatar, run, drift } = setup();
    key('keydown', 'KeyW');
    run(30);
    avatar.setMovementMode('platformer');
    key('keyup', 'KeyW');
    run(30);
    expect(drift()).toEqual({ x: 0, z: 0 });
  });

  it('turns momentum with the player through a portal', () => {
    const { avatar, coasting, drift } = setup();
    coasting();
    avatar.turnMomentum(Math.PI);
    const move = drift();
    expect(move.z).toBeGreaterThan(0);
    expect(move.x).toBeCloseTo(0, 9);
  });
});

describe.each(['classic', 'platformer'] as const)('double-tap flight in %s', mode => {
  const tap = () => { key('keydown', 'Space'); key('keyup', 'Space'); };

  it('takes off when both presses arrive between frames', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode(mode);
    tap();
    tap();
    run(1);
    expect(avatar.isFlying).toBe(true);
  });

  it('starts flying on a second press during a jump', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode(mode);
    tap();
    run(5);
    expect(avatar.position.y).toBeGreaterThan(0);
    expect(avatar.isFlying).toBe(false);
    tap();
    expect(avatar.isFlying).toBe(true);
  });

  it('jumps again, without flying, once landed', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode(mode);
    tap();
    run(90);
    expect(avatar.position.y).toBe(0);
    tap();
    run(3);
    expect(avatar.isFlying).toBe(false);
    expect(avatar.position.y).toBeGreaterThan(0);
  });
});

describe('platformer ledges', () => {
  it('still jumps just after running off a ledge', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode('platformer');
    avatar.setWorldCollision([{ minX: -1, maxX: 1, minZ: -1, maxZ: 1, topY: 4 }], null);
    avatar.applySpawn({ position: [0, 4, 0], yaw: 0 });
    run(1);
    avatar.setWorldCollision([], null);
    run(2);
    key('keydown', 'Space');
    run(1);
    expect(avatar.isFlying).toBe(false);
    expect(avatar.velocityY).toBeGreaterThan(0);
  });
});

describe('jump height', () => {
  /** Highest point of one jump with Space held for `holdFrames`, at a given frame rate. */
  function apex(mode: 'classic' | 'platformer', fps: number, holdFrames = Infinity) {
    const { avatar } = setup();
    avatar.setMovementMode(mode);
    key('keydown', 'Space');
    let best = 0;
    for (let i = 0; i < fps * 2; i++) {
      if (i === holdFrames) key('keyup', 'Space');
      avatar.update(1 / fps, i / fps, false);
      best = Math.max(best, avatar.position.y);
    }
    key('keyup', 'Space');
    avatar.dispose();
    return best;
  }

  // Classic's jump height varies with frame rate. The two modes are tuned to match at 60 fps.
  it.each([[60, 0.05], [30, 0.3], [120, 0.3]])('reaches the same full height in both modes at %s fps', (fps, within) => {
    expect(Math.abs(apex('platformer', fps) - apex('classic', fps))).toBeLessThan(within);
  });

  it('keeps the Platformer tap low', () => {
    expect(Math.abs(apex('platformer', 60, 0) - 0.8)).toBeLessThan(0.15);
  });

  it.each([0, 0.1, Infinity])('keeps the same Platformer apex across frame rates for a %s s hold', seconds => {
    const heights = [20, 30, 60, 120, 240].map(fps => apex('platformer', fps, seconds * fps));
    // Even with an identical trajectory the displayed frames can straddle the apex.
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.025);
  });
});

describe.each(['classic', 'platformer'] as const)('room walls and bounds in %s', mode => {
  it('stops at a room collider and slides along it', () => {
    const { avatar, run } = setup();
    avatar.setMovementMode(mode);
    // a wall across the way at z = -3: nothing gets past it
    avatar.setWorldCollision([], null, undefined, { move: (_from, to, r) => [to[0], Math.max(to[2], -3 + r)] });
    avatar.applySpawn({ position: [0, 0, 0], yaw: 0.3 });
    key('keydown', 'KeyW');
    run(120);
    key('keyup', 'KeyW');
    expect(avatar.position.z).toBeGreaterThanOrEqual(-3);
    expect(avatar.position.x).toBeLessThan(-1);
  });

  it('lets a room set how far the player can wander', () => {
    const { avatar } = setup();
    avatar.setMovementMode(mode);
    avatar.setWorldCollision([], null, undefined, null, { minX: -200, maxX: 200, minZ: -200, maxZ: 200 });
    avatar.applySpawn({ position: [-150, 0, 0], yaw: 0 });
    avatar.update(FRAME, 0, false);
    expect(avatar.position.x).toBe(-150);
    avatar.setWorldCollision([], null);
    avatar.update(FRAME, 0, false);
    expect(avatar.position.x).toBe(-95);
  });
});
