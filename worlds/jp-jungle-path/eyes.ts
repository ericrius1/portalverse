import * as THREE from 'three/webgpu';
import { positionWorld, uniform } from 'three/tsl';
import type { WorldContext } from '@portalverse/core/types';
import { pathCenter, pathWidth } from './layout';
import { layerDepth, observeJungleSettings } from './tuning';

export const EYE_RADIUS = 0.32;
export const EYE_PERIOD = 14;
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

/** Only eye surfaces exist: discarded fragments reveal the actual scene behind. */
export function mountJungleEyes(ctx: WorldContext, parent: THREE.Group): void {
  const root = new THREE.Group();
  root.name = 'Eyes in the jungle';
  parent.add(root);
  const sphere = new THREE.SphereGeometry(EYE_RADIUS, 40, 28);
  const irisSphere = new THREE.SphereGeometry(1, 32, 20);
  const materials: THREE.MeshBasicNodeMaterial[] = [];
  const eyes = [
    { side: 1, z: 24, y: 2.25, phase: 0 },
    { side: -1, z: 2, y: 2.8, phase: 4.7 },
    { side: 1, z: -20, y: 2.45, phase: 9.2 },
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
    for (const side of [-1, 1]) {
      const ball = new THREE.Mesh(sphere, yellow);
      ball.name = 'Pure yellow eye';
      ball.position.x = side * 0.43;
      const iris = new THREE.Mesh(irisSphere, blueBlack);
      iris.name = 'Flattened blue-black iris';
      iris.position.set(side * 0.43, 0, 0.305);
      iris.scale.set(0.145, 0.18, 0.045);
      group.add(ball, iris);
    }
    group.visible = false;
    return { ...placement, group, aperture };
  });
  const target = new THREE.Vector3();
  const unsubscribe = observeJungleSettings(settings => {
    for (const eye of eyes) {
      const x = pathCenter(eye.z) + eye.side * (pathWidth(eye.z) + layerDepth(2, settings) - 0.65);
      eye.group.position.set(x, eye.y, eye.z);
      target.set(pathCenter(eye.z + 8), eye.y, eye.z + 8);
      eye.group.lookAt(target);
    }
  });
  ctx.onUpdate((_dt, elapsed) => {
    const player = ctx.player;
    for (const eye of eyes) {
      eye.aperture.value = eyeAperture(elapsed, eye.phase);
      eye.group.visible = eye.aperture.value > 0;
      if (player) {
        target.set(player.position.x, eye.y, player.position.z);
        eye.group.lookAt(target);
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
