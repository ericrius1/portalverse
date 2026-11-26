// The Palace Lagoon's birds, each built here from nothing but its species' measure and what it's doing (ported from
// Earth's city birds, web/src/birds/birds.wgsl): a body full in the breast and tapering to the tail, a head and a bill,
// a neck for the long-necked ones (an S held at rest, drawn in on the shoulders in flight, shot out in a strike), two
// wings each of an arm and a hand (the hand a beat behind the arm, both folded along the flanks at rest), a fanned tail,
// legs when it stands (trailed behind a wader in flight). Painted in its plumage:
//   0 starling      the murmuration's: glossy black shot with purple and green, spangled pale (the few-vertex LOW body)
//   1 great egret   white, a dagger of a yellow bill, black legs
//   2 great heron   blue-grey, a white face with a black crest stripe, a buff neck, dark flight feathers
//   3 mute swan     white, the orange bill with its black knob, the neck in its long curve
//   4 peregrine     slate above, barred pale below, a dark hood: the falcon that stoops through the murmuration
// Lit by the room's key light (the sun, then the moon), its sky and ground, the Palace's shadow and the drones'
// projectors; mirrored in the lagoon by the reflection pass.
#include "../shaders/common"
#include "../../../packages/core/src/rooms/projection/light"

// a: x y z, heading (rad, from +x toward +z); b: pitch, bank, species, size; c: the wingbeat's phase, its amplitude,
// how folded the wings are (0 spread .. 1 folded), the wings' dihedral; d: the neck's pose (-1 drawn in, 0 the S at
// rest, 1 alert, 2 a strike), variant, posture (0 flying, 1 standing, 2 afloat) times 1000 plus its speed (m/s), and
// how much of it shows (0..1: a starling gone down to roost)
struct Bird { a: vec4f, b: vec4f, c: vec4f, d: vec4f }
@group(2) @binding(0) var<storage, read> birds: array<Bird>;

/** the starlings' body: a dozen cells of body, a cell an arm and a hand, the tail (LOW_V vertices a bird) */
override LOW: bool = false;
/** drawn no smaller than this many pixels across, far off: a speck, not a flicker */
override MIN_PX: f32 = 1.6;

const BPI = 3.14159265;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) n: vec3f,
  @location(2) q: vec3f,
  @location(3) top: vec3f,
  @location(4) @interpolate(flat) look: vec4u,   // part, species, variant
}

// a species' measure (m): body length, width, height, the head's radius; the bill's length and depth, the half-span,
// the chord; the tail's length and its width at the end, the legs, how far the hand tapers; the neck's length and
// thickness, the hand's sweep, how broad and fingered the hand is
struct Measure { body: vec4f, wing: vec4f, more: vec4f, neck: vec4f }
fn measure(sp: u32) -> Measure {
  var m: Measure;
  switch sp {
    case 0u: { m.body = vec4f(0.2, 0.065, 0.06, 0.022); m.wing = vec4f(0.026, 0.008, 0.19, 0.075); m.more = vec4f(0.065, 0.055, 0.03, 0.32); m.neck = vec4f(0.0, 0.0, 0.3, 0.0); }
    case 1u: { m.body = vec4f(0.36, 0.14, 0.15, 0.03); m.wing = vec4f(0.13, 0.02, 0.7, 0.27); m.more = vec4f(0.13, 0.13, 0.5, 0.62); m.neck = vec4f(0.44, 0.026, 0.12, 1.0); }
    case 2u: { m.body = vec4f(0.46, 0.18, 0.19, 0.038); m.wing = vec4f(0.15, 0.03, 0.92, 0.34); m.more = vec4f(0.15, 0.15, 0.55, 0.66); m.neck = vec4f(0.5, 0.034, 0.1, 1.0); }
    case 3u: { m.body = vec4f(0.78, 0.36, 0.28, 0.05); m.wing = vec4f(0.09, 0.045, 1.1, 0.42); m.more = vec4f(0.14, 0.2, 0.12, 0.6); m.neck = vec4f(0.64, 0.05, 0.14, 0.6); }
    default: { m.body = vec4f(0.3, 0.12, 0.11, 0.04); m.wing = vec4f(0.025, 0.02, 0.5, 0.17); m.more = vec4f(0.14, 0.09, 0.06, 0.36); m.neck = vec4f(0.0, 0.0, 0.34, 0.0); }
  }
  return m;
}

const SB = 10u;  // the body's segments round
const RB = 7u;   // and its bands, tail to breast
const SH = 6u;
const RH = 4u;
const NR = 8u;   // the neck's segments round
const NL = 8u;   // and along
const BODY_V = 420u;
const HEAD_V = 144u;
const BILL_V = 12u;
const NECK_V = 384u;
const WING_V = 90u;   // each wing: five cells out (two the arm, three the hand) by three across
const TAIL_V = 12u;
const LEG_V = 24u;    // each leg two crossed strips

// a quad's six corners as two triangles: (0,0) (1,0) (1,1) (0,0) (1,1) (0,1), from bits (no table: Metal)
fn corner6(k: u32) -> vec2f { return vec2f(f32((22u >> k) & 1u), f32((52u >> k) & 1u)); }

// the unit sphere at a cell's corner, its pole along z (lat 0 the back, PI the front)
fn sphereZ(cell: u32, segs: u32, bands: u32, k: u32) -> vec3f {
  let c = corner6(k);
  let lat = (f32(cell / segs) + c.y) / f32(bands) * BPI;
  let lon = (f32(cell % segs) + c.x) / f32(segs) * 2.0 * BPI;
  return vec3f(cos(lon) * sin(lat), sin(lon) * sin(lat), -cos(lat));
}

struct Local { p: vec3f, n: vec3f, q: vec3f, top: vec3f, part: u32 }

// one wing's point: s along the span (0 the shoulder .. 1 the tip), c across it (0 the leading edge .. 1 the trailing),
// `side` +1 the right wing, -1 the left
fn wingPoint(m: Measure, sp: u32, s: f32, c: f32, side: f32, phase: f32, amp: f32, fold: f32, dihedral: f32) -> Local {
  var o: Local;
  let half = m.wing.z;
  let chord0 = m.wing.w;
  let ARM = 0.42;
  let hand = saturate((s - ARM) / (1.0 - ARM));
  let taper = mix(1.0, m.more.w, hand);
  let sweep = (s - ARM) * half * m.neck.z * step(ARM, s);
  // an asymmetric beat: a powerful downstroke with the wing spread, the upstroke led by the wrist, the hand swept back
  let upK = saturate(cos(phase)) * saturate(amp * 1.5);
  let recSweep = (s - ARM) * half * 0.22 * upK * step(ARM, s);
  // (a wader's and a swan's hand fingered: the primaries' tips splay apart at the trailing edge)
  let fingers = m.neck.w * hand * hand * c * 0.25 * sin(s * 40.0);
  let lead = chord0 * 0.35 - sweep - recSweep;
  let chord = chord0 * taper;
  let shoulder = vec3f(side * m.body.y * 0.42, m.body.z * 0.3, m.body.x * 0.1);
  let beat = sin(phase) - 0.18 * sin(2.0 * phase);
  let handBeat = sin(phase - 0.88) - 0.2 * sin(2.0 * (phase - 0.88));
  let ta = dihedral + amp * beat;
  let th = ta + amp * 0.62 * handBeat - amp * (0.2 + 0.22 * upK);
  let armL = ARM * half;
  let x = s * half;
  let handSpan = mix(1.0, 0.84, upK);
  // the wing's twist: the trailing edge lifts on the downstroke and drops on the feathered upstroke
  let twistY = (c - 0.35) * chord * amp * (0.34 * cos(phase - 0.35)) * smoothstep(0.15, 0.9, s);
  var lat: vec2f;
  var nUp: vec2f;
  if (x <= armL) { lat = vec2f(cos(ta), sin(ta)) * x; nUp = vec2f(-sin(ta), cos(ta)); }
  else { lat = vec2f(cos(ta), sin(ta)) * armL + vec2f(cos(th), sin(th)) * ((x - armL) * handSpan); nUp = vec2f(-sin(th), cos(th)); }
  let spread = shoulder + vec3f(side * lat.x, lat.y + twistY + fingers * chord, lead - c * chord);
  // folded: laid along the body, wrapped round its flank from the back's top (the leading edge) down the side (the
  // trailing), the primaries crossing over the tail; a swan's raised in an arch over its back
  let L = m.body.x * 0.5;
  let zn = 0.62 - 1.75 * s;
  let back = max(-zn, 0.0);
  let girth = sqrt(max(1.0 - zn * zn, 0.0)) * (1.0 - 0.4 * back * back);
  let r = max(girth, 0.18 * smoothstep(-1.4, -0.85, zn)) * 1.06 + 0.02;
  let phi = mix(0.42, 1.75, c);
  let arch = select(0.0, 0.35 * (1.0 - c) * sin(s * 3.14159), sp == 3u);
  let folded = vec3f(side * sin(phi) * r * m.body.y * 0.5, cos(phi) * r * m.body.z * 0.5 + m.body.z * (0.25 * back * back + arch) + 0.004, zn * L);
  o.p = mix(spread, folded, fold);
  o.top = normalize(mix(vec3f(side * nUp.x, nUp.y, 0.0), vec3f(side, 0.15, 0.0), fold));
  o.n = o.top;
  o.q = vec3f(s, c, 0.0);
  o.part = 3u;
  return o;
}

// the neck's shape for a pose: where the head is (from the body's centre), the curve's two handles (from its ends,
// in neck lengths), and which way the bill points
struct NeckPose { head: vec3f, h0: vec3f, h1: vec3f, bill: vec3f }
fn neckKey(k: i32, m: Measure, sp: u32, legs: f32) -> NeckPose {
  var o: NeckPose;
  let L = m.body.x * 0.5;
  let H = m.body.z * 0.5;
  let Ln = m.neck.x;
  switch k {
    case -1: {
      // drawn in on the shoulders (flight, sleep): the kink hangs below the head
      o.head = vec3f(0.0, H * 0.95, L + Ln * 0.18);
      o.h0 = vec3f(0.0, -0.05, 0.3);
      o.h1 = vec3f(0.0, -0.32, -0.1);
      o.bill = vec3f(0.0, -0.12, 1.0);
    }
    case 0: {
      // the S at rest: up from the breast, back, and forward to the head
      o.head = vec3f(0.0, H + Ln * 0.72, L + Ln * 0.12);
      o.h0 = vec3f(0.0, 0.22, 0.42);
      o.h1 = vec3f(0.0, -0.32, -0.55);
      o.bill = vec3f(0.0, -0.22, 1.0);
      if (sp == 3u) { o.head = vec3f(0.0, H + Ln * 0.72, L + Ln * 0.12); o.h0 = vec3f(0.0, 0.5, 0.25); o.h1 = vec3f(0.0, 0.1, -0.35); o.bill = vec3f(0.0, -0.75, 1.0); }
    }
    case 1: {
      // alert: stretched up, near straight
      o.head = vec3f(0.0, H + Ln * 0.9, L + Ln * 0.26);
      o.h0 = vec3f(0.0, 0.4, 0.05);
      o.h1 = vec3f(0.0, -0.36, -0.06);
      o.bill = vec3f(0.0, -0.12, 1.0);
    }
    default: {
      // the strike: shot down and forward to the water
      o.head = vec3f(0.0, -H - legs * 0.85, L + Ln * 0.72);
      o.h0 = vec3f(0.0, 0.12, 0.45);
      o.h1 = vec3f(0.0, 0.38, -0.25);
      o.bill = vec3f(0.0, -1.0, 0.4);
    }
  }
  return o;
}
fn neckPose(pose: f32, m: Measure, sp: u32, legs: f32) -> NeckPose {
  let k0 = floor(clamp(pose, -1.0, 2.0));
  let t = clamp(pose, -1.0, 2.0) - k0;
  let a = neckKey(i32(k0), m, sp, legs);
  let b = neckKey(min(i32(k0) + 1, 2), m, sp, legs);
  var o: NeckPose;
  o.head = mix(a.head, b.head, t);
  o.h0 = mix(a.h0, b.h0, t);
  o.h1 = mix(a.h1, b.h1, t);
  o.bill = normalize(mix(a.bill, b.bill, t));
  return o;
}
fn bez(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let u = 1.0 - t;
  return p0 * (u * u * u) + p1 * (3.0 * u * u * t) + p2 * (3.0 * u * t * t) + p3 * (t * t * t);
}
fn bezD(p0: vec3f, p1: vec3f, p2: vec3f, p3: vec3f, t: f32) -> vec3f {
  let u = 1.0 - t;
  return (p1 - p0) * (3.0 * u * u) + (p2 - p1) * (6.0 * u * t) + (p3 - p2) * (3.0 * t * t);
}

/** a turn about y (the head's quick looks round) */
fn yawed(v: vec3f, c: f32, s: f32) -> vec3f { return vec3f(v.x * c + v.z * s, v.y, -v.x * s + v.z * c); }

fn build(vi: u32, B: Bird) -> Local {
  var o: Local;
  let sp = u32(B.b.z);
  let m = measure(sp);
  let L = m.body.x * 0.5;
  let W = m.body.y * 0.5;
  let H = m.body.z * 0.5;
  let hr = m.body.w;
  let phase = B.c.x;
  let amp = B.c.y;
  let fold = B.c.z;
  let dihedral = B.c.w;
  let posture = u32(floor(B.d.z / 1000.0));
  let walkSpd = B.d.z - f32(posture) * 1000.0;
  let walkW = select(0.0, smoothstep(0.02, 0.2, walkSpd), posture == 1u);
  let standing = posture == 1u;
  let legs = select(0.0, m.more.z, standing);
  let hasNeck = m.neck.x > 0.0;
  // the body heaves against the downstroke in flight
  let heave = select(0.0, -amp * (1.0 - fold) * 0.13 * L * sin(phase - 0.35), posture == 0u);

  // the head: on its neck (a pose), or set on the shoulders; quick looks round when it's still
  let seed = fract(B.d.y * 0.37 + B.b.w * 7.13 + sin(B.a.w * 3.1) * 0.25);
  let slot = G.time * 0.7 + seed * 19.0;
  let si = floor(slot);
  let h0 = (hash12(vec2f(si, seed * 311.7)) * 2.0 - 1.0) * 0.5;
  let h1 = (hash12(vec2f(si + 1.0, seed * 311.7)) * 2.0 - 1.0) * 0.5;
  let still = select(0.0, 1.0, posture >= 1u) * (1.0 - smoothstep(1.2, 1.6, B.d.x));
  let headYaw = mix(h0, h1, smoothstep(0.85, 1.0, slot - si)) * still;
  let chy = cos(headYaw);
  let shy = sin(headYaw);
  var neck = neckPose(B.d.x, m, sp, max(legs, m.more.z * 0.7));
  if (!hasNeck) {
    neck.head = vec3f(0.0, H * 0.95 + hr * 0.4 - heave * 0.75, L * 0.92 + hr * 0.3);
    neck.bill = vec3f(0.0, -0.15, 1.0);
  }
  let headC = neck.head;
  let billDir = normalize(yawed(neck.bill, chy, shy));

  var v = vi;
  o.top = vec3f(0.0, 1.0, 0.0);
  if (v < BODY_V) {
    let s = sphereZ(v / 6u, SB, RB, v % 6u);
    let back = max(-s.z, 0.0);
    let taper = 1.0 - 0.4 * back * back;
    // (a swan's body boat-shaped: flat beneath, its breast deep)
    let keel = select(1.0, mix(0.7, 1.0, step(0.0, s.y)), sp == 3u);
    o.p = vec3f(s.x * W * taper, s.y * H * taper * keel + H * 0.25 * back * back, s.z * L);
    o.n = normalize(vec3f(s.x / W, s.y / H, s.z / L));
    o.q = s;
    o.part = 0u;
  } else if (v < BODY_V + HEAD_V) {
    v -= BODY_V;
    let s = sphereZ(v / 6u, SH, RH, v % 6u);
    // the head's long axis along the bill
    let fz = billDir;
    let fx = normalize(cross(vec3f(0.0, 1.0, 0.0), fz) + vec3f(1e-4, 0.0, 0.0));
    let fy = cross(fz, fx);
    let hs = s * vec3f(hr * 0.85, hr, hr * 1.2);
    o.p = headC + fx * hs.x + fy * hs.y + fz * hs.z;
    o.n = normalize(fx * s.x + fy * s.y + fz * s.z);
    o.q = s;
    o.part = 1u;
  } else if (v < BODY_V + HEAD_V + BILL_V) {
    v -= BODY_V + HEAD_V;
    // a four-sided wedge from the face to the tip
    let tri = v / 3u;
    let k = v % 3u;
    let bl = m.wing.x;
    let bd = m.wing.y;
    let a0 = f32(tri) * 0.5 * BPI + 0.25 * BPI;
    let a1 = a0 + 0.5 * BPI;
    let base = headC + billDir * hr * 0.85;
    let bx = normalize(cross(vec3f(0.0, 1.0, 0.0), billDir) + vec3f(1e-4, 0.0, 0.0));
    let by = cross(billDir, bx);
    var p = base + billDir * bl;
    if (k == 1u) { p = base + bx * cos(a0) * bd * 0.45 + by * sin(a0) * bd * 0.5; }
    if (k == 2u) { p = base + bx * cos(a1) * bd * 0.45 + by * sin(a1) * bd * 0.5; }
    o.p = p;
    o.n = normalize(bx * cos(a0 + 0.25 * BPI) + by * sin(a0 + 0.25 * BPI));
    o.q = vec3f(select(0.0, 1.0, k == 0u), 0.0, 0.0);
    o.part = 2u;
  } else if (v < BODY_V + HEAD_V + BILL_V + NECK_V) {
    v -= BODY_V + HEAD_V + BILL_V;
    if (!hasNeck) {
      o.p = vec3f(0.0, 0.0, L * 0.5);
      o.n = vec3f(0.0, 1.0, 0.0);
      o.part = 0u;
      o.q = vec3f(0.0, 0.0, 1.0);
    } else {
      // a tube along a cubic from the breast to the back of the head
      let cell = v / 6u;
      let c = corner6(v % 6u);
      let t = (f32(cell / NR) + c.y) / f32(NL);
      let a = (f32(cell % NR) + c.x) / f32(NR) * 2.0 * BPI;
      let Ln = m.neck.x;
      let p0 = vec3f(0.0, H * 0.45, L * 0.78);
      let p3 = headC - billDir * hr * 0.4;
      let p1 = p0 + neck.h0 * Ln;
      let p2 = p3 + neck.h1 * Ln;
      let C = bez(p0, p1, p2, p3, t);
      let T = normalize(bezD(p0, p1, p2, p3, t) + vec3f(0.0, 1e-4, 0.0));
      // (the neck lies in the bird's own upright plane, so its side is x: a frame that never flips)
      let nx = normalize(vec3f(1.0, 0.0, 0.0) - T * T.x);
      let ny = cross(T, nx);
      // (thick at the breast, slender under the head; a swan's evenly thick)
      let r = m.neck.y * mix(select(1.5, 1.15, sp == 3u), 0.8, t);
      let dirN = nx * cos(a) + ny * sin(a);
      o.p = C + dirN * r;
      o.n = dirN;
      o.q = vec3f(t, sin(a), 0.0);
      o.part = 6u;
    }
  } else if (v < BODY_V + HEAD_V + BILL_V + NECK_V + 2u * WING_V) {
    v -= BODY_V + HEAD_V + BILL_V + NECK_V;
    let side = select(1.0, -1.0, v >= WING_V);
    v = v % WING_V;
    let cell = v / 6u;
    let c = corner6(v % 6u);
    let a = f32(cell / 3u) + c.x;
    let s = select(0.42 + (a - 2.0) * 0.1933, a * 0.21, a <= 2.0);
    o = wingPoint(m, sp, s, (f32(cell % 3u) + c.y) / 3.0, side, phase, amp, fold, dihedral);
  } else if (v < BODY_V + HEAD_V + BILL_V + NECK_V + 2u * WING_V + TAIL_V) {
    v -= BODY_V + HEAD_V + BILL_V + NECK_V + 2u * WING_V;
    // the tail: two halves of a fan, spread wider in flight, in turns and in the landing's flare
    let side = select(1.0, -1.0, v >= 6u);
    let c = corner6(v % 6u);
    let flare = select(0.0, smoothstep(0.22, 0.55, B.b.x), posture == 0u);
    let spread = 1.0 + 0.5 * (1.0 - fold) + 0.28 * saturate(abs(B.b.y)) + 0.45 * flare;
    let rootW = W * 0.55;
    let endW = m.more.y * 0.5 * spread;
    let z = -L * 0.75 - c.y * m.more.x;
    let x = side * c.x * mix(rootW, endW, c.y);
    let tailPitch = select(0.0, amp * (1.0 - fold) * 0.12 * m.more.x * sin(phase - 0.6) - flare * 0.32 * m.more.x, posture == 0u);
    let cock = select(0.0, 0.06, sp == 3u);
    o.p = vec3f(x, H * 0.25 + c.y * (tailPitch + cock), z);
    o.n = vec3f(0.0, 1.0, 0.0);
    o.top = o.n;
    o.q = vec3f(c.x, c.y, 0.0);
    o.part = 4u;
  } else {
    v -= BODY_V + HEAD_V + BILL_V + NECK_V + 2u * WING_V + TAIL_V;
    // the legs: two crossed strips each, striding when it walks; a wader's trailed straight back in flight
    let side = select(1.0, -1.0, v >= 12u);
    let strip = (v / 6u) % 2u;
    let c = corner6(v % 6u);
    let lw = max(m.body.y * 0.075, 0.008);
    let legPh = phase + select(0.0, BPI, side < 0.0);
    let hip = vec3f(side * W * 0.35, -H * 0.5, -L * 0.05);
    let across = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), strip == 1u) * (c.x - 0.5) * lw;
    if (standing) {
      let strideZ = sin(legPh) * legs * 0.45 * walkW;
      let strideY = max(0.0, cos(legPh)) * legs * 0.22 * walkW;
      let foot = vec3f(side * W * 0.28, -H * 0.6 - legs + strideY, -L * 0.05 + legs * 0.12 + strideZ);
      o.p = mix(hip, foot, c.y) + across;
    } else if (posture == 0u && hasNeck && sp != 3u) {
      // (trailed: the feet a little past the tail; let down and forward in the landing's flare)
      let flare = smoothstep(0.2, 0.55, B.b.x);
      let foot = hip + mix(vec3f(side * 0.01, -0.03, -m.more.z * 1.05), vec3f(side * 0.03, -m.more.z * 0.95, m.more.z * 0.25), flare);
      o.p = mix(hip, foot, c.y) + across;
    } else {
      o.p = vec3f(0.0, -H * 0.5, 0.0);
    }
    o.n = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), strip == 1u);
    o.q = vec3f(c.x, c.y, 0.0);
    o.part = 5u;
  }
  // (standing: the feet at the instance's height; afloat: riding a third under; flying: the heave)
  if (posture == 0u) { o.p.y += heave; }
  if (standing) { o.p.y += H * 0.6 + legs; }
  if (posture == 2u) { o.p.y -= H * 0.05; }
  return o;
}

/** the starlings' body, far off and many: a dozen cells of body, a cell an arm and a hand, a fan of a tail */
const LOW_BODY_V = 72u;
const LOW_WING_V = 12u;
fn buildLow(vi: u32, B: Bird) -> Local {
  var o: Local;
  let m = measure(0u);
  let L = m.body.x * 0.5;
  let W = m.body.y * 0.5;
  let H = m.body.z * 0.5;
  let phase = B.c.x;
  let amp = B.c.y;
  var v = vi;
  o.top = vec3f(0.0, 1.0, 0.0);
  if (v < LOW_BODY_V) {
    let s = sphereZ(v / 6u, 4u, 3u, v % 6u);
    let back = max(-s.z, 0.0);
    let taper = 1.0 - 0.45 * back * back;
    // (the head a bump at the front)
    let front = smoothstep(0.55, 1.0, s.z);
    o.p = vec3f(s.x * W * taper * (1.0 - 0.35 * front), s.y * H * taper + H * 0.35 * front, s.z * L * (1.0 + 0.25 * front));
    o.n = normalize(vec3f(s.x / W, s.y / H, s.z / L));
    o.q = s;
    o.part = 0u;
  } else if (v < LOW_BODY_V + 2u * LOW_WING_V) {
    v -= LOW_BODY_V;
    let side = select(1.0, -1.0, v >= LOW_WING_V);
    v = v % LOW_WING_V;
    let cell = v / 6u;
    let c = corner6(v % 6u);
    // the starling's wing: a triangle (broad at the arm, pointed at the tip)
    let s = select(c.x * 0.42, 0.42 + c.x * 0.58, cell == 1u);
    o = wingPoint(m, 0u, s, c.y, side, phase, amp, 0.0, B.c.w);
  } else {
    v -= LOW_BODY_V + 2u * LOW_WING_V;
    let c = corner6(v % 6u);
    let x = (c.x - 0.5) * mix(W * 0.9, m.more.y, c.y);
    o.p = vec3f(x, H * 0.2, -L * 0.75 - c.y * m.more.x);
    o.n = vec3f(0.0, 1.0, 0.0);
    o.q = vec3f(c.x, c.y, 0.0);
    o.part = 4u;
  }
  o.p.y -= amp * 0.13 * L * sin(phase - 0.35);
  return o;
}

fn placeOf(B: Bird) -> mat3x3f {
  let yaw = B.a.w;
  let pitch = B.b.x;
  let roll = B.b.y;
  let F = vec3f(cos(yaw) * cos(pitch), sin(pitch), sin(yaw) * cos(pitch));
  let R0 = normalize(cross(F, vec3f(0.0, 1.0, 0.0)));
  let U0 = cross(R0, F);
  let R = R0 * cos(roll) - U0 * sin(roll);
  let U = U0 * cos(roll) + R0 * sin(roll);
  return mat3x3f(R, U, F);
}

fn hidden() -> VOut {
  var o: VOut;
  o.pos = vec4f(0.0, 0.0, -1.0, 1.0);
  return o;
}

@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  let B = birds[ii];
  if (B.d.w <= 0.001) { return hidden(); }
  let sp = u32(B.b.z);
  var l: Local;
  if (LOW) { l = buildLow(vi, B); } else { l = build(vi, B); }
  let M = placeOf(B);
  // (no smaller than MIN_PX across far off; a starling coming up from the roost grows from nothing)
  let dist = length(B.a.xyz - frame.camPos);
  let px = 2.0 * tan(frame.fovY * 0.5) * dist / max(G.vp.w, 1.0);
  let span = measure(sp).wing.z * 2.0 * B.b.w;
  let k = B.b.w * max(1.0, MIN_PX * px / span) * B.d.w;
  let w = B.a.xyz + M * (l.p * k);
  var o: VOut;
  o.pos = clipAt(w);
  o.world = w;
  o.n = normalize(M * l.n);
  o.top = normalize(M * l.top);
  o.q = l.q;
  o.look = vec4u(l.part, sp, u32(B.d.y + 0.5), 0u);
  return o;
}

struct Plumage { albedo: vec3f, gloss: f32, sheen: f32 }

fn plumage(part: u32, sp: u32, variant: u32, q: vec3f, top: bool, p: vec3f) -> Plumage {
  var o: Plumage;
  o.gloss = 0.0;
  o.sheen = 0.0;
  let fine = hash12(floor(p.xz * 70.0) + floor(p.y * 70.0));
  switch sp {
    case 0u: {
      // the starling: black, glossed purple and green, spangled with pale tips; the wings' undersides grey-brown
      o.albedo = vec3f(0.022, 0.02, 0.024);
      if (fine > 0.82 && part == 0u) { o.albedo = vec3f(0.3, 0.27, 0.2); }
      if (part == 3u && !top) { o.albedo = vec3f(0.09, 0.085, 0.08); }
      if (part == 2u) { o.albedo = vec3f(0.55, 0.45, 0.12); }
      o.sheen = 1.0;
      o.gloss = 0.5;
    }
    case 1u: {
      // the great egret: white all over, the bill yellow, the legs black
      o.albedo = vec3f(0.8, 0.8, 0.78) * (0.95 + 0.05 * fine);
      if (part == 2u) { o.albedo = vec3f(0.85, 0.62, 0.08); }
      if (part == 5u) { o.albedo = vec3f(0.025); }
      if (part == 1u && q.z > 0.75 && abs(q.y) < 0.3) { o.albedo = vec3f(0.55, 0.65, 0.3); }
      o.gloss = 0.1;
    }
    case 2u: {
      // the great heron: blue-grey; the face white with a black stripe over the eye to the crest, the neck buff-grey,
      // the flight feathers slate-black; the bill yellow, the legs olive
      o.albedo = vec3f(0.3, 0.34, 0.4) * (0.9 + 0.2 * fine);
      if (part == 6u) { o.albedo = mix(vec3f(0.5, 0.47, 0.44), vec3f(0.75, 0.72, 0.68), smoothstep(0.3, -0.6, q.y)); }
      if (part == 1u) { o.albedo = select(vec3f(0.85, 0.85, 0.82), vec3f(0.04), q.y > 0.35); }
      if (part == 3u && (q.x > 0.55 || q.y > 0.7)) { o.albedo = vec3f(0.08, 0.09, 0.11); }
      if (part == 2u) { o.albedo = vec3f(0.75, 0.6, 0.2); }
      if (part == 5u) { o.albedo = vec3f(0.3, 0.28, 0.18); }
      if (part == 0u && q.y < -0.3) { o.albedo = vec3f(0.22, 0.22, 0.24); }
    }
    case 3u: {
      // the mute swan: white, the bill orange with its black knob and face
      o.albedo = vec3f(0.84, 0.84, 0.82) * (0.96 + 0.04 * fine);
      if (part == 2u) { o.albedo = select(vec3f(0.9, 0.32, 0.04), vec3f(0.02), q.x < 0.25); }
      if (part == 1u && q.z > 0.55 && q.y < 0.3) { o.albedo = vec3f(0.03); }
      if (part == 5u) { o.albedo = vec3f(0.03); }
      o.gloss = 0.12;
    }
    default: {
      // the peregrine: slate-blue above, the tips darker; pale and finely barred below; a dark hood over a pale cheek
      let bars = step(0.5, fract(p.y * 90.0 + p.x * 20.0));
      o.albedo = select(mix(vec3f(0.75, 0.72, 0.64), vec3f(0.3, 0.28, 0.26), bars * 0.6), vec3f(0.18, 0.2, 0.25), top);
      if (part == 0u && q.y > 0.2) { o.albedo = vec3f(0.18, 0.2, 0.25); }
      if (part == 1u) { o.albedo = select(vec3f(0.06, 0.06, 0.07), vec3f(0.85, 0.83, 0.78), q.y < -0.2 && q.z > -0.2); }
      if (part == 3u && q.x > 0.7) { o.albedo = vec3f(0.06, 0.065, 0.075); }
      if (part == 2u) { o.albedo = vec3f(0.12, 0.12, 0.14); }
      if (part == 5u) { o.albedo = vec3f(0.85, 0.7, 0.1); }
      o.gloss = 0.15;
    }
  }
  return o;
}

@fragment fn fs(i: VOut) -> @location(0) vec4f {
  let p = i.world;
  if (clipBelowWater(p)) { discard; }
  var n = normalize(i.n);
  let v = normalize(frame.camPos - p);
  let top = dot(i.top, v) > 0.0;
  if (dot(n, v) < 0.0) { n = -n; }
  let pl = plumage(i.look.x, i.look.y, i.look.z, i.q, top, p);
  let l = G.sunDir;
  let ndl = saturate(dot(n, l));
  var vis = 1.0;
  if (ndl > 0.0 || i.look.x == 3u) { vis = sunShadow(p, n); }
  let amb = ambient(n);
  let wrap = saturate(dot(n, l) * 0.5 + 0.5) * 0.12;
  // (light through a thin wing held against the low sun: its edges glow; a white bird's whole wing)
  let back = pow(saturate(dot(-v, l)), 4.0);
  let through = select(0.0, back * mix(0.25, 0.7, dot(pl.albedo, vec3f(0.33))), i.look.x == 3u || i.look.x == 4u);
  var c = pl.albedo * (G.sunColor * vis * (ndl + wrap + through) + amb);
  c += G.sunColor * vis * ggx(n, v, l, mix(0.6, 0.3, pl.gloss), vec3f(0.04)) * (0.25 + 0.6 * pl.gloss);
  // the starling's gloss: purple on the head and breast, green on the back, shifting with the angle
  let slant = 1.0 - saturate(dot(n, v));
  c += pl.sheen * mix(vec3f(0.06, 0.24, 0.12), vec3f(0.22, 0.06, 0.28), slant * slant) * (amb * 0.8 + G.sunColor * vis * ndl * 0.15);
  // a rim of the sky's light round the silhouette
  c += pl.albedo * G.skyHorizon * pow(slant, 3.0) * 0.35;
  // the drones' projectors on the birds they catch
  if (G.palace.w > 0.0) { c += projectionTake(pl.albedo) * projectedLight(p, n) * G.palace.w; }
  return vec4f(haze(c, p), 1.0);
}
