// The grove's night lights, additive after everything (the 'glow' phase): lantern-fruit hanging under the oaks and
// the flowering trees, swaying on their threads, warm cores in soft halos; and glow-seeds drifting up out of the
// glowing crowns, spiralling on the wind, each living a few seconds. Both come out with the dusk (G.night) and are
// made in the vertex shader from their number (nothing moves on the CPU).
#include "../shaders/common"

// two a lantern: where it hangs (world) and its size (m); its colour (HDR) and its phase
@group(2) @binding(0) var<storage, read> lanterns: array<vec4f>;
// two a glowing crown: its middle (world) and radius (m); its seeds' colour (HDR) and -
@group(2) @binding(1) var<storage, read> emitters: array<vec4f>;

/** how many glowing crowns (emitters) there are */
override EMITTERS: u32 = 1u;

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,                     // across the quad (-1..1)
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) core: f32, // the core's radius over the quad's half size
  @location(3) world: vec3f,
}

fn collapsedG() -> GOut {
  var o: GOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  return o;
}

/** a camera-facing quad round `c`, half size `h` (m), corner k of six */
fn billboard(c: vec3f, h: f32, k: u32) -> vec4f {
  let cx = f32((22u >> k) & 1u) * 2.0 - 1.0;
  let cy = f32((52u >> k) & 1u) * 2.0 - 1.0;
  return vec4f(cx, cy, 0.0, 0.0);
}

@vertex fn vsLantern(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  let on = smoothstep(0.12, 0.55, G.night);
  if (on <= 0.0) { return collapsedG(); }
  let a = lanterns[ii * 2u];
  let b = lanterns[ii * 2u + 1u];
  let t = G.time;
  // swaying on its thread
  let sw = vec3f(sin(t * 1.3 + b.w * 6.28), 0.0, cos(t * 1.05 + b.w * 4.1)) * 0.07;
  let c = a.xyz + sw;
  let d = distance(c, frame.camPos);
  if (d > 260.0) { return collapsedG(); }
  // the halo grows a little with distance so a far lantern still reads as a point of light
  let halo = a.w * (7.0 + d * 0.035);
  let q = billboard(c, halo, vi % 6u).xy;
  let p = c + (frame.camRight * q.x + frame.camUp * q.y) * halo;
  var o: GOut;
  o.pos = clipAt(p);
  o.q = q;
  // (breathing slowly, each its own)
  let breathe = 0.8 + 0.2 * sin(t * 0.9 + b.w * 17.0);
  o.col = b.rgb * on * breathe;
  o.core = a.w / halo;
  o.world = p;
  return o;
}

@vertex fn vsSeed(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  let on = smoothstep(0.3, 0.8, G.night);
  if (on <= 0.0) { return collapsedG(); }
  let e = ii % EMITTERS;
  let a = emitters[e * 2u];
  let b = emitters[e * 2u + 1u];
  let h = vec4f(hash12(vec2f(f32(ii), 1.7)), hash12(vec2f(f32(ii), 5.3)), hash12(vec2f(f32(ii), 9.1)), hash12(vec2f(f32(ii), 13.9)));
  let t = G.time;
  let period = 9.0 + 7.0 * h.x;
  let cyc = t / period + h.y;
  let life = fract(cyc);
  let gen = floor(cyc);
  // where this life starts: somewhere in the crown (a new place each life)
  let r1 = hash12(vec2f(f32(ii) + gen * 13.1, 2.2));
  let r2 = hash12(vec2f(f32(ii) + gen * 7.7, 4.4));
  let r3 = hash12(vec2f(f32(ii) + gen * 3.3, 6.6));
  let ang = r1 * 6.2832;
  let rad = sqrt(r2) * a.w * 0.8;
  var p = a.xyz + vec3f(cos(ang) * rad, (r3 - 0.5) * a.w * 0.6, sin(ang) * rad);
  // rising, spiralling, carried off on the wind
  let rise = life * (5.0 + 4.0 * h.z);
  p += vec3f(0.0, rise, 0.0);
  p += vec3f(0.94, 0.0, 0.34) * life * life * 4.0;
  p += vec3f(sin(t * 0.9 + h.w * 6.28), 0.0, cos(t * 0.7 + h.w * 6.28)) * (0.3 + 0.6 * life);
  let d = distance(p, frame.camPos);
  if (d > 220.0) { return collapsedG(); }
  let halo = 0.05 * (6.0 + d * 0.04);
  let q = billboard(p, halo, vi % 6u).xy;
  let wp = p + (frame.camRight * q.x + frame.camUp * q.y) * halo;
  var o: GOut;
  o.pos = clipAt(wp);
  o.q = q;
  let twinkle = 0.65 + 0.35 * sin(t * 6.0 + h.w * 40.0);
  o.col = mix(b.rgb, vec3f(1.0, 0.95, 0.85) * length(b.rgb) * 0.6, 0.3) * on * sin(life * 3.14159) * twinkle * 0.8;
  o.core = 0.05 / halo;
  o.world = wp;
  return o;
}

@fragment fn fsGlow(i: GOut) -> @location(0) vec4f {
  let r = length(i.q);
  if (r > 1.0 || clipBelowWater(i.world)) { discard; }
  // a bright core, a soft halo falling off round it
  let core = smoothstep(i.core * 1.2, i.core * 0.5, r) * 5.0;
  let halo = exp(-r * r * 9.0) * 0.55 + exp(-r * r * 40.0) * 0.6;
  let c = i.col * (core + halo) * (1.0 - smoothstep(0.7, 1.0, r));
  return vec4f(c * exp(-distance(i.world, frame.camPos) * G.haze), 0.0);
}
