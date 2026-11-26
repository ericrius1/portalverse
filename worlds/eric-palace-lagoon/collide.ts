/**
 * What the Palace of Fine Arts is to a body walking round it, ported from Earth
 * (github.com/ericrius1/world: web/src/palace/collide.ts, from pipeline/palace_model.py's
 * solids()): the rotunda's podium to stand on, its eight piers and their columns'
 * pedestals to stop against (walk in through the arches, under the dome), the
 * peristyle's 132 columns and urns, the exhibition hall; and for a flier, the ring over
 * the piers, the drum and the dome, and the colonnade's entablature and planter boxes,
 * every top of which can be landed on.
 *
 * palace.json is Earth's, in Earth's San Francisco frame; it's moved into the room's
 * frame once, here, the same way palaceMesh.worker.ts moves the mesh. Heights in it are
 * over the Palace's ground, which is the room's y = 0.
 */
import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';
import earth from './palace.json';
import { PALACE } from './layout';

type P2 = [number, number];

const cos = Math.cos(PALACE.turn), sin = Math.sin(PALACE.turn);
const [ecx, ecz] = PALACE.earthCentre;
const [ax, az] = PALACE.at;
const toRoom = ([x, z]: readonly number[]): P2 => {
  const dx = x - ecx, dz = z - ecz;
  return [dx * cos - dz * sin + ax, dx * sin + dz * cos + az];
};

/** Earth's palace.json in the room's frame (its axis turned to +X). */
const J = {
  centre: [ax, az] as P2,
  floor: earth.floor,
  podium: earth.podium,
  inner: earth.inner,
  domeIn: earth.domeIn as P2,
  top: earth.top,
  polys: earth.polys.map(poly => ({ p: poly.p.map(toRoom), y1: poly.y1 })),
  circles: earth.circles.map(([x, z, r, top]) => [...toRoom([x, z]), r, top] as [number, number, number, number]),
  wings: earth.wings.map(line => line.map(toRoom)),
  clusters: earth.clusters.map(toRoom),
  wingTop: earth.wingTop as P2,
  outline: earth.outline.map(toRoom),
  upper: earth.upper as P2,
  innerOct: earth.innerOct.map(toRoom),
  drum: earth.drum as [number, number, number],
};

function inPoly(P: P2[], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The nearest point on a polygon's edges, and how far it is. */
function nearestOnPoly(P: P2[], x: number, z: number): [number, number, number] {
  let bx = 0, bz = 0, bd = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const ax0 = P[j][0], az0 = P[j][1], dx = P[i][0] - ax0, dz = P[i][1] - az0, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax0) * dx + (z - az0) * dz) / L2));
    const px = ax0 + dx * t, pz = az0 + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; bx = px; bz = pz; }
  }
  return [bx, bz, bd];
}

function distToLine(L: P2[], x: number, z: number): number {
  let bd = Infinity;
  for (let i = 1; i < L.length; i++) {
    const ax0 = L[i - 1][0], az0 = L[i - 1][1], dx = L[i][0] - ax0, dz = L[i][1] - az0, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - ax0) * dx + (z - az0) * dz) / L2));
    bd = Math.min(bd, Math.hypot(x - ax0 - dx * t, z - az0 - dz * t));
  }
  return bd;
}

/** The whole Palace's reach (x0, z0, x1, z1) and the rotunda's, for a quick "nowhere near" first. */
const box = (() => {
  const xs: number[] = [], zs: number[] = [];
  for (const w of J.wings) for (const [x, z] of w) { xs.push(x); zs.push(z); }
  for (const [x, z] of J.clusters) { xs.push(x); zs.push(z); }
  for (const poly of J.polys) for (const [x, z] of poly.p) { xs.push(x); zs.push(z); }
  return [Math.min(...xs) - 8, Math.min(...zs) - 8, Math.max(...xs) + 8, Math.max(...zs) + 8];
})();
const R = J.podium + 6;
const rBox = [J.centre[0] - R, J.centre[1] - R, J.centre[0] + R, J.centre[1] + R];

function near(x: number, z: number, pad = 0): boolean {
  return (x > box[0] - pad && x < box[2] + pad && z > box[1] - pad && z < box[3] + pad) ||
    (x > rBox[0] - pad && x < rBox[2] + pad && z > rBox[1] - pad && z < rBox[3] + pad);
}

/** The rotunda's podium deck under (x, z) (its octagon's faces 22.5° off the axis), or null off it. */
function podiumDeck(x: number, z: number): number | null {
  const u = x - J.centre[0], v = z - J.centre[1];
  const a = Math.atan2(v, u), r = Math.hypot(u, v);
  const rel = (((a % (Math.PI / 4)) + Math.PI / 4) % (Math.PI / 4)) - Math.PI / 8;
  const ap = r * Math.cos(rel);
  if (ap < J.podium) return J.floor;
  if (ap < J.podium + 0.8) return J.floor - 0.3;
  return null;
}

/** The dome's (and the drum's) top over (x, z), or null off them. */
function domeTop(x: number, z: number): number | null {
  const rc = Math.hypot(x - J.centre[0], z - J.centre[1]);
  const [drumR, drumTop, footR] = J.drum;
  if (rc < footR) return drumTop + (J.top - drumTop) * Math.sqrt(1 - (rc / footR) ** 2);
  return rc < drumR ? drumTop : null;
}

/** Is (x, y, z), grown by m, inside the high parts a flier can hit: the ring and attic, the drum and dome, the colonnade's entablature and boxes? */
function solidOverhead(x: number, y: number, z: number, m: number): boolean {
  if (y > J.upper[0] - m && y < J.upper[1] + m && inPoly(J.outline, x, z) && !(y < J.domeIn[0] && inPoly(J.innerOct, x, z))) return true;
  const dome = domeTop(x, z);
  if (dome !== null && y > J.upper[1] - m && y < dome + m) return true;
  if (y > J.wingTop[0] - m && y < J.wingTop[1] + m) {
    for (const w of J.wings) if (distToLine(w, x, z) < 2.5 + m) return true;
    for (const [cx, cz] of J.clusters) if (Math.hypot(x - cx, z - cz) < 4.0 + m) return true;
  }
  return false;
}

export const palaceCollider: RoomCollider = {
  move(from: Readonly<Vec3Tuple>, to: Readonly<Vec3Tuple>, r: number, height: number): [number, number] {
    let x = to[0], z = to[2];
    if (!near(x, z, r + 2)) return [x, z];
    const lo = to[1], hi = to[1] + height;
    // piers, pedestals and the hall: pushed out to their nearest edge, or back out the way you came
    for (const P of J.polys) {
      if (lo > P.y1 || hi < -2) continue;
      const inside = inPoly(P.p, x, z);
      const [px, pz, d] = nearestOnPoly(P.p, x, z);
      if (inside) {
        if (!inPoly(P.p, from[0], from[2])) {
          const ex = x - px, ez = z - pz, L = Math.hypot(ex, ez) || 1;
          x = px - (ex / L) * r;
          z = pz - (ez / L) * r;
        }
      } else if (d < r) {
        const ex = x - px, ez = z - pz, L = d || 1;
        x = px + (ex / L) * r;
        z = pz + (ez / L) * r;
      }
    }
    // the columns and urns: round, so you slide round them
    for (const [cx, cz, cr, top] of J.circles) {
      if (lo > top || hi < -2) continue;
      const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), reach = cr + r;
      if (d < reach) {
        x = d > 1e-6 ? cx + (dx * reach) / d : cx + reach;
        z = d > 1e-6 ? cz + (dz * reach) / d : cz;
      }
    }
    // the high parts, for a flier: stop rather than pass into them
    const mid = to[1] + height * 0.5;
    if (solidOverhead(x, mid, z, r) && !solidOverhead(from[0], mid, from[2], r)) return [from[0], from[2]];
    return [x, z];
  },
};

/**
 * The highest Palace surface at (x, z) that someone whose feet are at `fromY` can stand
 * on: the podium's deck, and from above, the tops of the piers, the hall, the columns,
 * the colonnade, the ring and the dome. -Infinity where there's none.
 */
export function palaceSurface(x: number, z: number, fromY = Infinity): number {
  if (!near(x, z, 1)) return -Infinity;
  const step = 0.6;
  let best = -Infinity;
  const consider = (top: number) => { if (top > best && fromY >= top - step) best = top; };
  const deck = podiumDeck(x, z);
  if (deck !== null) consider(deck);
  if (fromY < J.wingTop[0]) {
    // (walking on the ground: only the podium and the low tops matter)
    for (const P of J.polys) if (P.y1 <= fromY + step && inPoly(P.p, x, z)) consider(P.y1);
    for (const [cx, cz, cr, top] of J.circles) if (top <= fromY + step && Math.hypot(x - cx, z - cz) < cr) consider(top);
    return best;
  }
  for (const P of J.polys) if (inPoly(P.p, x, z)) consider(P.y1);
  for (const [cx, cz, cr, top] of J.circles) if (Math.hypot(x - cx, z - cz) < cr) consider(top);
  for (const w of J.wings) if (distToLine(w, x, z) < 2.5) { consider(J.wingTop[1]); break; }
  for (const [cx, cz] of J.clusters) if (Math.hypot(x - cx, z - cz) < 4.0) { consider(J.wingTop[1]); break; }
  if (inPoly(J.outline, x, z) && !inPoly(J.innerOct, x, z)) consider(J.upper[1]);
  const dome = domeTop(x, z);
  if (dome !== null) consider(dome);
  return best;
}
