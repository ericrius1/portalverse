// The projectors' beams in the haze (rig.ts `beams`): for every pixel, the light the beams scatter toward the eye along
// its ray, up to whatever the scene drew there (its depth), each beam carrying its image (a throw shows its picture's
// rays in the air) and cut by what stands in the way (columns throw shafts through it). Drawn additively over the
// scene into the same colour target, a fullscreen triangle per view.
#include "weft/fullscreen"
#include "./drones"

@group(2) @binding(0) var sceneDepth: texture_depth_2d;

override STEPS: u32 = 12u;

@fragment fn fs(i: FullscreenOut) -> @location(0) vec4f {
  if (RV.density <= 0.0) { return vec4f(0.0); }
  let px = vec2i(i.pos.xy);
  let uv = (i.pos.xy - RV.vp.xy) / max(RV.vp.zw, vec2f(1.0));
  let d = textureLoad(sceneDepth, px, 0);
  let o = frame.camPos;
  let dir = viewRay(uv);
  var tMax = 220.0;
  if (d > 0.0) { tMax = min(tMax, distance(worldFromDepth(uv, d), o)); }
  // (each pixel's samples offset a little from its neighbours', so a few steps read as a smooth glow)
  let jitter = fract(52.9829189 * fract(dot(i.pos.xy, vec2f(0.06711056, 0.00583715))) + f32(frame.frame % 64u) * 0.618034);
  let c = projectedHaze(o, dir, tMax, jitter, STEPS, RV.density);
  return vec4f(c, 0.0);
}
