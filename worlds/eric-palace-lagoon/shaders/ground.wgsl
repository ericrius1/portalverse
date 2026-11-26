// The land: one grid made in the vertex shader from its index (nothing on the CPU, nothing uploaded), dense round the
// path and the lagoon and coarser out toward the horizon, raised by terrainHeight. Meadow green under the grass, a
// gravel path, the lagoon's muddy banks and bed, lawn round the Palace. And the sky, drawn last where nothing is.
#include "./common"

override GRID: u32 = 384u;
const CENTRE = vec2f(-50.0, 0.0);
const REACH = 1100.0;

/** the grid's warp: fine (under a metre) near the middle, about 10 m at the edge */
fn warp(t: f32) -> f32 { return REACH * (0.13 * t + 0.87 * t * t * t); }

struct GOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
}

@vertex fn vsGround(@builtin(vertex_index) vi: u32) -> GOut {
  let quad = vi / 6u;
  let corner = vi % 6u;
  let cells = GRID - 1u;
  let qx = quad % cells;
  let qz = quad / cells;
  // two triangles per cell: (0,0) (1,0) (0,1) / (1,0) (1,1) (0,1), as bit masks (no lookup table)
  let gx = qx + ((26u >> corner) & 1u);
  let gz = qz + ((52u >> corner) & 1u);
  let t = vec2f(f32(gx), f32(gz)) / f32(cells) * 2.0 - 1.0;
  let xz = CENTRE + vec2f(warp(t.x), warp(t.y));
  let p = vec3f(xz.x, terrainHeight(xz), xz.y);
  var o: GOut;
  o.world = p;
  o.pos = clipAt(p);
  return o;
}

fn groundNormal(xz: vec2f) -> vec3f {
  let e = 0.35;
  let hx = terrainHeight(xz + vec2f(e, 0.0)) - terrainHeight(xz - vec2f(e, 0.0));
  let hz = terrainHeight(xz + vec2f(0.0, e)) - terrainHeight(xz - vec2f(0.0, e));
  return normalize(vec3f(-hx, 2.0 * e, -hz));
}

/** the meadow's colour on the ground (the grass draws over it near the eye, so it reads as the field far off) */
fn meadowAlbedo(xz: vec2f) -> vec3f {
  let meadowPatch = fbm2(xz * 0.035, 4);
  let fine = noise2(xz * 0.6);
  var c = mix(vec3f(0.10, 0.17, 0.035), vec3f(0.20, 0.25, 0.06), meadowPatch);
  c = mix(c, vec3f(0.30, 0.25, 0.08), smoothstep(0.62, 0.8, meadowPatch) * 0.6);
  return c * (0.85 + 0.3 * fine);
}

@fragment fn fsGround(i: GOut) -> @location(0) vec4f {
  let p = i.world;
  if (clipBelowWater(p)) { discard; }
  let xz = p.xz;
  let n = groundNormal(xz);
  let shore = lagoonSdf(xz);
  var albedo = meadowAlbedo(xz);
  var rough = 0.95;
  // the gravel path, its edges ragged
  let pathEdge = 1.5 + 0.25 * noise2(vec2f(xz.y * 0.8, 3.0));
  let onPath = 1.0 - smoothstep(pathEdge - 0.25, pathEdge, abs(xz.x));
  let gravel = vec3f(0.42, 0.37, 0.3) * (0.8 + 0.35 * noise2(xz * 9.0)) * (0.9 + 0.2 * noise2(xz * 1.3));
  albedo = mix(albedo, gravel, onPath);
  // the banks: damp earth, then mud under the water
  let wet = 1.0 - smoothstep(0.0, 2.5, shore);
  albedo = mix(albedo, vec3f(0.12, 0.1, 0.07), wet);
  if (p.y < G.waterY) { albedo = vec3f(0.08, 0.075, 0.05) * (0.8 + 0.4 * noise2(xz * 0.7)); }
  // round the Palace: mown lawn, a little paler
  albedo = mix(albedo, vec3f(0.17, 0.23, 0.07) * (0.9 + 0.2 * noise2(xz * 0.4)), smoothstep(-70.0, -85.0, xz.x) * (1.0 - wet));
  let vis = select(1.0, sunShadow(p, n), dot(n, G.sunDir) > 0.0);
  let c = albedo * (G.sunColor * saturate(dot(n, G.sunDir)) * vis + ambient(n));
  return vec4f(haze(c, p), 1.0);
}

// ---------------------------------------------------------------- the sky
struct SOut { @builtin(position) pos: vec4f }
@vertex fn vsSky(@builtin(vertex_index) vi: u32) -> SOut {
  let uv = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  var o: SOut;
  o.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return o;
}
@fragment fn fsSky(i: SOut) -> @location(0) vec4f {
  let dir = viewRay(viewUV(i.pos));
  return vec4f(skyColor(dir) + sunDisc(dir), 1.0);
}
