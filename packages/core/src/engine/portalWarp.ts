import * as THREE from 'three/webgpu';
import type { PortalVisualHandle } from '../types';
import { RUN_SPEED, WARP_RADIUS } from '../portal/roomLayout';

/**
 * How strongly the screen warps near portals.
 *
 * Each portal has a warp circle on the floor: the equator of the sphere the debug
 * view draws around it. The warp starts at the circle's edge and is strongest at
 * the portal's centre, measured from the player's feet and ignoring height.
 * Moving adds up to 20% more, using smoothed speed: the character stops on a dime,
 * so smoothing makes a run count for more than a walk, and a stop-start walk for
 * less than a steady one but still more than standing still.
 */

/** Extra warp at a sprint, as a fraction of the standing-still warp. */
export const WARP_SPEED_BOOST = 0.2;
/** Seconds for smoothed speed to cover about two-thirds of a change. */
export const WARP_SPEED_SMOOTHING = 0.5;

/** 0 at the edge of a warp circle, rising smoothly to 1 at its centre. */
export function warpFalloff(distance: number, radius = WARP_RADIUS): number {
  if (!(distance < radius)) return 0;
  const t = 1 - Math.max(0, distance) / radius;
  return t * t * (3 - 2 * t);
}

/** The strongest warp from any portal whose circle the feet are in. */
export function portalWarp(
  handles: ReadonlyArray<Pick<PortalVisualHandle, 'triggerCenter'>>,
  feet: THREE.Vector3,
  radius = WARP_RADIUS,
): number {
  let strongest = 0;
  for (const { triggerCenter } of handles) {
    const distance = Math.hypot(feet.x - triggerCenter.x, feet.z - triggerCenter.z);
    strongest = Math.max(strongest, warpFalloff(distance, radius));
  }
  return strongest;
}

/** Ease a smoothed speed toward this frame's speed, the same at any frame rate. */
export function smoothSpeed(smoothed: number, instant: number, dt: number,
  timeConstant = WARP_SPEED_SMOOTHING): number {
  return smoothed + (instant - smoothed) * (1 - Math.exp(-dt / timeConstant));
}

/** 1 standing still, rising to 1 + WARP_SPEED_BOOST at a sprint. */
export function warpSpeedFactor(smoothedSpeed: number): number {
  return 1 + WARP_SPEED_BOOST * THREE.MathUtils.clamp(smoothedSpeed / RUN_SPEED, 0, 1);
}
