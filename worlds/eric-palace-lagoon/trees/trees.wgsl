// The grove's trees, drawn a kind at a time (index.ts: one draw of its bark and one of its cards for each kind, over
// its trees). Every vertex is pulled by number from the kind's grown lists (grow.ts) and placed for its tree (its
// foot, size, stretch and turn: placement.ts); each tree sizes its crown's clumps its own way. A tree wholly out of the
// view, or a card past what its distance keeps, folds to nothing before any of the rest is done.
//
// The light, after Earth's trees (github.com/ericrius1/world: web/src/trees/trees.wgsl) and Tidewater's (Daniel
// Greenheck, MIT): each clump one mass with a soft lit side on its bent normal, its shade cooler and lifted by the
// sky coming down through the crown, darker deep inside; the key light through the leaves (a crown against the low
// sun aglow at its edges, gold); each clump shaded as one by what's between it and the light (the Palace, a
// neighbour), looked up past its sunward side. At night: the flowers' bioluminescence, pulsing slowly through the
// crown; a willow's strands glowing at their tips; the moss's faint lichen-light.
#include "../shaders/common"
#include "../../../packages/core/src/rooms/projection/light"

struct Species {
  leaf: vec3f,        // the leaves' albedo
  glowLeaves: f32,    // how much of the flowers' glow the leaves round them take
  lit: vec3f,         // the lit side's tint
  gloss: f32,
  through: vec3f,     // the key light through the leaves
  moss: f32,
  bark: vec3f,
  height: f32,        // the kind's height (m)
  bloom: vec3f,
  farCards: f32,      // the cards kept far off (the first ones)
  glow: vec3f,        // the flowers' glow at night
  trunkVerts: f32,    // the bark's trunk alone (the first vertices)
  tipGlow: vec3f,     // a strand's or a frond's tips at night
  reach: f32,         // past this (m) the kind isn't drawn at all (0: always)
  bound: vec4f,       // the tree's sphere: its centre's height, its radius (m); the far level from, to (m)
}
@group(2) @binding(0) var<uniform> S: Species;
// two a tree: its foot (x, y, z) and size; its turn, its height's stretch, its seed, 1 for a tree of the woods
@group(2) @binding(1) var<storage, read> trees: array<vec4f>;
// five a card (grow.ts CARD)
@group(2) @binding(2) var<storage, read> cards: array<vec4f>;
// four a bark vertex (grow.ts BARK)
@group(2) @binding(3) var<storage, read> bark: array<vec4f>;
@group(2) @binding(4) var leafTex: texture_2d_array<f32>;

const WIND_DIR = vec2f(0.94, 0.34);

struct Tree { p: vec3f, s: f32, cs: f32, sn: f32, sy: f32, seed: f32, woods: bool }

fn treeAt(ii: u32) -> Tree {
  let a = trees[ii * 2u];
  let b = trees[ii * 2u + 1u];
  return Tree(a.xyz, a.w, cos(b.x), sin(b.x), b.y, b.z, b.w > 0.5);
}
/** a point of the kind's (m, its frame) into the world for tree T */
fn place(T: Tree, l: vec3f) -> vec3f {
  return T.p + vec3f(l.x * T.cs - l.z * T.sn, l.y * T.sy, l.x * T.sn + l.z * T.cs) * T.s;
}
fn turn(T: Tree, n: vec3f) -> vec3f {
  return vec3f(n.x * T.cs - n.z * T.sn, n.y / T.sy, n.x * T.sn + n.z * T.cs);
}
/** is the whole tree out of this view (or past its kind's reach)? */
fn notSeen(T: Tree) -> bool {
  let c = T.p + vec3f(0.0, S.bound.x * T.s * T.sy, 0.0);
  let r = S.bound.y * T.s * max(1.0, T.sy);
  if (S.reach > 0.0 && distance(c, frame.camPos) > S.reach + r) { return true; }
  let q = clipAt(c);
  let k = r * max(abs(frame.proj[0][0]), abs(frame.proj[1][1]));
  return q.w < -r || q.x < -q.w - k || q.x > q.w + k || q.y < -q.w - k || q.y > q.w + k;
}
/** how far into the far level a tree is (0 near .. 1 far): a tree of the woods always */
fn farness(T: Tree) -> f32 {
  if (T.woods) { return 1.0; }
  let d = distance(T.p, frame.camPos) / max(T.s, 0.3);
  var f = smoothstep(S.bound.z, S.bound.w, d);
  // (a small plant shrinks away toward its reach)
  if (S.reach > 0.0) { f = max(f, smoothstep(S.reach * 0.7, S.reach, distance(T.p, frame.camPos))); }
  return f;
}

/** each tree's clumps its own: clump `id` (centre `c`, the kind's) moved a little in or out and sized its own way */
fn lobeOf(T: Tree, id: f32, c: vec3f) -> vec4f {
  let h = hash12(vec2f(id * 7.13 + 1.0, T.seed * 91.7));
  let m = 0.9 + 0.2 * fract(h * 7.31);
  return vec4f(c.x * m, c.y, c.z * m, 0.82 + 0.36 * h);
}

/** the gusts: rolling over the land from the west */
fn gust(xz: vec2f, t: f32) -> f32 {
  return 0.35 + 0.65 * noise2(xz * 0.022 - WIND_DIR * t * 0.32);
}
/** the wind's push on a tree at a point with sway w (0 at its foot .. 1 at its outermost twigs), its clump's number */
fn windPush(T: Tree, w: f32, lobe: f32, vi: u32, leafy: bool) -> vec3f {
  let t = G.time;
  let H = S.height * T.s;
  let g = gust(T.p.xz, t);
  let sw = sin(t * 1.1 + T.seed * 6.28) * 0.6 + sin(t * 2.7 + T.seed * 11.0) * 0.25;
  let bend = w * w * H * 0.011 * g * (0.65 + 0.45 * sw);
  var d = vec3f(WIND_DIR.x * bend, -bend * 0.12, WIND_DIR.y * bend);
  if (lobe >= 0.0) {
    // each clump rocked on its limb, a little behind the trunk
    let rock = sin(t * 1.7 + lobe * 2.3 + T.seed * 6.28) * 0.018 * H * w * g;
    d += vec3f(WIND_DIR.x * rock - WIND_DIR.y * rock * 0.5, rock * 0.35, WIND_DIR.y * rock + WIND_DIR.x * rock * 0.5);
  }
  if (leafy) {
    d.y += sin(t * 7.0 + f32(vi) * 1.7) * 0.035 * w * g;
  }
  return d;
}

/** the drones' projected light at a point (per vertex: on leaves a wash of the show's colours), near the Palace only */
fn droneLight(p: vec3f, n: vec3f) -> vec3f {
  if (G.palace.w <= 0.0 || distance(p.xz, G.palace.xy) > 140.0) { return vec3f(0.0); }
  return projectedLight(p, n) * G.palace.w;
}

// ------------------------------------------------------------------ the cards
struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) info: vec4u,   // kind, layer, -, -
  @location(4) shade: vec4f,                     // ao, the clump's key light (shadow), along a strand (0 top .. 1 tip), seed
  @location(5) fog: vec4f,                       // the haze's colour and how much
  @location(6) proj: vec3f,                      // the drones' projectors' light here (light.wgsl)
}

struct Corner { ok: bool, lp: vec3f, kind: u32, layer: u32, uv: vec2f, n: vec3f, sway: f32, ao: f32, lobe: vec3f, lw: f32, along: f32, lobeR: f32 }

/** a card's corner for tree T (its kind's frame, m): vertex vi of its six. `far`: the far level (the first third,
 *  grown) as a shadow caster draws it */
fn corner(T: Tree, vi: u32, shadow: bool) -> Corner {
  var o: Corner;
  o.ok = false;
  let card = vi / 6u;
  let k = vi % 6u;
  let keep = card < u32(S.farCards);
  let f = select(farness(T), 1.0, shadow);
  if (!keep && f > 0.999) { return o; }
  let base = card * 5u;
  let v0 = cards[base];
  let v1 = cards[base + 1u];
  let v2 = cards[base + 2u];
  let v3 = cards[base + 3u];
  let v4 = cards[base + 4u];
  let code = u32(v0.w);
  o.kind = code / 1024u;
  o.layer = (code / 64u) % 16u;
  let seg = f32((code / 8u) % 8u);
  let segs = f32(code % 8u);
  // the outer third grows as the rest shrinks away
  let g = select(1.0 - f, mix(1.0, 1.55, f), keep);
  // (the corners: (0,0) (1,0) (1,1) / (0,0) (1,1) (0,1) as bit masks)
  let cx = f32((22u >> k) & 1u);
  let cy = f32((52u >> k) & 1u);
  var c = v0.xyz;
  var a = v1.xyz;
  var b = v2.xyz;
  o.lobe = v4.xyz;
  o.lw = v4.w;
  o.lobeR = fract(max(v4.w, 0.0)) * 16.0;
  if (v4.w >= 0.0) {
    let L = lobeOf(T, floor(v4.w), v4.xyz);
    c = L.xyz + (c - o.lobe) * L.w;
    o.lobe = L.xyz;
    o.lobeR *= L.w;
    a *= L.w;
    b *= L.w;
  }
  if (o.kind >= 2u) {
    // a strand or a frond: as wide as it's kept, its length its own
    a *= g;
    o.uv = vec2f(cx, (seg + cy) / segs);
    o.along = (seg + cy) / segs;
  } else {
    a *= g;
    b *= g;
    o.uv = vec2f(cx, cy);
    o.along = 0.0;
  }
  if (g < 0.01) { return o; }
  o.lp = c + a * (cx * 2.0 - 1.0) + b * (cy * 2.0 - 1.0);
  o.n = v3.xyz;
  o.ao = v3.w;
  o.sway = v2.w;
  o.ok = true;
  return o;
}

fn collapsedL() -> LOut {
  var o: LOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  return o;
}

@vertex fn vsLeaf(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  let T = treeAt(ii);
  if (notSeen(T)) { return collapsedL(); }
  let C = corner(T, vi, false);
  if (!C.ok) { return collapsedL(); }
  var p = place(T, C.lp);
  // the wind: a strand swings below where it hangs, a pendulum; the rest bends with the tree and its clump
  var push = windPush(T, C.sway, select(-1.0, floor(C.lw), C.lw >= 0.0), vi, true);
  if (C.kind == 2u) {
    let t = G.time;
    let drop = max(0.0, C.lobe.y - C.lp.y) * T.s;
    let phase = -C.lw * 1.618;
    let g = gust(T.p.xz, t);
    let swing = (0.06 * drop + 0.016 * drop * drop) * g * (0.75 + 0.25 * sin(t * 0.9 + phase));
    let side = sin(t * 1.3 + phase * 2.0 + drop * 0.35) * 0.05 * drop;
    push = windPush(T, 0.55, -1.0, vi, false) + vec3f(WIND_DIR.x * swing - WIND_DIR.y * side, swing * -0.1, WIND_DIR.y * swing + WIND_DIR.x * side);
  }
  p += push;
  var o: LOut;
  o.pos = clipAt(p);
  o.world = p;
  o.n = normalize(turn(T, C.n));
  o.uv = C.uv;
  o.info = vec4u(C.kind, C.layer, 0u, 0u);
  // the clump's key light: the shadow map looked up past its sunward side (it lit or shaded as one by what's round
  // it, never striped by its own cards); a strand's or a frond's where it is
  var vis = 1.0;
  if (C.lw >= 0.0) {
    let lc = place(T, C.lobe) + push;
    vis = sunShadow(lc + G.sunDir * (C.lobeR * T.s * 1.1 + 0.8), vec3f(0.0, 1.0, 0.0));
  } else {
    vis = sunShadow(p, vec3f(0.0, 1.0, 0.0));
  }
  o.shade = vec4f(C.ao, vis, C.along, T.seed);
  let to = p - frame.camPos;
  let d = length(to);
  let dir = to / max(d, 1e-3);
  o.fog = vec4f(skyColor(vec3f(dir.x, max(dir.y, 0.0) * 0.4, dir.z)), 1.0 - exp(-d * G.haze));
  o.proj = droneLight(p, o.n);
  return o;
}

/** a crown's leaves lit as a painter lays foliage in (see the top) */
fn leafLight(albedo: vec3f, n: vec3f, v: vec3f, ao: f32, vis: f32) -> vec3f {
  let l = G.sunDir;
  let ndl = dot(n, l);
  let key = G.sunColor * vis;
  // the lit side: a soft terminator wrapping round each clump, warmer
  let lit = smoothstep(-0.3, 0.85, ndl) * mix(0.5, 1.0, ao);
  var c = albedo * S.lit * key * lit;
  // the shade: the sky's light coming down through the crown, cooler, darker deep inside
  let sky = ambient(normalize(n + vec3f(0.0, 0.6, 0.0)));
  let cool = albedo * vec3f(0.82, 1.0, 1.15);
  c += cool * sky * mix(0.35, 1.1, ao) * 1.5;
  // the key light through the leaves: a little wherever it reaches the crown, a crown against it aglow at its edges
  let edge = 1.0 - saturate(dot(n, v));
  let back = pow(saturate(dot(-v, l)), 3.0);
  let thru = (0.03 + saturate(-ndl * 0.7 + 0.3) * back * (0.05 + 0.95 * edge * edge)) * ao * ao;
  c += S.through * key * thru;
  // a rim of the sky round the crown's edge, and the leaves' sheen
  c += cool * sky * pow(edge, 3.0) * ao * 0.5;
  c += key * ggx(n, v, l, 0.5, vec3f(0.04)) * S.gloss * ao;
  return c;
}

@fragment fn fsLeaf(i: LOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  let kind = i.info.x;
  let tex = textureSample(leafTex, samp_linear, i.uv, i.info.y);
  let fw = max(fwidth(tex.r), 1e-4);
  // the leaves' coverage, sharpened to the pixel: its threshold lowered as the atlas is minified (its mips average
  // the leaves with their gaps, and a far crown would thin away) — but not for a card at a slant — and a cluster seen
  // edge-on thinned out (no slivers through the crown: Tidewater's)
  let du = dpdx(i.uv);
  let dv = dpdy(i.uv);
  let sum2 = dot(du, du) + dot(dv, dv);
  let area = abs(du.x * dv.y - du.y * dv.x);
  let long2 = max(0.5 * (sum2 + sqrt(max(sum2 * sum2 - 4.0 * area * area, 0.0))), 1e-14);
  let mip = 0.5 * log2(long2) + log2(f32(textureDimensions(leafTex).x));
  let squash = area / long2;
  let card = kind < 2u;
  let facing = select(1.0, squash, card);
  let thr = mix(0.5, 0.28, saturate(mip / 4.0) * smoothstep(0.35, 0.65, facing)) + (1.0 - smoothstep(0.08, 0.4, facing)) * 0.6;
  let a = (tex.r - thr) / fw + 0.5;
  let p = i.world;
  // (everything cut is cut once, at the end: an early discard before the light has blackened far crowns on Metal)
  let cut = a < 0.5 || clipBelowWater(p);

  let v = normalize(frame.camPos - p);
  var n = normalize(i.n);
  // (a frond's two sides are its own; a crown's cards share their clump's light, front or back)
  if (!front && kind == 3u) { n = -n; }
  let dist = distance(p, frame.camPos);
  let near = 1.0 - smoothstep(8.0, 45.0, dist);
  let tilt = (tex.ba - 0.5) * 2.0;
  n = normalize(n + vec3f(tilt.x, 0.0, tilt.y) * mix(0.08, 0.25, near));
  let seed = i.shade.w;
  let ao = i.shade.x;
  var albedo = S.leaf * (0.85 + 0.3 * seed) * mix(1.0, 0.45 + 0.9 * tex.g, mix(0.3, 0.6, near));
  // (each clump a little its own: a crown's masses read apart)
  albedo *= 0.9 + 0.2 * noise2(p.xz * 0.35 + p.y * 0.2);
  // (the flowers close a little as the night comes: their own glow is what shows them then)
  if (kind == 1u) { albedo = S.bloom * (0.55 + 0.75 * tex.g) * (0.9 + 0.2 * seed) * mix(1.0, 0.3, G.night); }
  var c = leafLight(albedo, n, v, ao, i.shade.y);

  // ---- the night's magic
  let t = G.time;
  let night = G.night;
  if (night > 0.0) {
    // a slow pulse travelling up through the crown, each tree its own
    let pulse = 0.6 + 0.4 * sin(t * 0.8 - p.y * 0.45 + dot(p.xz, vec2f(0.13, 0.09)) + seed * 6.28);
    if (kind == 1u) {
      // the flowers' bioluminescence: a soft glow through the bloom, darker deep in the crown, and every so often a
      // floret alight, bright at its rim (each its own, by where it is), sparking now and then
      let fl = hash13(floor(p * 2.7) + vec3f(seed * 17.0));
      let lit = pow(fl, 5.0) * (0.6 + 0.4 * sin(t * (1.3 + fl * 2.0) + fl * 40.0));
      let spark = smoothstep(0.97, 1.0, noise2(p.xz * 3.0 + vec2f(t * 0.7, -t * 0.4)));
      c += S.glow * night * (0.025 + 1.6 * lit * tex.g + 1.5 * spark) * (0.25 + 0.75 * ao) * pulse * (0.4 + 0.6 * tex.g);
    } else if (kind == 2u || kind == 3u) {
      // a strand's (a frond's) tips aglow, the glow running down it now and then
      let run = smoothstep(0.6, 1.0, sin(t * 0.6 + seed * 9.0 - i.shade.z * 3.0) * 0.5 + 0.5);
      c += S.tipGlow * night * (smoothstep(0.75, 1.0, i.shade.z) * 0.9 + run * 0.25) * (0.3 + 0.7 * tex.g) * pulse;
    }
    // the leaves round the flowers take a little of their light, more deep in the crown
    c += S.glow * S.glowLeaves * night * (0.3 + 0.7 * (1.0 - ao)) * pulse * select(0.0, 1.0, kind == 0u);
  }
  // (a crown takes the projectors as scattered washes, not as an image on a wall: a third as strong)
  c += projectionTake(albedo) * i.proj * mix(0.15, 0.35, ao);
  c = mix(c, i.fog.rgb, i.fog.a);
  if (cut) { discard; }
  return vec4f(c, 1.0);
}

// ------------------------------------------------------------------ the bark
struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,          // round it (m), along it (m)
  @location(3) shade: vec4f,       // ao, its radius (m), seed, -
  @location(4) proj: vec3f,
}

fn collapsedB() -> BOut {
  var o: BOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  return o;
}

/** a bark vertex for tree T (its kind's frame), and its clump (to move with it) */
fn barkAt(T: Tree, vi: u32) -> array<vec4f, 4> {
  let b = vi * 4u;
  var v = array<vec4f, 4>(bark[b], bark[b + 1u], bark[b + 2u], bark[b + 3u]);
  if (v[1].w >= 0.0) {
    let L = lobeOf(T, v[1].w, v[3].xyz);
    v[0] = vec4f(v[0].xyz + (L.xyz - v[3].xyz), v[0].w);
  }
  return v;
}

@vertex fn vsBark(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BOut {
  let T = treeAt(ii);
  if (notSeen(T)) { return collapsedB(); }
  // (far off only the trunk: the limbs are in the crown)
  if (vi >= u32(S.trunkVerts) && farness(T) > 0.999) { return collapsedB(); }
  let v = barkAt(T, vi);
  var p = place(T, v[0].xyz);
  p += windPush(T, v[0].w, v[1].w, vi, false);
  var o: BOut;
  o.pos = clipAt(p);
  o.world = p;
  o.n = normalize(turn(T, v[1].xyz));
  o.uv = v[2].xy * T.s;
  o.shade = vec4f(v[2].w, v[2].z * T.s, T.seed, 0.0);
  o.proj = droneLight(p, o.n);
  return o;
}

@fragment fn fsBark(i: BOut) -> @location(0) vec4f {
  let p = i.world;
  var n = normalize(i.n);
  let seed = i.shade.z;
  // furrows up the trunk and along the limbs: ridges broken across, in metres round and along
  let q = vec2f(i.uv.x * 2.6, i.uv.y * 0.55 + seed * 17.0);
  let ridge = noise2(q + vec2f(noise2(q * 0.5) * 1.5, 0.0));
  let furrow = smoothstep(0.25, 0.7, ridge);
  var albedo = S.bark * mix(0.45, 1.15, furrow) * (0.88 + 0.24 * noise2(i.uv * vec2f(9.0, 3.0)));
  // moss and lichen on the tops of the limbs and the trunk's north side
  let up = saturate(n.y * 1.4 + 0.15 * (-n.z));
  let mossy = S.moss * smoothstep(0.35, 0.75, up + 0.35 * noise2(p.xz * 1.7 + p.y)) * (0.6 + 0.4 * furrow);
  albedo = mix(albedo, vec3f(0.05, 0.085, 0.025), mossy);
  let ao = i.shade.x * mix(0.6, 1.0, furrow);
  let l = G.sunDir;
  let vis = sunShadow(p, n);
  var c = albedo * (G.sunColor * vis * saturate(dot(n, l) * 0.85 + 0.15) + ambient(n) * ao * 1.2);
  // at night: the lichen's faint light in the moss, speckled
  let speck = smoothstep(0.82, 0.95, noise2(p.xz * 7.0 + p.y * 5.0 + seed * 3.0));
  c += vec3f(0.12, 0.55, 0.42) * G.night * mossy * speck * 0.5;
  c += projectionTake(albedo) * i.proj;
  c = haze(c, p);
  if (clipBelowWater(p)) { discard; }
  return vec4f(c, 1.0);
}

// ------------------------------------------------------------------ the key light's shadow (baked, no wind)
struct SOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) layer: u32,
}

@vertex fn vsBarkShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> @builtin(position) vec4f {
  let T = treeAt(ii);
  if (notSeen(T)) { return vec4f(0.0, 0.0, -2.0, 1.0); }
  let v = barkAt(T, vi);
  return clipAt(place(T, v[0].xyz));
}

@vertex fn vsLeafShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SOut {
  var o: SOut;
  o.pos = vec4f(0.0, 0.0, -2.0, 1.0);
  let T = treeAt(ii);
  if (notSeen(T)) { return o; }
  let C = corner(T, vi, true);
  if (!C.ok) { return o; }
  o.pos = clipAt(place(T, C.lp));
  o.uv = C.uv;
  o.layer = C.layer;
  return o;
}

@fragment fn fsLeafShadow(i: SOut) {
  let tex = textureSample(leafTex, samp_linear, i.uv, i.layer);
  if (tex.r < 0.4) { discard; }
}
