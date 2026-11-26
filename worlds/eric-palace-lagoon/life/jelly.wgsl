// The lagoon's night magic: lantern jellies, glass-clear medusae of light drifting in the air over the water (a few
// over the lawn and through the colonnade), out as the dark comes. Each is a bell that beats, slow and strong (a quick
// contraction that lifts it, a long relax as it sinks back), its rim strung with beads of light that a pulse runs
// round, eight canals of light down the bell, frilled arms hanging under it and long fine tendrils trailing behind its
// drift. Drawn additive (the scene's 'glow' phase, and mirrored in the lagoon), with the light it sheds pooled on the
// water under it. Cyan, violet, the aurora's green; one in a few warm rose. Nothing is stepped: each one's place is
// its home and the clock.
#include "../shaders/common"

struct Jelly {
  show: vec4f,     // x how much they glow (0 by day .. 1 dark), y their count, z, w -
}
@group(2) @binding(0) var<uniform> J: Jelly;
/** each jelly's home: x, height over the water, z, seed */
@group(2) @binding(1) var<storage, read> homes: array<vec4f>;

const JPI = 3.14159265;
/** the bell: rings from the crown to the margin, segments round */
const BR = 9u;
const BS = 24u;
const BELL_V = 1296u;     // BR * BS * 6
/** the tendrils from the margin, and their segments */
const TN = 12u;
const TS = 14u;
const TENDRIL_V = 1008u;  // TN * TS * 6
/** the frilled oral arms under the bell */
const AN = 4u;
const AS = 10u;
const ARM_V = 240u;       // AN * AS * 6
const JELLY_V = 2544u;

struct JOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) q: vec3f,         // part-dependent: bell (u, angle, -), strand (along, across, -)
  @location(3) col: vec3f,
  @location(4) @interpolate(flat) part: vec2f,  // x part (0 bell, 1 tendril, 2 arm), y the bell's beat (0..1)
}

fn nothing() -> JOut {
  var o: JOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  return o;
}

/** a jelly now: where its bell's crown is, its upright (tilted with its drift), its size, the beat, its colour */
struct State { at: vec3f, up: vec3f, drift: vec3f, size: f32, beat: f32, phase: f32, col: vec3f }
fn jellyAt(ii: u32, t: f32) -> State {
  var s: State;
  let h = homes[ii];
  let seed = h.w;
  let a = seed * 6.2831;
  // the drift: slow wide loops over the water (tighter under the dome, between its piers)
  let roam = select(1.0, 0.3, length(h.xz - G.palace.xy) < 20.0);
  let dx = (sin(t * 0.019 + a) * 9.0 + sin(t * 0.043 + a * 3.0) * 3.0) * roam;
  let dz = (cos(t * 0.016 + a * 1.7) * 9.0 + sin(t * 0.051 + a * 2.0) * 3.0) * roam;
  let vx = (cos(t * 0.019 + a) * 0.171 + cos(t * 0.043 + a * 3.0) * 0.129) * roam;
  let vz = (-sin(t * 0.016 + a * 1.7) * 0.144 + cos(t * 0.051 + a * 2.0) * 0.153) * roam;
  // the beat: quick contraction, long relax; each beat lifts it, and it sinks back between
  let period = 3.4 + 1.8 * fract(seed * 7.7);
  let ph = fract(t / period + seed * 3.0);
  s.phase = ph;
  s.beat = smoothstep(0.0, 0.16, ph) * (1.0 - smoothstep(0.16, 0.8, ph));
  let bob = 0.32 * (smoothstep(0.04, 0.42, ph) - ph) + sin(t * 0.07 + a * 5.0) * 1.2;
  s.at = vec3f(h.x + dx, G.waterY + h.y + bob, h.z + dz);
  s.drift = vec3f(vx, 0.0, vz);
  s.up = normalize(vec3f(vx * 0.9, 1.0, vz * 0.9));
  s.size = 0.55 + 0.75 * fract(seed * 13.1);
  let k = fract(seed * 5.3);
  s.col = vec3f(0.28, 0.85, 1.0);
  if (k > 0.4) { s.col = vec3f(0.62, 0.42, 1.0); }
  if (k > 0.72) { s.col = vec3f(0.35, 1.0, 0.68); }
  if (k > 0.9) { s.col = vec3f(1.0, 0.5, 0.62); }
  return s;
}

/** the bell's profile at u (0 the crown .. 1 the margin): (radius, height under the crown), its beat drawing it in */
fn bellProfile(u: f32, beat: f32) -> vec2f {
  let a = u * JPI * 0.5 * 1.08;
  var r = sin(a) * (1.0 - 0.28 * beat * smoothstep(0.3, 1.0, u));
  var y = (1.0 - cos(a)) * (0.78 + 0.22 * beat);
  // (the margin turned in a little)
  r -= smoothstep(0.85, 1.0, u) * 0.06;
  return vec2f(r, y);
}

fn basis(up: vec3f) -> mat3x3f {
  let x = normalize(cross(up, vec3f(0.0, 0.0, 1.0)) + vec3f(0.0, 0.0, 1e-4));
  let z = cross(x, up);
  return mat3x3f(x, up, z);
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> JOut {
  if (J.show.x <= 0.002) { return nothing(); }
  let s = jellyAt(ii, G.time);
  if (dot(s.at - frame.camPos, frame.camFwd) < -4.0) { return nothing(); }
  let M = basis(s.up);
  let R = s.size;
  var o: JOut;
  var v = vi;
  let c = vec2f(f32((22u >> (v % 6u)) & 1u), f32((52u >> (v % 6u)) & 1u));
  var p: vec3f;
  var n: vec3f;
  if (v < BELL_V) {
    let cell = v / 6u;
    let u = (f32(cell / BS) + c.y) / f32(BR);
    let ang = (f32(cell % BS) + c.x) / f32(BS) * 2.0 * JPI;
    // (the margin scalloped between the tendrils)
    let scallop = 1.0 + 0.04 * smoothstep(0.75, 1.0, u) * cos(ang * f32(TN));
    let pr = bellProfile(u, s.beat);
    let e = 0.01;
    let pr2 = bellProfile(u + e, s.beat);
    let local = vec3f(cos(ang) * pr.x * scallop, -pr.y, sin(ang) * pr.x * scallop) * R;
    let tang = vec2f(pr2.x - pr.x, -(pr2.y - pr.y));
    let nr = normalize(vec2f(-tang.y, tang.x));
    n = M * normalize(vec3f(cos(ang) * nr.x, -nr.y, sin(ang) * nr.x)) * -1.0;
    p = s.at + M * local;
    o.q = vec3f(u, ang, 0.0);
    o.part = vec2f(0.0, s.beat);
  } else if (v < BELL_V + TENDRIL_V) {
    v -= BELL_V;
    let strand = v / (TS * 6u);
    let seg = (v / 6u) % TS;
    let t = (f32(seg) + c.y) / f32(TS);
    let ang = (f32(strand) + 0.5) / f32(TN) * 2.0 * JPI;
    let rim = bellProfile(0.98, s.beat);
    let len = R * (3.2 + 1.6 * hash12(vec2f(f32(strand), f32(ii))));
    // hanging, trailing the drift, the beat's wave running down them
    let lag = t * t;
    let sway = vec3f(sin(G.time * 0.8 + ang * 2.0 + t * 4.0), 0.0, cos(G.time * 0.7 + ang * 3.0 + t * 3.5)) * 0.12 * t * len;
    let wave = sin(t * 9.0 - s.phase * 6.2831) * 0.05 * R * t;
    let root = s.at + M * vec3f(cos(ang) * rim.x * R * 0.92, -rim.y * R, sin(ang) * rim.x * R * 0.92);
    let C = root + M * vec3f(cos(ang) * wave, -t * len, sin(ang) * wave) - s.drift * lag * len * 2.2 + sway;
    // (a ribbon facing the eye, a pixel or so wide at least)
    let d = length(C - frame.camPos);
    let px = 2.0 * tan(frame.fovY * 0.5) * d / max(G.vp.w, 1.0);
    let w = max(0.006 * R * (1.0 - 0.6 * t), px * 0.7);
    let T = normalize(M[1] * -1.0 - s.drift * 2.0 * t + vec3f(1e-4, 0.0, 0.0));
    let side = normalize(cross(T, normalize(C - frame.camPos)));
    p = C + side * (c.x * 2.0 - 1.0) * w;
    n = side;
    o.q = vec3f(t, c.x * 2.0 - 1.0, (0.006 * R) / w);
    o.part = vec2f(1.0, s.beat);
  } else if (v < JELLY_V) {
    v -= BELL_V + TENDRIL_V;
    // the oral arms: four frilled curtains spiralling down from under the bell's middle
    let arm = v / (AS * 6u);
    let seg = (v / 6u) % AS;
    let t = (f32(seg) + c.y) / f32(AS);
    let ang = f32(arm) / f32(AN) * 2.0 * JPI + t * 1.2 + sin(G.time * 0.4) * 0.2;
    let len = R * 1.5;
    let width = R * 0.22 * (1.0 - 0.5 * t) * (0.7 + 0.3 * sin(t * 18.0 + G.time));
    let top = s.at + M * vec3f(0.0, -R * 0.55, 0.0);
    let C = top + M * vec3f(cos(ang) * R * 0.08, -t * len, sin(ang) * R * 0.08) - s.drift * t * t * len * 1.6;
    let side = M * vec3f(cos(ang), 0.0, sin(ang));
    p = C + side * c.x * width;
    n = M * vec3f(-sin(ang), 0.0, cos(ang));
    o.q = vec3f(t, c.x, 0.0);
    o.part = vec2f(2.0, s.beat);
  } else {
    return nothing();
  }
  o.world = p;
  o.pos = clipAt(p);
  o.n = n;
  o.col = s.col;
  return o;
}

@fragment fn fs(i: JOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  if (clipBelowWater(i.world)) { discard; }
  let v = normalize(frame.camPos - i.world);
  var c = vec3f(0.0);
  let t = G.time;
  if (i.part.x < 0.5) {
    // the bell: clear glass that glows at its edges (where the eye looks through more of it), its canals, its beads
    let u = i.q.x;
    let ang = i.q.y;
    let n = normalize(i.n);
    let edge = pow(1.0 - abs(dot(n, v)), 2.2);
    let canals = pow(abs(cos(ang * 4.0)), 60.0) * smoothstep(0.1, 0.4, u) * (1.0 - smoothstep(0.85, 1.0, u));
    let crown = exp(-u * u * 30.0) * 0.8;
    // the beads round the margin, a pulse running round them with each beat
    let beadAng = ang * f32(TN) * 2.0;
    let bead = pow(saturate(cos(beadAng) * 0.5 + 0.5), 30.0) * smoothstep(0.9, 0.99, u);
    let run = 0.4 + 0.6 * pow(saturate(cos(ang - t * 2.3) * 0.5 + 0.5), 4.0);
    let inner = select(0.6, 1.0, front);
    c = i.col * (0.05 + edge * 0.9 + canals * 0.7 + crown) * inner;
    c += mix(i.col, vec3f(1.0), 0.5) * bead * run * 4.0;
    // the beat brightens it
    c *= 0.8 + 0.6 * i.part.y;
  } else if (i.part.x < 1.5) {
    // a tendril: a fine thread, pulses of light running down it
    let along = i.q.x;
    let across = 1.0 - abs(i.q.y);
    let pulse = pow(saturate(sin(along * 14.0 - t * 2.5) * 0.5 + 0.5), 8.0);
    c = i.col * (0.35 + 1.4 * pulse) * across * i.q.z * (1.0 - along * 0.85);
  } else {
    // an arm: a frilled curtain, brighter at its ruffled edge
    let frill = smoothstep(0.6, 1.0, abs(i.q.y));
    c = mix(i.col, vec3f(0.9, 0.8, 1.0), 0.3) * (0.08 + 0.5 * frill) * (1.0 - i.q.x * 0.6);
  }
  let fade = exp(-length(i.world - frame.camPos) * G.haze * 0.7);
  return vec4f(c * J.show.x * fade, 0.0);
}

// ---------------------------------------------------------------- the light they shed on the water
struct POut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) @interpolate(flat) light: vec4f,   // its colour times its strength, its height over the water
  @location(2) @interpolate(flat) at: vec2f,      // where it is (x, z)
}

@vertex fn vsPool(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> POut {
  var o: POut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  if (J.show.x <= 0.002) { return o; }
  let s = jellyAt(ii, G.time);
  let h = max(s.at.y - G.waterY, 0.3);
  let r = 1.5 + h * 1.1;
  // (only over the water)
  if (lagoonSdf(s.at.xz) > r) { return o; }
  let c = vec2f(f32((22u >> vi) & 1u), f32((52u >> vi) & 1u)) * 2.0 - 1.0;
  let p = vec3f(s.at.x + c.x * r, G.waterY + 0.015, s.at.z + c.y * r);
  o.world = p;
  o.pos = clipAt(p);
  o.light = vec4f(s.col * (0.8 + 0.6 * s.beat) * s.size * s.size, h);
  o.at = s.at.xz;
  return o;
}

@fragment fn fsPool(i: POut) -> @location(0) vec4f {
  let h = i.light.w;
  let d = length(i.world.xz - i.at);
  // the light from the jelly above, as a lamp's on a plane (h / r^3), and a breath of it off the ripples
  let r2 = d * d + h * h;
  let lit = h / (r2 * sqrt(r2)) * 1.6;
  let ripple = 0.75 + 0.25 * noise2(i.world.xz * 3.0 + vec2f(G.time * 0.5, G.time * 0.2));
  let fade = exp(-length(i.world - frame.camPos) * G.haze * 0.7);
  let edge = 1.0 - smoothstep(1.0 + h * 0.6, 1.5 + h * 1.1, d);
  return vec4f(i.light.rgb * lit * ripple * edge * fade * J.show.x * 0.5, 0.0);
}
