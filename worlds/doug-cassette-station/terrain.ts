import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';

export const ENTRANCE_Z = 36.25;
export const EXIT_Z = -36.25;

/** Wet asphalt road corridor runs along X in [-4.8, +4.8], completely level at Y = 0 from portal to portal. */
export const ROAD_HALF_WIDTH = 4.8;

/** Key Neo-Tokyo Street Corner landmark coordinates. */
export const NOODLE_BAR_POS = { x: -8.6, z: 6.2 } as const;
export const OPTICS_SHOP_POS = { x: 8.8, z: 8.2 } as const;
export const ANALOG_SHOP_POS = { x: -8.8, z: -10.8 } as const;
export const CONBINI_POS = { x: 8.8, z: -10.2 } as const;
export const BUS_STOP_POS = { x: 6.2, z: -1.0 } as const;
export const TROLLEY_TRACK_X = 2.6;
export const SCOOTER_LANE_NORTH_X = -1.6;
export const SCOOTER_LANE_SOUTH_X = 0.8;

/** 5 Hidden Blade Runner / Neo-Tokyo Easter Eggs around the street corner. */
export const EASTER_EGGS: ReadonlyArray<{
  id: string;
  name: string;
  location: string;
  lore: string;
  x: number;
  z: number;
  color: string;
}> = [
  {
    id: 'origami-unicorn',
    name: 'Foil Origami Unicorn',
    location: 'by the White Dragon Noodle counter',
    lore: '"Too bad she won\'t live... but then again, who does?"',
    x: -5.5,
    z: 9.6,
    color: '#e2e8f0',
  },
  {
    id: 'dead-channel-tape',
    name: 'Cassette: DEAD CHANNEL 88',
    location: 'behind Analog Ghost\'s CRT shrine',
    lore: 'Labelled: "When the rain parts, look up. The sky is tuned to a dead channel."',
    x: -5.7,
    z: -7.6,
    color: '#22d3ee',
  },
  {
    id: 'ocular-scanner',
    name: 'Voight-Class Iris Scanner',
    location: 'outside Kuro\'s Bio-Mod Clinic',
    lore: 'Frozen screen reads: "BASELINE: TORTOISE IN DESERT — EMOTIONAL RESPONSE DETECTED."',
    x: 5.9,
    z: 11.4,
    color: '#34d399',
  },
  {
    id: 'trolley-pass-404',
    name: 'Trolley Pass #404',
    location: 'on the Sector 9 Tram Stop bench',
    lore: 'Stamped: "DESTINATION: BEYOND BLOCK 32 — PASSENGERS DISSOLVE INTO POLYGONS."',
    x: 6.6,
    z: 1.4,
    color: '#f472b6',
  },
  {
    id: 'mochi-x',
    name: 'Stray Bio-Cat Mochi-X',
    location: 'sheltering under Gekko Mart\'s awning',
    lore: 'Its tiny glowing ear-tag blinks: "PROPERTY OF NO ONE • 9 LIVES LEFT."',
    x: 6.0,
    z: -13.6,
    color: '#fbbf24',
  },
];

/**
 * Walkable street height:
 * - Strictly Y = 0 across the entire road corridor and within both portals (|z| > 26).
 * - Smooth 0.14 m curb step up onto the tiled Neo-Tokyo sidewalks outside |x| > ROAD_HALF_WIDTH.
 */
export function stationHeight(x: number, z: number): number {
  if (Math.abs(z) > 26.5) return 0;
  const ax = Math.abs(x);
  if (ax <= ROAD_HALF_WIDTH) return 0;
  const t = Math.max(0, Math.min(1, (ax - ROAD_HALF_WIDTH) / 0.55));
  return 0.14 * t * t * (3 - 2 * t);
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
 * Smooth sliding collider for buildings, shop counters, bus stop posts, and street props.
 * Keeps the central street and sidewalks freely walkable.
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
