import * as THREE from 'three/webgpu';

/**
 * Every pass that draws a room scene (the main view, live portal windows and
 * portal snapshots) renders into a target made here. WebGPU keys render
 * pipelines on colour format and sample count, so sharing both means a preview
 * room promoted to the active room reuses pipelines it already compiled instead
 * of compiling new ones on the crossing frame. Change the options here, never
 * per pass.
 */
export function createSceneTarget(width: number, height: number): THREE.RenderTarget {
  return new THREE.RenderTarget(Math.max(1, width), Math.max(1, height), {
    type: THREE.HalfFloatType,
    samples: 0,
  });
}
