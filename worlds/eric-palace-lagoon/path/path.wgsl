// The colonnade-to-lagoon boardwalk and the handcrafted Spanish-cedar & Granada azulejo spiral stairway.
// Drawn into the main scene (opaque + additive lantern halos), the lagoon planar reflection,
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
const MAT_AZULEJO = 5u;
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

/**
 * Clean, warm Granada Spanish azulejo ceramic inlay runner (softly anti-aliased, zero harsh black-and-white noise):
 * 8-point Nasrid star & cross tiles in warm ivory, cobalt, turquoise, terracotta, and honey gold.
 */
fn azulejoPattern(uv: vec2f) -> vec4f {
  let q = vec2f((uv.x - 0.5) * 1.15, uv.y * 1.15);
  let cell = fract(q) - 0.5;
  let id = floor(q);
  let a = abs(cell);
  let p = vec2f(max(a.x, a.y), min(a.x, a.y));
  // 8-point Alhambra star
  let dSq = max(p.x, p.y) - 0.30;
  let dRot = (p.x + p.y) * 0.7071068 - 0.30;
  let star = min(dSq, dRot);
  // Softly filtered edges (no harsh aliasing at grazing angles)
  let inStar = 1.0 - smoothstep(-0.025, 0.025, star);
  let innerOct = 1.0 - smoothstep(-0.025, 0.025, max(dSq, dRot) + 0.11);
  let grout = smoothstep(0.055, 0.008, abs(star));
  let border = smoothstep(0.38, 0.46, abs(uv.x - 0.5));
  let tileHash = hash12(id + vec2f(11.3, 5.7));
  return vec4f(inStar, innerOct, saturate(grout + border * 0.7), tileHash);
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
    // Rich warm timber grain (flows gently along planks without noisy high-frequency contrast)
    let grainA = noise2(vec2f(i.uv.x * 16.0 + p.y * 0.7, i.uv.y * 4.5 + p.x * 1.1));
    let grainB = noise2(vec2f(p.x * 5.0 + p.z * 2.0, p.z * 7.0 + p.y * 3.0));
    let grain = 0.88 + 0.18 * grainA + 0.08 * grainB;
    albedo *= grain;
    rough = 0.58;
    f0 = vec3f(0.045);
  } else if (m == MAT_BRASS) {
    rough = 0.28;
    f0 = albedo;
  } else if (m == MAT_WASHI) {
    let glowK = 0.40 + 0.60 * G.night;
    let flicker = 0.92 + 0.08 * sin(G.time * 3.1 + i.extra * 5.0);
    let core = 0.65 + 1.8 * pow(saturate(dot(n, v)), 1.3);
    emit = vec3f(1.0, 0.66, 0.28) * glowK * flicker * core * 1.45;
    rough = 0.85;
  } else if (m == MAT_FOLIAGE) {
    albedo *= 0.88 + 0.24 * noise2(p.xz * 7.0 + p.y * 4.0);
    rough = 0.88;
  } else if (m == MAT_TERRACOTTA) {
    albedo *= 0.92 + 0.16 * noise2(p.xz * 5.0 + p.y * 6.0);
    rough = 0.80;
  } else if (m == MAT_INLAY) {
    albedo *= 0.94 + 0.12 * noise2(p.xz * 6.0);
    rough = 0.36;
    f0 = vec3f(0.07);
  } else if (m == MAT_GLOW) {
    let pulse = 0.78 + 0.22 * sin(G.time * 2.2 + i.extra * 3.0 - p.y * 0.25);
    emit = i.col * (1.25 + 1.15 * G.night) * pulse;
    rough = 0.2;
  } else if (m == MAT_AZULEJO) {
    // Kiln-fired Granada Spanish azulejo ceramic runner inlaid down the center of the wooden spiral
    let az = azulejoPattern(i.uv);
    let inStar = az.x;
    let innerOct = az.y;
    let grout = az.z;
    let th = az.w;

    let ivory = vec3f(0.84, 0.77, 0.64);
    let cobalt = vec3f(0.08, 0.20, 0.52);
    let turquoise = vec3f(0.09, 0.52, 0.56);
    let terracotta = vec3f(0.64, 0.27, 0.14);
    let honeyGold = vec3f(0.88, 0.64, 0.22);

    let starFill = mix(cobalt, turquoise, smoothstep(0.35, 0.75, th));
    var tile = mix(ivory, starFill, inStar);
    tile = mix(tile, mix(terracotta, honeyGold, 0.4), innerOct * 0.85);
    albedo = mix(tile, honeyGold, grout * 0.75);
    rough = mix(0.22, 0.40, grout);
    f0 = mix(vec3f(0.08), vec3f(0.65, 0.50, 0.20), grout);

    // Subtle warm lantern shimmer climbing toward the portal gateway (stronger near the summit)
    let nearPortal = smoothstep(16.0, 26.2, p.y);
    let wave = pow(0.5 + 0.5 * sin(i.uv.y * 2.2 - G.time * 2.2), 4.0);
    let guideCol = mix(vec3f(1.0, 0.74, 0.30), vec3f(0.24, 0.90, 0.95), nearPortal * 0.75);
    emit = guideCol * grout * (0.14 + 0.55 * wave) * (0.35 + 0.85 * nearPortal + 0.35 * G.night);

    // Soft warm golden-cyan footstep shimmer around the player's feet
    if (P.player.w > 0.5) {
      let dp = length(p - P.player.xyz);
      let footGlow = exp(-dp * dp * 0.20);
      emit += mix(vec3f(1.0, 0.78, 0.34), vec3f(0.28, 0.92, 0.96), nearPortal * 0.6) * footGlow * (0.18 + 0.55 * grout);
    }
  }

  // Standard lighting + projection-mapping spill + warm night wood illumination
  let diff = G.sunColor * saturate(ndl) * vis + ambient(n);
  var c = albedo * diff + G.sunColor * vis * ggx(n, v, l, rough, f0);
  if (m == MAT_WOOD || m == MAT_INLAY || m == MAT_TERRACOTTA || m == MAT_AZULEJO) {
    c += projectionTake(albedo) * projectedLight(p, n) * G.palace.w;
    if (G.night > 0.0) {
      c += albedo * LAMP * (0.28 * G.night);
    }
  }
  c += emit;
  return vec4f(haze(c, p), 1.0);
}

// ---------------------------------------------------------------- additive soft glow halos (washi & Moorish lanterns)
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
  let strength = (0.34 + 0.78 * G.night) * flicker;
  o.col = h.col.rgb * strength;
  return o;
}

@fragment fn fsHalo(i: HOut) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  if (r2 > 1.0) { discard; }
  let g = exp(-r2 * 6.5) * 0.55 + exp(-r2 * 2.0) * 0.14;
  return vec4f(i.col * g * smoothstep(1.0, 0.72, r2), 0.0);
}
