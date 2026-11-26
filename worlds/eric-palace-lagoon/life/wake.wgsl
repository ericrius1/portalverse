// The swans' wakes on the still lagoon: the V each one draws behind it (the Kelvin arms at 19.5 degrees, their
// fine crests running out along them, the transverse ripples between), as a glint of the sky the ripples tilt to the
// eye. One quad behind each swan on the water, additive after the water (the scene's 'glow' phase). Their places
// come from the birds' own buffer (birds.wgsl's Bird), so they follow the swans exactly.
#include "../shaders/common"

struct Bird { a: vec4f, b: vec4f, c: vec4f, d: vec4f }
@group(2) @binding(0) var<storage, read> birds: array<Bird>;
/** which birds are swans: the first and how many (their indices run on) */
struct Wake { first: u32, count: u32, _p0: u32, _p1: u32 }
@group(2) @binding(1) var<uniform> W: Wake;

const BEHIND = 11.0;
const ACROSS = 5.5;

struct WOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) local: vec2f,                      // behind it (m), across (m)
  @location(2) @interpolate(flat) speed: f32,
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> WOut {
  var o: WOut;
  let B = birds[W.first + ii];
  let speed = B.d.z - floor(B.d.z / 1000.0) * 1000.0;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  if (B.d.w < 0.01 || speed < 0.02) { return o; }
  let c = vec2f(f32((22u >> vi) & 1u), f32((52u >> vi) & 1u));
  let fwd = vec2f(cos(B.a.w), sin(B.a.w));
  let side = vec2f(-fwd.y, fwd.x);
  let u = mix(-0.6, BEHIND, c.x);
  let v = mix(-ACROSS, ACROSS, c.y);
  let xz = B.a.xz - fwd * u + side * v;
  let p = vec3f(xz.x, G.waterY + 0.01, xz.y);
  o.world = p;
  o.pos = clipAt(p);
  o.local = vec2f(u, v);
  o.speed = speed;
  return o;
}

@fragment fn fs(i: WOut) -> @location(0) vec4f {
  let u = i.local.x;
  let v = abs(i.local.y);
  if (u < -0.4) { discard; }
  let k = 0.354;   // tan(19.47 degrees): the arms
  let arm = u * k;
  // the divergent waves: crests along the arms, a few short ones stepped back
  let width = 0.12 + u * 0.06;
  let onArm = exp(-pow((v - arm) / width, 2.0));
  let crests = 0.5 + 0.5 * cos((u * 0.94 + v * 2.6) * 9.0 / (0.6 + i.speed));
  // the transverse waves inside the V, fainter
  let inside = smoothstep(arm + width, arm - width * 2.0, v);
  let trans = (0.5 + 0.5 * cos(u * 11.0 / (0.5 + i.speed))) * inside * 0.35;
  // (fading with the distance behind, and in from the bow)
  let fade = smoothstep(-0.4, 0.4, u) * exp(-u * 0.22) * smoothstep(ACROSS, ACROSS * 0.6, v);
  let w = (onArm * crests + trans) * fade * saturate(i.speed * 2.5);
  // the glint: the sky low over the far bank and a little of the key light's colour, tilted to the eye
  let to = normalize(i.world - frame.camPos);
  let sky = skyColor(normalize(vec3f(to.x, 0.25, to.z)));
  let glint = sky * 0.4 + G.sunColor * 0.03;
  let fadeFar = 1.0 - smoothstep(60.0, 140.0, length(i.world - frame.camPos));
  return vec4f(glint * w * fadeFar, 0.0);
}
