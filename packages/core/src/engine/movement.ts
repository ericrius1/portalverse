/**
 * Platformer walking and jumping, with no DOM or renderer dependencies.
 *
 * The numbers live in one tuning object, so anything that changes how a body moves
 * (such as per-room gravity) has one place to plug into. Classic movement, flight and
 * double-tap takeoff are handled by `AvatarController`.
 */
import { RUN_SPEED } from '../portal/roomLayout';

export type MovementMode = 'classic' | 'platformer';

export interface MovementTuning {
  walkSpeed: number;
  sprintSpeed: number;
  /** Seconds from rest to the walk or sprint speed. */
  accelTime: number;
  /** Seconds from the walk or sprint speed to rest. */
  stopTime: number;
  /** Steering in mid-air, as a fraction of ground acceleration. */
  airControl: number;
  jumpSpeed: number;
  /** Gravity while rising with jump held. */
  riseGravity: number;
  /** Gravity while rising with jump released; higher means taps jump lower. */
  releaseGravity: number;
  fallGravity: number;
  maxFallSpeed: number;
  /** Seconds after leaving the ground during which a jump still works. */
  coyoteTime: number;
  /** Seconds an early jump press is remembered. */
  jumpBufferTime: number;
  /** Largest drop in one step that a walking body follows without becoming airborne. */
  groundSnap: number;
}

export const PLATFORMER_TUNING: Readonly<MovementTuning> = {
  walkSpeed: 8.2,
  sprintSpeed: RUN_SPEED,
  accelTime: 0.25,
  stopTime: 0.15,
  airControl: 0.35,
  jumpSpeed: 14.3, // A held jump peaks level with Classic's at 60 fps.
  riseGravity: 30,
  releaseGravity: 115,
  fallGravity: 48,
  maxFallSpeed: 30,
  coyoteTime: 0.1,
  jumpBufferTime: 0.12,
  groundSnap: 0.3,
};

export interface MovementState {
  velocity: { x: number; y: number; z: number };
  grounded: boolean;
  /** Seconds of ledge grace left. */
  coyote: number;
  /** Seconds an unused jump press stays live. */
  jumpBuffer: number;
  /** Target speed of the last movement input; sets how hard stopping brakes. */
  gaitSpeed: number;
}

export interface MovementInput {
  /** Desired horizontal direction in world space: a unit vector, or zero. */
  x: number;
  z: number;
  sprint: boolean;
  jumpHeld: boolean;
  /** True only on the step where jump went down. */
  jumpPressed: boolean;
}

export function createMovementState(): MovementState {
  return { velocity: { x: 0, y: 0, z: 0 }, grounded: true, coyote: 0, jumpBuffer: 0, gaitSpeed: 0 };
}

/** Advance velocity by one step and return how far the body moves. Ground contact is `resolveGround`. */
export function stepMovement(
  s: MovementState,
  input: MovementInput,
  t: MovementTuning,
  dt: number,
): { x: number; y: number; z: number } {
  s.coyote = s.grounded ? t.coyoteTime : Math.max(0, s.coyote - dt);
  const onFooting = s.grounded || s.coyote > 0;

  steer(s, input, t, dt, onFooting);

  if (input.jumpPressed) s.jumpBuffer = t.jumpBufferTime;
  if (s.jumpBuffer > 0 && onFooting) {
    s.velocity.y = t.jumpSpeed;
    s.grounded = false;
    s.coyote = 0;
    s.jumpBuffer = 0;
  } else {
    s.jumpBuffer = Math.max(0, s.jumpBuffer - dt);
  }

  const y = stepVertical(s, input.jumpHeld, t, dt);
  return { x: s.velocity.x * dt, y, z: s.velocity.z * dt };
}

/** Integrate each part of the arc, including frames that pass the apex or reach terminal speed. */
function stepVertical(s: MovementState, jumpHeld: boolean, t: MovementTuning, dt: number): number {
  let speed = Math.max(s.velocity.y, -t.maxFallSpeed);
  let distance = 0;
  if (speed > 0) {
    const gravity = jumpHeld ? t.riseGravity : t.releaseGravity;
    const riseTime = Math.min(dt, speed / gravity);
    const endSpeed = Math.max(0, speed - gravity * riseTime);
    distance += (speed + endSpeed) * 0.5 * riseTime;
    speed = endSpeed;
    dt -= riseTime;
  }
  if (dt > 0 && speed > -t.maxFallSpeed) {
    const fallTime = Math.min(dt, (speed + t.maxFallSpeed) / t.fallGravity);
    const endSpeed = Math.max(-t.maxFallSpeed, speed - t.fallGravity * fallTime);
    distance += (speed + endSpeed) * 0.5 * fallTime;
    speed = endSpeed;
    dt -= fallTime;
  }
  s.velocity.y = speed;
  return distance + speed * dt;
}

function steer(s: MovementState, input: MovementInput, t: MovementTuning, dt: number, onFooting: boolean): void {
  const v = s.velocity;
  const moving = input.x !== 0 || input.z !== 0;
  // With nothing pushing, a body in the air keeps its momentum.
  if (!moving && !onFooting) return;

  const speed = input.sprint ? t.sprintSpeed : t.walkSpeed;
  if (moving) s.gaitSpeed = speed;
  const reversing = moving && v.x * input.x + v.z * input.z < 0;
  const braking = !moving || (reversing && onFooting);
  const time = braking ? t.stopTime : t.accelTime;
  const targetX = braking ? 0 : input.x * speed;
  const targetZ = braking ? 0 : input.z * speed;

  // Speed carried in from elsewhere (a mode switch or a flight landing) brakes at least at walking strength.
  const base = braking ? Math.max(s.gaitSpeed, t.walkSpeed) : speed;
  const rate = (base / time) * (onFooting ? 1 : t.airControl);
  const dx = targetX - v.x;
  const dz = targetZ - v.z;
  const distance = Math.hypot(dx, dz);
  const reach = rate * dt;
  if (distance <= reach + 1e-9) {
    v.x = targetX;
    v.z = targetZ;
  } else {
    v.x += (dx / distance) * reach;
    v.z += (dz / distance) * reach;
  }
}

/** Settle the body against the floor and return its corrected height. */
export function resolveGround(s: MovementState, y: number, floorY: number, snap = 0): number {
  const follows = s.grounded && s.velocity.y <= 0 && y - floorY <= snap;
  s.grounded = y <= floorY || follows;
  if (!s.grounded) return y;
  s.velocity.y = 0;
  return floorY;
}

/** Drop horizontal momentum and any pending jump. Vertical speed is left alone. */
export function clearMomentum(s: MovementState): void {
  s.velocity.x = 0;
  s.velocity.z = 0;
  s.coyote = 0;
  s.jumpBuffer = 0;
}

/** Rotate momentum about +Y, matching how a portal crossing rotates positions. */
export function turnMomentum(s: MovementState, yawDelta: number): void {
  const cos = Math.cos(yawDelta);
  const sin = Math.sin(yawDelta);
  const { x, z } = s.velocity;
  s.velocity.x = x * cos + z * sin;
  s.velocity.z = z * cos - x * sin;
}

export function parseMovementMode(raw: string | null): MovementMode {
  return raw === 'platformer' ? 'platformer' : 'classic';
}
