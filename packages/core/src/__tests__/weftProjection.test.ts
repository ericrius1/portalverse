import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { Camera } from '@ericrius1/weft';
import { framePortal, portalPixels } from '../engine/PortalPreviews';
import { setWeftProjection } from '../rooms/weftProjection';

describe('weft portal projection', () => {
  for (const distance of [3, 21.25, 72.5]) {
    for (const pitch of [-0.08, 0, 0.12]) {
      it(`preserves clipping and screen registration at ${distance} m, pitch ${pitch}`, () => {
        const aperture = new THREE.Mesh(new THREE.CircleGeometry(2.77, 32), new THREE.MeshBasicMaterial());
        aperture.position.set(0, 2.85, 0);
        aperture.updateMatrixWorld();
        const viewer = new THREE.PerspectiveCamera(62, 1.6, .1, 450);
        viewer.coordinateSystem = THREE.WebGPUCoordinateSystem;
        viewer.position.set(.5, 1.65, distance);
        viewer.rotation.set(pitch, .03, 0, 'YXZ');
        viewer.updateProjectionMatrix();
        viewer.updateMatrixWorld();
        const size = new THREE.Vector2(1280, 800);
        const rect = portalPixels(aperture, viewer, size, new THREE.Vector4());
        const destination = new THREE.PerspectiveCamera();
        const spawn = { position: [-13.05, 0, 61.05] as [number, number, number], yaw: -.7190934 };
        framePortal(destination, viewer, aperture, spawn, 0, 0, size, rect);
        const camera = new Camera();
        camera.viewOverride = new Float32Array(destination.matrixWorldInverse.elements);
        setWeftProjection(camera, destination.projectionMatrix.elements);
        camera.update(rect.z, rect.w);
        const actual = new THREE.Matrix4().fromArray(camera.viewProj);
        const expected = new THREE.Matrix4().multiplyMatrices(destination.projectionMatrix, destination.matrixWorldInverse);
        for (const z of [-20, -2, 1]) {
          const point = new THREE.Vector3(.25, 2, z).applyAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw)
            .add(new THREE.Vector3(...spawn.position));
          const a = new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(actual);
          const e = new THREE.Vector4(point.x, point.y, point.z, 1).applyMatrix4(expected);
          expect(a.x / a.w).toBeCloseTo(e.x / e.w, 4);
          expect(a.y / a.w).toBeCloseTo(e.y / e.w, 4);
          // The compositor reverses depth directly; no scalar near-plane approximation.
          expect(1 - a.z / a.w).toBeCloseTo(e.z / e.w, 4);
          if (z > 0) expect(a.z).toBeGreaterThan(a.w); // wall behind the doorway
          else {
            expect(a.z).toBeGreaterThan(0);
            expect(a.z).toBeLessThan(a.w);
            expect(camera.sees(point.toArray(), .1)).toBe(true);
          }
          const reconstructed = a.clone().applyMatrix4(new THREE.Matrix4().fromArray(camera.invViewProj));
          expect(reconstructed.x / reconstructed.w).toBeCloseTo(point.x, 3);
          expect(reconstructed.z / reconstructed.w).toBeCloseTo(point.z, 3);
        }
        // Camera-relative shaders and subsequent View.update calls use the same lens.
        const old = Array.from(camera.viewProj);
        camera.update(rect.z, rect.w);
        expect(Array.from(camera.prevViewProj)).toEqual(old);
        expect(Array.from(camera.viewProj)).toEqual(old);
        const relative = new THREE.Vector4(0, 0, -3, 1).applyMatrix4(new THREE.Matrix4().fromArray(camera.viewProjRel));
        const world = new THREE.Vector4(camera.position[0], camera.position[1], camera.position[2] - 3, 1).applyMatrix4(actual);
        expect(relative.x).toBeCloseTo(world.x, 3);
        expect(relative.z).toBeCloseTo(world.z, 3);
        aperture.geometry.dispose();
        aperture.material.dispose();
      });
    }
  }

  it('replaces a portal projection on a shared camera when drawing the active room', () => {
    const camera = new Camera();
    const engine = new THREE.PerspectiveCamera(62, 1.6, .1, 450);
    engine.coordinateSystem = THREE.WebGPUCoordinateSystem;
    engine.updateProjectionMatrix();
    const portal = engine.projectionMatrix.clone();
    portal.elements[6] = .12;
    setWeftProjection(camera, portal.elements);
    camera.update(1280, 800);
    setWeftProjection(camera, engine.projectionMatrix.elements);
    camera.cut();
    camera.update(1280, 800);
    expect(camera.proj[6]).toBe(0);
    expect(Array.from(camera.prevViewProj)).toEqual(Array.from(camera.viewProj));
  });
});
