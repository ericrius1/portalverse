// Projection mapping: light thrown by projectors (drones, masts, lamps on a façade) onto whatever a surface shader
// draws, and seen in the air as beams. One include for the surface side: #include it, bind the rig's resources by name
// (ProjectionRig.bindings: `projectors`, `projectorImage`, `projectorDepth`) and add
//
//     c += projectionTake(albedo) * projectedLight(p, n);
//
// to the colour (p the world position, n the shading normal). The rig (rig.ts) paints each projector's image once a
// frame (content.wgsl, with the programs in programs.wgsl) and keeps a depth map of what each one sees, so light
// lands only where the projector can reach: columns throw shadows, the backs of things stay dark.
//
// Each projector decides WHERE its light lands (its frustum, its falloff with distance and angle, what's in the way)
// and, by its mapping, WHAT lands there:
//   throw    the image in the projector's own frame (as a real projector: stretched over oblique and curved stone)
//   cylinder the image in a cylinder's coordinates round an axis (angle, height): calibrated projection mapping, the
//            picture aligned with a rotunda, a tower, a drum, whatever stands round that axis
//   plane    the image in a plane's coordinates (origin, two axes, metres a frame): aligned with a façade
// Weft conventions: reversed-Z with an infinite far plane, linear HDR light. Group 3, so it sits beside a host's own
// groups 1 and 2 (loom's env, a room's globals, per-draw data).
#include "weft/frame"

struct Projector {
  viewProj: mat4x4f,       // world → the projector's clip space, now (its frame, its reach)
  depthViewProj: mat4x4f,  // world → its clip space when its depth map was last drawn (the occlusion test)
  pos: vec3f,              // the lens (world)
  power: f32,              // its lamp: the light a square-on surface 10 m away takes from a white frame (0: off)
  tint: vec3f,             // the lamp's colour (times the image's)
  occlude: f32,            // 1: test projectorDepth (its layer is this projector's index), 0: light passes through
  axis: vec3f,             // where it points (unit)
  haze: f32,               // how strongly its beam shows in the air (0: not at all)
  map: vec4f,              // x mapping (0 throw, 1 cylinder, 2 plane); cylinder: y, z the axis (x, z), w frames round it
  mapB: vec4f,             // cylinder: x the frame's foot (y, m), y its height (m); plane: xyz origin, w metres a frame
  mapU: vec4f,             // plane: xyz the frame's right (unit); w its aspect (width / height)
  mapV: vec4f,             // plane: xyz the frame's down (unit)
  paint: vec4f,            // x program, y the program it's crossing to, z how far across (0..1), w seed (0..1)
  clock: vec4f,            // x the image's clock (s), y paint this frame (1) or keep last frame's (0), z, w -
}

@group(3) @binding(0) var<storage, read> projectors: array<Projector>;
@group(3) @binding(1) var projectorImage: texture_2d_array<f32>;
@group(3) @binding(2) var projectorDepth: texture_depth_2d_array;

const PROJ_MAX = 16u;
const PROJ_TAU = 6.28318531;

fn projectorCount() -> u32 { return min(arrayLength(&projectors), PROJ_MAX); }

/** where a point is in a projector's frame: ndc (x right, y up, z depth) and w, or w <= 0 behind the lens */
fn projectorClip(m: mat4x4f, p: vec3f) -> vec4f {
  let c = m * vec4f(p, 1.0);
  return vec4f(c.xyz / max(c.w, 1e-6), c.w);
}

/** the frame's uv (0, 0 top left) from its ndc */
fn projectorUV(ndc: vec2f) -> vec2f { return ndc * vec2f(0.5, -0.5) + 0.5; }

/** how much of the lamp reaches p, by what stands between: 1 lit, 0 in shadow (soft over a texel or two) */
fn projectorVisibility(P: Projector, i: u32, p: vec3f, n: vec3f, r: f32) -> f32 {
  if (P.occlude < 0.5) { return 1.0; }
  // (pushed off the surface by more the further it is: a depth map's texel covers more stone far away)
  let q = p + n * (0.04 + r * 0.004);
  let c = projectorClip(P.depthViewProj, q);
  if (c.w <= 0.0) { return 0.0; }
  let uv = projectorUV(c.xy);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  // reversed-Z: nearer is larger; lit where the point is at least as near as what the projector saw there
  let cmp = c.z * 1.0015;
  let texel = 1.0 / vec2f(textureDimensions(projectorDepth));
  var s = 0.0;
  s += textureSampleCompareLevel(projectorDepth, samp_shadow, uv + texel * vec2f(-0.5, -0.5), i, cmp);
  s += textureSampleCompareLevel(projectorDepth, samp_shadow, uv + texel * vec2f(0.5, -0.5), i, cmp);
  s += textureSampleCompareLevel(projectorDepth, samp_shadow, uv + texel * vec2f(-0.5, 0.5), i, cmp);
  s += textureSampleCompareLevel(projectorDepth, samp_shadow, uv + texel * vec2f(0.5, 0.5), i, cmp);
  return s * 0.25;
}

/** the image's colour at a point: in the projector's frame, or mapped to the surface (a cylinder or a plane) */
fn projectorImageAt(P: Projector, i: u32, p: vec3f, frameUV: vec2f) -> vec3f {
  let mode = u32(P.map.x + 0.5);
  if (mode == 0u) {
    return textureSampleLevel(projectorImage, samp_linear, frameUV, i, 0.0).rgb;
  }
  var uv: vec2f;
  if (mode == 1u) {
    let d = p.xz - P.map.yz;
    uv = vec2f(atan2(d.y, d.x) / PROJ_TAU * P.map.w, 1.0 - (p.y - P.mapB.x) / max(P.mapB.y, 1e-3));
  } else {
    let o = p - P.mapB.xyz;
    let h = max(P.mapB.w, 1e-3);
    uv = vec2f(dot(o, P.mapU.xyz) / (h * max(P.mapU.w, 1e-3)), dot(o, P.mapV.xyz) / h);
  }
  // the image repeats; its seam is hidden under a blend with the same image half a frame along
  let a = textureSampleLevel(projectorImage, samp_repeat, uv, i, 0.0).rgb;
  let b = textureSampleLevel(projectorImage, samp_repeat, uv + vec2f(0.5, 0.0), i, 0.0).rgb;
  let seam = smoothstep(0.38, 0.5, abs(fract(uv.x) - 0.5));
  // (a cylinder's frame and a plane's are one frame tall: soft at their top and foot)
  return mix(a, b, seam) * smoothstep(0.0, 0.04, uv.y) * smoothstep(1.0, 0.96, uv.y);
}

/** one projector's light on a point facing n (before the surface's albedo) */
fn projectorLight(i: u32, p: vec3f, n: vec3f) -> vec3f {
  let P = projectors[i];
  if (P.power <= 0.0) { return vec3f(0.0); }
  let c = projectorClip(P.viewProj, p);
  if (c.w <= 0.0 || abs(c.x) > 1.0 || abs(c.y) > 1.0) { return vec3f(0.0); }
  let to = P.pos - p;
  let r = length(to);
  let nl = dot(n, to / max(r, 1e-4));
  if (nl <= 0.0) { return vec3f(0.0); }
  // (the frame's edge soft, as a lens leaves it; the light falling off as the square of the distance, held at 10 m)
  let edge = smoothstep(1.0, 0.93, max(abs(c.x), abs(c.y)));
  let fall = 100.0 / (r * r + 4.0);
  let vis = projectorVisibility(P, i, p, n, r);
  if (vis <= 0.0) { return vec3f(0.0); }
  let img = projectorImageAt(P, i, p, projectorUV(c.xy));
  return img * P.tint * (P.power * nl * edge * fall * vis);
}

/** every projector's light on a point facing n */
fn projectedLight(p: vec3f, n: vec3f) -> vec3f {
  var sum = vec3f(0.0);
  let count = projectorCount();
  for (var i = 0u; i < count; i++) { sum += projectorLight(i, p, n); }
  return sum;
}

/** how a coloured stone takes coloured light: a little desaturated, so a projector's hues read on cream and ochre */
fn projectionTake(albedo: vec3f) -> vec3f {
  return mix(albedo, vec3f(dot(albedo, vec3f(0.333))), 0.5) * 1.1;
}

// ---------------------------------------------------------------- the beams in the air

/** a span of a ray (t0, t1) cut to where a + b t <= 0 */
fn projectorClipSide(s: vec2f, a: f32, b: f32) -> vec2f {
  if (abs(b) < 1e-7) { return select(s, vec2f(1.0, 0.0), a > 0.0); }
  let t = -a / b;
  return select(vec2f(max(s.x, t), s.y), vec2f(s.x, min(s.y, t)), b > 0.0);
}

/** where a ray (from o along d, 0..tMax) passes through a projector's frustum, up to `reach` metres from the lens:
 *  (t0, t1), empty when t1 <= t0 */
fn projectorSpan(P: Projector, o: vec3f, d: vec3f, tMax: f32, reach: f32) -> vec2f {
  // in clip space the ray is a line, and the frustum's four sides and its front are half-spaces: clip it to each
  let c0 = P.viewProj * vec4f(o, 1.0);
  let dc = P.viewProj * vec4f(d, 0.0);
  // (each side: a + b t <= 0; written out, as a runtime-indexed table stalls Metal's compiler)
  var s = vec2f(0.0, tMax);
  s = projectorClipSide(s, c0.x - c0.w, dc.x - dc.w);
  s = projectorClipSide(s, -c0.x - c0.w, -dc.x - dc.w);
  s = projectorClipSide(s, c0.y - c0.w, dc.y - dc.w);
  s = projectorClipSide(s, -c0.y - c0.w, -dc.y - dc.w);
  s = projectorClipSide(s, 0.3 - c0.w, -dc.w);
  var t0 = s.x;
  var t1 = s.y;
  // (and no further from the lens than its reach: a sphere round it)
  let oc = o - P.pos;
  let bq = dot(oc, d);
  let cq = dot(oc, oc) - reach * reach;
  let disc = bq * bq - cq;
  if (disc <= 0.0) { return vec2f(1.0, 0.0); }
  let sq = sqrt(disc);
  t0 = max(t0, -bq - sq);
  t1 = min(t1, -bq + sq);
  return vec2f(t0, t1);
}

/** the light the beams scatter toward the eye along a view ray (from o along d, to tMax), `steps` samples per beam
 *  jittered by `jitter` (0..1); `density` is the haze's (per metre) */
fn projectedHaze(o: vec3f, d: vec3f, tMax: f32, jitter: f32, steps: u32, density: f32) -> vec3f {
  var sum = vec3f(0.0);
  let count = projectorCount();
  for (var i = 0u; i < count; i++) {
    let P = projectors[i];
    if (P.power <= 0.0 || P.haze <= 0.0) { continue; }
    let span = projectorSpan(P, o, d, tMax, 90.0);
    if (span.y <= span.x) { continue; }
    let len = span.y - span.x;
    let dt = len / f32(steps);
    // (a little forward scattering: a beam seen looking down it is brighter than one seen across)
    let phase = 0.6 + 0.9 * pow(saturate(dot(-d, P.axis)), 6.0);
    var acc = vec3f(0.0);
    for (var k = 0u; k < steps; k++) {
      let q = o + d * (span.x + (f32(k) + jitter) * dt);
      let c = projectorClip(P.viewProj, q);
      let r = distance(q, P.pos);
      let uv = projectorUV(c.xy);
      var img: vec3f;
      if (u32(P.map.x + 0.5) == 0u) {
        img = textureSampleLevel(projectorImage, samp_linear, uv, i, 0.0).rgb;
      } else {
        img = vec3f(0.22);
      }
      var vis = 1.0;
      if (P.occlude > 0.5) {
        // (its depth map may lag a moving projector: outside what it saw, leave the beam be)
        let cd = projectorClip(P.depthViewProj, q);
        let duv = projectorUV(cd.xy);
        if (cd.w > 0.0 && all(duv >= vec2f(0.0)) && all(duv <= vec2f(1.0))) {
          vis = textureSampleCompareLevel(projectorDepth, samp_shadow, duv, i, cd.z * 1.002);
        }
      }
      let edge = smoothstep(1.0, 0.85, max(abs(c.x), abs(c.y)));
      acc += img * (vis * edge * 100.0 / (r * r + 16.0));
    }
    sum += acc * P.tint * (P.power * P.haze * phase * dt * density);
  }
  return sum;
}
