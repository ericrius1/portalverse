// The boardwalk over the lagoon and the trippy ascending celestial sky-path into the dome roof.
// Drawn into the main scene (opaque + additive lantern/orb halos), the lagoon planar reflection,
// and the key-light shadow map. Shares Globals + ProjectionRig lighting with the Palace.
#include "../shaders/common"
#include "../../../packages/core/src/rooms/projection/light"

struct PathUniforms {
  player: vec4f,   // xyz: player feet, w: 1 active / 0 preview
  meta: vec4f,     // x: halo count, y..w unused
}
struct PathHalo {
  pos: vec4f,      // xyz: world pos, w: phase
  col: vec4f,      // rgb: tint, w: scale
}

@group(2) @binding(0) var<storage, read> verts: array<u32>;
@group(2) @binding(1) var<uniform> P: PathUniforms;
@group(2) @binding(2) var<storage, read> halos: array<PathHalo>;

const MAT_WOOD = 0u;
const MAT_BRASS = 1u;
const MAT_WASHI = 2u;
const MAT_FOLIAGE = 3u;
const MAT_TERRACOTTA = 4u;
const MAT_CELESTIAL = 5u;
const MAT_GLOW = 6u;
const MAT_INLAY = 7u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) col: vec3f,
  @location(4) @interpolate(flat) mat: u32,
  @location(5) extra: f32,
}

fn octDecode(e: vec2f) -> vec3f {
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = saturate(-n.z);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let b = vi * 8u;
  var o: VOut;
  o.world = vec3f(bitcast<f32>(verts[b]), bitcast<f32>(verts[b + 1u]), bitcast<f32>(verts[b + 2u]));
  o.uv = vec2f(bitcast<f32>(verts[b + 3u]), bitcast<f32>(verts[b + 4u]));
  o.n = octDecode(unpack2x16snorm(verts[b + 5u]));
  let cm = verts[b + 6u];
  o.col = vec3f(f32(cm & 255u), f32((cm >> 8u) & 255u), f32((cm >> 16u) & 255u)) / 255.0;
  o.mat = (cm >> 24u) & 255u;
  o.extra = bitcast<f32>(verts[b + 7u]);
  o.pos = clipAtFacing(o.world, o.n);
  return o;
}

@vertex fn vsShadow(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let b = vi * 8u;
  return clipAt(vec3f(bitcast<f32>(verts[b]), bitcast<f32>(verts[b + 1u]), bitcast<f32>(verts[b + 2u])));
}

/** Thin-film iridescent palette for the trippy celestial Arabic-geometric walkway tiles. */
fn irid(phase: f32) -> vec3f {
  return 0.5 + 0.5 * cos(6.28318 * (phase + vec3f(0.0, 0.30, 0.62)));
}

/** Repeating 8-fold Islamic star-and-lozenge girih pattern along the celestial walkway. */
fn girihTile(uv: vec2f) -> vec3f {
  // uv.x in [0, 1] across the 3.2 m walkway, uv.y advances along it
  let q = vec2f((uv.x - 0.5) * 3.0, uv.y * 1.45);
  let cell = fract(q) - 0.5;
  let id = floor(q);
  // 8-fold symmetry folded into one octant
  let a = abs(cell);
  let p = vec2f(max(a.x, a.y), min(a.x, a.y));
  // Interlocking square + 45°-rotated square (Rub el Hizb star)
  let dSq = max(p.x, p.y) - 0.34;
  let dRot = (p.x + p.y) * 0.7071068 - 0.34;
  let star = min(dSq, dRot);
  let edge = exp(-pow(abs(star) / 0.024, 2.0));
  let innerStar = exp(-pow(abs(max(dSq, dRot) + 0.08) / 0.022, 2.0));
  let border = smoothstep(0.41, 0.47, abs(uv.x - 0.5));
  let tileHash = hash12(id + vec2f(11.3, 5.7));
  return vec3f(saturate(max(edge, innerStar * 0.75) + border * 0.65), step(star, 0.0), tileHash);
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = i.world;
  if (clipBelowWater(p)) { discard; }
  let n = normalize(i.n);
  let v = normalize(frame.camPos - p);
  let l = G.sunDir;
  let ndl = dot(n, l);
  let vis = select(1.0, sunShadow(p, n), ndl > 0.0);
  let m = i.mat;

  var albedo = i.col;
  var rough = 0.72;
  var f0 = vec3f(0.04);
  var emit = vec3f(0.0);

  if (m == MAT_WOOD) {
    let grain = 0.90 + 0.20 * noise2(vec2f(p.x * 9.0 + p.z * 2.5, p.z * 14.0));
    albedo *= grain;
    rough = 0.68;
  } else if (m == MAT_BRASS) {
    rough = 0.28;
    f0 = albedo;
  } else if (m == MAT_WASHI) {
    // Warm amber paper lantern glowing softly even at sunset, blazing warmly at night
    let glowK = 0.35 + 0.65 * G.night;
    let flicker = 0.92 + 0.08 * sin(G.time * 3.1 + i.extra * 5.0);
    let core = 0.65 + 1.8 * pow(saturate(dot(n, v)), 1.3);
    emit = vec3f(1.0, 0.66, 0.28) * glowK * flicker * core * 1.45;
    rough = 0.85;
  } else if (m == MAT_FOLIAGE) {
    albedo *= 0.88 + 0.24 * noise2(p.xz * 7.0 + p.y * 4.0);
    rough = 0.88;
  } else if (m == MAT_TERRACOTTA) {
    albedo *= 0.92 + 0.16 * noise2(p.xz * 5.0 + p.y * 6.0);
    rough = 0.82;
  } else if (m == MAT_INLAY) {
    albedo *= 0.94 + 0.12 * noise2(p.xz * 6.0);
    rough = 0.42;
    f0 = vec3f(0.08);
  } else if (m == MAT_GLOW) {
    let pulse = 0.78 + 0.22 * sin(G.time * 2.2 + i.extra * 3.0 - p.y * 0.25);
    emit = i.col * (1.25 + 1.15 * G.night) * pulse;
    rough = 0.2;
  } else if (m == MAT_CELESTIAL) {
    // Trippy iridescent Arabic girih mosaic deck with upward-flowing energy veins & player footstep ripples!
    let g = girihTile(i.uv);
    let line = g.x;
    let inStar = g.y;
    let th = g.z;
    let ndv = saturate(dot(n, v));
    let fres = pow(1.0 - ndv, 3.0);
    let shift = irid(th * 0.4 + fres * 0.75 + G.time * 0.06 - p.y * 0.03);

    // Rich Moroccan lapis / turquoise / emerald ceramic glaze under gold filigree grout
    let zelligeBase = mix(vec3f(0.04, 0.12, 0.34), vec3f(0.06, 0.46, 0.50), inStar);
    let glaze = mix(zelligeBase, zelligeBase * 0.45 + shift * 0.55, 0.32 + 0.48 * fres);
    let goldFiligree = vec3f(0.95, 0.76, 0.30);
    albedo = mix(glaze, goldFiligree, line);
    rough = mix(0.24, 0.18, line);
    f0 = mix(vec3f(0.09, 0.14, 0.18), vec3f(0.90, 0.72, 0.32), line);

    // Flowing luminous pulse climbing up the walkway toward the dome portal
    let wave = pow(0.5 + 0.5 * sin(i.uv.y * 2.6 - G.time * 2.4), 5.0);
    let climbBoost = 0.45 + 0.85 * saturate(p.y / 24.0) + 0.45 * G.night;
    let veinCol = mix(vec3f(1.0, 0.74, 0.26), vec3f(0.22, 0.92, 0.96), 0.35 + 0.35 * sin(G.time * 0.7 + p.y * 0.18));
    emit = veinCol * line * (0.28 + 1.35 * wave) * climbBoost * i.extra;
    emit += shift * fres * 0.22 * climbBoost * i.extra;

    // Footstep ripple: luminous golden-cyan sacred-geometry bloom right around the player's feet!
    if (P.player.w > 0.5) {
      let dp = length(p - P.player.xyz);
      let footGlow = exp(-dp * dp * 0.16);
      let ring = exp(-pow((dp - fract(G.time * 0.65) * 4.5), 2.0) * 2.6) * smoothstep(5.0, 0.5, dp);
      emit += mix(vec3f(1.0, 0.82, 0.36), vec3f(0.25, 0.96, 1.0), 0.45) * (footGlow * (0.35 + 1.2 * line) + ring * 0.85 * line);
    }
  }

  // Standard lighting + projection-mapping spill + emissive
  let diff = G.sunColor * saturate(ndl) * vis + ambient(n);
  var c = albedo * diff + G.sunColor * vis * ggx(n, v, l, rough, f0);
  if (m == MAT_WOOD || m == MAT_INLAY || m == MAT_TERRACOTTA) {
    c += projectionTake(albedo) * projectedLight(p, n) * G.palace.w;
    if (G.night > 0.0) {
      c += albedo * LAMP * (0.22 * G.night);
    }
  }
  c += emit;
  return vec4f(haze(c, p), 1.0);
}

// ---------------------------------------------------------------- additive soft glow halos (washi lanterns & arch orbs)
struct HOut {
  @builtin(position) pos: vec4f,
  @location(0) q: vec2f,
  @location(1) col: vec3f,
}

@vertex fn vsHalo(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  let h = halos[ii];
  let u = f32((26u >> vi) & 1u) * 2.0 - 1.0;
  let v = f32((52u >> vi) & 1u) * 2.0 - 1.0;
  let s = 1.05 * h.col.w;
  var o: HOut;
  o.pos = clipAt(h.pos.xyz + (frame.camRight * u + frame.camUp * v) * s);
  o.q = vec2f(u, v);
  let flicker = 0.86 + 0.14 * sin(G.time * 2.7 + h.pos.w * 4.3);
  let strength = (0.32 + 0.78 * G.night) * flicker;
  o.col = h.col.rgb * strength;
  return o;
}

@fragment fn fsHalo(i: HOut) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  if (r2 > 1.0) { discard; }
  let g = exp(-r2 * 6.5) * 0.55 + exp(-r2 * 2.0) * 0.14;
  return vec4f(i.col * g * smoothstep(1.0, 0.72, r2), 0.0);
}
