// The grove's leaf atlas, drawn once at load into a 2D array (index.ts makes its mips). Each texel: its coverage (r),
// its leaf's own shade (g), and the leaf's tilt (b, a: the normal's two sideways parts, 0.5 flat). After Earth's
// (github.com/ericrius1/world: web/src/trees/leaves.wgsl), itself after Daniel Greenheck's Tidewater (MIT:
// src/world/vegetation/LeafTextures.js): clusters of twigs' whorls of leaves, supersampled.
// Layers (species.ts LAYER): 0 broad lobed, 1 small dense, 2 glossy ovals, 3 narrow blades, 4 scale sprays, 5 a
// willow's strand (along v), 6 a cluster of small flowers, 7 pine needles in tufts, 8 a fern's frond (along v).
@group(2) @binding(0) var leafOut: texture_storage_2d_array<rgba8unorm, write>;

fn h2(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/** one leaf in its own frame: u along it from its stalk (0) to its tip (1), v across (in leaf lengths), w its width.
 *  Returns whether it's inside, its shade, how far across it the point is (-1..1, for its curl) */
fn leafShape(u: f32, v: f32, kind: u32, w: f32) -> vec3f {
  if (u <= 0.0 || u >= 1.0) { return vec3f(0.0); }
  if (kind == 0u) {
    // lobed: five lobes round a point past the stalk
    let d = vec2f(u - 0.45, v);
    let rho = length(d) / w;
    let phi = atan2(d.y, d.x);
    let lobes = 0.6 + 0.4 * pow(abs(cos(phi * 2.5)), 0.7);
    let notch = 1.0 - 0.45 * smoothstep(2.3, 3.1, abs(phi));
    let vein = 1.0 - 0.12 * smoothstep(0.05, 0.0, abs(sin(phi * 2.5)) * rho);
    return vec3f(select(0.0, 1.0, rho < lobes * notch), (0.8 + 0.25 * rho) * vein, clamp(v / w, -1.0, 1.0));
  }
  if (kind == 4u) {
    // a spray of scale leaves: branchlets off a stem swept to its tip
    let av = abs(v);
    let stem = av < 0.03 * (1.0 - 0.6 * u);
    let k = fract(u * 6.0 - av * 1.6);
    let bumps = 0.8 + 0.2 * sin(u * 90.0 + av * 60.0);
    let twig = k < 0.45 && av < w * (1.0 - u * 0.7) * bumps;
    return vec3f(select(0.0, 1.0, stem || twig), 0.75 + 0.3 * u - 0.25 * av / w, clamp(v / w, -1.0, 1.0));
  }
  if (kind == 7u) {
    // a pine needle
    let inside = abs(v - u * u * 0.04) < w * (1.0 - u * 0.5);
    return vec3f(select(0.0, 1.0, inside), 0.7 + 0.35 * u, 0.0);
  }
  let s = select(u, pow(u, 0.75), kind == 3u);
  let half = max(w * pow(sin(s * 3.14159), 0.8) * (1.0 - 0.25 * u * u * u), 1e-3);
  var shade = (0.84 + 0.22 * u) * (1.0 - 0.1 * smoothstep(0.15, 0.0, abs(v) / half));
  if (kind == 2u) { shade += 0.28 * exp(-pow(v / half - 0.35, 2.0) * 18.0) * u; }
  return vec3f(select(0.0, 1.0, abs(v) < half && u > 0.02), shade, clamp(v / half, -1.0, 1.0));
}

struct Leafy { cover: f32, shade: f32, tilt: vec2f }

/** a cluster of twigs' whorls of leaves on a jittered grid (two layers offset by half a cell): whorls outside the
 *  cluster's ragged round outline left out, and a few inside (its holes), the outer ones smaller */
fn whorls(p: vec2f, kind: u32) -> Leafy {
  var G = 6.0;
  var n = 6.0;
  var L = 0.62;
  var W = 0.24;
  switch (kind) {
    case 0u: { G = 5.0; n = 5.0; L = 0.6; W = 0.4; }
    case 1u: { G = 8.0; n = 7.0; L = 0.62; W = 0.2; }
    case 3u: { G = 6.0; n = 6.0; L = 0.78; W = 0.09; }
    case 4u: { G = 5.0; n = 5.0; L = 0.85; W = 0.22; }
    case 7u: { G = 5.0; n = 30.0; L = 0.85; W = 0.035; }
    default: {}
  }
  var hit = Leafy(0.0, 0.5, vec2f(0.0));
  for (var lay = 0u; lay < 2u; lay++) {
    let off = select(0.0, 0.5, lay == 1u);
    let g = p * G - off;
    let first = floor(g - 0.5);
    for (var j = 0u; j < 4u; j++) {
      let cell = first + vec2f(f32(j % 2u), f32(j / 2u));
      let hs = cell + f32(lay) * 37.0 + f32(kind) * 11.0;
      let h1 = h2(hs);
      let h3 = h2(hs * 1.7 + 5.2);
      let h4 = h2(hs * 2.3 + 1.9);
      let tip = cell + 0.5 + (vec2f(h1, h3) - 0.5) * 0.5;
      let rc = length((tip + off) / G - 0.5);
      if (rc > 0.4 + 0.08 * (h4 - 0.5) || h4 < 0.1) { continue; }
      let sc = (0.8 + 0.4 * h3) * (1.0 - 0.35 * smoothstep(0.2, 0.42, rc));
      let d = (g - tip) / sc;
      if (length(d) > L * 1.15) { continue; }
      let a0 = h1 * 6.283;
      let nw = n + floor(h3 * 3.0) - 1.0;
      for (var k = 0.0; k < nw; k += 1.0) {
        let lr = h2(vec2f(k, h1 * 13.7 + f32(lay)));
        let dir = a0 + (k + (lr - 0.5) * 0.8) * 6.283 / nw;
        let axis = vec2f(cos(dir), sin(dir));
        let ll = L * (0.7 + 0.3 * fract(lr * 7.13));
        let u = dot(d, axis) / ll + 0.12;
        let v = dot(d, vec2f(-axis.y, axis.x)) / ll - (fract(lr * 3.31) - 0.5) * 0.5 * u * u;
        let s = leafShape(u, v, kind, W);
        if (s.x > 0.5) {
          hit = Leafy(1.0, s.y * (0.72 + 0.32 * lr) * (0.9 + 0.2 * h4) * 0.6 + 0.2, axis * (u - 0.45) * 0.6 + vec2f(-axis.y, axis.x) * s.z * 0.35);
        }
      }
    }
  }
  return hit;
}

/** a willow's strand (u across, v down it from where it hangs): a thin whip down the middle wandering a little, narrow
 *  leaves off it both sides, angled down toward its tip, alternating, each its own length */
fn strand(p: vec2f) -> Leafy {
  let v = p.y;
  let x = p.x - 0.5 - 0.04 * sin(v * 9.0 + 1.3);
  let ax = abs(x);
  var hit = Leafy(0.0, 0.5, vec2f(0.0));
  if (ax < 0.022) { hit = Leafy(1.0, 0.35, vec2f(0.0)); }
  // (leaves at a spacing of 1/26 of the strand down each side, offset by half on the other)
  let side = select(-1.0, 1.0, x > 0.0);
  let k = v * 26.0 + select(0.0, 0.5, x > 0.0);
  for (var j = -1; j <= 1; j++) {
    let cell = floor(k) + f32(j);
    let hh = h2(vec2f(cell, side * 3.1));
    if (hh < 0.12) { continue; }
    let v0 = (cell - select(0.0, 0.5, x > 0.0)) / 26.0;
    // the leaf from the whip at v0 out and down: its axis
    let ang = 0.42 + 0.25 * hh;
    let axis = vec2f(sin(ang) * side, cos(ang));
    let d = vec2f(x, v - v0);
    let len = 0.11 + 0.08 * h2(vec2f(cell, 7.7 + side));
    let u = dot(d, axis) / len;
    let w = dot(d, vec2f(-axis.y, axis.x)) / len;
    let s = leafShape(u, w, 3u, 0.17);
    if (s.x > 0.5) { hit = Leafy(1.0, s.y * (0.75 + 0.3 * hh), axis * (u - 0.4) * 0.5 + vec2f(-axis.y, axis.x) * s.z * 0.4); }
  }
  return hit;
}

/** a cluster of small open flowers: five-petalled, paler at the rims, a darker heart; a few leaf-green buds between */
fn blossom(p: vec2f) -> Leafy {
  var hit = Leafy(0.0, 0.5, vec2f(0.0));
  let q = p - 0.5;
  // (a round ragged cluster)
  let edge = 0.44 + 0.05 * sin(atan2(q.y, q.x) * 5.0 + 1.0);
  if (length(q) > edge) { return hit; }
  let G = 7.0;
  for (var lay = 0u; lay < 2u; lay++) {
    let off = select(0.0, 0.5, lay == 1u);
    let g = p * G - off;
    let first = floor(g - 0.5);
    for (var j = 0u; j < 4u; j++) {
      let cell = first + vec2f(f32(j % 2u), f32(j / 2u));
      let hs = cell + f32(lay) * 19.0;
      let h1 = h2(hs);
      let h3 = h2(hs * 1.9 + 3.3);
      if (h3 < 0.15) { continue; }
      let c = cell + 0.5 + (vec2f(h1, h3) - 0.5) * 0.6;
      let R = 0.42 + 0.2 * h1;
      let d = (g - c) / R;
      let r = length(d);
      let th = atan2(d.y, d.x) + h1 * 6.283;
      let petal = 0.68 + 0.32 * abs(cos(th * 2.5));
      if (r < petal) {
        let heart = r < 0.2;
        hit = Leafy(1.0, select(0.45 + 0.55 * r / petal, 0.18, heart), d * 0.35);
      }
    }
  }
  return hit;
}

/** a fern's frond (along v, its foot at 0): the rachis, pinnae off it both ways swept toward the tip, each cut into
 *  pinnules; the frond widest a third of the way up, to a point at its tip */
fn frond(p: vec2f) -> Leafy {
  let x = p.x - 0.5;
  let ax = abs(x);
  let v = p.y;
  let outline = select(0.5 + 0.5 * v / 0.33, 1.0 - (v - 0.33) / 0.67, v > 0.33);
  let half = 0.48 * pow(saturate(outline), 0.7);
  let along = ax / max(half, 1e-3);
  let k = fract(v * 17.0 - ax * 1.8 + select(0.0, 0.5, x < 0.0));
  let pinnule = 0.65 + 0.35 * abs(sin(ax * 95.0));
  let w = 0.4 * (1.0 - along * 0.85) * pinnule;
  let pinna = abs(k - 0.5) < w && along < 1.0;
  let rib = ax < 0.02 && v < 0.98;
  return Leafy(select(0.0, 1.0, pinna || rib), 0.35 + 0.5 * (1.0 - along) * (0.7 + 0.3 * pinnule), vec2f(x * 0.9, (k - 0.5) * 0.5));
}

fn sampleLayer(q: vec2f, layer: u32) -> Leafy {
  switch (layer) {
    case 5u: { return strand(q); }
    case 6u: { return blossom(q); }
    case 8u: { return frond(q); }
    default: { return whorls(q, layer); }
  }
}

@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) id: vec3u) {
  let N = textureDimensions(leafOut).x;
  if (id.x >= N || id.y >= N) { return; }
  let layer = id.z;
  let p = (vec2f(id.xy) + 0.5) / f32(N);
  // four samples a texel: the leaves' edges smooth in the mips
  var cov = 0.0;
  var shade = 0.0;
  var tilt = vec2f(0.0);
  var hits = 0.0;
  for (var s = 0u; s < 4u; s++) {
    let q = p + (vec2f(f32(s % 2u), f32(s / 2u)) - 0.5) * 0.5 / f32(N);
    let w = sampleLayer(q, layer);
    if (w.cover > 0.0) {
      cov += 0.25;
      shade += w.shade;
      tilt += w.tilt;
      hits += 1.0;
    }
  }
  let k = 1.0 / max(hits, 1.0);
  textureStore(leafOut, id.xy, layer, vec4f(cov, select(0.5, shade * k, hits > 0.0), clamp(tilt * k * 0.5 + 0.5, vec2f(0.0), vec2f(1.0))));
}
