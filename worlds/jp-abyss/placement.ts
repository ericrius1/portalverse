import { MathUtils, type Object3D } from 'three/webgpu';

export type Rotation = [number, number, number]; // XYZ Euler angles in degrees in the parent's frame.
export interface Pose { x: number; y: number; z: number; rotation?: Rotation }
export interface EncounterPlacement { chest: Pose; shadow: Pose }

export function validPose(value: unknown): value is Pose {
  if (!value || typeof value !== 'object') return false;
  const p = value as Pose;
  return [p.x, p.y, p.z].every(Number.isFinite) && (p.rotation === undefined ||
    (Array.isArray(p.rotation) && p.rotation.length === 3 && p.rotation.every(Number.isFinite)));
}

export function applyPose(object: Object3D, pose: Pose) {
  object.position.set(pose.x, pose.y, pose.z);
  const [x, y, z] = pose.rotation ?? [0, 0, 0];
  object.rotation.set(MathUtils.degToRad(x), MathUtils.degToRad(y), MathUtils.degToRad(z));
}

export function readPose(object: Object3D): Pose {
  const { x, y, z } = object.position;
  const r = object.rotation;
  return { x, y, z, rotation: [MathUtils.radToDeg(r.x), MathUtils.radToDeg(r.y), MathUtils.radToDeg(r.z)] };
}
