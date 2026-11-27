import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';

export const ENTRANCE_Z = 36.25;
export const EXIT_Z = -36.25;

/** Central promenade stays level at Y = 0 from portal to portal; gentle raised curbs flank the sides. */
export const PROMENADE_HALF_WIDTH = 4.6;

/** Key landmark positions along the rain-washed twilight station promenade. */
export const SHELTER_POS = { x: -7.8, z: 12.0 } as const;
export const CAT_BENCH_POS = { x: -6.9, z: 12.2 } as const;
export const VENDING_ROW_POS = { x: 7.4, z: 14.5 } as const;
export const RAMEN_KIOSK_POS = { x: -8.2, z: -11.5 } as const;
export const CRT_NOOK_POS = { x: 7.5, z: -2.0 } as const;
export const PHONE_BOOTH_POS = { x: -7.2, z: -0.5 } as const;
export const CASSETTE_ARCH_Z = 2.0;

/** Five recessed neon glass synth tiles along the central promenade (tuned to B major / G# minor). */
export const SYNTH_PADS: ReadonlyArray<{ x: number; z: number; freq: number; color: string; note: string }> = [
  { x: -1.8, z: 18.0, freq: 493.88, color: '#5eead4', note: 'B4' },
  { x: 1.7, z: 10.5, freq: 554.37, color: '#38bdf8', note: 'C#5' },
  { x: -1.6, z: 2.0, freq: 622.25, color: '#f472b6', note: 'D#5' },
  { x: 1.8, z: -7.5, freq: 739.99, color: '#fbbf24', note: 'F#5' },
  { x: -1.7, z: -16.5, freq: 830.61, color: '#c084fc', note: 'G#5' },
];

/** Five nostalgic glowing cassette tapes tucked near the station's cozy details. */
export const CASSETTE_SPOTS: ReadonlyArray<{ id: string; title: string; spot: string; x: number; z: number; color: string }> = [
  { id: 'blue-hour', title: 'Side A: Blue Hour Rain', spot: 'by the cat waiting bench', x: -5.4, z: 14.2, color: '#38bdf8' },
  { id: 'peach-fizz', title: 'Side A: Midnight Vending Fizz', spot: 'by the glowing vending row', x: 5.4, z: 16.2, color: '#fb7185' },
  { id: 'dial-tone', title: 'Side B: Rainy Payphone Echo', spot: 'outside the red phone booth', x: -5.5, z: 1.4, color: '#facc15' },
  { id: 'crt-dream', title: 'Side B: Static & CRT Glow', spot: 'beside the retro CRT stack', x: 5.6, z: -4.2, color: '#5eead4' },
  { id: 'noodle-steam', title: 'Bonus Track: 2AM Matcha Steam', spot: 'near the lantern tea kiosk', x: -5.6, z: -9.2, color: '#c084fc' },
];

/**
 * Walkable station height: completely level Y = 0 across the entire central promenade and both portals,
 * with a gentle 0.14m step onto the side station platforms (easily stepped onto or walked across).
 */
export function stationHeight(x: number, z: number): number {
  // Keep both portals and approaches strictly flat at Y = 0
  if (Math.abs(z) > 26.5) return 0;
  const ax = Math.abs(x);
  if (ax <= PROMENADE_HALF_WIDTH) return 0;
  // Smooth beveled curb up to side platforms (+0.12m)
  const t = Math.max(0, Math.min(1, (ax - PROMENADE_HALF_WIDTH) / 0.8));
  return 0.12 * t * t * (3 - 2 * t);
}

export interface SolidBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

export interface SolidCylinder {
  x: number;
  z: number;
  radius: number;
  maxY: number;
}

/**
 * Smooth sliding collider around vending machines, kiosks, phone booth, shelter posts, and planters.
 * Keeps the central portal-to-portal corridor completely open.
 */
export function createStationCollider(boxes: SolidBox[], cylinders: SolidCylinder[]): RoomCollider {
  return {
    move(_from: Readonly<Vec3Tuple>, to: Readonly<Vec3Tuple>, radius: number, _height: number): [number, number] {
      let x = to[0];
      let z = to[2];
      const feetY = to[1];

      for (let pass = 0; pass < 2; pass++) {
        for (const c of cylinders) {
          if (feetY >= c.maxY) continue;
          const dx = x - c.x;
          const dz = z - c.z;
          const minD = c.radius + radius;
          const dSq = dx * dx + dz * dz;
          if (dSq < minD * minD) {
            const d = Math.sqrt(dSq);
            if (d > 1e-4) {
              x = c.x + (dx / d) * minD;
              z = c.z + (dz / d) * minD;
            } else {
              x = c.x + minD;
            }
          }
        }
        for (const b of boxes) {
          if (feetY >= b.maxY) continue;
          const cx = Math.max(b.minX, Math.min(b.maxX, x));
          const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
          const dx = x - cx;
          const dz = z - cz;
          const dSq = dx * dx + dz * dz;
          if (dSq < radius * radius) {
            const d = Math.sqrt(dSq);
            if (d > 1e-4) {
              const push = radius - d;
              x += (dx / d) * push;
              z += (dz / d) * push;
            } else {
              const left = x - b.minX;
              const right = b.maxX - x;
              const top = z - b.minZ;
              const bottom = b.maxZ - z;
              const m = Math.min(left, right, top, bottom);
              if (m === left) x = b.minX - radius;
              else if (m === right) x = b.maxX + radius;
              else if (m === top) z = b.minZ - radius;
              else z = b.maxZ + radius;
            }
          }
        }
      }

      return [x, z];
    },
  };
}
