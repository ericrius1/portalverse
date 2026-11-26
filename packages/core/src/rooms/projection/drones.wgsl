// The drones that carry the projectors (rig.ts `drones`): a small graphite pod on four arms hovering at each
// projector with `body`, level while its lens (under it, on a gimbal) points where the projector points; and its
// lights: the lens glowing toward where it throws (blinding looking down the beam), a teal and an amber nav light, a
// white strobe on top. Made in the vertex shader from the index, nothing uploaded. Lit by the light the host gives
// for this view (RigView), not by any one place's shaders.
#include "./light"

struct RigView {
  keyDir: vec3f,     // the key light (toward it) and its colour
  density: f32,      // the haze's density for the beams (per metre)
  keyColor: vec3f,
  lights: f32,       // how bright the drones' own lights are (0..1)
  ambSky: vec3f,
  time: f32,
  ambGround: vec3f,
  _pad: f32,
  vp: vec4f,         // this view's viewport in its target (px)
}
@group(1) @binding(0) var<uniform> RV: RigView;

const SEG = 12u;
const RINGS = 8u;
const POD = vec3f(0.42, 0.11, 0.42);

struct BodyOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) seam: f32,
}

fn hidden() -> BodyOut {
  var o: BodyOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  return o;
}

/** the drone's own frame: level, its nose toward where its projector points */
fn droneFrame(P: Projector) -> mat3x3f {
  let f = normalize(vec3f(P.axis.x, 0.0, P.axis.z) + vec3f(0.0, 0.0, 1e-4));
  let r = normalize(cross(f, vec3f(0.0, 1.0, 0.0)));
  return mat3x3f(r, vec3f(0.0, 1.0, 0.0), f);
}

/** its slow hover: a few centimetres of drift and roll, its own phase */
fn bob(P: Projector, t: f32) -> vec3f {
  let s = P.paint.w * 40.0;
  return vec3f(sin(t * 0.7 + s) * 0.03, sin(t * 1.1 + s * 1.3) * 0.04, cos(t * 0.6 + s * 0.7) * 0.03);
}

@vertex fn vsBody(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BodyOut {
  if (ii >= projectorCount()) { return hidden(); }
  let P = projectors[ii];
  if (P.clock.z < 0.5) { return hidden(); }
  let F = droneFrame(P);
  let centre = P.pos + vec3f(0.0, 0.2, 0.0) + bob(P, RV.time);
  var local: vec3f;
  var nl: vec3f;
  var seam = 0.0;
  let podVerts = SEG * RINGS * 6u;
  if (vi < podVerts) {
    // the pod: an ellipsoid, ring by ring
    let q = vi / 6u;
    let c = vi % 6u;
    let gx = q % SEG + ((26u >> c) & 1u);
    let gy = q / SEG + ((52u >> c) & 1u);
    let lon = f32(gx) / f32(SEG) * PROJ_TAU;
    let lat = (f32(gy) / f32(RINGS) - 0.5) * 3.14159265;
    let s = vec3f(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    local = s * POD;
    nl = normalize(s / POD);
    seam = 1.0 - smoothstep(0.0, 0.12, abs(lat));
  } else {
    // the four arms: thin boxes out along the diagonals
    let k = vi - podVerts;
    let arm = k / 36u;
    let c = k % 36u;
    let face = c / 6u;
    let corner = c % 6u;
    let a = 0.78539816 + f32(arm) * 1.5707963;
    let dir = vec3f(cos(a), 0.0, sin(a));
    let side = vec3f(-dir.z, 0.0, dir.x);
    // (a unit cube's face, corner by corner: u, v on the face, the face's normal)
    let u = f32((26u >> corner) & 1u) * 2.0 - 1.0;
    let v = f32((52u >> corner) & 1u) * 2.0 - 1.0;
    let axisN = face / 2u;
    let sgn = select(-1.0, 1.0, (face & 1u) == 1u);
    var cube: vec3f;
    if (axisN == 0u) { cube = vec3f(sgn, u, v); } else if (axisN == 1u) { cube = vec3f(u, sgn, v); } else { cube = vec3f(u, v, sgn); }
    let half = vec3f(0.36, 0.022, 0.03);
    local = dir * (0.38 + cube.x * half.x) + vec3f(0.0, cube.y * half.y + 0.02, 0.0) + side * cube.z * half.z;
    nl = normalize(dir * select(0.0, cube.x, axisN == 0u) + vec3f(0.0, select(0.0, cube.y, axisN == 1u), 0.0) + side * select(0.0, cube.z, axisN == 2u));
  }
  var o: BodyOut;
  o.world = centre + F * local;
  o.n = F * nl;
  o.seam = seam;
  o.pos = clipAt(o.world);
  return o;
}

@fragment fn fsBody(i: BodyOut) -> @location(0) vec4f {
  let n = normalize(i.n);
  let v = normalize(frame.camPos - i.world);
  let l = RV.keyDir;
  let albedo = vec3f(0.045, 0.05, 0.055);
  let amb = mix(RV.ambGround, RV.ambSky, n.y * 0.5 + 0.5);
  var c = albedo * (RV.keyColor * saturate(dot(n, l)) + amb);
  // a satin shell: the sky's light and the key's in it
  let h = normalize(v + l);
  c += RV.keyColor * pow(saturate(dot(n, h)), 60.0) * 0.4;
  c += amb * pow(1.0 - saturate(dot(n, v)), 4.0) * 0.6;
  // a fine teal seam round its waist at night
  c += vec3f(0.2, 0.9, 0.75) * i.seam * RV.lights * 0.6;
  return vec4f(c, 1.0);
}

// ---------------------------------------------------------------- the lights
struct LightOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,
  @location(1) col: vec3f,
}
fn noLight() -> LightOut {
  var o: LightOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  return o;
}

@vertex fn vsLight(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LightOut {
  if (ii >= projectorCount()) { return noLight(); }
  let P = projectors[ii];
  if (P.clock.z < 0.5) { return noLight(); }
  let F = droneFrame(P);
  let centre = P.pos + vec3f(0.0, 0.2, 0.0) + bob(P, RV.time);
  let which = vi / 6u;
  let corner = vi % 6u;
  var at: vec3f;
  var size: f32;
  var col: vec3f;
  let t = RV.time + P.paint.w * 17.0;
  if (which == 0u) {
    // the lens, bright down its beam
    at = P.pos;
    size = 0.2;
    let toEye = normalize(frame.camPos - P.pos);
    let into = pow(saturate(dot(toEye, P.axis)), 8.0);
    // (a faint glint seen from the side or behind; blazing only looking down its beam)
    let side = smoothstep(-0.2, 0.4, dot(toEye, P.axis));
    col = P.tint * (0.15 * side + 40.0 * into) * min(P.power, 3.0) * 0.6 * RV.lights;
  } else if (which == 1u) {
    at = centre + F * vec3f(-0.44, 0.0, 0.0);
    size = 0.09;
    col = vec3f(0.1, 1.0, 0.75) * 2.5 * RV.lights;
  } else if (which == 2u) {
    at = centre + F * vec3f(0.44, 0.0, 0.0);
    size = 0.09;
    col = vec3f(1.0, 0.55, 0.12) * 2.5 * RV.lights;
  } else {
    // the strobe: a short white flash every couple of seconds
    at = centre + vec3f(0.0, 0.13, 0.0);
    size = 0.1;
    let ph = fract(t / 2.4);
    col = vec3f(1.0, 0.97, 0.92) * 9.0 * exp(-ph * 60.0) * RV.lights;
  }
  // (no smaller than a couple of pixels, its light spread over what it covers, so a far drone is a steady point)
  let dist = distance(frame.camPos, at);
  let pix = dist * 2.0 * tan(frame.fovY * 0.5) / max(frame.res.y, 1.0);
  let s = max(size, pix * 2.5);
  col *= (size / s) * (size / s);
  let u = f32((26u >> corner) & 1u) * 2.0 - 1.0;
  let v = f32((52u >> corner) & 1u) * 2.0 - 1.0;
  let p = at + (frame.camRight * u + frame.camUp * v) * s;
  var o: LightOut;
  o.pos = clipAt(p);
  o.q = vec2f(u, v);
  o.col = col;
  return o;
}

@fragment fn fsLight(i: LightOut) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  let g = exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.5);
  return vec4f(i.col * g * smoothstep(1.0, 0.7, r2), 0.0);
}
