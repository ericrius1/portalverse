import { describe, expect, it } from 'vitest';
import earth from './palace.json';
import { ENTRANCE_Z, EXIT_Z, PALACE, WATER_Y, lagoonSdf, terrainHeight, walkHeight } from './layout';
import { nearPalace, palaceCollider, palaceSurface } from './collide';
import { DOME_PORTAL_Y, ENTRY_PLAZA, PATH_FRAMES, SUMMIT_DECK, pathSurface } from './path/curve';

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

  it('carries you dry over the reflecting lagoon boardwalk, through the north arch, and onto the star plaza', () => {
    // Midway across the cove at z = 25.6 is open water, yet the boardwalk keeps feet well above WATER_Y.
    expect(lagoonSdf(0, 25.6)).toBeLessThan(0);
    const overWaterFrame = PATH_FRAMES.find(f => Math.abs(f.p[2] - 25.6) < 0.5)!;
    expect(pathSurface(overWaterFrame.p[0], overWaterFrame.p[2], 0.3)).toBeGreaterThan(WATER_Y + 0.8);

    // Follow the boardwalk waypoints from entrance through the north arch onto the entry plaza
    let pos: [number, number, number] = [0, 0, ENTRANCE_Z];
    for (let i = 0; i <= 80; i += 4) {
      const f = PATH_FRAMES[i];
      pos = walk(pos, f.p[0], f.p[2], 120);
      expect(pos[1]).toBeGreaterThan(WATER_Y + 0.5);
    }
    expect(Math.hypot(pos[0] - ENTRY_PLAZA.x, pos[2] - ENTRY_PLAZA.z)).toBeLessThan(0.5);
    expect(pos[1]).toBeCloseTo(ENTRY_PLAZA.y, 1);
  });

  it('lets you walk all the way up the arching spiral path into the dome-roof portal without hitting any pier or ceiling', () => {
    let pos: [number, number, number] = [ENTRY_PLAZA.x, ENTRY_PLAZA.y, ENTRY_PLAZA.z];
    for (let i = 81; i < PATH_FRAMES.length; i += 2) {
      const f = PATH_FRAMES[i];
      pos = walk(pos, f.p[0], f.p[2], 60);
    }
    const last = PATH_FRAMES[PATH_FRAMES.length - 1];
    pos = walk(pos, last.p[0], last.p[2], 60);
    // Reaches past SUMMIT_DECK and right across DOME_PORTAL_Y (26.2 m) inside the dome roof
    expect(pos[1]).toBeGreaterThan(DOME_PORTAL_Y);
    expect(Math.hypot(pos[0] - PALACE.at[0], pos[2] - PALACE.at[1])).toBeLessThan(1.0);
    expect(pathSurface(SUMMIT_DECK.x, SUMMIT_DECK.z, SUMMIT_DECK.y)).toBeCloseTo(SUMMIT_DECK.y, 2);
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

  it("keeps the portals' surroundings clear of the Palace", () => {
    expect(nearPalace(0, ENTRANCE_Z, 3)).toBe(false);
    expect(nearPalace(30, 30, 2)).toBe(false);
    expect(nearPalace(PALACE.at[0], PALACE.at[1], 0)).toBe(true);
  });
});
