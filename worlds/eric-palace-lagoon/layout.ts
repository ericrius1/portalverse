/**
 * Where things are in the Palace Lagoon, shared by the shaders (through the Globals uniform) and the room's walking
 * ground. `terrainHeight` is the same function as shaders/common.wgsl's: change both together.
 *
 * The rotunda stands across the portal path: the path (x = 0) runs from the entrance (z = +36.25) over the lawn,
 * up onto the rotunda's podium, in through its north arch, under the dome, and out through its south arch, where the
 * exit portal (z = -36.25) stands in the arch itself. The rotunda's lagoon front faces east (+X), the lagoon in front
 * of it and the colonnade's two wings curving round it from behind; the exhibition hall behind them to the west.
 */

/** The lagoon's surface (m). */
export const WATER_Y = -0.8;

/** Earth's Palace, moved into this room: its rotunda's centre and the turn that faces it east (+X) across the lagoon. */
export const PALACE = {
  /** the rotunda's centre in Earth's San Francisco frame (x, z), and its ground (y) */
  earthCentre: [-1215.2, -2943.2] as const,
  earthDatum: 2.9,
  /** Earth's podium deck stands this far over its ground: lowered by it here, so the deck is the room's y = 0 */
  floor: 0.6,
  /** Earth's palace axis (toward the lagoon) is (0.98686, -0.16160): turned by this it points down +X */
  turn: 0.1623,
  /** where the rotunda's centre lands in the room: the exit portal (z = -36.25) stands in its south arch, 22.25 m out */
  at: [0, -14] as const,
  /** Earth's Palace mesh mirrored on Portalverse's R2 Worker (content-addressed, immutable, CORS open) */
  url: 'https://portalverse-assets.ericrius1.workers.dev/objects/8112524c5b092f2953325f69669b94d3356e15d0d02cf3544d12dc0ce6b27667/palace.bin',
} as const;

/** The rotunda's heights over the deck (m), Earth's palace.json less `PALACE.floor`. */
export const ROTUNDA = {
  /** the arches' springing and crown */
  archSpring: 16.2, archCrown: 19.8,
  /** the inner dome: its foot and its crown */
  domeFoot: 25.4, domeCrown: 43.4,
  /** the outer dome's crown */
  top: 48.2,
  /** the piers' inner face and the podium's edge, from the centre */
  inner: 18.5, podium: 33.4,
} as const;

/** The lagoon in front of the rotunda: centre (x, z), half width along x, half length along z. */
export const LAGOON = { x: 76, z: -14, rx: 38, rz: 96 } as const;
/** Reflecting lagoon cove curving across the north approach between the entrance and the rotunda's north arch. */
export const NORTH_COVE = { x: 14, z: 25.6, rx: 32, rz: 6.2 } as const;

/** The portals (the engine's: x = 0, z = ±36.25) and the walk between them, from sunset to night. */
export const ENTRANCE_Z = 36.25;
export const EXIT_Z = -36.25;

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smin = (a: number, b: number, k: number): number => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
};
const segDist = (px: number, pz: number, ax: number, az: number, bx: number, bz: number): number => {
  const abx = bx - ax, abz = bz - az;
  const t = Math.min(1, Math.max(0, ((px - ax) * abx + (pz - az) * abz) / (abx * abx + abz * abz)));
  return Math.hypot(px - ax - abx * t, pz - az - abz * t);
};

/** In the Palace's own frame: u along its axis (east, toward the lagoon), v across it (along +z). */
export function palaceFrame(x: number, z: number): [number, number] {
  return [x - PALACE.at[0], z - PALACE.at[1]];
}

/** Signed distance from the rotunda's octagonal podium edge (negative inside). Matches common.wgsl podiumDist. */
export function podiumDist(x: number, z: number): number {
  const dx = x - PALACE.at[0], dz = z - PALACE.at[1];
  const seg = Math.PI / 4;
  const a = Math.atan2(dz, dx);
  const rel = a - seg * (Math.floor(a / seg) + 0.5);
  return Math.hypot(dx, dz) * Math.cos(rel) - 33.4;
}

/** Distance from the colonnade wings' centre line (both wings mirror across v = 0). Matches common.wgsl wingDist. */
export function wingDist(x: number, z: number): number {
  const qx = x - PALACE.at[0], qz = Math.abs(z - PALACE.at[1]);
  let d = 1e9;
  d = Math.min(d, segDist(qx, qz, -29.2, 30.9, -23.8, 45.0));
  d = Math.min(d, segDist(qx, qz, -23.8, 45.0, -16.6, 56.4));
  d = Math.min(d, segDist(qx, qz, -16.6, 56.4, -7.4, 66.3));
  d = Math.min(d, segDist(qx, qz, -7.4, 66.3, 2.2, 73.6));
  d = Math.min(d, segDist(qx, qz, 2.2, 73.6, 12.9, 79.1));
  d = Math.min(d, segDist(qx, qz, 12.9, 79.1, 30.5, 79.3));
  d = Math.min(d, segDist(qx, qz, 30.5, 79.3, 31.8, 104.7));
  // Lone box cluster pad at each wing tip
  d = Math.min(d, Math.hypot(qx - 13.3, qz - 105.3));
  return d;
}

export function lagoonSdf(x: number, z: number): number {
  const qx = (x - LAGOON.x) / LAGOON.rx, qz = (z - LAGOON.z) / LAGOON.rz;
  const wobble = Math.sin(z * 0.071) * 2.2 + Math.sin(z * 0.19 + 1.3) * 0.9 + Math.sin(x * 0.11 + 0.4) * 0.7;
  const main = (Math.hypot(qx, qz) - 1) * LAGOON.rx + wobble;
  const cx = (x - NORTH_COVE.x) / NORTH_COVE.rx, cz = (z - NORTH_COVE.z) / NORTH_COVE.rz;
  const cw = Math.sin(x * 0.14 + 0.7) * 0.45 + Math.sin(z * 0.21) * 0.25;
  const cove = (Math.hypot(cx, cz) - 1) * NORTH_COVE.rz + cw;
  return smin(main, cove, 6.0);
}

/** 1 on the Palace's level grounds (from behind the hall to the lagoon's bank, wing tip to wing tip), 0 beyond. */
export function groundsMask(x: number, z: number): number {
  const [u, v] = palaceFrame(x, z);
  return smoothstep(-120, -102, u) * (1 - smoothstep(38, 52, u)) * (1 - smoothstep(140, 158, Math.abs(v)));
}

export function terrainHeight(x: number, z: number): number {
  // the meadow rolls a little, and rises to hills round the horizon: behind the hall, beyond the lagoon, north and south
  let h = Math.sin(x * 0.045 + 0.5) * 0.9 + Math.sin(z * 0.06 + x * 0.02) * 0.7 + Math.sin(z * 0.13 - 0.7) * 0.25 + 0.3;
  h += smoothstep(130, 280, -x) * (12 + 7 * Math.sin(z * 0.011 + 0.8));
  h += smoothstep(150, 320, x) * (9 + 6 * Math.sin(z * 0.013 + 2.1));
  h += smoothstep(170, 320, Math.abs(z - PALACE.at[1])) * (7 + 4 * Math.sin(x * 0.017 + 0.3));
  // the Palace's grounds are level
  h *= 1 - groundsMask(x, z);
  // keep ground cleanly beneath the lowered rotunda podium (y = 0) and colonnade stylobate (y = -0.40..-0.52) to prevent Z-fighting
  const underPodium = 1 - smoothstep(-1.5, 1.5, podiumDist(x, z));
  const underWing = 1 - smoothstep(5.5, 10.5, wingDist(x, z));
  h = mix(h, -0.58, Math.max(underPodium, underWing));
  // the banks and the lagoon's bed
  const s = lagoonSdf(x, z);
  const bed = WATER_Y - 0.35;
  h = mix(bed, h, smoothstep(0, 5.5, s));
  if (s < 0) h = bed - Math.min(2, -s * 0.12);
  return h;
}

/** Where a player stands: the land, or wading in the lagoon up to the waist. */
export function walkHeight(x: number, z: number): number {
  return Math.max(terrainHeight(x, z), WATER_Y - 0.6);
}

/**
 * How far along the walk from sunset to night a viewer is (0 at the entrance, 1 at the dome portal / south night),
 * from where their eye is. Every view has its own: a portal's preview of this room from the room before it shows the
 * sunset, from the room after it the night.
 */
export function duskAt(z: number, y = 0): number {
  const approach = smoothstep(ENTRANCE_Z - 2, PALACE.at[1] - 4, z) * 0.58;
  const climb = smoothstep(1.0, 23.0, y) * 0.48;
  const south = smoothstep(PALACE.at[1], EXIT_Z + 4, z) * 0.45;
  return Math.min(1, approach + Math.max(climb, south));
}
