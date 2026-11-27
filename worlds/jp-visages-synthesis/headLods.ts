import * as THREE from 'three/webgpu';
import { loadGLB, disposeObject } from '@portalverse/core/rooms/kit';
import mediumUrl from './assets/head-medium.glb?url';
import farUrl from './assets/head-far.glb?url';

let cache: Promise<Array<{ skin: THREE.BufferGeometry; eyes: THREE.BufferGeometry }>> | undefined;
/** Offline Blender reductions in the exact same frame as loadSplitHead. */
export function loadHeadLods() {
  cache ??= Promise.all([mediumUrl, farUrl].map(async url => {
    const gltf = await loadGLB(url);
    gltf.scene.updateMatrixWorld(true);
    const parts: Record<string, THREE.BufferGeometry> = {};
    gltf.scene.traverse(o => {
      if (o instanceof THREE.Mesh) {
        parts[o.name] = o.geometry.clone().applyMatrix4(o.matrixWorld);
      }
    });
    disposeObject(gltf.scene);
    if (!parts.skin || !parts.eyes) throw new Error('Missing Visages LOD skin or eyes');
    return { skin: parts.skin, eyes: parts.eyes };
  })).catch(error => { cache = undefined; throw error; });
  return cache;
}
