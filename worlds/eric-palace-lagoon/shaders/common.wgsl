// The Palace Lagoon's shared pieces: its light, its sky and haze, the key light's shadow, the land's height. Every draw
// in the room includes this. The land's height here and in ../layout.ts are the same function: keep them together.
// The light changes along the walk from sunset (dusk 0, at the entrance) to night (dusk 1, at the exit portal):
// ../timeOfDay.ts fills these fields for each view from where its eye is.
#include "weft/frame"

struct Globals {
  sunDir: vec3f,      // the key light (toward it): the sun while it's up, then the moon
  waterY: f32,        // the lagoon's surface (m)
  sunColor: vec3f,    // the key light's colour (linear, scene-referred; 0 while it swaps from the sun to the moon)
  time: f32,
  skyZenith: vec3f,
  haze: f32,          // haze per metre
  skyHorizon: vec3f,
  reveal: f32,        // the Palace fading in once its mesh is up (0..1)
  ambSky: vec3f,      // the sky's light from above
  dusk: f32,          // how far along the walk this view is: 0 sunset .. 1 night
  ambGround: vec3f,   // the ground's light from below
  night: f32,         // 0 daylight .. 1 dark: the floodlights, the lanterns, every glowing thing
  lagoon: vec4f,      // the lagoon: centre x, centre z, half width (x), half length (z)
  vp: vec4f,          // this view's viewport in the target: x, y, width, height (px)
  lightViewProj: mat4x4f,
  trueSun: vec3f,     // the sun itself (below the horizon once it's set)
  aurora: f32,        // the aurora's strength (0..1)
  glow: vec3f,        // the afterglow's colour, low over where the sun went down
  stars: f32,         // how much of the starfield shows (0..1)
  moonDir: vec3f,     // the moon (toward it)
  moonLit: f32,       // how bright it is (0..1)
  palace: vec4f,      // the rotunda's centre x, z; its deck's y; w the drones' show (0 off .. 1: it comes up with the dark)
  skyTint: vec4f,     // rgb: Belt of Venus / anti-solar twilight tint; w: cloud cover (0..1)
  skyExtra: vec4f,    // x: Milky Way strength; y: crepuscular rays; z: aurora reach; w: moon earthshine
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
fn hash13(p: vec3f) -> f32 {
  var p3 = fract(p * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
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
fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}
fn lagoonSdf(xz: vec2f) -> f32 {
  let q = (xz - G.lagoon.xy) / G.lagoon.zw;
  let wobble = sin(xz.y * 0.071) * 2.2 + sin(xz.y * 0.19 + 1.3) * 0.9 + sin(xz.x * 0.11 + 0.4) * 0.7;
  let main = (length(q) - 1.0) * G.lagoon.z + wobble;
  // reflecting north cove curving in front of the rotunda's north arch (as ../layout.ts NORTH_COVE)
  let cq = (xz - vec2f(14.0, 25.6)) / vec2f(32.0, 6.2);
  let cw = sin(xz.x * 0.14 + 0.7) * 0.45 + sin(xz.y * 0.21) * 0.25;
  let cove = (length(cq) - 1.0) * 6.2 + cw;
  return smin(main, cove, 6.0);
}
/** 1 on the Palace's level grounds, 0 beyond (as ../layout.ts groundsMask) */
fn groundsMask(xz: vec2f) -> f32 {
  let uv = xz - G.palace.xy;
  return smoothstep(-120.0, -102.0, uv.x) * (1.0 - smoothstep(38.0, 52.0, uv.x)) * (1.0 - smoothstep(140.0, 158.0, abs(uv.y)));
}
fn segDist(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let ab = b - a;
  let t = saturate(dot(p - a, ab) / dot(ab, ab));
  return length(p - a - ab * t);
}
/** how far (m) from the colonnade wings' walk (their centre line, both wings: they mirror across the Palace's axis) */
fn wingDist(xz: vec2f) -> f32 {
  let q = vec2f(xz.x - G.palace.x, abs(xz.y - G.palace.y));
  var d = 1e9;
  d = min(d, segDist(q, vec2f(-29.2, 30.9), vec2f(-23.8, 45.0)));
  d = min(d, segDist(q, vec2f(-23.8, 45.0), vec2f(-16.6, 56.4)));
  d = min(d, segDist(q, vec2f(-16.6, 56.4), vec2f(-7.4, 66.3)));
  d = min(d, segDist(q, vec2f(-7.4, 66.3), vec2f(2.2, 73.6)));
  d = min(d, segDist(q, vec2f(2.2, 73.6), vec2f(12.9, 79.1)));
  d = min(d, segDist(q, vec2f(12.9, 79.1), vec2f(30.5, 79.3)));
  d = min(d, segDist(q, vec2f(30.5, 79.3), vec2f(31.8, 104.7)));
  d = min(d, length(q - vec2f(13.3, 105.3)));
  return d;
}
/** the rotunda's podium: how far outside its octagon's edge (m; negative on it; its faces 22.5° off the axis, as
 *  ../collide.ts podiumDeck) */
fn podiumDist(xz: vec2f) -> f32 {
  let d = xz - G.palace.xy;
  let seg = 0.78539816;
  let a = atan2(d.y, d.x);
  let rel = a - seg * (floor(a / seg) + 0.5);
  return length(d) * cos(rel) - 33.4;
}
fn terrainHeight(xz: vec2f) -> f32 {
  let x = xz.x;
  let z = xz.y;
  // the meadow rolls a little, and rises to hills round the horizon
  var h = sin(x * 0.045 + 0.5) * 0.9 + sin(z * 0.06 + x * 0.02) * 0.7 + sin(z * 0.13 - 0.7) * 0.25 + 0.3;
  h += smoothstep(130.0, 280.0, -x) * (12.0 + 7.0 * sin(z * 0.011 + 0.8));
  h += smoothstep(150.0, 320.0, x) * (9.0 + 6.0 * sin(z * 0.013 + 2.1));
  h += smoothstep(170.0, 320.0, abs(z - G.palace.y)) * (7.0 + 4.0 * sin(x * 0.017 + 0.3));
  // the Palace's grounds are level
  h *= 1.0 - groundsMask(xz);
  // depress ground cleanly beneath the rotunda podium and colonnade stylobate to eliminate Z-fighting
  let underPodium = 1.0 - smoothstep(-1.5, 1.5, podiumDist(xz));
  let underWing = 1.0 - smoothstep(5.5, 10.5, wingDist(xz));
  h = mix(h, -0.58, max(underPodium, underWing));
  // the banks and the lagoon's bed
  let s = lagoonSdf(xz);
  let bed = G.waterY - 0.35;
  h = mix(bed, h, smoothstep(0.0, 5.5, s));
  if (s < 0.0) { h = bed - min(2.0, -s * 0.12); }
  return h;
}

#include "./sky"

/** distance haze toward the sky's colour along the view */
fn haze(c: vec3f, p: vec3f) -> vec3f {
  let to = p - frame.camPos;
  let d = length(to);
  let dir = to / max(d, 1e-3);
  let f = 1.0 - exp(-d * G.haze);
  return mix(c, skyColor(vec3f(dir.x, max(dir.y, 0.0) * 0.4, dir.z)), f);
}

// ---------------------------------------------------------------- the light
/** the key light's shadow (the Palace casts it; ortho from the key light, reversed-Z) */
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
/** the warm lamps of the night (floodlights, lanterns): their colour */
const LAMP = vec3f(1.0, 0.66, 0.36);
/** the reflection view draws only what's above the water */
fn clipBelowWater(p: vec3f) -> bool { return frame.user.x > 0.5 && p.y < G.waterY - 0.02; }
/** is this the reflection view (the world mirrored in the lagoon)? */
fn inReflection() -> bool { return frame.user.x > 0.5; }
/** a fragment's place in this view as a uv over the view (0, 0 top left) */
fn viewUV(pos: vec4f) -> vec2f { return (pos.xy - G.vp.xy) / max(G.vp.zw, vec2f(1.0)); }

// ---------------------------------------------------------------- the Palace's plan on the ground
/** the gravel walk along the south portals' line (x = 0) and the north colonnade-to-lagoon garden boardwalk */
fn onWalk(xz: vec2f) -> f32 {
  let edge = 1.6 + 0.25 * noise2(vec2f(xz.y * 0.8, 3.0));
  let along = abs(xz.y - G.palace.y);
  let straight = (1.0 - smoothstep(edge - 0.25, edge, abs(xz.x))) * (1.0 - smoothstep(70.0, 73.0, along)) * smoothstep(32.0, 36.0, -xz.y + 70.0);
  // Clear grass & lay warm garden gravel cleanly underneath the wooden colonnade approach walkway
  var dApp = segDist(xz, vec2f(-13.2, 61.2), vec2f(-6.27, 53.30));
  dApp = min(dApp, segDist(xz, vec2f(-6.27, 53.30), vec2f(-3.1, 49.7)));
  dApp = min(dApp, segDist(xz, vec2f(-3.1, 49.7), vec2f(0.2, 44.0)));
  dApp = min(dApp, segDist(xz, vec2f(0.2, 44.0), vec2f(0.65, 37.0)));
  dApp = min(dApp, segDist(xz, vec2f(0.65, 37.0), vec2f(1.45, 30.2)));
  let approach = 1.0 - smoothstep(1.65, 2.05, dApp);
  return max(straight, approach);
}
/** the walk's lanterns: one every LANTERN_STEP m along each side of it (x = ±LANTERN_X), off the podium */
const LANTERN_STEP = 7.0;
const LANTERN_X = 3.6;
/** the warm light the lanterns throw on the ground round (x, z): the two pairs of lanterns either side of it */
fn lanternPools(xz: vec2f) -> f32 {
  let along = xz.y - G.palace.y;
  if (abs(xz.x) > 14.0 || abs(along) > 80.0 || abs(along) < 28.0) { return 0.0; }
  let k0 = floor(along / LANTERN_STEP) * LANTERN_STEP;
  return lanternPair(xz.x, along, k0) + lanternPair(xz.x, along, k0 + LANTERN_STEP);
}
/** the pair of lanterns at k (m along the walk from the rotunda's centre), if there is one there */
fn lanternPair(x: f32, along: f32, k: f32) -> f32 {
  // (none on the podium, none beyond the walk's ends, none beside the entrance portal, 50.25 m out)
  if (abs(k) < 36.0 || abs(k) > 70.0 || abs(k - 50.25) < 3.0) { return 0.0; }
  let da = distance(vec2f(x, along), vec2f(LANTERN_X, k));
  let db = distance(vec2f(x, along), vec2f(-LANTERN_X, k));
  return 0.9 / (1.0 + da * da * 0.5) + 0.9 / (1.0 + db * db * 0.5);
}
