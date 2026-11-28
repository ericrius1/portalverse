import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import type { WorldContext } from '@portalverse/core/types';
import { EYE_PERIOD, EYE_RADIUS, eyeAperture, mountJungleEyes, reticleOnEyes, updateGazeBlink } from './eyes';

import { jungleDefaults, updateJungleSettings } from './tuning';

afterEach(() => updateJungleSettings(jungleDefaults));

describe('eyes appearing through a clipped blink', () => {
  it('opens from nothing, holds, blinks, then fully vanishes with a seamless loop', () => {
    for (const t of [0, 0.9, 8.7, 12, 14]) expect(eyeAperture(t)).toBe(0);
    expect(eyeAperture(1.2)).toBeCloseTo(0.5);
    expect(eyeAperture(2)).toBe(1);
    expect(eyeAperture(5.43)).toBeCloseTo(0);
    expect(eyeAperture(6)).toBe(1);
    expect(eyeAperture(8.5)).toBeCloseTo(0.5);
    for (let i = 0; i < 1400; i++) {
      const aperture = eyeAperture(i / 100);
      expect(aperture).toBeGreaterThanOrEqual(0);
      expect(aperture).toBeLessThanOrEqual(1);
      expect(eyeAperture(i / 100 + EYE_PERIOD)).toBeCloseTo(aperture, 10);
    }
  });
  it('uses yellow spheres and oblate dark irises with shared geometric clipping, no eyelids', () => {
    const parent = new THREE.Group();
    const updates: Array<(dt: number, time: number) => void> = [];
    const cleanups: Array<() => void> = [];
    mountJungleEyes({ player: null, onUpdate: (fn: (dt: number, time: number) => void) => updates.push(fn), onDispose: (fn: () => void) => cleanups.push(fn) } as Partial<WorldContext> as WorldContext, parent);
    const root = parent.children[0];
    expect(root.children).toHaveLength(12);
    const first = root.children[0];
    expect(first.children).toHaveLength(4);
    const ball = first.children[0] as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicNodeMaterial>;
    const iris = first.children[1] as THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicNodeMaterial>;
    expect(ball.geometry.parameters.radius).toBe(EYE_RADIUS);
    expect(ball.material.color.getHexString()).toBe('ffff00');
    expect(iris.material.color.getHexString()).toBe('040b18');
    expect(iris.scale.z).toBeLessThan(iris.scale.x / 2);
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const material = object.material as THREE.MeshBasicNodeMaterial;
      expect(material.toneMapped).toBe(false);
      expect(material.fog).toBe(false);
      expect(material.alphaTest).toBe(0.5);
      expect(material.transparent).toBe(false);
      expect(material.opacityNode).not.toBeNull();
      resources.add(object.geometry);
      resources.add(material);
    });
    updates.forEach(fn => fn(0, 2));
    expect(first.visible).toBe(true);
    expect(root.children.slice(3).every(eye => !eye.visible)).toBe(true);
    updates.forEach(fn => fn(0, 10));
    expect(first.visible).toBe(false);
    expect(ball.scale.toArray()).toEqual([1, 1, 1]);
    const released = new Set<unknown>();
    resources.forEach(resource => {
      if (resource instanceof THREE.Material) resource.addEventListener('dispose', () => released.add(resource));
      else resource.addEventListener('dispose', () => released.add(resource));
    });
    cleanups.forEach(fn => fn());
    expect(released.size).toBe(resources.size);
    expect(parent.children).toHaveLength(0);
  });
});

function mountWithCamera() {
  const parent = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 200);
  const updates: Array<(dt: number, time: number) => void> = [];
  const cleanups: Array<() => void> = [];
  mountJungleEyes({ player: { camera, position: camera.position }, onUpdate: (fn: (dt: number, time: number) => void) => updates.push(fn),
    onDispose: (fn: () => void) => cleanups.push(fn) } as unknown as WorldContext, parent);
  return { camera, eyes: parent.children[0].children,
    tick: (dt: number, time: number) => updates.forEach(fn => fn(dt, time)),
    dispose: () => cleanups.forEach(fn => fn()) };
}

describe('fixed eyes and peripheral watchers', () => {
  it('keeps eye bodies fixed to the curve while pupils track camera position and stay seated', () => {
    updateJungleSettings({ pupilsOnly: true });
    const scene = mountWithCamera();
    try {
      const eye = scene.eyes[0];
      const orientation = eye.quaternion.clone();
      const height = eye.position.y;
      scene.camera.position.set(0, 1.7, 24);
      scene.tick(0.016, 2);
      const iris = eye.children[1];
      const firstPupil = iris.position.clone();
      scene.camera.position.set(0, 3.8, 15);
      scene.tick(0.016, 2.016);
      expect(eye.quaternion.angleTo(orientation)).toBeCloseTo(0);
      expect(eye.position.y).toBe(height);
      expect(iris.position.distanceTo(firstPupil)).toBeGreaterThan(0.01);
      expect(iris.position.clone().sub(new THREE.Vector3(-0.43, 0, 0)).length()).toBeCloseTo(0.305);
      expect(iris.position.z).toBeGreaterThan(0.2);
      updateJungleSettings({ pupilsOnly: false });
      scene.tick(0.016, 2.032);
      expect(eye.quaternion.angleTo(orientation)).toBeGreaterThan(0.01);
      expect(iris.position.toArray()).toEqual([-0.43, 0, 0.305]);
      expect(iris.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    } finally { scene.dispose(); }
  });

  it('recognizes center aim, rejects behind/offscreen/peripheral pairs at different aspect ratios', () => {
    for (const aspect of [0.6, 1.6, 2.4]) {
      const camera = new THREE.PerspectiveCamera(65, aspect, 0.1, 200);
      expect(reticleOnEyes(new THREE.Vector3(0, 0, -10), camera.projectionMatrix)).toBe(true);
      expect(reticleOnEyes(new THREE.Vector3(0, 0, 10), camera.projectionMatrix)).toBe(false);
      expect(reticleOnEyes(new THREE.Vector3(5, 0, -10), camera.projectionMatrix)).toBe(false);
      expect(reticleOnEyes(new THREE.Vector3(0, 3, -10), camera.projectionMatrix)).toBe(false);
    }
  });

  it('closes quickly, stays hidden under sustained gaze, and waits before returning', () => {
    const state = { open: 1, hiddenUntil: -Infinity };
    expect(updateGazeBlink(state, true, 0.05, 2)).toBeCloseTo(0.5);
    expect(updateGazeBlink(state, true, 0.05, 2.05)).toBe(0);
    expect(updateGazeBlink(state, true, 2, 4.05)).toBe(0);
    expect(updateGazeBlink(state, false, 0.5, 4.55)).toBe(0);
    expect(updateGazeBlink(state, false, 0.175, 5)).toBeCloseTo(0.5);
    expect(updateGazeBlink(state, false, 0.175, 5.175)).toBe(1);
  });

  it('uses actual pitched camera aim, enables multiple pairs, and restores the original mode', () => {
    updateJungleSettings({ pupilsOnly: true, peripheralEyes: true });
    const scene = mountWithCamera();
    try {
      const first = scene.eyes[0];
      scene.camera.position.set(0, 0.3, 28);
      scene.camera.lookAt(first.position);
      scene.tick(0.11, 2);
      expect(first.visible).toBe(false);
      expect(scene.eyes.slice(3).filter(eye => eye.visible).length).toBeGreaterThan(1);
      scene.tick(0.1, 3);
      expect(first.visible).toBe(false);
      scene.camera.lookAt(0, 1, -35);
      scene.tick(0.1, 3.2);
      expect(first.visible).toBe(false);
      scene.tick(0.35, 4.2);
      expect(first.visible).toBe(true);
      updateJungleSettings({ peripheralEyes: false });
      scene.camera.lookAt(first.position);
      scene.tick(0.1, 4.3);
      expect(first.visible).toBe(true);
      expect(scene.eyes.slice(3).every(eye => !eye.visible)).toBe(true);
    } finally { scene.dispose(); }
  });
});
