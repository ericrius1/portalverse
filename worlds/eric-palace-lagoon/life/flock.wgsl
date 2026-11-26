// The murmuration: a few thousand starlings over the lagoon at sunset, stepped on the GPU once a frame (life/flock.ts).
// Each bird steers by the others within a few metres (a few tiles of them a step through workgroup memory, round in turn):
// it keeps its distance from the nearest, flies the way its neighbours fly, closes on them. The flock as a whole is
// pulled round a few lobes that wander over the water, merge and part (so the cloud stretches, folds, splits and
// pours back into itself), and it swirls. When the peregrine stoops, the birds near it flash away and the turn runs
// through the flock as a dark wave. As the light goes the birds go down to roost on the far bank, a stream of them at
// a time spiralling down into it, and come up again (the walk back toward the sunset) in the order they went.
#include "../shaders/common"

struct Sim {
  time: f32,
  dt: f32,
  count: u32,
  roost: f32,       // 0 all aloft .. 1 all gone down to the roost
  att0: vec4f,      // the flock's lobes: their centres (xyz) and how far round them the birds may spread (m)
  att1: vec4f,
  att2: vec4f,
  falcon: vec4f,    // the falcon (xyz) and how much the flock fears it now (0..1)
  player: vec4f,    // the player (xyz), w 1 if there is one
  roostAt: vec4f,   // the roost (xyz) and its radius (m)
  swirl: vec4f,     // x: which way and how hard the flock turns round its lobes; y: how far it may stray (0..1)
  tileStart: u32,   // the first tile of others this step looks at, and how many (a few a step, round in turn: the
  tiles: u32,       // neighbours' pull is held by each bird's momentum between them)
}
// p: xyz, the wingbeat's phase; v: xyz, the bank; e: the beat's amplitude, -, its seed (0..1: the roost's order), how
// much of it shows (0 gone to roost)
struct Boid { p: vec4f, v: vec4f, e: vec4f }
struct Bird { a: vec4f, b: vec4f, c: vec4f, d: vec4f }

@group(2) @binding(0) var<uniform> sim: Sim;
@group(2) @binding(1) var<storage, read> prev: array<Boid>;
@group(2) @binding(2) var<storage, read_write> next: array<Boid>;
@group(2) @binding(3) var<storage, read_write> flock: array<Bird>;

const TILE = 256u;
/** neighbours within (m), squared, and the personal space kept from the nearest (m), squared */
const R2 = 49.0;
const S2 = 1.0;
const FTAU = 6.2831853;
var<workgroup> tp: array<vec4f, TILE>;
var<workgroup> tv: array<vec4f, TILE>;

fn lobe(seed: f32) -> vec4f {
  let k = fract(seed * 7.31 + 0.13);
  if (k < 0.5) { return sim.att0; }
  if (k < 0.8) { return sim.att1; }
  return sim.att2;
}

/** a smooth wander for each bird, a few metres per second squared */
fn wander(p: vec3f, t: f32, seed: f32) -> vec3f {
  let q = p.xz * 0.045 + vec2f(t * 0.11, seed * 13.0);
  return vec3f(noise2(q) - 0.5, (noise2(q + vec2f(31.0, 7.0)) - 0.5) * 0.6, noise2(q + vec2f(-17.0, 23.0)) - 0.5) * 2.0;
}

@compute @workgroup_size(256)
fn stepFlock(@builtin(global_invocation_id) gid: vec3u, @builtin(local_invocation_id) lid: vec3u) {
  let n = sim.count;
  let i = min(gid.x, n - 1u);
  let me = prev[i];
  let p = me.p.xyz;
  let v = me.v.xyz;
  let seed = me.e.z;
  let dt = min(sim.dt, 0.05);

  // ---- every other bird, a tile at a time (those gone to roost left out)
  var ali = vec3f(0.0);
  var coh = vec3f(0.0);
  var sep = vec3f(0.0);
  var wsum = 0.0;
  let nT = (n + TILE - 1u) / TILE;
  let visit = clamp(sim.tiles, 1u, nT);
  for (var t = 0u; t < visit; t++) {
    let base = ((sim.tileStart + t) % nT) * TILE;
    let j = base + lid.x;
    var q = vec4f(1e6, 1e6, 1e6, 0.0);
    var qv = vec4f(0.0);
    if (j < n && j != i) {
      let o = prev[j];
      if (o.e.w > 0.5) { q = vec4f(o.p.xyz, 1.0); qv = o.v; }
    }
    tp[lid.x] = q;
    tv[lid.x] = qv;
    workgroupBarrier();
    for (var k = 0u; k < TILE; k++) {
      let d = tp[k].xyz - p;
      let r2 = dot(d, d);
      if (r2 < R2) {
        let w = 1.0 - r2 / R2;
        ali += tv[k].xyz * w;
        coh += d * w;
        wsum += w;
        if (r2 < S2) { sep -= d * (1.0 / max(r2, 0.04) - 1.0 / S2); }
      }
    }
    workgroupBarrier();
  }

  let speed = length(v);
  let fwd = v / max(speed, 1e-3);
  var acc = vec3f(0.0);
  if (wsum > 0.0) {
    acc += (ali / wsum - v) * 2.6;
    acc += (coh / wsum) * 1.4;
  }
  sep *= f32(nT) / f32(visit);
  let sepL = length(sep);
  acc += sep / max(sepL, 1e-4) * min(sepL * 2.5, 18.0);

  // ---- its lobe: a soft shell round it, and the swirl round the lobe's upright
  let A = lobe(seed);
  let toA = A.xyz - p;
  let dA = length(toA);
  let dirA = toA / max(dA, 1e-3);
  let stray = mix(1.0, 0.35, sim.swirl.y);
  acc += dirA * (1.5 + max(dA - A.w, 0.0) * 0.9 * stray);
  // (a bird out past its lobe turns back in to it, rather than wheeling round it in a ring)
  acc += (dirA * speed - v) * 0.9 * smoothstep(A.w, A.w + 14.0, dA);
  let flatA = normalize(vec3f(toA.x, 0.0, toA.z) + vec3f(1e-3, 0.0, 0.0));
  acc += cross(flatA, vec3f(0.0, 1.0, 0.0)) * sim.swirl.x * smoothstep(2.0, 16.0, dA);
  acc += wander(p, sim.time, seed) * 0.6;

  // ---- the falcon: the nearest flash away and up, the turn running on through the alignment
  let f = p - sim.falcon.xyz;
  let df = length(f);
  if (sim.falcon.w > 0.0 && df < 26.0) {
    let away = f / max(df, 0.1);
    let fear = sim.falcon.w * pow(1.0 - df / 26.0, 2.0);
    acc += (away * 55.0 + cross(away, vec3f(0.0, 1.0, 0.0)) * 18.0 * sign(seed - 0.5)) * fear;
  }
  // ---- the player, if the flock comes down near them (and the Palace's dome, which it wheels round)
  let fp = p - sim.player.xyz;
  let dp = length(fp);
  if (sim.player.w > 0.5 && dp < 12.0) { acc += fp / max(dp, 0.1) * 30.0 * (1.0 - dp / 12.0); }
  let dome = p - vec3f(G.palace.x, 18.0, G.palace.y);
  let dd = length(dome);
  if (dd < 48.0) { acc += dome / max(dd, 0.1) * 25.0 * (1.0 - dd / 48.0); }

  // ---- over the water and the land, under a ceiling
  let ground = max(terrainHeight(p.xz), G.waterY);
  let goingDown = seed < sim.roost;
  if (!goingDown) {
    let low = ground + 9.0 - p.y;
    if (low > 0.0) { acc.y += low * 2.5; }
    if (p.y > 85.0) { acc.y -= (p.y - 85.0) * 1.5; }
  }

  // ---- its speed: a starling's 11-14 m/s
  let cruise = 11.5 + 2.5 * fract(seed * 13.7);
  acc += fwd * (cruise - speed) * 1.4;

  // ---- going down to roost: out of the flock in a stream, spiralling down into the reeds
  var vis = me.e.w;
  let toR = sim.roostAt.xyz - p;
  let dR = length(toR);
  if (goingDown) {
    let flatR = vec3f(toR.x, 0.0, toR.z);
    let dh = length(flatR);
    let around = cross(vec3f(0.0, 1.0, 0.0), flatR / max(dh, 1e-3));
    // (the funnel: aim a little above the roost, the further off the higher, and wheel round it closing in)
    let aim = sim.roostAt.xyz + vec3f(0.0, min(dh * 0.45, 30.0), 0.0) - p;
    acc = acc * 0.25 + normalize(aim) * 22.0 + around * 7.0 * smoothstep(10.0, 35.0, dh);
    // (in among the reeds: gone from sight)
    if (dh < sim.roostAt.w * 2.5 && p.y < sim.roostAt.y + 4.0) { vis = max(vis - dt * 1.2, 0.0); }
  } else if (vis < 1.0) {
    vis = min(vis + dt * 0.9, 1.0);
    acc.y += 8.0;
  }

  let aL = length(acc);
  acc = acc / max(aL, 1e-4) * min(aL, 70.0);
  var nv = v + acc * dt;
  let s = length(nv);
  let minS = select(5.0, 2.0, goingDown);
  let maxS = select(24.0, mix(5.0, 24.0, smoothstep(4.0, 30.0, dR)), goingDown);
  nv = nv / max(s, 1e-3) * clamp(s, minS, maxS);
  var np = p + nv * dt;
  // (down in the roost: held there, hidden, till it's time to go up again)
  if (vis <= 0.0) {
    let h = vec2f(fract(seed * 91.7), fract(seed * 53.3)) - 0.5;
    np = sim.roostAt.xyz + vec3f(h.x * sim.roostAt.w * 2.0, 0.5, h.y * sim.roostAt.w * 2.0);
    nv = vec3f(cos(seed * 40.0), 0.6, sin(seed * 40.0)) * 6.0;
  }

  // ---- the wings: bursts of quick beats and glides, beating when it climbs, turns hard or is slow
  let right = normalize(cross(fwd, vec3f(0.0, 1.0, 0.0)) + vec3f(1e-4, 0.0, 0.0));
  let lat = dot(acc, right);
  let bank = mix(me.v.w, clamp(lat * 0.07, -1.2, 1.2), min(1.0, dt * 5.0));
  let burst = noise2(vec2f(sim.time * 0.8, seed * 97.0));
  let beating = burst > 0.42 || nv.y > 1.2 || s < 10.5 || abs(lat) > 14.0;
  let amp = mix(me.e.x, select(0.0, 0.95, beating), min(1.0, dt * 7.0));
  var phase = me.p.w;
  if (amp > 0.05) { phase += dt * (10.5 + 2.0 * fract(seed * 5.1)) * FTAU; }
  else { phase += (atan2(sin(-phase), cos(-phase))) * min(1.0, dt * 4.0); }
  phase = phase - floor(phase / FTAU) * FTAU;

  if (gid.x < n) {
    next[i] = Boid(vec4f(np, phase), vec4f(nv, bank), vec4f(amp, 0.0, seed, vis));
    let heading = atan2(nv.z, nv.x);
    let pitch = asin(clamp(nv.y / max(length(nv), 1e-3), -1.0, 1.0)) * 0.8;
    let size = 0.9 + 0.2 * fract(seed * 31.3);
    flock[i] = Bird(vec4f(np, heading), vec4f(pitch, bank, 0.0, size), vec4f(phase, amp, 0.0, 0.1), vec4f(0.0, 0.0, length(nv), vis));
  }
}
