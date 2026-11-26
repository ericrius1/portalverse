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
 * the view never jumps. Backing in, the camera leads instead: the crossing starts
 * and promotes as soon as the camera passes through the opening.
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

type PortalFrame = Pick<PortalVisualHandle, 'group' | 'aperture' | 'portal' | 'openingRadius' | 'portalCenterY' | 'useFullOrientation'>;
type CrossingHandle = Pick<PortalVisualHandle, 'group' | 'aperture' | 'openingRadius' | 'portalCenterY' | 'useFullOrientation'>;

/** Depth of a world point along the portal normal, signed so the entry side is positive. */
function depth(handle: Pick<PortalVisualHandle, 'group' | 'aperture'>, point: THREE.Vector3, side: CrossingSide, out: THREE.Vector3): number {
  return handle.group.worldToLocal(out.copy(point)).z * side;
}

/**
 * Which face the feet passed through between two frames, or null. The traveller's
 * body must pass inside the circular opening itself. One-way portals ignore the back face.
 */
export function detectFeetCrossing(
  handle: CrossingHandle,
  previousFeet: THREE.Vector3,
  feet: THREE.Vector3,
): CrossingSide | null {
  const before = handle.group.worldToLocal(localA.copy(previousFeet));
  const after = handle.group.worldToLocal(localB.copy(feet));
  const radius = handle.openingRadius ?? PORTAL_RADIUS;
  let withinOpening: boolean;
  if (handle.useFullOrientation) {
    withinOpening = Math.hypot(after.x, after.y) < radius - 0.1;
  } else {
    const centerY = handle.portalCenterY ?? PORTAL_CENTER_Y;
    const radialDist = Math.hypot(after.x, after.y + 1.0 - centerY);
    withinOpening = after.y >= -0.35 && radialDist < radius - 0.1;
  }
  if (!withinOpening) return null;
  if (before.z > 0 && after.z <= 0) return 1;
  if (!isOneWay(handle) && before.z < 0 && after.z >= 0) return -1;
  return null;
}

/** Which face the camera passed through between two frames, or null. It must pass inside the opening. */
export function detectCameraCrossing(
  handle: CrossingHandle,
  previousCamera: THREE.Vector3,
  camera: THREE.Vector3,
): CrossingSide | null {
  const before = handle.group.worldToLocal(localA.copy(previousCamera));
  const after = handle.group.worldToLocal(localB.copy(camera));
  const radius = handle.openingRadius ?? PORTAL_RADIUS;
  const centerY = handle.useFullOrientation ? 0 : (handle.portalCenterY ?? PORTAL_CENTER_Y);
  if (Math.hypot(after.x, after.y - centerY) >= radius - 0.1) return null;
  if (before.z > 0 && after.z <= 0) return 1;
  if (!isOneWay(handle) && before.z < 0 && after.z >= 0) return -1;
  return null;
}

/** Where the feet and chase camera were last frame and are now. */
export interface FrameMotion {
  previousFeet: THREE.Vector3;
  feet: THREE.Vector3;
  previousCamera: THREE.Vector3;
  camera: THREE.Vector3;
}

export interface CrossingStart {
  side: CrossingSide;
  /** What reached the opening first: the feet, or the camera when backing in. */
  by: 'feet' | 'camera';
}

/**
 * Whether the player starts going through a portal this frame. Walking forward the
 * feet lead. Backing in, the 3rd-person camera reaches the opening first; starting
 * then keeps it from looking back at the room it's leaving from the far side of the
 * portal, where the scenery around the ring would snap when the feet finally crossed.
 */
export function beginCrossing(
  handle: CrossingHandle,
  motion: FrameMotion,
  firstPerson: boolean,
): CrossingStart | null {
  const feetSide = detectFeetCrossing(handle, motion.previousFeet, motion.feet);
  if (feetSide) return { side: feetSide, by: 'feet' };
  if (firstPerson) return null;
  const cameraSide = detectCameraCrossing(handle, motion.previousCamera, motion.camera);
  return cameraSide ? { side: cameraSide, by: 'camera' } : null;
}

/**
 * Whether a nearby portal should offer the [E] prompt: the player must be on an
 * allowed entry side (front only for one-way portals) and facing toward the opening.
 */
export function canOfferPortalPrompt(
  handle: PortalFrame,
  playerPos: THREE.Vector3,
  playerYaw: number,
): boolean {
  const feetLocal = handle.group.worldToLocal(localA.copy(playerPos));
  if (isOneWay(handle) && feetLocal.z <= 0) return false;
  if (handle.useFullOrientation) return true;
  const toX = handle.portal.position[0] - playerPos.x;
  const toZ = handle.portal.position[2] - playerPos.z;
  const len = Math.hypot(toX, toZ);
  if (len < 0.05) return false;
  const fwdX = -Math.sin(playerYaw);
  const fwdZ = -Math.cos(playerYaw);
  return (fwdX * toX + fwdZ * toZ) / len > 0.35;
}

/**
 * Decide what an in-progress transit does this frame.
 * - `promote` once the camera reaches the plane, in first person, or if the camera lags far behind.
 * - `cancel` when the player steps back out with the camera (not during a click-to-walk).
 */
export function resolveTransit(
  handle: Pick<PortalVisualHandle, 'group' | 'aperture'>,
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
export function viewerSide(handle: Pick<PortalVisualHandle, 'group' | 'aperture'>, viewer: THREE.Vector3): CrossingSide {
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
