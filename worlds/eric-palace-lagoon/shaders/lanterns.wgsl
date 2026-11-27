// The walk's lanterns (common.wgsl lanternPools lights the ground round them): a slim bronze post with a glass globe,
// both sides of the gravel walk, lit as the dark comes. Made in the vertex shader from the index; the posts and globes
// in one draw (opaque), the globes' halos in another (additive, the 'glow' phase).
#include "./common"

const SEG = 10u;
const RINGS = 6u;
/** the globe's verts (a lathe), then the post's (a box) */
const GLOBE_VERTS = 360u;
const POST_H = 1.15;
const GLOBE_R = 0.17;

/** lantern i's foot: both sides of the walk, at the lanternPools spacing (none by the entrance portal, none on the podium) */
fn lanternFoot(i: u32) -> vec3f {
  let side = select(-LANTERN_X, LANTERN_X, (i & 1u) == 1u);
  let slot = i / 2u;
  var k: f32;
  if (slot < 1u) { k = 42.0; } else if (slot < 4u) { k = 49.0 + 7.0 * f32(slot); } else { k = -(42.0 + 7.0 * f32(slot - 4u)); }
  let xz = vec2f(side, G.palace.y + k);
  // Skip any ground lantern submerged in the north reflecting cove or standing on the wooden approach boardwalk
  if (lagoonSdf(xz) < 1.5 || onWalk(xz) > 0.1) { return vec3f(xz.x, -50.0, xz.y); }
  return vec3f(xz.x, terrainHeight(xz), xz.y);
}

struct LOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) @interpolate(flat) glass: u32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LOut {
  let foot = lanternFoot(ii);
  var local: vec3f;
  var nl: vec3f;
  var glass = 0u;
  if (vi < GLOBE_VERTS) {
    let q = vi / 6u;
    let c = vi % 6u;
    let gx = q % SEG + ((26u >> c) & 1u);
    let gy = q / SEG + ((52u >> c) & 1u);
    let lon = f32(gx) / f32(SEG) * 6.2831853;
    let lat = (f32(gy) / f32(RINGS) - 0.5) * 3.14159265;
    let s = vec3f(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
    local = s * GLOBE_R + vec3f(0.0, POST_H + GLOBE_R * 0.8, 0.0);
    nl = s;
    glass = 1u;
  } else {
    // the post: a slim box, a little wider at its foot
    let k = vi - GLOBE_VERTS;
    let face = (k % 36u) / 6u;
    let corner = k % 6u;
    let u = f32((26u >> corner) & 1u) * 2.0 - 1.0;
    let v = f32((52u >> corner) & 1u) * 2.0 - 1.0;
    let axisN = face / 2u;
    let sgn = select(-1.0, 1.0, (face & 1u) == 1u);
    var cube: vec3f;
    if (axisN == 0u) { cube = vec3f(sgn, u, v); } else if (axisN == 1u) { cube = vec3f(u, sgn, v); } else { cube = vec3f(u, v, sgn); }
    let y01 = cube.y * 0.5 + 0.5;
    let w = mix(0.06, 0.035, y01);
    local = vec3f(cube.x * w, y01 * POST_H, cube.z * w);
    nl = vec3f(select(0.0, cube.x, axisN == 0u), select(0.0, cube.y, axisN == 1u), select(0.0, cube.z, axisN == 2u));
  }
  var o: LOut;
  o.world = foot + local;
  o.n = nl;
  o.glass = glass;
  o.pos = clipAt(o.world);
  return o;
}

@fragment fn fs(i: LOut) -> @location(0) vec4f {
  let p = i.world;
  if (clipBelowWater(p)) { discard; }
  let n = normalize(i.n);
  let v = normalize(frame.camPos - p);
  if (i.glass == 1u) {
    // frosted glass: the sky in it by day, the flame's glow through it by night
    let lit = LAMP * (0.6 + 3.4 * pow(saturate(dot(n, v)), 1.5)) * G.night * 1.4;
    let day = ambient(n) * 0.5 + G.sunColor * saturate(dot(n, G.sunDir)) * 0.2;
    return vec4f(haze(lit + day, p), 1.0);
  }
  let bronze = vec3f(0.11, 0.075, 0.045);
  var c = bronze * (G.sunColor * saturate(dot(n, G.sunDir)) * sunShadow(p, n) + ambient(n));
  c += G.sunColor * ggx(n, v, G.sunDir, 0.4, vec3f(0.5, 0.36, 0.22));
  // (the globe's light down the post)
  c += bronze * LAMP * G.night * 2.0 * smoothstep(POST_H - 0.6, POST_H, p.y - terrainHeight(p.xz));
  return vec4f(haze(c, p), 1.0);
}

// ---------------------------------------------------------------- the halos
struct HOut { @builtin(position) pos: vec4f, @location(0) q: vec2f, @location(1) k: f32 }
@vertex fn vsHalo(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> HOut {
  let at = lanternFoot(ii) + vec3f(0.0, POST_H + GLOBE_R * 0.8, 0.0);
  let u = f32((26u >> vi) & 1u) * 2.0 - 1.0;
  let v = f32((52u >> vi) & 1u) * 2.0 - 1.0;
  let s = 0.9;
  var o: HOut;
  o.pos = clipAt(at + (frame.camRight * u + frame.camUp * v) * s);
  o.q = vec2f(u, v);
  // (a slow flicker, each its own)
  o.k = G.night * (0.85 + 0.15 * noise2(vec2f(G.time * 2.3, f32(ii) * 7.1)));
  return o;
}
@fragment fn fsHalo(i: HOut) -> @location(0) vec4f {
  let r2 = dot(i.q, i.q);
  let g = exp(-r2 * 7.0) * 0.6 + exp(-r2 * 2.2) * 0.12;
  return vec4f(LAMP * g * i.k * smoothstep(1.0, 0.8, r2), 0.0);
}
