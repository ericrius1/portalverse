import { expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { createVisibleHeads, spatialGroups } from './visibility';
import { buildVisageSynthesisPlan } from './layout';

it('selects detail and culls per camera while preserving each head’s attributes', () => {
  const heads = buildVisageSynthesisPlan().heads.slice(0, 3);
  const matrices = [0, -100, -220].map(z => new THREE.Matrix4().makeTranslation(0, 0, z));
  const geo = new THREE.SphereGeometry(2, 8, 6);
  const mat = new THREE.MeshBasicMaterial();
  const batch = createVisibleHeads(heads, matrices, [geo, geo, geo], [geo, geo, geo], mat, mat);
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 500);
  camera.coordinateSystem = THREE.WebGPUCoordinateSystem;
  camera.updateProjectionMatrix();
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld(true);
  batch.update(camera);
  expect(batch.meshes.map(m => m.count)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(batch.meshes[2].geometry.getAttribute('aCrack').getX(0)).toBeCloseTo(heads[1].seed);
  // A second pass looks back from the other end, moving the far head to full detail.
  camera.position.z = -230;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  batch.update(camera);
  expect(batch.meshes[0].geometry.getAttribute('aCrack').getX(0)).toBeCloseTo(heads[2].seed);
  // Looking away submits none of them, regardless of which pass drew previously.
  camera.lookAt(0, 0, -300);
  camera.updateMatrixWorld(true);
  batch.update(camera);
  expect(batch.meshes.every(m => m.count === 0)).toBe(true);
  batch.dispose(); geo.dispose(); mat.dispose();
});

it('partitions scenery into spatial groups without dropping or duplicating instances', () => {
  const matrices = [-200, -199, 0, 10, 200].map(z => new THREE.Matrix4().makeTranslation(0, 0, z));
  const groups = spatialGroups(matrices);
  expect(groups).toHaveLength(3);
  expect(groups.flat().sort()).toEqual([0, 1, 2, 3, 4]);
});
