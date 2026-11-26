// The meadow's grass and wildflowers, made in the vertex shader: one blade a cell of a grid that follows the eye in
// whole cells, so each blade belongs to its place in the world (hashed from its cell) and nothing swims as you move.
// Two rings: fine blades close, sparser and wider ones further out, shrinking away to the plain meadow at the edge.
// Each blade is a strip of seven vertices bent by the wind; a few are poppies and lupines. Nothing on the CPU.
#include "./common"

override CELL: f32 = 0.16;
override SIDE: u32 = 256u;
/** the inner ring's half width, left out of the outer one (0: none) */
override HOLE: f32 = 0.0;
override WIDTH: f32 = 0.032;
override HEIGHT: f32 = 0.55;
/** the outer ring shrinks away to the plain meadow at its edge; the inner one runs to the outer's hole */
override FADES: bool = true;

struct BOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) col: vec3f,
  @location(3) t: f32,
}

fn collapsed() -> BOut {
  var o: BOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  return o;
}

/** the wind: gusts rolling over the meadow from the west, and a little flutter */
fn windAt(xz: vec2f, t: f32) -> vec2f {
  let gust = fbm2(xz * 0.045 - vec2f(t * 0.32, t * 0.06), 3);
  let flutter = noise2(xz * 0.9 + vec2f(t * 1.7, 0.0)) - 0.5;
  return vec2f(0.35, 0.12) * (0.25 + 1.5 * gust) + vec2f(flutter, -flutter * 0.6) * 0.18;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BOut {
  let eye = frame.camPos.xz;
  let base = floor(eye / CELL) - f32(SIDE / 2u);
  let cell = base + vec2f(f32(ii % SIDE), f32(ii / SIDE));
  let jitter = hash22(cell * 1.31 + 7.0);
  let xz = (cell + jitter) * CELL;
  let rel = xz - eye;
  if (HOLE > 0.0 && max(abs(rel.x), abs(rel.y)) < HOLE) { return collapsed(); }
  let reach = f32(SIDE) * CELL * 0.5;
  let fade = select(1.0, 1.0 - smoothstep(reach * 0.6, reach * 0.98, length(rel)), FADES);
  if (fade <= 0.0) { return collapsed(); }
  // where grass grows: not on the walk, the podium or the colonnade's paving, not in the water or on its muddy edge
  if (onWalk(xz) > 0.05 || podiumDist(xz) < 0.3 || wingDist(xz) < 5.0) { return collapsed(); }
  let shore = lagoonSdf(xz);
  if (shore < 1.6 + jitter.x * 1.5) { return collapsed(); }
  // behind the eye: nothing to see (a little margin for wide portal views)
  let ground = terrainHeight(xz);
  let to = vec3f(xz.x, ground, xz.y) - frame.camPos;
  if (dot(to, frame.camFwd) < -1.5) { return collapsed(); }

  let h0 = hash12(cell + 3.7);
  let meadowPatch = fbm2(xz * 0.07, 3);
  let height = HEIGHT * (0.45 + 0.9 * meadowPatch + 0.35 * h0) * mix(0.25, 1.0, fade) * (0.6 + 0.4 * smoothstep(1.5, 6.0, shore));
  let flowerPick = hash12(cell * 0.73 + 11.0);
  let flowers = smoothstep(0.55, 0.75, fbm2(xz * 0.05 + 30.0, 3));
  let isFlower = flowerPick < 0.035 + 0.09 * flowers;
  let yaw = h0 * 6.2832;
  let face = vec2f(cos(yaw), sin(yaw));
  let side = vec2f(-face.y, face.x);

  // the strip: pairs at a third and two thirds of the way up, a point at the tip
  let k = min(vi / 2u, 3u);
  let t = f32(k) / 3.0;
  let s = select(select(-1.0, 1.0, (vi & 1u) == 1u), 0.0, vi >= 6u);
  var w = WIDTH * (1.0 - t * 0.75) * (0.8 + 0.5 * h0);
  if (isFlower && k == 2u) { w = 0.028; }
  let wind = windAt(xz, G.time) * (0.6 + 0.6 * hash12(cell + 9.1));
  let lean = (wind + (jitter - 0.5) * 0.3) * height * pow(t, 1.6);
  let droop = dot(lean, lean) / max(height, 0.05) * 0.4;
  let p = vec3f(xz.x + side.x * w * s + lean.x, ground + height * t - droop, xz.y + side.y * w * s + lean.y);

  var o: BOut;
  o.world = p;
  o.pos = clipAt(p);
  // the blade's face, bowed toward its tip so it shades rounded
  o.n = normalize(vec3f(face.x, 0.6 + t, face.y) + vec3f(side.x, 0.0, side.y) * s * 0.45);
  var col = mix(vec3f(0.03, 0.06, 0.012), vec3f(0.11, 0.19, 0.035), t);
  col = mix(col, vec3f(0.27, 0.24, 0.07), smoothstep(0.55, 0.85, meadowPatch) * t * 0.7);
  col *= 0.8 + 0.4 * h0;
  if (isFlower && k >= 2u) {
    // California poppies and lupines
    col = select(vec3f(0.36, 0.2, 0.85), vec3f(1.0, 0.36, 0.03), hash12(cell + 5.5) < 0.6) * select(0.7, 1.0, k == 3u);
  }
  o.col = col;
  o.t = t;
  return o;
}

@fragment fn fs(i: BOut) -> @location(0) vec4f {
  let p = i.world;
  var n = normalize(i.n);
  let v = normalize(frame.camPos - p);
  if (dot(n, v) < 0.0) { n = -n; n.y = abs(n.y); }
  let l = G.sunDir;
  let vis = sunShadow(p, vec3f(0.0, 1.0, 0.0));
  let diff = saturate(dot(n, l)) * 0.75 + 0.25;
  // the sun through the blades: the low sun behind them lights them gold
  let through = pow(saturate(dot(-v, l)), 3.0) * 0.5 * i.t;
  let ao = mix(0.35, 1.0, i.t);
  var c = i.col * (G.sunColor * vis * (diff + through) + ambient(n) * ao);
  c += G.sunColor * vis * pow(saturate(dot(reflect(-l, n), v)), 18.0) * 0.06 * i.t;
  // the night: the walk's lanterns lighting the blades round them
  if (G.night > 0.0) { c += i.col * LAMP * lanternPools(p.xz) * G.night * (0.5 + 0.8 * i.t); }
  return vec4f(haze(c, p), 1.0);
}
