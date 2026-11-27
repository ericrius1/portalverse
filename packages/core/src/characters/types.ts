import type { SkinAppearance } from './appearance';
import type * as THREE from 'three/webgpu';

/**
 * Per-frame movement telemetry passed into every playable character rig
 * (local player, portal-transit proxy, remote multiplayer avatars, and
 * character-select preview).
 */
export interface AvatarMotionState {
  /** Horizontal speed in m/s (0 while standing still). */
  speed: number;
  /** Horizontal speed normalized to standard run speed (0 = idle, ~0.6 = walk, 1+ = sprint/boost). */
  speedNorm: number;
  /** Forward speed in the character's local frame (+ forward, - backward). */
  forwardSpeed: number;
  /** Rightward strafe speed in the character's local frame (+ right, - left). */
  strafeSpeed: number;
  /** Vertical velocity in m/s (+ rising/jumping, - falling/diving). */
  velocityY: number;
  /** Yaw turn rate in rad/s (+ turning left, - turning right) for banking & head look. */
  turnRate: number;
  /** True when standing on a floor, terrain, or platform. */
  grounded: boolean;
  /** True when in 3D flight mode. */
  isFlying: boolean;
  /** Smoothly blended 0..1 boost/sprint intensity. */
  boost: number;
  /** Look / flight pitch in radians (+ up, - down). */
  pitch: number;
  /** Decaying 0..1 squash impulse triggered upon touching down from a jump or flight. */
  landImpact: number;
}

export const IDLE_MOTION_STATE: Readonly<AvatarMotionState> = Object.freeze({
  speed: 0,
  speedNorm: 0,
  forwardSpeed: 0,
  strafeSpeed: 0,
  velocityY: 0,
  turnRate: 0,
  grounded: true,
  isFlying: false,
  boost: 0,
  pitch: 0,
  landImpact: 0,
});

export interface CharacterRigOptions extends Partial<SkinAppearance> {
  accentColor?: string;
}

export interface CharacterRig {
  /**
   * Root group placed at the player's feet (`Y = 0` at soles/ground, facing `-Z`
   * forward in Portalverse convention).
   */
  readonly group: THREE.Group;
  /** Resolves once an asynchronous model is mounted. */
  readonly ready?: Promise<void>;
  setSkinAppearance?(appearance: Partial<SkinAppearance>): void;
  /** Optional accent/aura color hook when the player customizes their profile color. */
  setAccentColor?(hexColor: string): void;
  /** Advance procedural rigging and shaders for the current frame. */
  update(dt: number, elapsed: number, motion: AvatarMotionState): void;
  /** Release all geometries, materials, and procedural textures owned by this rig instance. */
  dispose(): void;
}

export interface CharacterDefinition {
  id: string;
  supportsSkinTone?: boolean;
  /** Defaults to camera-facing strafing. Adventure mode separates body facing from camera orbit. */
  thirdPersonMovement?: 'adventure';
  /** Physics applied on startup and when switching to this character. */
  defaultMovementMode?: 'platformer';
  name: string;
  title: string;
  species: string;
  tagline: string;
  description: string;
  accentColor: string;
  /** Height of multiplayer floating nameplate above feet (Y = 0), in meters. */
  labelHeight: number;
  /** Default eye height above feet (Y = 0), in meters. */
  eyeHeight: number;
  /** Short flavor badges displayed on the character selection screen. */
  traits: readonly string[];
  /** Creates a fresh, isolated rig instance. */
  createRig: (options?: CharacterRigOptions) => CharacterRig;
}
