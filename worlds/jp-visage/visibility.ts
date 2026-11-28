import * as THREE from 'three/webgpu';
import type { HeadPlacement } from './layout';
import { copyOfGeometry } from './headGeometry';

/** Distances are measured from each head's centre, for the camera of THIS pass. */
export function headDetail(distance: number): number {
  return distance < 75 ? 0 : distance < 165 ? 1 : 2;
}

/** Repack six small instanced draws, instead of submitting the entire avenue.
 * Called per scene render: portal cameras must make their own visibility choices.
 */
export function createVisibleHeads(
  heads: HeadPlacement[], matrices: THREE.Matrix4[],
  skins: THREE.BufferGeometry[], eyes: THREE.BufferGeometry[],
  skinMaterial: THREE.Material, eyeMaterial: THREE.Material,
) {
  const meshes: THREE.InstancedMesh[] = [];
  for (let level = 0; level < 3; level++) {
    for (const [kind, source, material] of [
      ['skin', skins[level], skinMaterial], ['eyes', eyes[level], eyeMaterial],
    ] as const) {
      const geo = copyOfGeometry(source);
      if (kind === 'skin') {
        geo.setAttribute('aWeep', new THREE.InstancedBufferAttribute(new Float32Array(heads.length), 1).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aCrack', new THREE.InstancedBufferAttribute(new Float32Array(heads.length * 4), 4).setUsage(THREE.DynamicDrawUsage));
      }
      const mesh = new THREE.InstancedMesh(geo, material, heads.length);
      mesh.name = `visages-${kind}-${level}`;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Individual spheres are culled below, before submitting this batch.
      mesh.frustumCulled = false;
      meshes.push(mesh);
    }
  }
  skins[0].computeBoundingSphere();
  const spheres = matrices.map(m => skins[0].boundingSphere!.clone().applyMatrix4(m));
  const frustum = new THREE.Frustum();
  const projection = new THREE.Matrix4();
  const cameraPosition = new THREE.Vector3();
  const counts = [0, 0, 0];
  function update(camera: THREE.Camera) {
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection, camera.coordinateSystem, camera.reversedDepth);
    cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    counts.fill(0);
    for (let i = 0; i < heads.length; i++) {
      if (!frustum.intersectsSphere(spheres[i])) continue;
      const level = headDetail(cameraPosition.distanceTo(spheres[i].center));
      const slot = counts[level]++;
      const skin = meshes[level * 2], eye = meshes[level * 2 + 1];
      skin.setMatrixAt(slot, matrices[i]);
      eye.setMatrixAt(slot, matrices[i]);
      const h = heads[i];
      skin.geometry.getAttribute('aWeep').setX(slot, h.weeping);
      skin.geometry.getAttribute('aCrack').setXYZW(slot, h.seed, ((h.seed * 7.31) % 1 + 1) % 1, h.crackAngle, h.crackDensity);
    }
    meshes.forEach((mesh, i) => {
      mesh.count = counts[Math.floor(i / 2)];
      mesh.instanceMatrix.needsUpdate = true;
      for (const name of ['aWeep', 'aCrack']) {
        const a = mesh.geometry.getAttribute(name);
        if (a) a.needsUpdate = true;
      }
    });
  }
  return { meshes, update, dispose() { meshes.forEach(m => { m.dispose(); m.geometry.dispose(); }); } };
}

/** Spatial batches let ordinary frustum culling skip whole stretches of rubble. */
export function spatialGroups(matrices: THREE.Matrix4[], width = 56): number[][] {
  const groups = new Map<string, number[]>();
  matrices.forEach((m, i) => {
    const key = `${Math.floor(m.elements[12] / width)},${Math.floor(m.elements[14] / width)}`;
    const group = groups.get(key) ?? [];
    group.push(i);
    groups.set(key, group);
  });
  return [...groups.values()];
}
