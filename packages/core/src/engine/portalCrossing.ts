import * as THREE from 'three/webgpu';
import type { PortalVisualHandle } from '../types';
import { PORTAL_CENTER_Y, PORTAL_RADIUS } from '../portal/roomLayout';
import { isOneWay } from './PortalMesh';

/**
 * Room-crossing rules shared by the engine and its tests. Everything here is pure
 * apart from reading each portal group's current `matrixWorld`.
 *
 * A crossing has two phases. When the player's feet pass through an opening, the
 * engine starts a transit and keeps rendering the old room. When the chase camera
 * also passes the plane, the destination room is promoted on that same frame, so
 * the view never jumps.
 */

/** 1 = entered through the front (+Z) face, -1 = through the back face. */
export type CrossingSide = 1 | -1;

export type TransitDecision = 'wait' | 'promote' | 'cancel';

/** Feet this far back on the entry side, with the camera too, abandon the transit. */
export const TRANSIT_CANCEL_DEPTH = 0.45;
/** Feet this far past the plane promote even if the camera lags behind. */
export const TRANSIT_FORCE_DEPTH = 9.5;

const UP = new THREE.Vector3(0, 1, 0);
const localA = new THREE.Vector3();
const localB = new THREE.Vector3();

type PortalFrame = Pick<PortalVisualHandle, 'group' | 'aperture'>;

/** Depth of a world point along the portal normal, signed so the entry side is positive. */
function depth(handle: PortalFrame, point: THREE.Vector3, side: CrossingSide, out: THREE.Vector3): number {
  return handle.group.worldToLocal(out.copy(point)).z * side;
}

/**
 * Which face the feet passed through between two frames, or null. Feet must be
 * inside the opening's width and height. One-way portals ignore the back face.
 */
export function detectFeetCrossing(
  handle: PortalFrame,
  previousFeet: THREE.Vector3,
  feet: THREE.Vector3,
): CrossingSide | null {
  const before = handle.group.worldToLocal(localA.copy(previousFeet));
  const after = handle.group.worldToLocal(localB.copy(feet));
  const withinOpening =
    Math.abs(after.x) < PORTAL_RADIUS - 0.1 &&
    after.y >= -0.35 &&
    after.y < PORTAL_CENTER_Y + PORTAL_RADIUS;
  if (!withinOpening) return null;
  if (before.z > 0 && after.z <= 0) return 1;
  if (!isOneWay(handle) && before.z < 0 && after.z >= 0) return -1;
  return null;
}

/**
 * Decide what an in-progress transit does this frame.
 * - `promote` once the camera reaches the plane, in first person, or if the camera lags far behind.
 * - `cancel` when the player steps back out with the camera (not during a click-to-walk).
 */
export function resolveTransit(
  handle: PortalFrame,
  side: CrossingSide,
  feet: THREE.Vector3,
  camera: THREE.Vector3,
  state: { walkingThrough: boolean; firstPerson: boolean },
): TransitDecision {
  const feetDepth = depth(handle, feet, side, localA);
  const cameraDepth = depth(handle, camera, side, localB);
  if (!state.walkingThrough && feetDepth > TRANSIT_CANCEL_DEPTH && cameraDepth > TRANSIT_CANCEL_DEPTH) return 'cancel';
  if (cameraDepth <= 0 || state.firstPerson || feetDepth < -TRANSIT_FORCE_DEPTH) return 'promote';
  return 'wait';
}

/** Which face a viewer stands in front of, for choosing how a portal maps into its destination. */
export function viewerSide(handle: PortalFrame, viewer: THREE.Vector3): CrossingSide {
  if (isOneWay(handle)) return 1;
  return handle.group.worldToLocal(localA.copy(viewer)).z >= 0 ? 1 : -1;
}

/**
 * Turn that carries a traveller through a portal into the arrival spawn. Entering
 * through the back face reverses the portal's direction.
 */
export function crossingYawDelta(portalYaw: number, side: CrossingSide, arrivalYaw: number): number {
  return arrivalYaw - (portalYaw + (side < 0 ? Math.PI : 0));
}

/**
 * Move a world point through the doorway, keeping its offset from the threshold.
 * The point is changed in place and returned.
 */
export function carryThroughPortal(
  point: THREE.Vector3,
  sourceOrigin: THREE.Vector3,
  yawDelta: number,
  landing: THREE.Vector3,
): THREE.Vector3 {
  return point.sub(sourceOrigin).applyAxisAngle(UP, yawDelta).add(landing);
}
