/**
 * Each kind of tree grown once (in the grove's worker, grove.worker.ts) into two lists the shaders pull by number:
 * its bark (trunk, limbs and branches: tubes along curves, a triangle list) and its cards (leaf clusters, flowers, a
 * willow's hanging strands, a fern's fronds: a quad each, its corners made in the vertex shader).
 *
 * After Earth's (github.com/ericrius1/world: web/src/trees/grow.ts), itself after Daniel Greenheck's Tidewater (MIT:
 * src/world/vegetation/PlantGeometry.js): a crown is a handful of clumps, each a ball of leaf cards biased to its
 * shell, the cards' normals bent out from the clump's middle and the crown's, their light (ao) falling toward the
 * inside of each, so a crown lights as a few soft masses the way a painter blocks one in. Every card knows its clump,
 * so each tree sizes its clumps its own way and the wind rocks them (trees.wgsl). The cards are ranked, the crown's
 * outer ones first: far off only the first third is drawn, grown to keep the crown full.
 *
 * Here in metres (y up from the tree's foot), a kind at its own size; each tree is scaled a little its own way.
 */
import { SPECIES, type Shape, type Species, type V3 } from './species';

/** floats a card: c.xyz, code (kind·1024 + layer·64 + seg·8 + segs); a.xyz (half width), rank; b.xyz (half height),
 *  sway; n.xyz, ao; lobe centre (a strand's: where it hangs from).xyz, lobe (its number + its radius/16; a strand's
 *  -(1 + its number)) */
export const CARD = 20;
/** floats a bark vertex: pos.xyz, sway; n.xyz, lobe (-1 none); around (m), along (m), radius (m), ao; lobe centre.xyz, - */
export const BARK = 16;

/** card kinds (trees.wgsl) */
export const KIND = { leaf: 0, flower: 1, strand: 2, frond: 3 } as const;

export interface Grown {
  name: string;
  cards: Float32Array;
  cardCount: number;
  /** the cards kept far off (the first third, by rank) */
  farCards: number;
  bark: Float32Array;
  barkCount: number;
  /** the bark vertices of the trunk alone (the first ones): far off, only it is drawn */
  trunkVerts: number;
  /** lantern-fruit under the crown: x, y, z (m, the tree's frame), size (m) */
  lanterns: Float32Array;
  /** the crown's middle (m up) and its radius (m): where glow-seeds rise from */
  crown: [number, number];
  /** the whole tree's bounding sphere: its centre's height (m) and radius (m), for culling */
  bound: [number, number];
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a: V3): V3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const lerp = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const bez = (a: V3, c: V3, b: V3, t: number): V3 => lerp(lerp(a, c, t), lerp(c, b, t), t);
const UP: V3 = [0, 1, 0];

/** a clump: its centre (m), its radius (m), how squashed it is up and down */
interface Lobe { c: V3; r: number; flat: number }

/** the crown's frame: its middle, its half extents (m) */
interface Crown { mid: V3; ext: V3 }

// ------------------------------------------------------------------ the crown's clumps
function crownLobes(S: Species, r: () => number): { C: Crown; lobes: Lobe[] } {
  const R = S.r, h = S.h, yb = S.base * h;
  const cy = S.shape === 'shrub' ? h * 0.5 : (yb + h) / 2;
  const Ry = S.shape === 'shrub' ? h * 0.5 : (h - yb) / 2;
  const C: Crown = { mid: [0, cy, 0], ext: [R, Ry, R] };
  const out: Lobe[] = [];
  const jit = () => (r() - 0.5) * 0.12;
  // (x, z in crown radii, y in the crown's half heights from its middle, the clump's radius in crown radii)
  const one = (x: number, y: number, z: number, rad: number, flat = 0.8) =>
    out.push({ c: [(x + jit()) * R, cy + (y + jit() * 0.6) * Ry, (z + jit()) * R], r: rad * R * (0.9 + 0.2 * r()), flat });
  const ring = (n: number, y: number, rad: number, rl: number, flat = 0.8, phase = r() * 6.28) => {
    for (let i = 0; i < n; i++) {
      const a = phase + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.6;
      one(Math.cos(a) * rad, y, Math.sin(a) * rad, rl, flat);
    }
  };
  switch (S.shape) {
    case 'oak':
      // (a live oak's: cumulus heaped over a broad spreading skirt, the lowest hanging out past the limbs)
      one(0, 0.62, 0, 0.33, 0.78);
      ring(4, 0.32, 0.4, 0.32, 0.75);
      ring(6, -0.08, 0.7, 0.3, 0.62);
      ring(4, -0.5, 0.5, 0.26, 0.6);
      break;
    case 'column': {
      // (a flame: widest a third up, to a point; each clump overlapping the next)
      const n = 9, span = h - yb;
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        const w = (0.62 + 0.38 * Math.sin(Math.PI * Math.min(1, s * 1.5 + 0.25))) * Math.pow(1 - s * 0.93, 0.6);
        const rad = w * R * 1.05;
        const flat = Math.min(2.2, (span / n) * 1.5 / rad);
        out.push({ c: [(r() - 0.5) * 0.12 * R, yb + 0.5 + s * span * 0.9, (r() - 0.5) * 0.12 * R], r: rad, flat });
      }
      break;
    }
    case 'tiers':
      // (wind-sculpted: flat plates in tiers, leaning away from the sea wind)
      for (let t = 0; t < 3; t++) {
        const w = 1 - t * 0.22;
        const n = t === 2 ? 2 : 4;
        const phase = r() * 6.28;
        for (let i = 0; i < n; i++) {
          const a = phase + (i / n) * Math.PI * 2 + (r() - 0.5) * 0.7;
          one(Math.cos(a) * 0.52 * w + 0.12 * t, -0.62 + 0.6 * t, Math.sin(a) * 0.52 * w, 0.42 * w, 0.3);
        }
      }
      one(0.3, 0.75, 0, 0.26, 0.35);
      break;
    case 'weeping':
      one(0, 0.55, 0, 0.42, 0.8);
      ring(5, 0.1, 0.55, 0.38, 0.75);
      ring(6, -0.38, 0.74, 0.3, 0.65);
      break;
    case 'vase':
      // (a jacaranda's umbrella of bloom held on a vase of limbs)
      one(0, 0.5, 0, 0.34, 0.55);
      ring(6, 0.12, 0.64, 0.34, 0.5);
      ring(3, -0.3, 0.34, 0.28, 0.6);
      break;
    case 'round':
      one(0, 0.5, 0, 0.44, 0.8);
      ring(5, 0.05, 0.58, 0.4, 0.75);
      ring(4, -0.45, 0.45, 0.33, 0.7);
      break;
    case 'shrub':
      one(0, 0.3, 0, 0.55, 0.85);
      ring(4, -0.2, 0.52, 0.48, 0.8);
      break;
    case 'cone': {
      const n = 9;
      for (let i = 0; i < n; i++) {
        const s = 0.03 + (0.92 * i) / (n - 1), w = Math.pow(1 - s, 0.85), rl = (0.12 + 0.9 * w) * R;
        const y = yb + s * (h - yb);
        out.push({ c: [0, y, 0], r: rl, flat: Math.min(1.6, (((h - yb) / n) * 1.2) / rl) });
      }
      break;
    }
    case 'fern':
      break;
  }
  if (S.shape === 'shrub') for (const L of out) L.c[1] = Math.max(L.c[1], L.r * L.flat * 0.75);
  return { C, lobes: out };
}

/** a point on a clump's shell: biased to its outside (a clump reads as a volume, with gaps); `outer` keeps to the top
 *  and the outside (the flowers) */
function shellPoint(L: Lobe, r: () => number, outer = false): { p: V3; dir: V3 } {
  let x: number, y: number, z: number;
  do {
    x = r() * 2 - 1;
    y = r() * 2 - 1;
    z = r() * 2 - 1;
  } while (x * x + y * y + z * z > 1 || y < (outer ? -0.25 : -0.65));
  const l = Math.hypot(x, y, z) || 1, dir: V3 = [x / l, y / l, z / l];
  const shell = (outer ? 0.95 : 0.45 + 0.55 * Math.sqrt(l)) * L.r * 0.85;
  return { p: [L.c[0] + dir[0] * shell, L.c[1] + dir[1] * shell * L.flat, L.c[2] + dir[2] * shell], dir };
}

/** a card's shading normal and its light (ao, 0 deep in the crown .. 1 out in the sun and sky) at a point on clump L:
 *  bent out from the clump's middle and from the crown's (Tidewater's blend) */
function crownShade(C: Crown, L: Lobe, p: V3, cardN: V3): { n: V3; ao: number; out: number } {
  const dl: V3 = [(p[0] - L.c[0]) / L.r, (p[1] - L.c[1]) / (L.r * L.flat), (p[2] - L.c[2]) / L.r];
  const dc: V3 = [(p[0] - C.mid[0]) / C.ext[0], (p[1] - C.mid[1]) / C.ext[1], (p[2] - C.mid[2]) / C.ext[2]];
  const nl = nrm([dl[0], dl[1] / Math.sqrt(L.flat), dl[2]]);
  const n = nrm(add(add(mul(nl, 0.55), mul(nrm(dc), 0.45)), mul(cardN, 0.15)));
  const ext = Math.min(1, 0.5 * Math.min(1, len(dl)) + 0.4 * Math.min(1, len(dc)) + 0.25 * Math.max(0, nrm(dc)[1]));
  return { n, ao: 0.35 + 0.65 * ext * ext, out: Math.min(1, len(dc)) };
}

function pickLobe(lobes: Lobe[], r: () => number, pow = 2): number {
  const share = (L: Lobe) => Math.pow(L.r, pow) * (0.5 + 0.5 * Math.min(1, L.flat));
  let total = 0;
  for (const L of lobes) total += share(L);
  let x = r() * total;
  for (let i = 0; i < lobes.length; i++) {
    x -= share(lobes[i]);
    if (x <= 0) return i;
  }
  return lobes.length - 1;
}

// ------------------------------------------------------------------ the output
interface Card {
  c: V3; a: V3; b: V3; n: V3; rank: number; kind: number; layer: number; seg: number; segs: number; sway: number; ao: number;
  lobe: V3; lobeW: number;
}

class Bark {
  out: number[] = [];
  v(p: V3, sway: number, n: V3, lobeId: number, around: number, along: number, rad: number, ao: number, lobe: V3) {
    this.out.push(p[0], p[1], p[2], sway, n[0], n[1], n[2], lobeId, around, along, rad, ao, lobe[0], lobe[1], lobe[2], 0);
  }
  get count() { return this.out.length / BARK; }
}

const NO_LOBE: V3 = [0, 0, 0];

/**
 * A limb: a tube along `pts` (its radii `rad`), `sides` round, its sway rising from swayA to swayB along it, its last
 * rings in clump `lobeId` (so they move with it). `flare`: buttress roots at its foot (a trunk's).
 */
function tube(B: Bark, pts: V3[], rad: number[], sides: number, swayA: number, swayB: number, ao: [number, number], lobeId = -1, lobe = NO_LOBE, flare = 0, seed = 0) {
  const n = pts.length;
  // (parallel-transported frames: no twist along a bent limb)
  const T: V3[] = pts.map((_, i) => nrm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)])));
  let u = nrm(cross(T[0], Math.abs(T[0][1]) > 0.9 ? [1, 0, 0] : UP));
  const frames: [V3, V3][] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      // project the last u onto the plane normal to this tangent
      u = nrm(sub(u, mul(T[i], dot(u, T[i]))));
    }
    frames.push([u, cross(T[i], u)]);
  }
  let along = 0;
  const alongs = pts.map((p, i) => (i === 0 ? 0 : (along += len(sub(p, pts[i - 1])))));
  const ring = (i: number, k: number): { p: V3; n: V3 } => {
    const th = (k / sides) * Math.PI * 2;
    const [fu, fw] = frames[i];
    const d = add(mul(fu, Math.cos(th)), mul(fw, Math.sin(th)));
    let r = rad[i];
    if (flare > 0) {
      // (the roots: lobes round the foot, fading up the first metre or two)
      const f = Math.max(0, 1 - alongs[i] / (1.2 + rad[0] * 1.5));
      const lobes = Math.pow(0.5 + 0.5 * Math.cos(th * 5 + seed), 2.0);
      r *= 1 + flare * f * f * (0.35 + lobes);
    }
    return { p: add(pts[i], mul(d, r)), n: d };
  };
  for (let i = 0; i < n - 1; i++) {
    const t0 = i / (n - 1), t1 = (i + 1) / (n - 1);
    const s0 = swayA + (swayB - swayA) * t0, s1 = swayA + (swayB - swayA) * t1;
    const a0 = ao[0] + (ao[1] - ao[0]) * t0, a1 = ao[0] + (ao[1] - ao[0]) * t1;
    // (only the last ring moves with its clump)
    const l0 = -1, l1 = i + 1 === n - 1 ? lobeId : -1;
    for (let k = 0; k < sides; k++) {
      const p00 = ring(i, k), p01 = ring(i, k + 1), p10 = ring(i + 1, k), p11 = ring(i + 1, k + 1);
      const c0 = (k / sides) * Math.PI * 2 * rad[i], c1 = ((k + 1) / sides) * Math.PI * 2 * rad[i];
      const d0 = (k / sides) * Math.PI * 2 * rad[i + 1], d1 = ((k + 1) / sides) * Math.PI * 2 * rad[i + 1];
      const L0 = l0 >= 0 ? lobe : NO_LOBE, L1 = l1 >= 0 ? lobe : NO_LOBE;
      B.v(p00.p, s0, p00.n, l0, c0, alongs[i], rad[i], a0, L0);
      B.v(p01.p, s0, p01.n, l0, c1, alongs[i], rad[i], a0, L0);
      B.v(p11.p, s1, p11.n, l1, d1, alongs[i + 1], rad[i + 1], a1, L1);
      B.v(p00.p, s0, p00.n, l0, c0, alongs[i], rad[i], a0, L0);
      B.v(p11.p, s1, p11.n, l1, d1, alongs[i + 1], rad[i + 1], a1, L1);
      B.v(p10.p, s1, p10.n, l1, d0, alongs[i + 1], rad[i + 1], a1, L1);
    }
  }
}

/** points along a quadratic curve a → b bent through c, wobbling a little (gnarled), `segs` segments */
function curve(a: V3, c: V3, b: V3, segs: number, r: () => number, wobble: number): V3[] {
  const pts: V3[] = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = bez(a, c, b, t);
    if (i > 0 && i < segs) {
      const w = wobble * Math.sin(t * Math.PI);
      p[0] += (r() - 0.5) * w;
      p[1] += (r() - 0.5) * w * 0.5;
      p[2] += (r() - 0.5) * w;
    }
    pts.push(p);
  }
  return pts;
}

const taper = (a: number, b: number, n: number, pow = 1) => Array.from({ length: n }, (_, i) => a + (b - a) * Math.pow(i / (n - 1), pow));

// ------------------------------------------------------------------ the bark
let trunkEnd = 0;

function growBark(S: Species, B: Bark, lobes: Lobe[], C: Crown, r: () => number) {
  trunkEnd = 0;
  const h = S.h, tr = S.trunk;
  const seed = r() * 6.28;
  const shape: Shape = S.shape;
  if (shape === 'fern') return;
  if (shape === 'shrub') {
    lobes.forEach((L, i) => {
      const a = i * 1.7 + r();
      const foot: V3 = [Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12];
      const end: V3 = [L.c[0] * 0.7, L.c[1] * 0.8, L.c[2] * 0.7];
      tube(B, curve(foot, lerp(foot, end, 0.5), end, 3, r, 0.1), taper(0.05, 0.018, 4), 4, 0, 0.4, [0.3, 0.6], i, L.c);
    });
    return;
  }
  if (shape === 'column' || shape === 'cone') {
    const top: V3 = [0, h * 0.94, 0];
    const pts = curve([0, 0, 0], [0, h * 0.5, 0], top, 6, r, 0.08);
    tube(B, pts, taper(tr, tr * 0.08, pts.length, 0.8), 6, 0, 0.35, [0.35, 0.6], -1, NO_LOBE, 0.5, seed);
    trunkEnd = B.count;
    return;
  }
  // a trunk up to where it forks, leaning a little, gnarled, its roots flaring
  const forkY = { oak: 0.22, tiers: 0.24, weeping: 0.34, vase: 0.3, round: 0.26 }[shape] * h;
  const lean = shape === 'tiers' ? 0.12 * h : shape === 'weeping' ? 0.05 * h : (r() - 0.5) * 0.04 * h;
  const fork: V3 = [lean, forkY, (r() - 0.5) * 0.03 * h];
  const tpts = curve([0, 0, 0], [lean * 0.2, forkY * 0.5, 0], fork, 4, r, shape === 'oak' ? tr * 0.5 : tr * 0.25);
  tpts.unshift([0, -0.6, 0]);
  tube(B, tpts, [tr * 1.05, tr, tr * 0.96, tr * 0.92, tr * 0.88, tr * 0.86], 9, 0, 0.08, [0.45, 0.6], -1, NO_LOBE, shape === 'oak' ? 0.9 : 0.6, seed);
  trunkEnd = B.count;
  // the limbs: from the fork, one into each clump, out and then up (an oak's nearly level, a vase's steeply up, a
  // willow's rising and arching over)
  const maxR = Math.max(...lobes.map(L => L.r));
  const limbs = lobes.map((L, i) => ({ L, i })).filter(({ L }) => L.c[1] > forkY * 0.8);
  for (const { L, i } of limbs) {
    const outH: V3 = nrm([L.c[0] - fork[0] + 1e-3, 0, L.c[2] - fork[2]]);
    const reach = Math.hypot(L.c[0] - fork[0], L.c[2] - fork[2]);
    const rise = L.c[1] - fork[1];
    const start: V3 = add(fork, mul(outH, tr * 0.35));
    const end: V3 = lerp(fork, L.c, 0.8);
    let ctrl: V3;
    if (shape === 'oak' || shape === 'tiers') ctrl = add(fork, add(mul(outH, reach * 0.55), [0, rise * 0.15, 0]));
    else if (shape === 'weeping') ctrl = add(fork, add(mul(outH, reach * 0.2), [0, rise * 0.95, 0]));
    else if (shape === 'vase') ctrl = add(fork, add(mul(outH, reach * 0.3), [0, rise * 0.5, 0]));
    else ctrl = add(fork, add(mul(outH, reach * 0.4), [0, rise * 0.35, 0]));
    const k = Math.sqrt(L.r / maxR);
    const r0 = tr * (shape === 'oak' ? 0.62 : 0.55) * k, r1 = Math.max(0.06, tr * 0.12);
    const pts = curve(start, ctrl, end, shape === 'oak' ? 7 : 5, r, shape === 'oak' ? 0.9 : 0.35);
    tube(B, pts, taper(r0, r1, pts.length, 0.7), shape === 'oak' ? 7 : 6, 0.08, 0.55, [0.5, 0.75], i, L.c);
    // branches off the limb's outer half, into its clump's shell
    const nb = shape === 'oak' ? 4 : 3;
    for (let b = 0; b < nb; b++) {
      const t = 0.5 + 0.45 * r();
      const from = bez(start, ctrl, end, t);
      const { p: to } = shellPoint(L, r);
      const mid = add(lerp(from, to, 0.5), [0, (shape === 'weeping' ? 0.6 : 0.3) * L.r * 0.3, 0]);
      const bp = curve(from, mid, to, 3, r, 0.25);
      tube(B, bp, taper(r1 * 0.85, 0.02, bp.length), 4, 0.5, 0.85, [0.6, 0.8], i, L.c);
    }
  }
  void C;
}

// ------------------------------------------------------------------ the cards
function lobeCards(S: Species, C: Crown, lobes: Lobe[], r: () => number, n: number, cards: Card[]) {
  const meanR = lobes.reduce((s, L) => s + L.r, 0) / Math.max(1, lobes.length);
  for (let i = 0; i < n; i++) {
    const li = pickLobe(lobes, r, S.shape === 'cone' || S.shape === 'column' ? 1.6 : 2), L = lobes[li];
    const { p, dir } = shellPoint(L, r);
    const toSky = Math.min(1, S.toSky * (0.7 + 0.6 * r()));
    let cn = nrm(lerp(dir, UP, toSky));
    cn = nrm(add(cn, [(r() - 0.5) * 0.5, (r() - 0.5) * 0.5, (r() - 0.5) * 0.5]));
    const ref: V3 = Math.abs(cn[1]) > 0.9 ? [1, 0, 0] : UP;
    const spin = r() * Math.PI * 2, u0 = nrm(cross(cn, ref)), w0 = cross(cn, u0);
    const a = add(mul(u0, Math.cos(spin)), mul(w0, Math.sin(spin))), b = cross(cn, a);
    const sh = crownShade(C, L, p, cn);
    const s = S.card * (0.8 + 0.4 * r()) * Math.min(1.3, Math.max(0.7, Math.sqrt(L.r / meanR)));
    cards.push({
      c: p, a: mul(a, s), b: mul(b, s), n: sh.n, rank: r() * 0.65 + (1 - sh.ao) * 0.35, kind: 0, layer: S.leaf, seg: 0, segs: 1,
      sway: 0.5 + 0.5 * sh.out, ao: sh.ao, lobe: L.c, lobeW: li + Math.min(0.999, L.r / 16),
    });
  }
}

function flowerCards(S: Species, C: Crown, lobes: Lobe[], r: () => number, cards: Card[]) {
  const F = S.flowers!;
  for (let i = 0; i < F.n; i++) {
    const li = pickLobe(lobes, r), L = lobes[li];
    const { p, dir: o } = shellPoint(L, r, true);
    const s = F.size * (0.75 + 0.5 * r());
    const nn = nrm(add(o, [(r() - 0.5) * 0.5, 0.6, (r() - 0.5) * 0.5]));
    const ref: V3 = Math.abs(nn[1]) > 0.9 ? [1, 0, 0] : UP;
    const spin = r() * Math.PI * 2, u0 = nrm(cross(nn, ref)), w0 = cross(nn, u0);
    const a = add(mul(u0, Math.cos(spin)), mul(w0, Math.sin(spin)));
    const sh = crownShade(C, L, p, nn);
    cards.push({
      c: p, a: mul(a, s), b: mul(cross(nn, a), s), n: sh.n, rank: r() * 0.8 + (1 - sh.ao) * 0.2, kind: 1, layer: F.layer, seg: 0, segs: 1,
      sway: 0.55 + 0.45 * sh.out, ao: Math.max(0.75, sh.ao), lobe: L.c, lobeW: li + Math.min(0.999, L.r / 16),
    });
  }
}

/** a willow's curtain: strands hung from the crown's outer shell, bowing out a little and falling nearly to the
 *  ground; a strand is a chain of cards along it, all of one rank (kept or dropped together far off) */
function strandCards(S: Species, C: Crown, lobes: Lobe[], r: () => number, cards: Card[]) {
  const T = S.strands!;
  for (let i = 0; i < T.n; i++) {
    const li = pickLobe(lobes, r, 1.5), L = lobes[li];
    let dir: V3;
    let tries = 0;
    do {
      dir = nrm([r() * 2 - 1, r() * 1.1 - 0.45, r() * 2 - 1]);
      tries++;
    } while (tries < 20 && dot(nrm([dir[0], 0, dir[2]]), nrm([L.c[0] + 1e-3, 0, L.c[2]])) < -0.1 && len([L.c[0], 0, L.c[2]]) > L.r * 0.5);
    const at: V3 = [L.c[0] + dir[0] * L.r * 0.88, L.c[1] + dir[1] * L.r * L.flat * 0.88, L.c[2] + dir[2] * L.r * 0.88];
    const outH = nrm([at[0] + (r() - 0.5) * 0.5, 0, at[2] + (r() - 0.5) * 0.5]);
    const foot = 0.35 + 1.9 * r() * r();
    const drop = Math.max(1.5, at[1] - foot);
    const bow = Math.min(1.4, L.r * 0.18) * (0.5 + r());
    const pts: V3[] = [];
    for (let s = 0; s <= T.segs; s++) {
      const t = s / T.segs;
      pts.push(add(at, add(mul(outH, bow * Math.sin(t * Math.PI * 0.55)), [0, -drop * t, 0])));
    }
    const spin = (r() - 0.5) * 1.6;
    const side0 = nrm(cross(UP, outH));
    const side = nrm(add(mul(side0, Math.cos(spin)), mul(outH, Math.sin(spin))));
    const sh = crownShade(C, L, at, outH);
    const rank = r() * 0.7 + (1 - sh.ao) * 0.3;
    for (let s = 0; s < T.segs; s++) {
      const p0 = pts[s], p1 = pts[s + 1];
      const t = (s + 0.5) / T.segs;
      const w = T.width * (1 - 0.35 * t) * (0.8 + 0.4 * r());
      const face = nrm(cross(side, sub(p1, p0)));
      const n = nrm(add(add(mul(outH, 0.6), [0, 0.35, 0]), mul(face, dot(face, outH) >= 0 ? 0.25 : -0.25)));
      cards.push({
        c: lerp(p0, p1, 0.5), a: mul(side, w), b: mul(sub(p1, p0), 0.5), n, rank, kind: 2, layer: S.leaf === 3 ? 5 : S.leaf, seg: s, segs: T.segs,
        sway: 0.6 + 0.4 * t, ao: Math.min(1, sh.ao * 0.8 + 0.25 + 0.15 * t), lobe: at, lobeW: -(1 + i),
      });
    }
  }
}

/** a fern's fronds: rising from its heart and arching out, a strip of cards each */
function frondCards(S: Species, r: () => number, cards: Card[]) {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = i * 2.39996 + r() * 0.5;
    const tilt = 0.3 + 0.8 * r();
    const L = S.r * (0.75 + 0.35 * r());
    const dir: V3 = [Math.cos(a), 0, Math.sin(a)];
    const pts: V3[] = [];
    const segs = 4;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      const out = L * t * Math.cos(tilt);
      const y = 0.05 + L * t * Math.sin(tilt) * 1.3 - L * 0.55 * t * t;
      pts.push([dir[0] * out, Math.max(0.03, y), dir[2] * out]);
    }
    const side = nrm(cross(dir, UP));
    for (let s = 0; s < segs; s++) {
      const p0 = pts[s], p1 = pts[s + 1];
      const t = (s + 0.5) / segs;
      const w = 0.24 * (0.5 + 0.8 * Math.sin(Math.PI * Math.min(1, t * 1.1 + 0.1)));
      cards.push({
        c: lerp(p0, p1, 0.5), a: mul(side, w), b: mul(sub(p1, p0), 0.5), n: nrm([dir[0] * 0.3, 1, dir[2] * 0.3]), rank: r(), kind: 3, layer: S.leaf, seg: s, segs,
        sway: 0.3 + 0.6 * t, ao: 0.55 + 0.4 * t, lobe: [0, 0, 0], lobeW: -1,
      });
    }
  }
}

function lanternPoints(S: Species, lobes: Lobe[], r: () => number): number[] {
  const out: number[] = [];
  const n = S.lanterns ?? 0;
  // (the lower clumps first: lanterns hang under the crown, over where people walk)
  const order = lobes.map((L, i) => ({ L, i })).sort((a, b) => a.L.c[1] - b.L.c[1]);
  for (let k = 0; k < n; k++) {
    const { L } = order[Math.floor(Math.pow(r(), 1.6) * order.length)];
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * L.r * 0.7;
    const y = Math.max(2.2, L.c[1] - L.r * L.flat * (0.6 + 0.2 * r()) - (0.2 + 0.8 * r()));
    out.push(L.c[0] + Math.cos(a) * d, y, L.c[2] + Math.sin(a) * d, 0.09 + 0.06 * r());
  }
  return out;
}

function emitCards(cards: Card[]): { data: Float32Array; far: number } {
  // (by rank; a strand's cards share theirs and stay together)
  cards.sort((x, y) => x.rank - y.rank || x.seg - y.seg);
  const data = new Float32Array(cards.length * CARD);
  cards.forEach((c, i) => {
    const o = i * CARD;
    const rank = (i + 0.5) / cards.length;
    data.set([c.c[0], c.c[1], c.c[2], c.kind * 1024 + c.layer * 64 + c.seg * 8 + c.segs], o);
    data.set([c.a[0], c.a[1], c.a[2], rank], o + 4);
    data.set([c.b[0], c.b[1], c.b[2], c.sway], o + 8);
    data.set([c.n[0], c.n[1], c.n[2], c.ao], o + 12);
    data.set([c.lobe[0], c.lobe[1], c.lobe[2], c.lobeW], o + 16);
  });
  // the far level: the first third, rounded to a whole strand
  let far = Math.ceil(cards.length / 3);
  while (far < cards.length && cards[far].kind === 2 && cards[far].seg !== 0) far++;
  return { data, far };
}

export function grow(S: Species, seed: number): Grown {
  const r = rng(seed * 7919 + 13);
  const { C, lobes } = crownLobes(S, r);
  const B = new Bark();
  growBark(S, B, lobes, C, r);
  const cards: Card[] = [];
  if (S.shape === 'fern') frondCards(S, r, cards);
  else {
    lobeCards(S, C, lobes, r, S.cards, cards);
    if (S.flowers) flowerCards(S, C, lobes, r, cards);
    if (S.strands) strandCards(S, C, lobes, r, cards);
  }
  const { data, far } = emitCards(cards);
  // the bounding sphere round (0, cy, 0)
  const cy = S.h * 0.5;
  let rad = 0;
  for (let i = 0; i < cards.length; i++) {
    const o = i * CARD, ext = Math.hypot(data[o + 4], data[o + 5], data[o + 6]) + Math.hypot(data[o + 8], data[o + 9], data[o + 10]);
    rad = Math.max(rad, Math.hypot(data[o], data[o + 1] - cy, data[o + 2]) + ext);
  }
  for (let i = 0; i < B.count; i++) {
    const o = i * BARK;
    rad = Math.max(rad, Math.hypot(B.out[o], B.out[o + 1] - cy, B.out[o + 2]));
  }
  return {
    name: S.name,
    cards: data,
    cardCount: cards.length,
    farCards: far,
    bark: new Float32Array(B.out),
    barkCount: B.count,
    trunkVerts: trunkEnd,
    lanterns: new Float32Array(lanternPoints(S, lobes, r)),
    crown: [C.mid[1], Math.max(C.ext[0], C.ext[1]) * 0.85],
    bound: [cy, rad * 1.08 + 1],
  };
}

/** every kind, grown (the worker's job) */
export function growAll(): Grown[] {
  return SPECIES.map((S, i) => grow(S, 101 + i * 37));
}
