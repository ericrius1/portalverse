import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Camera } from '@ericrius1/weft';
import { projectionToLens } from '../rooms/weft';

/**
 * Portal windows draw rooms through off-axis frusta. A weft room must see exactly the
 * frustum Three uses, or its picture slides against the portal's opening. weft keeps
 * reversed-Z, so only the x and y rows of the two projections must agree.
 */
describe('projectionToLens', () => {
  it('clips a wall behind the snapshot doorway before it can occlude the room', () => {
    const three = new THREE.PerspectiveCamera(44, 1, 15.5, 275.5);
    three.coordinateSystem = THREE.WebGPUCoordinateSystem;
    three.updateProjectionMatrix();
    const lens = projectionToLens(three.projectionMatrix.elements);
    expect(lens.near).toBeCloseTo(15.5);
    const weft = new Camera();
    weft.fovY = lens.fovY;
    weft.near = lens.near!;
    weft.update(512, 512);
    const depthAt = (distance: number) => new THREE.Vector4(0, 0, -distance, 1)
      .applyMatrix4(new THREE.Matrix4().fromArray(weft.proj));
    const wall = depthAt(8), inside = depthAt(20);
    expect(wall.z).toBeGreaterThan(wall.w); // rejected by reversed-Z near clipping
    expect(inside.z).toBeLessThan(inside.w);
    expect(inside.z).toBeGreaterThan(0);
  });

  it('does not turn a tilted portal clipping plane into a perpendicular cut', () => {
    const three = new THREE.PerspectiveCamera(60, 1, .1, 450);
    three.coordinateSystem = THREE.WebGPUCoordinateSystem;
    three.updateProjectionMatrix();
    expect(projectionToLens(three.projectionMatrix.elements).near).toBeCloseTo(.1);
    three.projectionMatrix.elements[2] = .4;
    expect(projectionToLens(three.projectionMatrix.elements).near).toBeUndefined();
  });
  const cases: Array<[string, (cam: THREE.PerspectiveCamera) => void]> = [
    ['a centred view', () => {}],
    ['an off-axis portal window', cam => cam.setViewOffset(1600, 900, 220, 140, 640, 360)],
    ['a window off the other corner', cam => cam.setViewOffset(1600, 900, 900, 520, 500, 300)],
  ];
  for (const [name, setup] of cases) {
    it(`matches Three's frustum for ${name}`, () => {
      const three = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 450);
      three.coordinateSystem = THREE.WebGPUCoordinateSystem;
      setup(three);
      three.updateProjectionMatrix();
      const p = three.projectionMatrix.elements;
      const lens = projectionToLens(p);

      const weft = new Camera();
      weft.fovY = lens.fovY;
      weft.shift = lens.shift;
      weft.near = 0.1;
      const height = 360;
      weft.update(Math.round(height * lens.aspect), height);
      for (const i of [0, 5, 8, 9]) expect(weft.proj[i]).toBeCloseTo(p[i], 3);
    });
  }
});
