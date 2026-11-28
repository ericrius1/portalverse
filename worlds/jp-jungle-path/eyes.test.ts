import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import type { WorldContext } from '@portalverse/core/types';
import { EYE_PERIOD, EYE_RADIUS, eyeAperture, mountJungleEyes } from './eyes';

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
    mountJungleEyes({ player: null, onUpdate: fn => updates.push(fn), onDispose: fn => cleanups.push(fn) } as Partial<WorldContext> as WorldContext, parent);
    const root = parent.children[0];
    expect(root.children).toHaveLength(3);
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
