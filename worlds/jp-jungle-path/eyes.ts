import * as THREE from 'three/webgpu';
import { positionWorld, uniform } from 'three/tsl';
import type { WorldContext } from '@portalverse/core/types';
import { foliageSkinX, pathCenter, pathWidth } from './layout';
import { getJungleSettings, layerDepth, observeJungleSettings } from './tuning';

export const EYE_RADIUS = 0.32;
export const EYE_PERIOD = 14;
export const RETICLE_RADIUS_SCALE = 1.15;
const ease = (t: number) => t * t * (3 - 2 * t);

/** Appear through a central slit, watch, blink once, close, and vanish for a while. */
export function eyeAperture(elapsed: number, phase = 0): number {
  const t = ((elapsed + phase) % EYE_PERIOD + EYE_PERIOD) % EYE_PERIOD;
  if (t < 1) return 0;
  if (t < 1.4) return ease((t - 1) / 0.4);
  if (t < 5.3) return 1;
  if (t < 5.43) return 1 - ease((t - 5.3) / 0.13);
  if (t < 5.65) return ease((t - 5.43) / 0.22);
  if (t < 8.3) return 1;
  if (t < 8.7) return 1 - ease((t - 8.3) / 0.4);
  return 0;
}

/** Small reticle ellipse, expanded by the pair's apparent size. Point is camera-local. */
export function reticleOnEyes(point: THREE.Vector3, projection: THREE.Matrix4): boolean {
  const depth = -point.z;
  if (depth <= 0) return false;
  const sx = projection.elements[0];
  const sy = projection.elements[5];
  const x = point.x * sx / depth;
  const y = point.y * sy / depth;
  if (Math.abs(x) > 1 || Math.abs(y) > 1) return false;
  return (x / ((0.035 + 0.65 * sx / depth) * RETICLE_RADIUS_SCALE)) ** 2
    + (y / ((0.035 + EYE_RADIUS * sy / depth) * RETICLE_RADIUS_SCALE)) ** 2 <= 1;
}

export interface GazeBlink { open: number; hiddenUntil: number }
/** Fast closure, a short unseen pause, then a slower return after looking away. */
export function updateGazeBlink(state: GazeBlink, aimed: boolean, dt: number, elapsed: number): number {
  if (aimed) state.hiddenUntil = elapsed + 0.9;
  state.open = THREE.MathUtils.clamp(state.open + Math.max(0, dt)
    * (elapsed < state.hiddenUntil ? -1 / 0.1 : 1 / 0.35), 0, 1);
  return ease(state.open);
}

/** Only eye surfaces exist: discarded fragments reveal the actual scene behind. */
export function mountJungleEyes(ctx: WorldContext, parent: THREE.Group): void {
  const root = new THREE.Group();
  root.name = 'Eyes in the jungle';
  parent.add(root);
  const sphere = new THREE.SphereGeometry(EYE_RADIUS, 40, 28);
  const irisSphere = new THREE.SphereGeometry(1, 32, 20);
  const materials: THREE.MeshBasicNodeMaterial[] = [];
  let settings = getJungleSettings();
  const front = new THREE.Vector3(0, 0, 1);
  const eyes = [
    { side: 1, z: 24, y: 2.25, phase: 0, layer: 2 },
    { side: -1, z: 2, y: 2.8, phase: 4.7, layer: 2 },
    { side: 1, z: -20, y: 2.45, phase: 9.2, layer: 2 },
    { side: -1, z: 29, y: 2.5, phase: 2.1, layer: 2 },
    { side: 1, z: 13, y: 2.7, phase: 6.4, layer: 3 },
    { side: -1, z: 18, y: 2.3, phase: 10.8, layer: 3 },
    { side: 1, z: 4, y: 2.4, phase: 3.2, layer: 2 },
    { side: -1, z: -9, y: 2.65, phase: 7.8, layer: 2 },
    { side: 1, z: -8, y: 2.8, phase: 12.1, layer: 4 },
    { side: -1, z: -22, y: 2.35, phase: 1.5, layer: 3 },
    { side: 1, z: -31, y: 2.55, phase: 5.4, layer: 2 },
    { side: -1, z: 10, y: 2.75, phase: 9.8, layer: 4 },
  ].map((placement, index) => {
    const group = new THREE.Group();
    group.name = `Watching eyes ${index + 1}`;
    root.add(group);
    const aperture = uniform(0);
    const centerY = uniform(placement.y);
    const material = (hex: string) => {
      const mat = new THREE.MeshBasicNodeMaterial({
        color: hex, toneMapped: false, fog: false, alphaTest: 0.5,
      });
      // Both horizontal cut planes move symmetrically. Alpha testing discards
      // pixels AND their depth; there are no lids, masks, fades, or squash scaling.
      mat.opacityNode = positionWorld.y.sub(centerY).abs()
        .lessThan(aperture.mul(EYE_RADIUS)).select(1, 0);
      materials.push(mat);
      return mat;
    };
    const yellow = material('#ffff00');
    const blueBlack = material('#040b18');
    const irises: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const ball = new THREE.Mesh(sphere, yellow);
      ball.name = 'Pure yellow eye';
      ball.position.x = side * 0.43;
      const iris = new THREE.Mesh(irisSphere, blueBlack);
      iris.name = 'Flattened blue-black iris';
      iris.position.set(side * 0.43, 0, 0.305);
      iris.scale.set(0.145, 0.18, 0.045);
      group.add(ball, iris);
      irises.push(iris);
    }
    group.visible = false;
    return { ...placement, group, aperture, irises, extra: index >= 3,
      gaze: { open: 1, hiddenUntil: -Infinity } };
  });
  const target = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const cameraPoint = new THREE.Vector3();
  const unsubscribe = observeJungleSettings(next => {
    settings = next;
    for (const eye of eyes) {
      // Sample the same bowed surface as the leaves at the approved eye height.
      const skinY = eye.y;
      const x = settings.pupilsOnly
        ? foliageSkinX(eye.z, skinY, eye.layer, eye.side, settings) - eye.side * 0.65
        : pathCenter(eye.z) + eye.side * (pathWidth(eye.z) + layerDepth(eye.layer, settings) - 0.65);
      eye.group.position.set(x, eye.y, eye.z);
      if (settings.pupilsOnly) {
        const slope = (foliageSkinX(eye.z + 0.02, skinY, eye.layer, eye.side, settings)
          - foliageSkinX(eye.z - 0.02, skinY, eye.layer, eye.side, settings)) / 0.04;
        direction.set(-eye.side, 0, eye.side * slope).normalize();
        eye.group.quaternion.setFromUnitVectors(front, direction);
      } else {
        target.set(pathCenter(eye.z + 8), eye.y, eye.z + 8);
        eye.group.lookAt(target);
        eye.irises.forEach((iris, i) => {
          iris.position.set((i * 2 - 1) * 0.43, 0, 0.305);
          iris.quaternion.identity();
        });
      }
      if (!settings.peripheralEyes) {
        eye.gaze.open = 1;
        eye.gaze.hiddenUntil = -Infinity;
        if (eye.extra) eye.group.visible = false;
      }
    }
  });
  ctx.onUpdate((dt, elapsed) => {
    const player = ctx.player;
    const camera = player?.camera;
    if (camera) {
      camera.updateWorldMatrix(true, false);
      camera.getWorldPosition(cameraPosition);
    }
    root.updateWorldMatrix(true, true);
    for (const eye of eyes) {
      if (eye.extra && !settings.peripheralEyes) continue;
      let gaze = 1;
      if (settings.peripheralEyes && camera) {
        eye.group.getWorldPosition(cameraPoint).applyMatrix4(camera.matrixWorldInverse);
        gaze = updateGazeBlink(eye.gaze, reticleOnEyes(cameraPoint, camera.projectionMatrix), dt, elapsed);
      }
      eye.aperture.value = eyeAperture(elapsed, eye.phase) * gaze;
      eye.group.visible = eye.aperture.value > 0;
      if (!player) continue;
      if (!settings.pupilsOnly) {
        target.set(player.position.x, eye.y, player.position.z);
        eye.group.lookAt(target);
      } else if (camera) {
        target.copy(cameraPosition);
        eye.group.worldToLocal(target);
        eye.irises.forEach((iris, i) => {
          const x = (i * 2 - 1) * 0.43;
          direction.set(target.x - x, target.y, target.z);
          // Keep each flattened iris seated on the sphere's front cap.
          const yaw = THREE.MathUtils.clamp(Math.atan2(direction.x, direction.z), -0.65, 0.65);
          const pitch = THREE.MathUtils.clamp(Math.atan2(direction.y, Math.hypot(direction.x, direction.z)), -0.45, 0.45);
          direction.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
          iris.position.copy(direction).multiplyScalar(0.305);
          iris.position.x += x;
          iris.quaternion.setFromUnitVectors(front, direction);
        });
      }
    }
  });
  ctx.onDispose(() => {
    unsubscribe();
    root.removeFromParent();
    sphere.dispose();
    irisSphere.dispose();
    materials.forEach(material => material.dispose());
  });
}
