import { Camera, frustumPlanes, mat4Invert, mat4Mul } from '@ericrius1/weft';

const overrides = new WeakMap<Camera, Float32Array>();

/** Preserve the complete engine lens, including portal shear and oblique clipping.
 * weft has a view override but no projection override. Extend its public update
 * method once per camera so View.update uploads the corrected derived matrices.
 */
export function setWeftProjection(camera: Camera, projection: ArrayLike<number>): void {
  let matrix = overrides.get(camera);
  if (!matrix) {
    matrix = new Float32Array(16);
    overrides.set(camera, matrix);
    const update = camera.update.bind(camera);
    let cuts = -1;
    camera.update = (width, height) => {
      update(width, height);
      camera.proj.set(matrix!);
      mat4Mul(camera.proj, camera.view, camera.viewProj);
      mat4Invert(camera.viewProj, camera.invViewProj);
      mat4Invert(camera.proj, camera.invProj);
      mat4Mul(camera.proj, camera.viewRel, camera.viewProjRel);
      mat4Invert(camera.viewProjRel, camera.invViewProjRel);
      frustumPlanes(camera.viewProj, camera.planes);
      if (cuts !== camera.cuts) {
        camera.prevViewProj.set(camera.viewProj);
        camera.prevViewProjRel.set(camera.viewProjRel);
        cuts = camera.cuts;
      }
    };
  }
  // WebGPU z is [0,w]. Reverse it for weft's greater-depth pipelines:
  // z_weft = w_engine - z_engine. All other rows stay exactly as supplied.
  matrix.set(projection);
  for (let column = 0; column < 16; column += 4) {
    matrix[column + 2] = projection[column + 3] - projection[column + 2];
  }
}
