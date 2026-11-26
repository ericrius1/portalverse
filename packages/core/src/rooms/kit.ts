import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Small helpers for rooms. Import assets with Vite's `?url` suffix
 * (`import couch from './assets/couch.glb?url'`) so the room's build budget
 * counts them. `breathe` spreads slow setup over several frames (see
 * "Loading: about 10 seconds, in small pieces" in COLLAB.md), and `NO_GROUND`
 * marks drops in rooms that allow falling.
 */

export { NO_GROUND } from '../engine/falling';
export { breathe } from '../engine/breathe';

const gltfLoader = new GLTFLoader();

/** Load a GLB or glTF file. Uncompressed models only (no Draco, meshopt or KTX2). */
export function loadGLB(url: string): Promise<GLTF> {
  return gltfLoader.loadAsync(url);
}

/**
 * Dispose every geometry, material and texture under `root`. Call it once on each
 * model a room loaded; clones made with `.clone()` share these resources.
 */
export function disposeObject(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  root.traverse(object => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value);
      }
      material.dispose();
    }
  });
  for (const texture of textures) texture.dispose();
}

/**
 * Wrap a loaded model so its footprint is centred on the origin and its lowest
 * point sits at y = 0. Pass `precise` for skinned models, so the posed skeleton
 * is measured rather than the bind pose.
 */
export function groundModel(model: THREE.Object3D, precise = false): THREE.Group {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model, precise);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.z -= center.z;
  model.position.y -= box.min.y;
  const holder = new THREE.Group();
  holder.add(model);
  return holder;
}

/** Deterministic pseudo-random numbers in [0, 1), so a room looks the same on every visit. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
