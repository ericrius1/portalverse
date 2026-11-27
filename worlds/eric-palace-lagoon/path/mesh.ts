/**
 * Procedural WebGPU geometry for the Palace Lagoon's boardwalk-over-water and trippy ascending celestial sky-path.
 *
 * Earth-style boardwalk (`robolab/jamwalk.ts` craft):
 *   - Individual weathered teak planks with subtle per-board grain/silver tone variation
 *   - Dark teak side fascia, transverse cross-beams, and slim timber piles into the lagoon with brass waterline collars
 *   - Brass handrails, twin bronze tension cables, dark teak posts with gilt finial caps
 *   - Hanging washi paper lanterns on curved brass crooks with tiny solar tiles atop the posts
 *   - Moss cushions at post feet, curling ivy vines along the rails, and terracotta entry pots with greenery & reeds
 *
 * Trippy celestial ascent inside the rotunda:
 *   - Inlaid 8-point Arabic star compass medallion at the entry plaza and octagonal celestial sky balcony at the summit
 *   - Luminous beveled celestial walkway slabs with burnished gold trim and procedural girih light-veins
 *   - 11 floating pointed Moorish/Islamic ogee rib-arches soaring overhead along the spiral with floating star finials
 *   - Openwork brass filigree side railings with glowing turquoise-gold orb finials & suspended glowing keel spine
 *
 * Packed to 8 u32 words (32 bytes) per vertex:
 *   [x, y, z, u, v, octNormal(2x16snorm), rgba8(r,g,b,mat), meta(f32)]
 */
import { separateCoplanar } from '@ericrius1/weft/coplanar';
import { WATER_Y, lagoonSdf } from '../layout';
import {
  BOARDWALK_RANGE,
  ENTRY_PLAZA,
  PATH_FRAMES,
  SPIRAL_RANGE,
  SUMMIT_DECK,
  SUMMIT_RANGE,
  type PathFrame,
  type RoundDeck,
  type V3,
} from './curve';

export const PATH_MAT = {
  WOOD: 0,
  BRASS: 1,
  WASHI: 2,
  FOLIAGE: 3,
  TERRACOTTA: 4,
  CELESTIAL: 5,
  GLOW: 6,
  INLAY: 7,
} as const;

export interface PathLantern {
  pos: V3;
  phase: number;
  scale: number;
  tint: V3;
}

export interface PathMeshData {
  verts: ArrayBuffer;
  indices: Uint32Array;
  count: number;
  lanterns: PathLantern[];
}

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function octEncode(x: number, y: number, z: number): number {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = y / l;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  const su = Math.round(Math.max(-1, Math.min(1, u)) * 32767) & 0xffff;
  const sv = Math.round(Math.max(-1, Math.min(1, v)) * 32767) & 0xffff;
  return (su | (sv << 16)) >>> 0;
}

function packColorMat(c: V3, mat: number): number {
  const r = Math.round(Math.max(0, Math.min(1, c[0])) * 255);
  const g = Math.round(Math.max(0, Math.min(1, c[1])) * 255);
  const b = Math.round(Math.max(0, Math.min(1, c[2])) * 255);
  return (r | (g << 8) | (b << 16) | ((mat & 255) << 24)) >>> 0;
}

const norm3 = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

class Builder {
  private verts: number[] = [];
  private vWords: number[] = [];
  private idx: number[] = [];
  private nv = 0;

  pushVert(p: V3, n: V3, u: number, v: number, col: V3, mat: number, meta = 0): number {
    const id = this.nv++;
    this.verts.push(p[0], p[1], p[2], u, v);
    this.vWords.push(octEncode(n[0], n[1], n[2]), packColorMat(col, mat), meta);
    return id;
  }

  quad(a: V3, b: V3, c: V3, d: V3, n: V3, col: V3, mat: number, u0 = 0, u1 = 1, v0 = 0, v1 = 1, meta = 0): void {
    const i0 = this.pushVert(a, n, u0, v0, col, mat, meta);
    const i1 = this.pushVert(b, n, u1, v0, col, mat, meta);
    const i2 = this.pushVert(c, n, u1, v1, col, mat, meta);
    const i3 = this.pushVert(d, n, u0, v1, col, mat, meta);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }

  /** Solid box-like board from top quad (a,b,c,d) extruded down by `thick`. `capStart`/`capEnd` control a-b and c-d ends. */
  board(
    a: V3, b: V3, c: V3, d: V3, thick: number, col: V3, mat: number,
    u0 = 0, u1 = 1, v0 = 0, v1 = 1, meta = 0, capStart = true, capEnd = true,
  ): void {
    const e1: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2: V3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nt = norm3(cross3(e1, e2));
    if (nt[1] < 0) nt = [-nt[0], -nt[1], -nt[2]];
    const dn = (p: V3): V3 => [p[0], p[1] - thick, p[2]];
    const a2 = dn(a), b2 = dn(b), c2 = dn(c), d2 = dn(d);
    this.quad(a, b, c, d, nt, col, mat, u0, u1, v0, v1, meta);
    this.quad(d2, c2, b2, a2, [-nt[0], -nt[1], -nt[2]], col, mat, u0, u1, v0, v1, meta);
    const side = (p: V3, q: V3, p2: V3, q2: V3) => {
      const ex = q[0] - p[0], ez = q[2] - p[2];
      const nSide = norm3([ez, 0, -ex]);
      this.quad(p, q, q2, p2, nSide, col, mat, 0, 1, 0, 1, meta);
    };
    if (capStart) side(a, b, a2, b2);
    side(b, c, b2, c2);
    if (capEnd) side(c, d, c2, d2);
    side(d, a, d2, a2);
  }

  /** Tapered cylinder between a and b (`caps`: true = both, false = none, 'top' = top cap only). */
  cyl(a: V3, b: V3, r0: number, r1: number, seg: number, col: V3, mat: number, caps: boolean | 'top' = true, meta = 0): void {
    const axis: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(axis[0], axis[1], axis[2]);
    if (len < 1e-5) return;
    const d: V3 = [axis[0] / len, axis[1] / len, axis[2] / len];
    const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm3(cross3(d, ref));
    const v = norm3(cross3(d, u));
    const ringA: number[] = [];
    const ringB: number[] = [];
    for (let i = 0; i < seg; i++) {
      const ang = (i / seg) * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const n: V3 = [u[0] * ca + v[0] * sa, u[1] * ca + v[1] * sa, u[2] * ca + v[2] * sa];
      const pa: V3 = [a[0] + n[0] * r0, a[1] + n[1] * r0, a[2] + n[2] * r0];
      const pb: V3 = [b[0] + n[0] * r1, b[1] + n[1] * r1, b[2] + n[2] * r1];
      ringA.push(this.pushVert(pa, n, i / seg, 0, col, mat, meta));
      ringB.push(this.pushVert(pb, n, i / seg, 1, col, mat, meta));
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      this.idx.push(ringA[i], ringA[j], ringB[j], ringA[i], ringB[j], ringB[i]);
    }
    if (caps === true) {
      const ca = this.pushVert(a, [-d[0], -d[1], -d[2]], 0.5, 0.5, col, mat, meta);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.idx.push(ca, ringA[j], ringA[i]);
      }
    }
    if (caps === true || caps === 'top') {
      const cb = this.pushVert(b, d, 0.5, 0.5, col, mat, meta);
      for (let i = 0; i < seg; i++) {
        const j = (i + 1) % seg;
        this.idx.push(cb, ringB[i], ringB[j]);
      }
    }
  }

  /** Smooth tube along a polyline. */
  tube(pts: V3[], r: number, seg: number, col: V3, mat: number, meta = 0): void {
    for (let i = 0; i + 1 < pts.length; i++) {
      this.cyl(pts[i], pts[i + 1], r, r, seg, col, mat, false, meta);
    }
  }

  /** Low-poly ellipsoid (for moss, shrubs, blooms, lantern globes). */
  ellipsoid(c: V3, rx: number, ry: number, rz: number, seg: number, rings: number, col: V3, mat: number, meta = 0): void {
    const grid: number[][] = [];
    for (let r = 0; r <= rings; r++) {
      const phi = (r / rings - 0.5) * Math.PI;
      const cp = Math.cos(phi), sp = Math.sin(phi);
      const row: number[] = [];
      for (let s = 0; s < seg; s++) {
        const th = (s / seg) * Math.PI * 2;
        const ct = Math.cos(th), st = Math.sin(th);
        const nx = cp * ct, ny = sp, nz = cp * st;
        const p: V3 = [c[0] + nx * rx, c[1] + ny * ry, c[2] + nz * rz];
        row.push(this.pushVert(p, norm3([nx / rx, ny / ry, nz / rz]), s / seg, r / rings, col, mat, meta));
      }
      grid.push(row);
    }
    for (let r = 0; r < rings; r++) {
      for (let s = 0; s < seg; s++) {
        const sn = (s + 1) % seg;
        const a = grid[r][s], b = grid[r][sn], d = grid[r + 1][s], e = grid[r + 1][sn];
        if (r > 0) this.idx.push(a, b, e);
        if (r + 1 < rings) this.idx.push(a, e, d);
      }
    }
  }

  finish(lanterns: PathLantern[]): PathMeshData {
    const out = new ArrayBuffer(this.nv * 32);
    const f = new Float32Array(out);
    const u = new Uint32Array(out);
    for (let i = 0; i < this.nv; i++) {
      const vo = i * 5;
      const wo = i * 3;
      const b = i * 8;
      f[b] = this.verts[vo];
      f[b + 1] = this.verts[vo + 1];
      f[b + 2] = this.verts[vo + 2];
      f[b + 3] = this.verts[vo + 3];
      f[b + 4] = this.verts[vo + 4];
      u[b + 5] = this.vWords[wo];
      u[b + 6] = this.vWords[wo + 1];
      f[b + 7] = this.vWords[wo + 2];
    }
    const indices = new Uint32Array(this.idx);
    // Guarantee zero coplanar z-fighting across inlays, planks, moldings, and rims via weft's coplanar solver.
    separateCoplanar(f, indices, { stride: 8, offset: 0, eps: 0.003 });
    return { verts: out, indices, count: indices.length, lanterns };
  }
}

// ---- Palette (matching Earth's jamwalk.ts + gilded Arabic celadon/lapis/gold)
const TEAK: V3 = [0.36, 0.25, 0.16];
const DARK_TEAK: V3 = [0.19, 0.13, 0.09];
const PILE_WOOD: V3 = [0.17, 0.13, 0.10];
const BRASS: V3 = [0.76, 0.56, 0.24];
const GILT: V3 = [0.92, 0.72, 0.30];
const BRONZE: V3 = [0.34, 0.24, 0.15];
const WASHI_COL: V3 = [1.0, 0.80, 0.48];
const SOLAR_GLASS: V3 = [0.05, 0.08, 0.14];
const MOSS: V3 = [0.10, 0.24, 0.07];
const IVY: V3 = [0.08, 0.20, 0.06];
const LEAF: V3 = [0.14, 0.30, 0.08];
const BLOOM_A: V3 = [0.95, 0.44, 0.12];
const BLOOM_B: V3 = [0.58, 0.35, 0.92];
const TERRACOTTA: V3 = [0.56, 0.24, 0.13];
const TRAVERTINE: V3 = [0.78, 0.68, 0.54];
const TURQUOISE: V3 = [0.10, 0.68, 0.72];
const LAPIS: V3 = [0.07, 0.15, 0.46];
const GOLD_GLOW: V3 = [1.0, 0.80, 0.36];
const CYAN_GLOW: V3 = [0.22, 0.92, 0.95];

function plankColor(R: () => number): V3 {
  const k = 0.84 + 0.28 * R();
  let c: V3 = [TEAK[0] * k * (1 + 0.06 * (R() - 0.5)), TEAK[1] * k, TEAK[2] * k * (1 + 0.12 * (R() - 0.5))];
  if (R() < 0.16) {
    const s = 0.25 + 0.25 * R();
    c = [c[0] + (0.42 - c[0]) * s, c[1] + (0.39 - c[1]) * s, c[2] + (0.35 - c[2]) * s];
  }
  return c;
}

const ptAt = (f: PathFrame, sideOffset: number, dy = 0): V3 => [
  f.p[0] + f.n[0] * sideOffset,
  f.p[1] + dy,
  f.p[2] + f.n[1] * sideOffset,
];

function lerpFrame(a: PathFrame, b: PathFrame, t: number): PathFrame {
  const tx = a.t[0] + (b.t[0] - a.t[0]) * t;
  const tz = a.t[1] + (b.t[1] - a.t[1]) * t;
  const l = Math.hypot(tx, tz) || 1;
  return {
    p: [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, a.p[2] + (b.p[2] - a.p[2]) * t],
    t: [tx / l, tz / l],
    n: [-tz / l, tx / l],
    halfW: a.halfW + (b.halfW - a.halfW) * t,
    s: a.s + (b.s - a.s) * t,
    celestial: a.celestial + (b.celestial - a.celestial) * t,
    section: a.section,
  };
}

function addShrub(m: Builder, R: () => number, p: V3, size = 1): void {
  const cols = [LEAF, IVY, MOSS];
  const n = 4 + Math.floor(R() * 3);
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2, d = R() * 0.18 * size, r = (0.06 + 0.06 * R()) * size;
    m.ellipsoid([p[0] + Math.cos(a) * d, p[1] + r * 0.55 + R() * 0.14 * size, p[2] + Math.sin(a) * d], r * 1.35, r * 0.65, r * 1.15, 6, 3, cols[(R() * 3) | 0], PATH_MAT.FOLIAGE);
  }
  const f = 1 + Math.floor(R() * 2);
  for (let k = 0; k < f; k++) {
    const a = R() * Math.PI * 2, d = 0.06 + R() * 0.12 * size;
    m.ellipsoid([p[0] + Math.cos(a) * d, p[1] + 0.14 * size + R() * 0.1 * size, p[2] + Math.sin(a) * d], 0.032, 0.032, 0.032, 5, 3, R() < 0.55 ? BLOOM_A : BLOOM_B, PATH_MAT.FOLIAGE);
  }
}

function addReeds(m: Builder, R: () => number, p: V3, n = 5): void {
  for (let k = 0; k < n; k++) {
    const a = R() * Math.PI * 2, d = R() * 0.1, h = 0.55 + R() * 0.45, lean = 0.06 + R() * 0.12, b = R() * Math.PI * 2;
    const foot: V3 = [p[0] + Math.cos(a) * d, p[1], p[2] + Math.sin(a) * d];
    const tip: V3 = [foot[0] + Math.cos(b) * lean, p[1] + h, foot[2] + Math.sin(b) * lean];
    m.cyl(foot, tip, 0.008, 0.004, 4, LEAF, PATH_MAT.FOLIAGE, false);
    m.ellipsoid([tip[0], tip[1] + 0.03, tip[2]], 0.016, 0.038, 0.016, 5, 3, [0.58, 0.48, 0.24], PATH_MAT.FOLIAGE);
  }
}

function addWashiLantern(m: Builder, lanterns: PathLantern[], base: V3, out: [number, number], phase: number): void {
  const [x, y, z] = base;
  const [ox, oz] = out;
  // Teak post
  m.cyl([x, y - 0.04, z], [x, y + 1.56, z], 0.036, 0.030, 6, DARK_TEAK, PATH_MAT.WOOD);
  // Curved brass crook hanging out over the water
  const crook: V3[] = [
    [x, y + 1.46, z],
    [x + ox * 0.12, y + 1.64, z + oz * 0.12],
    [x + ox * 0.28, y + 1.66, z + oz * 0.28],
    [x + ox * 0.36, y + 1.54, z + oz * 0.36],
  ];
  m.tube(crook, 0.012, 5, BRASS, PATH_MAT.BRASS);
  const lc: V3 = [x + ox * 0.36, y + 1.24, z + oz * 0.36];
  m.cyl([lc[0], y + 1.54, lc[2]], [lc[0], lc[1] + 0.18, lc[2]], 0.004, 0.004, 4, BRASS, PATH_MAT.BRASS, false);
  // Washi paper lantern globe + brass top/bottom rings
  m.ellipsoid(lc, 0.14, 0.19, 0.14, 10, 6, WASHI_COL, PATH_MAT.WASHI, phase);
  m.cyl([lc[0], lc[1] + 0.17, lc[2]], [lc[0], lc[1] + 0.20, lc[2]], 0.075, 0.055, 8, BRASS, PATH_MAT.BRASS);
  m.cyl([lc[0], lc[1] - 0.20, lc[2]], [lc[0], lc[1] - 0.17, lc[2]], 0.055, 0.075, 8, BRASS, PATH_MAT.BRASS);
  // Miniature solar tile atop post in gilt frame (signature Earth jamwalk touch!)
  const ty = y + 1.60;
  m.board(
    [x - 0.11, ty, z - 0.08], [x + 0.11, ty, z - 0.08],
    [x + 0.11, ty + 0.04, z + 0.08], [x - 0.11, ty + 0.04, z + 0.08],
    0.014, GILT, PATH_MAT.BRASS,
  );
  m.quad(
    [x - 0.095, ty + 0.005, z - 0.065], [x + 0.095, ty + 0.005, z - 0.065],
    [x + 0.095, ty + 0.044, z + 0.065], [x - 0.095, ty + 0.044, z + 0.065],
    norm3([0, 0.96, -0.25]), SOLAR_GLASS, PATH_MAT.BRASS,
  );
  lanterns.push({ pos: lc, phase, scale: 1.0, tint: [1.0, 0.68, 0.34] });
}

/** Circular/octagonal inlaid Arabic 8-point star medallion plaza. */
function buildStarDeck(m: Builder, R: () => number, deck: RoundDeck, lanterns: PathLantern[]): void {
  const { x, y, z, r, celestial } = deck;
  const seg = celestial > 0.5 ? 8 : 36;
  const deckMat = celestial > 0.5 ? PATH_MAT.CELESTIAL : PATH_MAT.WOOD;
  const rimCol = celestial > 0.5 ? GILT : DARK_TEAK;
  const rimMat = celestial > 0.5 ? PATH_MAT.BRASS : PATH_MAT.WOOD;

  // Main circular/octagonal deck body
  m.cyl([x, y - 0.22, z], [x, y, z], r, r, seg, celestial > 0.5 ? LAPIS : TEAK, deckMat, true, celestial);
  // Outer bevelled rim (closed ring: omit radial interior end-caps between consecutive rim boards)
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2 + (celestial > 0.5 ? Math.PI / 8 : 0);
    const a1 = ((k + 1) / seg) * Math.PI * 2 + (celestial > 0.5 ? Math.PI / 8 : 0);
    const P = (a: number, rad: number, dy: number): V3 => [x + Math.cos(a) * rad, y + dy, z + Math.sin(a) * rad];
    m.board(P(a0, r - 0.24, 0.008), P(a1, r - 0.24, 0.008), P(a1, r + 0.04, 0.008), P(a0, r + 0.04, 0.008), 0.14, rimCol, rimMat, 0, 1, 0, 1, 0, false, false);
    // Luminous ring under lip
    m.cyl(P(a0, r - 0.06, -0.22), P(a1, r - 0.06, -0.22), 0.022, 0.022, 5, celestial > 0.5 ? CYAN_GLOW : GOLD_GLOW, PATH_MAT.GLOW, false, k * 0.4);
  }

  // Travertine & turquoise Arabic 8-point Rub el Hizb star rosette inlaid at center (top caps only: no coplanar undersides)
  const my = y + 0.014;
  m.cyl([x, y, z], [x, my, z], r * 0.52, r * 0.52, 32, TRAVERTINE, PATH_MAT.INLAY, 'top');
  m.cyl([x, my, z], [x, my + 0.008, z], r * 0.44, r * 0.44, 16, TURQUOISE, PATH_MAT.INLAY, 'top');
  // Two rotated gilt squares forming an 8-point Islamic star
  const sr = r * 0.42;
  for (const rot of [0, Math.PI / 4]) {
    const pts: V3[] = [0, 1, 2, 3].map(k => {
      const a = rot + (k * Math.PI) / 2;
      return [x + Math.cos(a) * sr, my + 0.014, z + Math.sin(a) * sr];
    });
    for (let k = 0; k < 4; k++) {
      m.cyl(pts[k], pts[(k + 1) % 4], 0.028, 0.028, 5, GILT, PATH_MAT.BRASS, false);
    }
  }
  // 16 gilded star rays + glowing heart
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    const len = k % 2 === 0 ? r * 0.48 : r * 0.34;
    const ax = Math.cos(a), az = Math.sin(a);
    m.cyl([x + ax * 0.22, my + 0.016, z + az * 0.22], [x + ax * len, my + 0.016, z + az * len], 0.022, 0.008, 4, k % 2 === 0 ? GILT : BRASS, PATH_MAT.BRASS, false);
  }
  m.cyl([x, my + 0.008, z], [x, my + 0.022, z], 0.26, 0.22, 16, GILT, PATH_MAT.BRASS, 'top');
  m.ellipsoid([x, my + 0.026, z], 0.14, 0.03, 0.14, 12, 4, celestial > 0.5 ? CYAN_GLOW : GOLD_GLOW, PATH_MAT.GLOW, 1.0);

  // Corner glowing orb posts on the summit celestial balcony
  if (celestial > 0.5) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
      // Leave the south opening (-Z, heading into the final arch) and east/west spiral entry open
      if (Math.sin(a) < -0.55) continue;
      if (Math.cos(a) > 0.72 && Math.sin(a) > -0.25) continue;
      const px = x + Math.cos(a) * (r - 0.14);
      const pz = z + Math.sin(a) * (r - 0.14);
      m.cyl([px, y, pz], [px, y + 1.05, pz], 0.032, 0.024, 6, BRASS, PATH_MAT.BRASS);
      m.ellipsoid([px, y + 1.12, pz], 0.075, 0.075, 0.075, 8, 5, k % 2 === 0 ? GOLD_GLOW : CYAN_GLOW, PATH_MAT.GLOW, k * 0.7);
      if (k % 2 === 0) {
        lanterns.push({ pos: [px, y + 1.12, pz], phase: k * 1.1, scale: 0.75, tint: [0.35, 0.92, 1.0] });
      }
    }
  } else {
    // Low moss accents around the entry plaza's rim
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.4;
      if (Math.abs(Math.cos(a)) < 0.45) continue;
      m.ellipsoid([x + Math.cos(a) * (r - 0.25), y + 0.04, z + Math.sin(a) * (r - 0.25)], 0.16, 0.06, 0.14, 6, 3, MOSS, PATH_MAT.FOLIAGE);
    }
  }
  void R;
}

/** Floating pointed Moorish / Islamic ogee golden rib-arch spanning over the ascending celestial sky-path. */
function buildCelestialArch(m: Builder, f: PathFrame, lanterns: PathLantern[], archIdx: number): void {
  const hw = f.halfW + 0.16;
  const h = 4.55;
  const steps = 16;
  const leftPts: V3[] = [];
  const rightPts: V3[] = [];
  const innerLeft: V3[] = [];
  const innerRight: V3[] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    // Pointed Moorish horseshoe-ogee profile: bows subtly outward near mid-height, curves cleanly to a pointed apex
    const sway = Math.sin(t * Math.PI) * 0.26 * (1 - t);
    const xOff = hw * (1 - Math.pow(t, 1.55)) + sway;
    const yOff = h * Math.sin(t * Math.PI * 0.5) + 0.35 * Math.pow(t, 3);
    leftPts.push(ptAt(f, -xOff, yOff));
    rightPts.push(ptAt(f, xOff, yOff));
    // Secondary inner luminous rib slightly inset
    innerLeft.push(ptAt(f, -Math.max(0, xOff - 0.14), Math.max(0.2, yOff - 0.14)));
    innerRight.push(ptAt(f, Math.max(0, xOff - 0.14), Math.max(0.2, yOff - 0.14)));
  }

  m.tube(leftPts, 0.055, 6, GILT, PATH_MAT.BRASS);
  m.tube(rightPts, 0.055, 6, GILT, PATH_MAT.BRASS);
  m.tube(innerLeft, 0.022, 4, archIdx % 2 === 0 ? CYAN_GLOW : GOLD_GLOW, PATH_MAT.GLOW, archIdx * 0.9);
  m.tube(innerRight, 0.022, 4, archIdx % 2 === 0 ? CYAN_GLOW : GOLD_GLOW, PATH_MAT.GLOW, archIdx * 0.9 + 0.3);

  // Delicate radial filigree struts connecting outer & inner arch ribs
  for (let i = 3; i < steps; i += 3) {
    m.cyl(leftPts[i], innerLeft[i], 0.014, 0.014, 4, BRASS, PATH_MAT.BRASS, false);
    m.cyl(rightPts[i], innerRight[i], 0.014, 0.014, 4, BRASS, PATH_MAT.BRASS, false);
  }

  // Crown jewel finial orb at the ogee apex
  const apex = ptAt(f, 0, h + 0.42);
  m.ellipsoid(apex, 0.11, 0.16, 0.11, 8, 5, archIdx % 2 === 0 ? GOLD_GLOW : CYAN_GLOW, PATH_MAT.GLOW, archIdx * 1.3);
  lanterns.push({
    pos: apex,
    phase: archIdx * 1.3,
    scale: 0.9,
    tint: archIdx % 2 === 0 ? [1.0, 0.78, 0.35] : [0.25, 0.92, 0.95],
  });
}

let cached: PathMeshData | null = null;

/** Build the complete boardwalk + celestial sky-path mesh once per session. */
export function buildPathMesh(): PathMeshData {
  if (cached) return cached;
  const R = rng(20261126);
  const m = new Builder();
  const lanterns: PathLantern[] = [];

  // ====================================================================
  // 1. EARTH-STYLE TEAK BOARDWALK OVER THE WATER + THROUGH NORTH ARCH
  // ====================================================================
  const [bw0, bw1] = BOARDWALK_RANGE;
  const plankStep = 0.20;
  for (let i = bw0; i < bw1; i++) {
    const fa = PATH_FRAMES[i];
    const fb = PATH_FRAMES[i + 1];
    const segLen = Math.hypot(fb.p[0] - fa.p[0], fb.p[1] - fa.p[1], fb.p[2] - fa.p[2]);
    const nPlanks = Math.max(1, Math.round(segLen / plankStep));
    for (let k = 0; k < nPlanks; k++) {
      const u0 = k / nPlanks;
      const u1 = (k + 0.92) / nPlanks;
      const a = lerpFrame(fa, fb, u0);
      const b = lerpFrame(fa, fb, u1);
      // Stop planks cleanly at entry plaza's rim
      if (Math.hypot(b.p[0] - ENTRY_PLAZA.x, b.p[2] - ENTRY_PLAZA.z) < ENTRY_PLAZA.r - 0.15) continue;
      m.board(
        ptAt(a, -a.halfW), ptAt(a, a.halfW),
        ptAt(b, b.halfW), ptAt(b, -b.halfW),
        0.048, plankColor(R), PATH_MAT.WOOD, 0, 1, a.s * 0.1, b.s * 0.1,
      );
    }

    // Dark teak side fascia boards & water-crossing piles/beams (omit interior cross-section end-caps)
    if (fa.p[2] > 18.6) {
      const prevHasFascia = i > bw0 && PATH_FRAMES[i - 1].p[2] > 18.6;
      const nextHasFascia = i + 1 < bw1 && fb.p[2] > 18.6;
      for (const sd of [-1, 1] as const) {
        m.board(
          ptAt(fa, sd * (fa.halfW - 0.01), -0.025), ptAt(fa, sd * (fa.halfW + 0.03), -0.025),
          ptAt(fb, sd * (fb.halfW + 0.03), -0.025), ptAt(fb, sd * (fb.halfW - 0.01), -0.025),
          0.19, DARK_TEAK, PATH_MAT.WOOD, 0, 1, 0, 1, 0, !prevHasFascia, !nextHasFascia,
        );
      }
    }
  }

  // Piles with brass waterline collars & cross-beams across the reflecting cove
  let nextPileS = 2.6;
  for (let i = bw0; i < bw1; i++) {
    const f = PATH_FRAMES[i];
    if (f.p[2] < 19.3 || f.p[2] > 32.8) continue;
    if (f.s < nextPileS) continue;
    nextPileS = f.s + 2.35;
    const beamY = f.p[1] - 0.055;
    const lEnd = ptAt(f, -f.halfW + 0.04, beamY - f.p[1]);
    const rEnd = ptAt(f, f.halfW - 0.04, beamY - f.p[1]);
    m.board(
      [lEnd[0] - f.t[0] * 0.06, beamY, lEnd[2] - f.t[1] * 0.06],
      [lEnd[0] + f.t[0] * 0.06, beamY, lEnd[2] + f.t[1] * 0.06],
      [rEnd[0] + f.t[0] * 0.06, beamY, rEnd[2] + f.t[1] * 0.06],
      [rEnd[0] - f.t[0] * 0.06, beamY, rEnd[2] - f.t[1] * 0.06],
      0.15, PILE_WOOD, PATH_MAT.WOOD,
    );
    for (const sd of [-1, 1] as const) {
      const pp = ptAt(f, sd * (f.halfW - 0.16), 0);
      const inLagoon = lagoonSdf(pp[0], pp[2]) < 1.2;
      m.cyl([pp[0], WATER_Y - 1.5, pp[2]], [pp[0], beamY - 0.12, pp[2]], 0.088, 0.082, 8, PILE_WOOD, PATH_MAT.WOOD);
      if (inLagoon) {
        m.cyl([pp[0], WATER_Y - 0.08, pp[2]], [pp[0], WATER_Y + 0.08, pp[2]], 0.10, 0.10, 8, BRASS, PATH_MAT.BRASS, false);
      }
    }
  }

  // Boardwalk railings (brass handrail + 2 bronze cables + teak posts with gilt finials + moss + ivy + washi lanterns)
  const railFrames = PATH_FRAMES.slice(bw0, bw1 + 1).filter(f => f.p[2] >= 19.2 && f.p[2] <= 32.8);
  for (const sd of [-1, 1] as const) {
    const rOff = sd * (railFrames[0].halfW - 0.08);
    const topPts = railFrames.map(f => ptAt(f, rOff, 0.94));
    m.tube(topPts, 0.028, 6, BRASS, PATH_MAT.BRASS);
    for (const h of [0.35, 0.65]) {
      m.tube(railFrames.map(f => ptAt(f, rOff, h)), 0.008, 4, BRONZE, PATH_MAT.BRASS);
    }
    let nextPostS = railFrames[0].s;
    let postIdx = 0;
    for (let i = 0; i < railFrames.length; i++) {
      const f = railFrames[i];
      if (f.s + 1e-4 >= nextPostS || i === railFrames.length - 1) {
        const foot = ptAt(f, rOff, 0);
        m.cyl([foot[0], foot[1] - 0.03, foot[2]], [foot[0], foot[1] + 0.96, foot[2]], 0.036, 0.032, 6, DARK_TEAK, PATH_MAT.WOOD, false);
        m.cyl([foot[0], foot[1] + 0.96, foot[2]], [foot[0], foot[1] + 1.00, foot[2]], 0.040, 0.026, 6, GILT, PATH_MAT.BRASS);
        if (postIdx % 2 === 0) {
          m.ellipsoid([foot[0], foot[1] + 0.02, foot[2]], 0.11, 0.045, 0.10, 6, 3, MOSS, PATH_MAT.FOLIAGE);
        }
        // Alternating hanging washi lanterns out over the water
        if ((postIdx === 0) || (postIdx > 0 && postIdx % 2 === (sd > 0 ? 1 : 0) && postIdx < 8)) {
          addWashiLantern(m, lanterns, foot, [f.n[0] * sd, f.n[1] * sd], postIdx * 1.7 + (sd > 0 ? 0.5 : 0));
        }
        postIdx++;
        nextPostS = f.s + 1.7;
      }
    }
    // Winding ivy vines along portions of the brass handrail
    for (let i = 2; i + 5 < railFrames.length; i += 7) {
      const vinePts: V3[] = [];
      for (let k = i; k <= Math.min(railFrames.length - 1, i + 5); k++) {
        const f = railFrames[k];
        const ph = k * 1.3;
        vinePts.push(ptAt(f, rOff + Math.cos(ph) * 0.04, 0.94 + Math.sin(ph) * 0.04));
      }
      m.tube(vinePts, 0.008, 4, IVY, PATH_MAT.FOLIAGE);
      for (let k = 0; k < vinePts.length; k += 2) {
        const vp = vinePts[k];
        m.ellipsoid([vp[0], vp[1] - 0.01, vp[2]], 0.055, 0.025, 0.045, 5, 3, LEAF, PATH_MAT.FOLIAGE);
        if (R() < 0.35) m.ellipsoid([vp[0], vp[1] + 0.03, vp[2]], 0.026, 0.026, 0.026, 5, 3, R() < 0.5 ? BLOOM_A : BLOOM_B, PATH_MAT.FOLIAGE);
      }
    }
  }

  // Two terracotta entry pots with lush shrubs & reeds flanking the entrance onto the boardwalk
  const entryF = PATH_FRAMES[bw0];
  for (const sd of [-1, 1] as const) {
    const pp = ptAt(entryF, sd * (entryF.halfW + 0.58), 0);
    m.cyl([pp[0], pp[1] - 0.05, pp[2]], [pp[0], pp[1] + 0.52, pp[2]], 0.25, 0.34, 12, TERRACOTTA, PATH_MAT.TERRACOTTA);
    m.cyl([pp[0], pp[1] + 0.52, pp[2]], [pp[0], pp[1] + 0.57, pp[2]], 0.36, 0.36, 12, TERRACOTTA, PATH_MAT.TERRACOTTA);
    addShrub(m, R, [pp[0], pp[1] + 0.54, pp[2]], 1.55);
    addReeds(m, R, [pp[0], pp[1] + 0.54, pp[2]], 6);
  }

  // ====================================================================
  // 2. INLAID ARABIC STAR MEDALLION PLAZAS (ENTRY & SUMMIT)
  // ====================================================================
  buildStarDeck(m, R, ENTRY_PLAZA, lanterns);
  buildStarDeck(m, R, SUMMIT_DECK, lanterns);

  // ====================================================================
  // 3. TRIPPY ASCENDING CELESTIAL SKY-PATH (SPIRAL + FINAL DOME ARCH)
  // ====================================================================
  const insidePlaza = (p: V3): boolean =>
    (Math.abs(p[1] - ENTRY_PLAZA.y) < 0.25 && Math.hypot(p[0] - ENTRY_PLAZA.x, p[2] - ENTRY_PLAZA.z) < ENTRY_PLAZA.r - 0.22) ||
    (Math.abs(p[1] - SUMMIT_DECK.y) < 0.25 && Math.hypot(p[0] - SUMMIT_DECK.x, p[2] - SUMMIT_DECK.z) < SUMMIT_DECK.r - 0.22);

  const buildCelestialStrip = (startIdx: number, endIdx: number, withArches: boolean) => {
    // Trim frames lying strictly inside the inlaid circular/octagonal plazas so slabs never coplanar-overlap them.
    const allStrip = PATH_FRAMES.slice(startIdx, endIdx + 1);
    let firstOut = 0;
    while (firstOut < allStrip.length - 1 && insidePlaza(allStrip[firstOut].p)) firstOut++;
    if (firstOut > 0) firstOut--; // keep one connecting boundary frame at the rim
    let lastOut = allStrip.length - 1;
    while (lastOut > firstOut + 1 && insidePlaza(allStrip[lastOut].p)) lastOut--;
    if (lastOut < allStrip.length - 1) lastOut++;
    const stripFrames = allStrip.slice(firstOut, lastOut + 1);

    const lRailTop: V3[] = [];
    const rRailTop: V3[] = [];
    const lRailMid: V3[] = [];
    const rRailMid: V3[] = [];
    const keelPts: V3[] = [];
    const glowSpineL: V3[] = [];
    const glowSpineR: V3[] = [];

    for (let i = 0; i + 1 < stripFrames.length; i++) {
      const fa = stripFrames[i];
      const fb = stripFrames[i + 1];
      const uA = fa.s * 0.25;
      const uB = fb.s * 0.25;
      const cel = 0.5 * (fa.celestial + fb.celestial);
      const capStart = i === 0;
      const capEnd = i + 2 === stripFrames.length;

      // Main celestial walkway slab (omit interior cross-section end-caps to prevent segment seam z-fighting)
      m.board(
        ptAt(fa, -fa.halfW), ptAt(fa, fa.halfW),
        ptAt(fb, fb.halfW), ptAt(fb, -fb.halfW),
        0.13, LAPIS, PATH_MAT.CELESTIAL, 0, 1, uA, uB, cel, capStart, capEnd,
      );

      // Burnished gold side edge moldings
      for (const sd of [-1, 1] as const) {
        m.board(
          ptAt(fa, sd * (fa.halfW - 0.04), 0.015), ptAt(fa, sd * (fa.halfW + 0.09), 0.015),
          ptAt(fb, sd * (fb.halfW + 0.09), 0.015), ptAt(fb, sd * (fb.halfW - 0.04), 0.015),
          0.18, GILT, PATH_MAT.BRASS, 0, 1, 0, 1, 0, capStart, capEnd,
        );
      }

      // Tapered gilded keel ribs underneath (every 4th segment)
      if (i % 4 === 0) {
        const ka = ptAt(fa, 0, -0.44);
        m.cyl(ptAt(fa, -fa.halfW * 0.85, -0.12), ka, 0.032, 0.025, 5, BRASS, PATH_MAT.BRASS, false);
        m.cyl(ptAt(fa, fa.halfW * 0.85, -0.12), ka, 0.032, 0.025, 5, BRASS, PATH_MAT.BRASS, false);
      }
    }

    for (let i = 0; i < stripFrames.length; i++) {
      const f = stripFrames[i];
      const rOff = f.halfW + 0.02;
      lRailTop.push(ptAt(f, -rOff, 0.92));
      rRailTop.push(ptAt(f, rOff, 0.92));
      lRailMid.push(ptAt(f, -rOff, 0.48));
      rRailMid.push(ptAt(f, rOff, 0.48));
      keelPts.push(ptAt(f, 0, -0.44));
      glowSpineL.push(ptAt(f, -f.halfW - 0.05, -0.15));
      glowSpineR.push(ptAt(f, f.halfW + 0.05, -0.15));
    }

    // Continuous ornate brass handrails, glowing underside energy ribbons & suspended golden keel
    m.tube(lRailTop, 0.028, 6, GILT, PATH_MAT.BRASS);
    m.tube(rRailTop, 0.028, 6, GILT, PATH_MAT.BRASS);
    m.tube(lRailMid, 0.012, 4, BRASS, PATH_MAT.BRASS);
    m.tube(rRailMid, 0.012, 4, BRASS, PATH_MAT.BRASS);
    m.tube(keelPts, 0.038, 5, GOLD_GLOW, PATH_MAT.GLOW, 0.4);
    m.tube(glowSpineL, 0.018, 4, CYAN_GLOW, PATH_MAT.GLOW, 0.8);
    m.tube(glowSpineR, 0.018, 4, CYAN_GLOW, PATH_MAT.GLOW, 1.4);

    // Ornate posts with glowing turquoise/gold orb finials along the climb
    for (let i = 3; i < stripFrames.length - 2; i += 6) {
      const f = stripFrames[i];
      for (const sd of [-1, 1] as const) {
        const foot = ptAt(f, sd * (f.halfW + 0.02), 0);
        m.cyl([foot[0], foot[1] - 0.06, foot[2]], [foot[0], foot[1] + 0.94, foot[2]], 0.028, 0.022, 6, BRASS, PATH_MAT.BRASS, false);
        m.ellipsoid([foot[0], foot[1] + 1.00, foot[2]], 0.055, 0.055, 0.055, 6, 4, ((i / 6) & 1) ? CYAN_GLOW : GOLD_GLOW, PATH_MAT.GLOW, i * 0.25);
      }
    }

    // Floating pointed Moorish/Islamic ogee golden arches soaring overhead along the spiral
    if (withArches) {
      let archIdx = 0;
      for (let i = 10; i < stripFrames.length - 8; i += 12) {
        buildCelestialArch(m, stripFrames[i], lanterns, archIdx++);
      }
    } else {
      // Two grand gateway ogee arches framing the final ascent straight into the dome portal
      buildCelestialArch(m, stripFrames[Math.floor(stripFrames.length * 0.25)], lanterns, 11);
      buildCelestialArch(m, stripFrames[Math.floor(stripFrames.length * 0.65)], lanterns, 12);
    }
  };

  buildCelestialStrip(SPIRAL_RANGE[0], SPIRAL_RANGE[1], true);
  buildCelestialStrip(SUMMIT_RANGE[0], SUMMIT_RANGE[1], false);

  cached = m.finish(lanterns);
  return cached;
}
