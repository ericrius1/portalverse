import { describe, expect, it } from 'vitest';
import earth from './palace.json';
import {
  DEFAULT_SPAWN_POS,
  ENTRANCE_POS,
  EXIT_Z,
  PALACE,
  WATER_Y,
  lagoonSdf,
  terrainHeight,
  walkHeight,
} from './layout';
import { findCoplanar } from '@ericrius1/weft/coplanar';
import { nearPalace, palaceCollider, palaceSurface } from './collide';
import {
  BOARDWALK_RANGE,
  DOME_ARRIVAL_SPAWN,
  DOME_PORTAL_Y,
  ENTRY_PLAZA,
  PATH_FRAMES,
  PORTAL_THRESHOLD_FRAME,
  SPIRAL_RANGE,
  pathCollider,
  pathSurface,
} from './path/curve';
import { buildPathMesh } from './path/mesh';

const R = 0.35;
const H = 1.8;

/** Walk from `from` toward (tx, tz) in short steps, as the avatar does, and return where the feet end up. */
function walk(from: [number, number, number], tx: number, tz: number, steps = 400): [number, number, number] {
  let [x, y, z] = from;
  for (let i = 0; i < steps; i++) {
    const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
    if (d < 0.05) break;
    const s = Math.min(0.15, d);
    const to: [number, number, number] = [x + (dx / d) * s, y, z + (dz / d) * s];
    [x, z] = palaceCollider.move([x, y, z], to, R, H);
    y = Math.max(walkHeight(x, z), palaceSurface(x, z, y), pathSurface(x, z, y));
  }
  return [x, y, z];
}

describe('the Palace to walk round', () => {
  it('stops you at a colonnade column and lets you slide round it', () => {
    const c = earth.circles.find(([, , , top]) => top > 10)!;
    const cos = Math.cos(PALACE.turn), sin = Math.sin(PALACE.turn);
    const dx = c[0] - PALACE.earthCentre[0], dz = c[1] - PALACE.earthCentre[1];
    const cx = dx * cos - dz * sin + PALACE.at[0], cz = dx * sin + dz * cos + PALACE.at[1];
    const [x, z] = palaceCollider.move([cx + 3, 0, cz], [cx, 0, cz], R, H);
    expect(Math.hypot(x - cx, z - cz)).toBeGreaterThanOrEqual(c[2] + R - 1e-6);
  });

  it('carries you from behind the north colonnade arches, across the reflecting lagoon boardwalk, and onto the star plaza', () => {
    // Ground walk starts back behind the monumental north colonnade portico and covers > 60 m before ascending.
    expect(PATH_FRAMES[BOARDWALK_RANGE[1]].s).toBeGreaterThan(60);
    // Midway across the cove at z = 25.6 is open water, yet the boardwalk keeps feet well above WATER_Y.
    expect(lagoonSdf(0, 25.6)).toBeLessThan(0);
    const overWaterFrame = PATH_FRAMES.find(f => Math.abs(f.p[2] - 25.6) < 0.5)!;
    expect(pathSurface(overWaterFrame.p[0], overWaterFrame.p[2], 0.3)).toBeGreaterThan(WATER_Y + 0.8);

    // Follow the boardwalk waypoints from the colonnade courtyard through the portico & north arch onto ENTRY_PLAZA
    let pos: [number, number, number] = [DEFAULT_SPAWN_POS[0], DEFAULT_SPAWN_POS[1], DEFAULT_SPAWN_POS[2]];
    for (let i = BOARDWALK_RANGE[0]; i <= BOARDWALK_RANGE[1]; i += 4) {
      const f = PATH_FRAMES[i];
      pos = walk(pos, f.p[0], f.p[2], 120);
      expect(pos[1]).toBeGreaterThan(WATER_Y + 0.5);
    }
    expect(Math.hypot(pos[0] - ENTRY_PLAZA.x, pos[2] - ENTRY_PLAZA.z)).toBeLessThan(0.5);
    expect(pos[1]).toBeCloseTo(ENTRY_PLAZA.y, 1);
  });

  it('lets you glide smoothly up the single fluid wooden spiral straight into the dome portal with zero 90° turn', () => {
    // Verify smooth wide curvature (no sharp 90° turn anywhere along the spiral!)
    let minTurnR = Infinity;
    for (let i = SPIRAL_RANGE[0] + 1; i < SPIRAL_RANGE[1]; i++) {
      const a = PATH_FRAMES[i - 1].p, b = PATH_FRAMES[i].p, c = PATH_FRAMES[i + 1].p;
      const v1x = b[0] - a[0], v1z = b[2] - a[2];
      const v2x = c[0] - b[0], v2z = c[2] - b[2];
      const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
      const ang = Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1z * v2z) / (l1 * l2))));
      if (ang > 1e-4) minTurnR = Math.min(minTurnR, (0.5 * (l1 + l2)) / ang);
    }
    expect(minTurnR).toBeGreaterThan(6.5);

    // Threshold frame crosses DOME_PORTAL_Y dead-center heading straight -Z
    expect(PORTAL_THRESHOLD_FRAME.p[1]).toBeCloseTo(DOME_PORTAL_Y, 2);
    expect(Math.hypot(PORTAL_THRESHOLD_FRAME.p[0] - PALACE.at[0], PORTAL_THRESHOLD_FRAME.p[2] - PALACE.at[1])).toBeLessThan(0.1);
    expect(DOME_ARRIVAL_SPAWN.position[1]).toBeLessThan(DOME_PORTAL_Y - 1.0);

    // Walk the entire spiral without hitting any pier or ceiling
    let pos: [number, number, number] = [ENTRY_PLAZA.x, ENTRY_PLAZA.y, ENTRY_PLAZA.z];
    for (let i = SPIRAL_RANGE[0] + 1; i <= SPIRAL_RANGE[1]; i += 2) {
      const f = PATH_FRAMES[i];
      pos = walk(pos, f.p[0], f.p[2], 60);
    }
    const last = PATH_FRAMES[SPIRAL_RANGE[1]];
    pos = walk(pos, last.p[0], last.p[2], 60);
    expect(pos[1]).toBeGreaterThan(DOME_PORTAL_Y + 0.8);
  });

  it('depresses terrain beneath the podium and colonnade to prevent ground Z-fighting', () => {
    expect(terrainHeight(PALACE.at[0], PALACE.at[1])).toBeLessThan(-0.45);
    expect(palaceSurface(PALACE.at[0], PALACE.at[1], 0)).toBeCloseTo(0, 5);
  });

  it('stands clear in the south arch too', () => {
    const [x, , z] = walk([PALACE.at[0], 0, PALACE.at[1]], 0, EXIT_Z);
    expect(Math.hypot(x, z - EXIT_Z)).toBeLessThan(0.05);
    expect(palaceSurface(0, EXIT_Z, 0)).toBeCloseTo(0, 5);
  });

  it("gives a flier the dome's crown to land on, and nothing to someone walking under it", () => {
    expect(palaceSurface(PALACE.at[0], PALACE.at[1], 60)).toBeCloseTo(earth.top - PALACE.floor, 3);
    expect(palaceSurface(PALACE.at[0], PALACE.at[1], 0)).toBeCloseTo(0, 5);
  });

  it('leaves the lawn alone', () => {
    expect(palaceCollider.move([20, 0, 30], [20.2, 0, 30.1], R, H)).toEqual([20.2, 30.1]);
    expect(palaceSurface(20, 30, 0)).toBe(-Infinity);
  });

  it('matches every boardwalk and fluid spiral frame height smoothly without jumping to uphill segments', () => {
    for (let i = 0; i < PATH_FRAMES.length; i++) {
      const f = PATH_FRAMES[i];
      const h = pathSurface(f.p[0], f.p[2], f.p[1]);
      expect(Math.abs(h - f.p[1])).toBeLessThan(0.005);
    }
    // Even 1.1 m off-center along the curved ascending spiral, height stays flush with the local deck.
    for (let i = SPIRAL_RANGE[0] + 10; i <= SPIRAL_RANGE[1] - 4; i++) {
      const f = PATH_FRAMES[i];
      for (const sd of [-1.1, 1.1]) {
        const h = pathSurface(f.p[0] + f.n[0] * sd, f.p[2] + f.n[1] * sd, f.p[1]);
        expect(Math.abs(h - f.p[1])).toBeLessThan(0.03);
      }
    }
  });

  it('slides walkers along spiral handrails while letting jumpers and podium walkers pass freely', () => {
    const mid = PATH_FRAMES[SPIRAL_RANGE[0] + 70];
    const outX = mid.p[0] + mid.n[0] * 2.4;
    const outZ = mid.p[2] + mid.n[1] * 2.4;
    const clamped = pathCollider.move([mid.p[0], mid.p[1], mid.p[2]], [outX, mid.p[1], outZ], R, H);
    expect(Math.hypot(clamped[0] - mid.p[0], clamped[1] - mid.p[2])).toBeLessThan(mid.halfW);

    // Jumping over the 0.94 m rail or walking on the podium far below passes unhindered.
    const jumped = pathCollider.move([mid.p[0], mid.p[1] + 1.0, mid.p[2]], [outX, mid.p[1] + 1.0, outZ], R, H);
    expect(jumped).toEqual([outX, outZ]);
    const below = pathCollider.move([mid.p[0], 0, mid.p[2]], [outX, 0, outZ], R, H);
    expect(below).toEqual([outX, outZ]);
  });

  it('separates coplanar triangles in the procedural path mesh', () => {
    const mesh = buildPathMesh();
    const pairs = findCoplanar(new Float32Array(mesh.verts), mesh.indices, { stride: 8, offset: 0 });
    expect(pairs.length).toBeLessThan(100);
  });

  it("keeps the portals' surroundings clear of the Palace", () => {
    expect(nearPalace(ENTRANCE_POS[0], ENTRANCE_POS[2], 3)).toBe(false);
    expect(nearPalace(30, 30, 2)).toBe(false);
    expect(nearPalace(PALACE.at[0], PALACE.at[1], 0)).toBe(true);
  });
});
