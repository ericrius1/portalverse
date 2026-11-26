/**
 * Where things are in the Palace Lagoon, shared by the shaders (through the Globals
 * uniform) and the room's walking ground. `terrainHeight` is the same function as
 * shaders/common.wgsl's: change both together.
 *
 * The path runs along the lagoon's east shore from the entrance (+Z) to the exit (-Z).
 * West of it, across the water, Earth's Palace of Fine Arts stands as it does in the
 * Marina, its rotunda facing the lagoon.
 */

/** The lagoon's surface (m). */
export const WATER_Y = -0.8;
/** The lagoon: centre x, half width along x, half length along z. */
export const LAGOON = { x: -46, rx: 32, rz: 95 } as const;

/** Earth's Palace, moved into this room: its rotunda's centre and the turn that faces it east (+X) across the lagoon. */
export const PALACE = {
  /** the rotunda's centre in Earth's San Francisco frame (x, z), and its ground (y) */
  earthCentre: [-1215.2, -2943.2] as const,
  earthDatum: 2.9,
  /** Earth's palace axis (toward the lagoon) is (0.98686, -0.16160): turned by this it points down +X */
  turn: 0.1623,
  /** where the rotunda's centre lands in the room */
  at: [-110, 0] as const,
  /** Earth's mesh on Earth's R2 (content-addressed, immutable; CORS open) */
  url: 'https://sf-assets.ericrius1.workers.dev/objects/8112524c5b092f2953325f69669b94d3356e15d0d02cf3544d12dc0ce6b27667/palace.bin',
} as const;

/** Golden hour: a low sun in the south-southeast, behind your left shoulder as you face the rotunda, raking across
 *  its lagoon front so every column throws its shadow on the stone behind it. */
const sun = [0.36, 0.3, 0.88];
const len = Math.hypot(sun[0], sun[1], sun[2]);
export const SUN_DIR: [number, number, number] = [sun[0] / len, sun[1] / len, sun[2] / len];
export const SUN_COLOR: [number, number, number] = [2.6, 1.95, 1.3];

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export function lagoonSdf(x: number, z: number): number {
  const qx = (x - LAGOON.x) / LAGOON.rx, qz = z / LAGOON.rz;
  const wobble = Math.sin(z * 0.071) * 2.2 + Math.sin(z * 0.19 + 1.3) * 0.9 + Math.sin(x * 0.11 + 0.4) * 0.7;
  return (Math.hypot(qx, qz) - 1) * LAGOON.rx + wobble;
}

export function terrainHeight(x: number, z: number): number {
  const away = smoothstep(3, 14, Math.abs(x));
  let h = away * (Math.sin(x * 0.045 + 0.5) * 0.9 + Math.sin(z * 0.06 + x * 0.02) * 0.7 + Math.sin(z * 0.13 - 0.7) * 0.25 + 0.3);
  h += smoothstep(30, 160, x) * (5 + 3 * Math.sin(z * 0.012 + 0.8));
  h *= smoothstep(-95, -60, x);
  const s = lagoonSdf(x, z);
  const bed = WATER_Y - 0.35;
  h = mix(bed, h, smoothstep(0, 7, s));
  if (s < 0) h = bed - Math.min(2, -s * 0.12);
  return h;
}

/** Where a player stands: the land, or wading in the lagoon up to the waist. */
export function walkHeight(x: number, z: number): number {
  return Math.max(terrainHeight(x, z), WATER_Y - 0.6);
}
