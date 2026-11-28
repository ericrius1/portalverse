import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { jellyHeight } from './creatureMotion';
import { applyFogDensity } from './fogControls';

describe('Reef atmosphere and motion', () => {
  it('keeps jellyfish continuous through repeated ascent/descent cycles', () => {
    for (const drift of [0.15, 0.25, 0.35]) {
      for (const phase of [0, 2, 5]) {
        let previous = jellyHeight(8, drift, phase, 0);
        for (let frame = 1; frame < 60 * 180; frame++) {
          const height = jellyHeight(8, drift, phase, frame / 60);
          expect(Math.abs(height - previous)).toBeLessThan(0.01);
          expect(height).toBeGreaterThanOrEqual(5.88);
          expect(height).toBeLessThanOrEqual(10.12);
          previous = height;
        }
      }
    }
  });

  it('reduces both close haze and distant fog without replacing the scene fog', () => {
    const scene = new THREE.Scene();
    const fog = new THREE.Fog('#0fa2ab', -25, 50);
    scene.fog = fog;
    const factor = (distance: number) => THREE.MathUtils.smoothstep(distance, fog.near, fog.far);
    applyFogDensity(fog, 1);
    const original = [0, 10, 30, 50].map(factor);
    applyFogDensity(fog, 0.75);
    [0, 10, 30, 50].forEach((distance, i) => expect(factor(distance)).toBeLessThan(original[i]));
    expect(scene.fog).toBe(fog);
    applyFogDensity(fog, 0);
    expect(factor(100)).toBeLessThan(0.000001);
    applyFogDensity(fog, 1);
    expect(fog.near).toBe(-25);
    expect(fog.far).toBe(50);
  });
});
