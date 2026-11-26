// What each projector throws: its image painted once a frame into its layer of projectorImage, from the programs in
// programs.wgsl (the art: caustics, a canopy's light, growing line-work...), crossing from one program to the next
// when the rig asks. A layer the rig doesn't mark for painting this frame keeps last frame's picture.
#include "./light"
#include "./programs"

@group(2) @binding(0) var paintOut: texture_storage_2d_array<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn paint(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(paintOut);
  let i = id.z;
  if (id.x >= size.x || id.y >= size.y || i >= projectorCount()) { return; }
  let P = projectors[i];
  if (P.power <= 0.0 || P.clock.y < 0.5) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let t = P.clock.x;
  let seed = P.paint.w;
  let aspect = select(1.0, P.mapU.w, u32(P.map.x + 0.5) == 2u);
  let a = u32(P.paint.x + 0.5) % PROGRAM_COUNT;
  var c = projectionProgram(a, uv, t, seed, aspect);
  let k = P.paint.z;
  if (k > 0.0) {
    let b = u32(P.paint.y + 0.5) % PROGRAM_COUNT;
    c = mix(c, projectionProgram(b, uv, t, seed, aspect), smoothstep(0.0, 1.0, k));
  }
  textureStore(paintOut, id.xy, i, vec4f(max(c, vec3f(0.0)), 1.0));
}
