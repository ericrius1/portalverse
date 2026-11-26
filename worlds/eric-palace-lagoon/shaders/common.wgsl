// The Palace Lagoon's shared pieces: its light, its sky and haze, the sun's shadow, the land's height. Every draw in
// the room includes this. The land's height here and in ../layout.ts are the same function: keep them together.
#include "weft/frame"

struct Globals {
  sunDir: vec3f,      // toward the sun
  waterY: f32,        // the lagoon's surface (m)
  sunColor: vec3f,    // the sun's light (linear, scene-referred)
  time: f32,
  skyZenith: vec3f,
  haze: f32,          // haze per metre
  skyHorizon: vec3f,
  reveal: f32,        // the Palace fading in once its mesh is up (0..1)
  ambSky: vec3f,      // the sky's light from above
  _p1: f32,
  ambGround: vec3f,   // the meadow's light from below
  _p2: f32,
  lagoon: vec4f,      // the lagoon: centre x, half width (x), half length (z), -
  vp: vec4f,          // this view's viewport in the target: x, y, width, height (px)
  lightViewProj: mat4x4f,
}
@group(1) @binding(0) var<uniform> G: Globals;
@group(1) @binding(1) var shadowMap: texture_depth_2d;

// ---------------------------------------------------------------- noise
fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn noise2(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn fbm2(p: vec2f, octaves: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < octaves; i++) {
    s += a * noise2(q);
    q = q * 2.03 + vec2f(17.1, 9.3);
    a *= 0.5;
  }
  return s / (1.0 - a * 2.0 + 1e-4);
}

// ---------------------------------------------------------------- the land (as ../layout.ts terrainHeight)
fn lagoonSdf(xz: vec2f) -> f32 {
  let q = (xz - vec2f(G.lagoon.x, 0.0)) / vec2f(G.lagoon.y, G.lagoon.z);
  let wobble = sin(xz.y * 0.071) * 2.2 + sin(xz.y * 0.19 + 1.3) * 0.9 + sin(xz.x * 0.11 + 0.4) * 0.7;
  return (length(q) - 1.0) * G.lagoon.y + wobble;
}
fn terrainHeight(xz: vec2f) -> f32 {
  let x = xz.x;
  let z = xz.y;
  // the meadow rolls a little away from the path, which stays level
  let away = smoothstep(3.0, 14.0, abs(x));
  var h = away * (sin(x * 0.045 + 0.5) * 0.9 + sin(z * 0.06 + x * 0.02) * 0.7 + sin(z * 0.13 - 0.7) * 0.25 + 0.3);
  h += smoothstep(30.0, 160.0, x) * (5.0 + 3.0 * sin(z * 0.012 + 0.8));
  // the Palace stands on level ground
  h *= smoothstep(-95.0, -60.0, x);
  // the banks and the lagoon's bed
  let s = lagoonSdf(xz);
  let bed = G.waterY - 0.35;
  h = mix(bed, h, smoothstep(0.0, 7.0, s));
  if (s < 0.0) { h = bed - min(2.0, -s * 0.12); }
  return h;
}

// ---------------------------------------------------------------- the sky and the haze
fn skyColor(dir: vec3f) -> vec3f {
  let up = saturate(dir.y);
  var c = mix(G.skyHorizon, G.skyZenith, pow(up, 0.5));
  // below the horizon: the haze over the distant land
  c = mix(c, G.skyHorizon * vec3f(0.78, 0.8, 0.78), smoothstep(0.0, -0.08, dir.y));
  let sd = saturate(dot(dir, G.sunDir));
  c += G.sunColor * (0.08 * pow(sd, 4.0) + 0.22 * pow(sd, 24.0) + 0.5 * pow(sd, 300.0));
  // clouds: a soft deck of fair-weather cumulus, lit warm on the sun's side
  if (dir.y > 0.0) {
    let uv = dir.xz / (dir.y + 0.12) * 0.9 + vec2f(G.time * 0.004, G.time * 0.0015);
    let d = fbm2(uv * 1.3, 5);
    let cover = smoothstep(0.56, 0.84, d) * smoothstep(0.0, 0.18, dir.y);
    let lit = mix(G.skyHorizon * 1.05, G.sunColor * 0.42 + G.skyZenith * 0.25, 0.35 + 0.65 * pow(sd, 3.0));
    c = mix(c, lit * (0.75 + 0.4 * fbm2(uv * 3.1 + 4.0, 3)), cover * 0.85);
  }
  return c;
}
fn sunDisc(dir: vec3f) -> vec3f {
  let sd = dot(dir, G.sunDir);
  return G.sunColor * smoothstep(0.99955, 0.99975, sd) * 18.0;
}
/** distance haze toward the sky's colour along the view */
fn haze(c: vec3f, p: vec3f) -> vec3f {
  let to = p - frame.camPos;
  let d = length(to);
  let dir = to / max(d, 1e-3);
  let f = 1.0 - exp(-d * G.haze);
  return mix(c, skyColor(vec3f(dir.x, max(dir.y, 0.0) * 0.4, dir.z)), f);
}

// ---------------------------------------------------------------- the light
/** the sun's shadow (the Palace casts it; baked once, ortho from the sun, reversed-Z) */
fn sunShadow(p: vec3f, n: vec3f) -> f32 {
  let q = p + n * 0.12;
  let c = G.lightViewProj * vec4f(q, 1.0);
  let ndc = c.xyz / c.w;
  let uv = ndc.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z <= 0.0) { return 1.0; }
  let cmp = ndc.z + 0.00025;
  let texel = 1.0 / vec2f(textureDimensions(shadowMap));
  var s = 0.0;
  s += textureSampleCompareLevel(shadowMap, samp_shadow, uv + texel * vec2f(-0.5, -0.5), cmp);
  s += textureSampleCompareLevel(shadowMap, samp_shadow, uv + texel * vec2f(0.5, -0.5), cmp);
  s += textureSampleCompareLevel(shadowMap, samp_shadow, uv + texel * vec2f(-0.5, 0.5), cmp);
  s += textureSampleCompareLevel(shadowMap, samp_shadow, uv + texel * vec2f(0.5, 0.5), cmp);
  return s * 0.25;
}
fn ambient(n: vec3f) -> vec3f {
  return mix(G.ambGround, G.ambSky, n.y * 0.5 + 0.5);
}
fn ggx(n: vec3f, v: vec3f, l: vec3f, rough: f32, f0: vec3f) -> vec3f {
  let h = normalize(v + l);
  let nh = saturate(dot(n, h));
  let nv = max(dot(n, v), 1e-3);
  let nl = saturate(dot(n, l));
  let a = rough * rough;
  let a2 = a * a;
  let dd = nh * nh * (a2 - 1.0) + 1.0;
  let D = a2 / (3.14159 * dd * dd);
  let k = a * 0.5;
  let Vis = 1.0 / ((nv * (1.0 - k) + k) * (nl * (1.0 - k) + k));
  let F = f0 + (1.0 - f0) * pow(1.0 - saturate(dot(v, h)), 5.0);
  return D * Vis * F * 0.25 * nl;
}
/** the reflection view draws only what's above the water */
fn clipBelowWater(p: vec3f) -> bool { return frame.user.x > 0.5 && p.y < G.waterY - 0.02; }
/** a fragment's place in this view as a uv over the view (0, 0 top left) */
fn viewUV(pos: vec4f) -> vec2f { return (pos.xy - G.vp.xy) / max(G.vp.zw, vec2f(1.0)); }
