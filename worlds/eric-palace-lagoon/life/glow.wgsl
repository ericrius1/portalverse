// The night's small lights, drawn additive after everything (the scene's 'glow' phase, and in the lagoon's mirror):
//   fireflies  over the lawns, in the long grass and up among the trees, drifting. Most flash together, the way
//              synchronous fireflies do: a burst of six flashes half a second apart, then dark, the burst rolling across
//              the meadow as a wave; the rest flash on their own. They part round the player and close behind.
//   moths      pale, luminous, spiralling in the drones' beams and round their lenses, lit by the beam's own colour
// Nothing is stepped: where each is comes from its home (CPU, once) and the clock, so every view draws the same lights.
#include "../shaders/common"

struct Life {
  player: vec4f,   // the player's feet (xyz), w 1 if there is one (not in a portal's preview)
  show: vec4f,     // x the fireflies' strength, y the moths', z how many lamps, w -
}
@group(2) @binding(0) var<uniform> L: Life;
/** each firefly's home: x, height over the ground, z, seed */
@group(2) @binding(1) var<storage, read> flies: array<vec4f>;
/** the lamps the moths come to, three a lamp: the lens (xyz) and its power; the beam's way (unit) and its reach (m);
 *  its colour */
@group(2) @binding(2) var<storage, read> lamps: array<vec4f>;

override MOTHS_PER_LAMP: u32 = 24u;

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) col: vec3f,
  @location(2) @interpolate(flat) kind: vec2f,   // x: core size in the quad (0..1), y: the moth's wings' open (0..1, -1 a firefly)
  @location(3) world: vec3f,
}

fn nowhere() -> GOut {
  var o: GOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  return o;
}

/** a camera-facing quad round p, `r` m across at least `minPx` pixels; returns the quad and how much its light was
 *  spread (the area it grew by), so a far light keeps its brightness and doesn't flicker */
struct Sprite { pos: vec4f, uv: vec2f, dim: f32 }
fn sprite(p: vec3f, r: f32, minPx: f32, vi: u32) -> Sprite {
  var s: Sprite;
  let c = vec2f(f32((22u >> vi) & 1u), f32((52u >> vi) & 1u)) * 2.0 - 1.0;
  let d = length(p - frame.camPos);
  let px = 2.0 * tan(frame.fovY * 0.5) * d / max(G.vp.w, 1.0);
  let rr = max(r, minPx * px * 0.5);
  s.dim = (r * r) / (rr * rr);
  let w = p + (frame.camRight * c.x + frame.camUp * c.y) * rr;
  s.pos = clipAt(w);
  s.uv = c;
  return s;
}

// ---------------------------------------------------------------- the fireflies
fn flashShape(x: f32) -> f32 {
  return smoothstep(0.0, 0.07, x) * exp(-max(x - 0.07, 0.0) * 9.0) * step(0.0, x);
}
/** how bright a firefly is now (0..1): in the meadow's synchronous bursts, or flashing on its own */
fn flash(t: f32, seed: f32, xz: vec2f) -> f32 {
  if (seed < 0.68) {
    // the burst rolls over the meadow from the south-west
    let delay = dot(xz, vec2f(0.6, 0.8)) * 0.05 + seed * 0.08;
    let tc = t - delay;
    let cyc = tc / 9.0;
    let ci = floor(cyc);
    let local = (cyc - ci) * 9.0;
    if (hash12(vec2f(ci, seed * 113.0)) > 0.82) { return 0.0; }
    if (local > 3.3) { return 0.0; }
    let k = local / 0.55;
    return flashShape((k - floor(k)) * 0.55);
  }
  let period = 2.0 + fract(seed * 17.3) * 3.5;
  let x = (t + seed * 41.0) / period;
  return flashShape((x - floor(x)) * period) * step(0.4, hash12(vec2f(floor(x), seed * 7.0)));
}

/** where firefly `ii` is now: its home, a slow drift, parted round the player */
fn flyAt(ii: u32) -> vec4f {
  let h = flies[ii];
  let seed = h.w;
  let t = G.time;
  let ph = seed * 61.0;
  let off = vec3f(
    sin(t * 0.21 + ph) * 1.4 + sin(t * 0.57 + ph * 1.7) * 0.5,
    sin(t * 0.33 + ph * 2.3) * 0.35 + sin(t * 0.9 + ph) * 0.12,
    cos(t * 0.17 + ph * 0.6) * 1.4 + sin(t * 0.49 + ph * 2.9) * 0.5);
  var p = vec3f(h.x + off.x, 0.0, h.z + off.z);
  p.y = terrainHeight(p.xz) + h.y + off.y;
  if (L.player.w > 0.5) {
    // (parted round the player, a ring 2.6 m out, and lifted a little: closing again behind them)
    let R = 2.6;
    let d = p.xz - L.player.xz;
    let r = length(d);
    let tall = 1.0 - smoothstep(2.2, 3.2, p.y - L.player.y);
    if (r < R && tall > 0.0) {
      let r2 = r + 0.5 * (R - r) * (R - r) / R * tall;
      p = vec3f(L.player.x + d.x / max(r, 1e-3) * r2, p.y + (R - r) / R * 0.35 * tall, L.player.z + d.y / max(r, 1e-3) * r2);
    }
  }
  return vec4f(p, seed);
}

@vertex fn vsFly(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  let f = flyAt(ii);
  let p = f.xyz;
  // (nothing behind the eye)
  if (dot(p - frame.camPos, frame.camFwd) < -0.5) { return nowhere(); }
  let lit = flash(G.time, f.w, p.xz);
  let glow = (0.06 + 1.5 * lit) * L.show.x;
  if (glow < 0.004) { return nowhere(); }
  let s = sprite(p, 0.1, 2.6, vi);
  var o: GOut;
  o.pos = s.pos;
  o.uv = s.uv;
  o.world = p;
  // Photinus' yellow-green; a few warmer
  let tint = mix(vec3f(0.72, 1.0, 0.22), vec3f(1.0, 0.8, 0.25), step(0.9, fract(f.w * 23.0)));
  o.col = tint * glow * s.dim;
  o.kind = vec2f(0.2, -1.0);
  return o;
}

// ---------------------------------------------------------------- the moths
@vertex fn vsMoth(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GOut {
  let n = u32(L.show.z);
  if (n == 0u || L.show.y <= 0.0) { return nowhere(); }
  let li = (ii / MOTHS_PER_LAMP) % n;
  let lens = lamps[li * 3u];
  let beam = lamps[li * 3u + 1u];
  let tint = lamps[li * 3u + 2u].xyz;
  if (lens.w <= 0.0) { return nowhere(); }
  let seed = hash12(vec2f(f32(ii) * 1.37, 4.1));
  let h2 = hash12(vec2f(f32(ii) * 2.11, 9.7));
  let h3 = hash12(vec2f(f32(ii) * 0.73, 1.9));
  let t = G.time;
  let A = beam.xyz;
  let side = normalize(cross(A, vec3f(0.0, 1.0, 0.0)) + vec3f(0.0, 0.0, 1e-3));
  let up = cross(side, A);
  // round a point along the beam, close by the lens most, spiralling in and out, darting
  let along = mix(0.8, min(beam.w * 0.5, 9.0), seed * seed);
  let ang = t * (2.0 + 3.0 * h2) * select(1.0, -1.0, h3 > 0.5) + seed * 40.0 + sin(t * 1.3 + h3 * 9.0) * 1.5;
  let rad = (0.25 + 0.9 * h3 + 0.2 * along * 0.2) * (0.75 + 0.25 * sin(t * 0.9 + seed * 17.0));
  let dart = vec3f(noise2(vec2f(t * 1.7, seed * 50.0)) - 0.5, noise2(vec2f(t * 1.9, seed * 70.0)) - 0.5, noise2(vec2f(t * 1.5, seed * 90.0)) - 0.5) * 0.6;
  let p = lens.xyz + A * (along + sin(t * 0.7 + seed * 6.0) * 0.4) + (side * cos(ang) + up * sin(ang)) * rad + dart;
  if (dot(p - frame.camPos, frame.camFwd) < -0.5) { return nowhere(); }
  // lit by the lamp: its light falling off as a projector's does (light.wgsl), held at the lens
  let r = length(p - lens.xyz);
  let light = lens.w * 100.0 / (r * r + 4.0);
  let s = sprite(p, 0.07, 2.2, vi);
  var o: GOut;
  o.pos = s.pos;
  o.uv = s.uv;
  o.world = p;
  o.col = (tint * light * 0.012 + vec3f(0.06, 0.05, 0.04)) * L.show.y * s.dim;
  o.kind = vec2f(0.35, abs(cos(t * 38.0 * (0.8 + 0.4 * h2) + seed * 30.0)));
  return o;
}

@fragment fn fsGlow(i: GOut) -> @location(0) vec4f {
  if (clipBelowWater(i.world)) { discard; }
  let r2 = dot(i.uv, i.uv);
  if (r2 > 1.0) { discard; }
  var a = 0.0;
  if (i.kind.y < 0.0) {
    // a firefly: a hot core and a soft halo
    let core = exp(-r2 / (i.kind.x * i.kind.x * 0.5));
    a = core * 2.5 + exp(-r2 * 5.0) * 0.35;
  } else {
    // a moth: two pale wings, open and shut, in a faint halo
    let open = i.kind.y;
    let wx = abs(i.uv.x) - 0.42 * open;
    let wing = 1.0 - smoothstep(0.7, 1.0, length(vec2f(wx / max(0.25 + 0.4 * open, 0.05), i.uv.y / 0.55)));
    a = wing * 1.4 + exp(-r2 * 6.0) * 0.25;
  }
  // (the haze takes light on its way to the eye)
  let fade = exp(-length(i.world - frame.camPos) * G.haze * 0.8);
  return vec4f(i.col * a * fade, 0.0);
}
