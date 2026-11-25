import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import {
  PLATFORMER_TUNING,
  clearMomentum,
  createMovementState,
  parseMovementMode,
  resolveGround,
  stepMovement,
  turnMomentum,
  type MovementInput,
  type MovementState,
  type MovementTuning,
} from '../engine/movement';

const platformer = PLATFORMER_TUNING;
const FRAME = 1 / 240;

const idle: MovementInput = { x: 0, z: 0, sprint: false, jumpHeld: false, jumpPressed: false };
const input = (patch: Partial<MovementInput> = {}): MovementInput => ({ ...idle, ...patch });

/** A body on a flat floor at y = 0, unless a floor height is given per step. */
function body(tuning: MovementTuning) {
  const state: MovementState = createMovementState();
  const pos = { x: 0, y: 0, z: 0 };
  const step = (patch: Partial<MovementInput> = {}, dt = FRAME, floorY = 0) => {
    const move = stepMovement(state, input(patch), tuning, dt);
    pos.x += move.x;
    pos.z += move.z;
    pos.y = resolveGround(state, pos.y + move.y, floorY, tuning.groundSnap);
  };
  const run = (seconds: number, patch: Partial<MovementInput> = {}, dt = FRAME) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) step(patch, dt);
  };
  const speed = () => Math.hypot(state.velocity.x, state.velocity.z);
  return { state, pos, step, run, speed };
}

/** Press jump, optionally keep holding, and return apex height and rise/fall times. */
function jump(tuning: MovementTuning, hold: boolean | number) {
  const heldFor = typeof hold === 'number' ? hold : hold ? Infinity : 0;
  const b = body(tuning);
  b.step({ jumpHeld: true, jumpPressed: true });
  let apex = b.pos.y;
  let rise = FRAME;
  let total = FRAME;
  while (!b.state.grounded && total < 3) {
    b.step({ jumpHeld: total < heldFor });
    total += FRAME;
    if (b.pos.y > apex) {
      apex = b.pos.y;
      rise = total;
    }
  }
  return { apex, rise, fall: total - rise };
}

describe('platformer ground movement', () => {
  it('ramps up to sprint speed over a quarter second', () => {
    const b = body(platformer);
    b.run(0.2, { z: -1, sprint: true });
    expect(b.speed()).toBeLessThan(14.5);
    expect(b.speed()).toBeGreaterThan(10);
    b.run(0.06, { z: -1, sprint: true });
    expect(b.speed()).toBeCloseTo(14.5, 9);
  });

  it('ramps up to walk speed over a quarter second', () => {
    const b = body(platformer);
    b.run(0.2, { z: -1 });
    expect(b.speed()).toBeLessThan(8.2);
    b.run(0.06, { z: -1 });
    expect(b.speed()).toBeCloseTo(8.2, 9);
  });

  it.each([false, true])('stops over 0.15 s (sprint: %s)', sprint => {
    const b = body(platformer);
    b.run(0.4, { z: -1, sprint });
    b.run(0.1);
    expect(b.speed()).toBeGreaterThan(0);
    b.run(0.06);
    expect(b.speed()).toBe(0);
  });

  it('settles at zero without reversing at a low frame rate', () => {
    const b = body(platformer);
    b.run(0.5, { z: -1, sprint: true }, 0.05);
    for (let i = 0; i < 10; i++) {
      b.step({}, 0.05);
      expect(b.state.velocity.z).toBeLessThanOrEqual(0);
    }
    expect(b.speed()).toBe(0);
  });

  it('still stops when it inherits speed it never accelerated to', () => {
    const b = body(platformer);
    b.state.velocity.z = -8;
    b.run(0.3);
    expect(b.speed()).toBe(0);
  });

  it('brakes before running the other way', () => {
    const b = body(platformer);
    b.run(0.4, { z: -1, sprint: true });
    b.run(0.05, { z: 1, sprint: true });
    expect(b.state.velocity.z).toBeLessThan(0);
    b.run(0.45, { z: 1, sprint: true });
    expect(b.state.velocity.z).toBeCloseTo(14.5, 9);
  });

  it('keeps ground steering and jumping while running downhill', () => {
    const b = body(platformer);
    let floor = 0;
    for (let i = 0; i < 63; i++) {
      floor -= 0.02;
      b.step({ z: -1, sprint: true }, FRAME, floor);
    }
    expect(b.speed()).toBeCloseTo(14.5, 9);
    floor -= 0.02;
    b.step({ z: -1, jumpHeld: true, jumpPressed: true }, FRAME, floor);
    expect(b.state.velocity.y).toBeGreaterThan(9);
  });
});

describe('platformer air movement', () => {
  const airborne = () => {
    const b = body(platformer);
    b.run(0.4, { z: -1, sprint: true });
    b.step({ z: -1, sprint: true, jumpHeld: true, jumpPressed: true });
    b.run(0.15, { z: -1, sprint: true, jumpHeld: true });
    expect(b.state.grounded).toBe(false);
    return b;
  };

  it('keeps momentum with no input', () => {
    const b = airborne();
    b.run(0.1, { jumpHeld: true });
    expect(b.speed()).toBeCloseTo(14.5, 9);
  });

  it('steers at 35% of the ground rate', () => {
    const b = airborne();
    b.step({ x: 1, sprint: true, jumpHeld: true });
    const change = Math.hypot(b.state.velocity.x, b.state.velocity.z + 14.5);
    expect(change).toBeCloseTo((14.5 / 0.25) * 0.35 * FRAME, 6);
  });
});

describe('platformer jumping', () => {
  it('jumps higher the longer Space is held', () => {
    const heights = [0, 0.08, 0.16, 0.24, 0.32].map(seconds => jump(platformer, seconds).apex);
    for (let i = 1; i < heights.length; i++) expect(heights[i] - heights[i - 1]).toBeGreaterThan(0.1);
  });

  it('jumps about 2.2 m when held and falls faster than it rises', () => {
    const { apex, rise, fall } = jump(platformer, true);
    expect(Math.abs(apex - 2.2)).toBeLessThan(0.1);
    expect(fall).toBeLessThan(rise);
  });

  it('jumps about 0.9 m when tapped', () => {
    expect(Math.abs(jump(platformer, false).apex - 0.9)).toBeLessThan(0.1);
  });

  it('caps fall speed at 30', () => {
    const b = body(platformer);
    for (let i = 0; i < 480; i++) b.step({}, FRAME, -1000);
    expect(b.state.velocity.y).toBe(-30);
  });

  it.each([[0.08, true], [0.15, false]])('allows a jump %s s after leaving a ledge: %s', (delay, jumps) => {
    const b = body(platformer);
    b.step();
    for (let i = 0; i < Math.round(delay / FRAME); i++) b.step({}, FRAME, -50);
    b.step({ jumpHeld: true, jumpPressed: true }, FRAME, -50);
    expect(b.state.velocity.y > 0).toBe(jumps);
  });

  it.each([[0.1, true], [0.2, false]])('remembers a press %s s before landing: %s', (early, jumps) => {
    const falling = (pressAt: number) => {
      const b = body(platformer);
      b.pos.y = 5;
      b.state.grounded = false;
      b.state.coyote = 0;
      let frames = 0;
      let rejumped = false;
      let landedAt = 0;
      for (; frames < 480; frames++) {
        b.step({ jumpHeld: frames >= pressAt, jumpPressed: frames === pressAt });
        if (b.state.grounded && !landedAt) landedAt = frames;
        if (landedAt && b.state.velocity.y > 0) rejumped = true;
      }
      return { landedAt, rejumped };
    };
    const landing = falling(Infinity).landedAt;
    expect(falling(landing - Math.round(early / FRAME)).rejumped).toBe(jumps);
  });

  it('does not jump again just because Space stays held', () => {
    const b = body(platformer);
    b.step({ jumpHeld: true, jumpPressed: true });
    let takeoffs = 1;
    let wasGrounded = false;
    for (let i = 0; i < 480; i++) {
      b.step({ jumpHeld: true });
      if (wasGrounded && !b.state.grounded) takeoffs++;
      wasGrounded = b.state.grounded;
    }
    expect(takeoffs).toBe(1);
  });
});

describe('momentum helpers', () => {
  it('turns momentum the same way a portal turns positions', () => {
    const state = createMovementState();
    Object.assign(state.velocity, { x: 3, y: -2, z: -7 });
    const expected = new THREE.Vector3(3, -2, -7).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    turnMomentum(state, Math.PI / 2);
    expect(state.velocity.x).toBeCloseTo(expected.x, 9);
    expect(state.velocity.y).toBe(-2);
    expect(state.velocity.z).toBeCloseTo(expected.z, 9);
  });

  it('clears horizontal momentum and pending jumps but keeps vertical speed', () => {
    const state = createMovementState();
    Object.assign(state.velocity, { x: 3, y: -2, z: -7 });
    state.jumpBuffer = 0.1;
    state.coyote = 0.1;
    clearMomentum(state);
    expect(state.velocity).toEqual({ x: 0, y: -2, z: 0 });
    expect(state.jumpBuffer).toBe(0);
    expect(state.coyote).toBe(0);
  });

  it('falls back to classic for a missing or unknown saved mode', () => {
    expect(parseMovementMode('platformer')).toBe('platformer');
    expect(parseMovementMode(null)).toBe('classic');
    expect(parseMovementMode('')).toBe('classic');
    expect(parseMovementMode('x')).toBe('classic');
  });
});
