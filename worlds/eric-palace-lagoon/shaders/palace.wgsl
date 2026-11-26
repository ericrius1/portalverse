// The Palace of Fine Arts, from Earth (github.com/ericrius1/world: web/src/palace/palace.wgsl, pipeline/palace_model.py):
// Maybeck's rotunda and peristyle on the lagoon, in the cream and ochre of its stone and the salmon of the rotunda's
// columns, the plain hall behind. The materials are Earth's: the columns fluted from their uv, the inner dome coffered,
// the paving jointed, the stone weathered. The light is this room's, from sunset to night along the walk: the key light
// (the low sun, then the moon) with its shadow, the sky's light by how much of the sky each place sees (baked into the
// mesh), the lagoon's light thrown up on the stone; and as the dark comes, Earth's floodlights (warm, from the ground,
// up the columns and into the rotunda: each place's share is baked into the mesh too) and the drones' projectors
// (packages/core/src/rooms/projection: their light, mapped to the stone or thrown, with every column's shadow).
//
// The mesh comes from Earth's R2 and is packed smaller by ../palaceMesh.worker.ts: 7 words a vertex, already in the
// room's frame (position xyz, uv, the normal octahedron-packed in two snorm16s, tag = material | flood << 8 |
// occlusion << 16 | sky seen << 24).
#include "./common"
#include "../../../packages/core/src/rooms/projection/light"

@group(2) @binding(0) var<storage, read> pv: array<u32>;

const STONE = 0u; const TRIM = 1u; const SALMON = 2u; const CAPITAL = 3u; const DOME = 4u; const RELIEF = 5u;
const FIGURE = 6u; const COFFER = 7u; const PAVING = 8u; const SHAFT = 9u; const PLANT = 10u; const URN = 11u;
const PODIUM = 12u; const SOIL = 13u; const SOFFIT = 14u; const HALL = 15u;


struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) uv: vec2f,
  @location(3) @interpolate(flat) mat: u32,
  @location(4) ls: vec3f,
}

fn octDecode(e: vec2f) -> vec3f {
  var n = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let t = saturate(-n.z);
  n.x += select(t, -t, n.x >= 0.0);
  n.y += select(t, -t, n.y >= 0.0);
  return normalize(n);
}

fn vertexAt(vi: u32) -> VOut {
  let b = vi * 7u;
  var o: VOut;
  o.world = vec3f(bitcast<f32>(pv[b]), bitcast<f32>(pv[b + 1u]), bitcast<f32>(pv[b + 2u]));
  o.uv = vec2f(bitcast<f32>(pv[b + 3u]), bitcast<f32>(pv[b + 4u]));
  o.n = octDecode(unpack2x16snorm(pv[b + 5u]));
  let tag = pv[b + 6u];
  o.mat = tag & 255u;
  o.ls = vec3f(f32((tag >> 8u) & 255u), f32((tag >> 16u) & 255u), f32(tag >> 24u)) / 255.0;
  o.pos = clipAt(o.world);
  return o;
}

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VOut { return vertexAt(vi); }

/** depth only, from the sun (the shadow's bake) */
@vertex fn vsShadow(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let b = vi * 7u;
  return clipAt(vec3f(bitcast<f32>(pv[b]), bitcast<f32>(pv[b + 1u]), bitcast<f32>(pv[b + 2u])));
}

// ------------------------------------------------------------------ the stone (Earth's colours, linear)
const CREAM = vec3f(0.74, 0.58, 0.40);
const TRIMC = vec3f(0.80, 0.66, 0.47);
const SALMONC = vec3f(0.60, 0.20, 0.13);
const OCHRE = vec3f(0.70, 0.52, 0.32);
const DOMEC = vec3f(0.76, 0.62, 0.38);

/** the stone's own variation: patches, darker toward the foot and streaked under the ledges */
fn weather(p: vec3f, n: vec3f, base: vec3f, pix: f32) -> vec3f {
  let h = p.y;
  var c = base * (0.9 + 0.2 * fbm2(vec2f(p.x + p.z * 0.7, p.y) * 0.18, 3));
  c *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 3.0, h));
  if (abs(n.y) < 0.6 && pix < 0.15) {
    let along = dot(p.xz, vec2f(-n.z, n.x));
    let streak = smoothstep(0.55, 0.95, noise2(vec2f(along * 2.3, floor(h / 4.0) * 7.1))) * (0.5 + 0.5 * noise2(vec2f(along * 0.5, h * 0.3)));
    c *= 1.0 - 0.1 * streak * (1.0 - smoothstep(0.08, 0.15, pix));
  }
  return c;
}

/** the lagoon's light thrown up on the stone near the water, rippling */
fn lagoonLight(p: vec3f, n: vec3f) -> f32 {
  let above = p.y - G.waterY;
  if (above < 0.0 || above > 9.0) { return 0.0; }
  let shore = lagoonSdf(p.xz);
  let near = 1.0 - smoothstep(0.0, 10.0, shore);
  let facing = saturate(0.35 - n.y * 0.5 + 0.3);
  let t = G.time;
  let q = p.xz * 0.9 + vec2f(p.y * 0.4, 0.0);
  let c = pow(abs(sin(q.x * 1.7 + t * 1.1 + 1.7 * sin(q.y * 1.3 + t * 0.7)) * sin(q.y * 1.9 - t * 0.9 + 1.3 * sin(q.x * 1.1 - t * 0.5))), 3.0);
  return c * near * facing * (1.0 - above / 9.0);
}

struct Surf { albedo: vec3f, n: vec3f, rough: f32, ao: f32 }

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = i.world;
  if (clipBelowWater(p) || hash12(floor(i.pos.xy)) > G.reveal) { discard; }
  // Open the inner dome vault above the cornice so the full-dome Arabic mosaic portal lives inside the rotunda roof
  // (the outer golden dome shell, mat == DOME, stays completely intact from outside).
  if (i.mat == COFFER && p.y > 25.6) { discard; }
  let v = normalize(frame.camPos - p);
  let dist = length(frame.camPos - p);
  let duv = fwidth(i.uv);
  let pix = dist * 1.2 / max(frame.res.y, 1.0);
  var s: Surf;
  // (the mesh is drawn two-sided and some of its faces point away from where they're seen, the dome's underside
  // through the inner dome's crown among them: light the side that's seen)
  s.n = normalize(i.n) * select(1.0, -1.0, dot(i.n, v) < 0.0);
  s.rough = 0.85;
  s.ao = 1.0;
  let m = i.mat;
  if (m == SALMON || m == SHAFT) {
    // the flutes: 24 round the shaft, concave channels between fillets, faded out where they'd shimmer
    let nf = 24.0;
    let ph = fract(i.uv.x * nf) - 0.5;
    let fade = 1.0 - smoothstep(0.25, 0.6, duv.x * nf);
    let up = vec3f(0.0, 1.0, 0.0);
    let T = normalize(cross(up, s.n) + vec3f(1e-5, 0.0, 0.0));
    let ch = saturate(abs(ph) / 0.42);
    let tilt = select(ph / 0.42 * 0.75, 0.0, ch >= 1.0) * fade;
    s.n = normalize(s.n - T * tilt);
    s.ao = 1.0 - 0.18 * (1.0 - ch * ch) * fade;
    s.albedo = select(OCHRE, SALMONC, m == SALMON);
    s.albedo *= 0.92 + 0.16 * noise2(vec2f(i.uv.x * 6.0, p.y * 0.25));
  } else if (m == CAPITAL || m == TRIM || m == URN) {
    s.albedo = TRIMC;
  } else if (m == DOME) {
    s.albedo = DOMEC * (0.94 + 0.12 * noise2(p.xz * 0.15));
    s.rough = 0.7;
  } else if (m == RELIEF || m == FIGURE) {
    s.albedo = vec3f(0.72, 0.6, 0.45);
  } else if (m == COFFER) {
    // the coffers: 32 round, nine rows up, each a sunk square with a rosette
    let az = i.uv.x * 32.0;
    let el = saturate((p.y - 25.4) / 18.0);
    let row = el * 9.0;
    let cu = abs(fract(az) - 0.5);
    let cv = abs(fract(row) - 0.5);
    let well = smoothstep(0.32, 0.26, max(cu, cv)) * step(row, 8.5);
    let rose = smoothstep(0.12, 0.06, length(vec2f(cu, cv)));
    s.albedo = mix(TRIMC, CREAM * 0.8, well) + vec3f(0.12, 0.09, 0.04) * rose * well;
    s.ao = 1.0 - 0.45 * well * (1.0 - rose);
  } else if (m == PAVING) {
    let q = abs(fract(i.uv / 1.2) - 0.5);
    let j = smoothstep(0.47, 0.49, max(q.x, q.y)) * (1.0 - smoothstep(0.02, 0.06, pix));
    let slab = hash12(floor(i.uv / 1.2));
    s.albedo = vec3f(0.5, 0.44, 0.36) * (0.9 + 0.2 * slab) * (1.0 - 0.35 * j);
  } else if (m == PODIUM) {
    s.albedo = vec3f(0.56, 0.48, 0.38);
  } else if (m == PLANT) {
    // the planter boxes' greenery, a little fuller than Earth's: this room leans solarpunk
    let g = noise2(p.xz * 1.7 + p.y);
    s.albedo = mix(vec3f(0.05, 0.11, 0.03), vec3f(0.14, 0.2, 0.05), g);
    s.rough = 0.9;
  } else if (m == SOIL) {
    s.albedo = vec3f(0.07, 0.05, 0.035);
  } else if (m == SOFFIT) {
    s.albedo = CREAM * 0.92;
  } else if (m == HALL) {
    s.albedo = vec3f(0.56, 0.45, 0.32);
  } else {
    s.albedo = CREAM;
  }
  if (m != PLANT && m != SOIL && m != SALMON) { s.albedo = weather(p, s.n, s.albedo, pix); }

  // ---- the light
  let n = s.n;
  let l = G.sunDir;
  let ndl = dot(n, l);
  var vis = 1.0;
  if (ndl > 0.0) { vis = sunShadow(p, normalize(i.n)); }
  let occl = i.ls.y * s.ao;
  let sky = i.ls.z;
  let amb = ambient(n) * occl * mix(0.25, 1.0, sky);
  var c = s.albedo * (G.sunColor * saturate(ndl) * vis + amb);
  c += G.sunColor * vis * ggx(n, v, l, s.rough, vec3f(0.035)) * occl;
  // the lagoon's light on the stone (the sun's by day, the lamps' and the drones' by night), and a warm glow inside
  // the rotunda where the sun can't reach
  let inside = 1.0 - smoothstep(16.0, 23.0, length(p.xz - G.palace.xy));
  c += s.albedo * (G.sunColor + LAMP * G.night * 0.15) * lagoonLight(p, n) * 0.35 * occl;
  c += s.albedo * vec3f(1.0, 0.72, 0.45) * inside * 0.12 * (1.0 - G.night) * select(0.5, 1.0, m == COFFER);
  // the night: Earth's floodlights from the ground, warm, strongest low on the columns and under the dome
  if (G.night > 0.0) {
    let flood = i.ls.x;
    // (low: a warm wash at the stone's foot that leaves the night dark above, for the drones' light to draw on)
    let foot = 1.0 - smoothstep(2.0, 14.0, p.y);
    let k = flood * (0.45 + 0.55 * saturate(n.y * -0.5 + 0.6)) * (0.35 + 0.65 * foot) + inside * 0.08 * select(0.3, 1.0, m == COFFER);
    c += s.albedo * LAMP * (G.night * k * 0.16 * occl);
  }
  // the drones' projectors
  // (the show comes up as the dark does: G.palace.w)
  if (G.palace.w > 0.0) { c += projectionTake(s.albedo) * projectedLight(p, n) * (mix(0.55, 1.0, occl) * G.palace.w); }
  c = haze(c, p);
  return vec4f(c, 1.0);
}
