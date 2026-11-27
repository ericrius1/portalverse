import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';

export const ENTRANCE_Z = 36.25;
export const EXIT_Z = -36.25;

/**
 * Perpendicular Neo-Tokyo Intersection Layout:
 * - Main Player Pedestrian Avenue / Crosswalk runs North-South along Z (X in [-4.5, +4.5]), level at Y = 0.
 * - Perpendicular Neo-Tokyo Vehicle Boulevard & Sunken Trolley Rails run East-West along X (Z in [-5.8, +5.8]), level at Y = 0.
 * - Raised Neo-Tokyo Sidewalks (+0.14 m) occupy the four corner quadrants outside both corridors!
 */
export const PEDESTRIAN_HALF_WIDTH = 4.5;
export const CROSS_ROAD_HALF_WIDTH = 5.8;

/** Perpendicular East-West traffic & trolley lanes (all perpendicular to the player's Z path!). */
export const TROLLEY_TRACK_Z = -3.2;
export const SCOOTER_LANE_WEST_Z = 0.5;   // cruising East -> West (-X)
export const SCOOTER_LANE_EAST_Z = 3.5;   // cruising West -> East (+X)

/** Four Iconic Street-Corner Shops + NE Bus Stop framing the perpendicular boulevard! */
export const NOODLE_BAR_POS = { x: -10.2, z: -11.4 } as const;  // NW corner (faces right out toward player & crosswalk!)
export const OPTICS_SHOP_POS = { x: 10.6, z: -14.8 } as const;  // NE corner behind bus stop
export const BUS_STOP_POS = { x: 7.4, z: -7.5 } as const;       // NE curb right beside the East-West trolley tracks!
export const ANALOG_SHOP_POS = { x: -10.2, z: 12.2 } as const;  // SW corner
export const CONBINI_POS = { x: 10.2, z: 12.2 } as const;       // SE corner

/** 5 Hidden Blade Runner / Neo-Tokyo Easter Eggs around the 4 street corners. */
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
    x: -6.4,
    z: -7.6,
    color: '#e2e8f0',
  },
  {
    id: 'dead-channel-tape',
    name: 'Cassette: DEAD CHANNEL 88',
    location: 'behind Analog Ghost\'s CRT shrine',
    lore: 'Labelled: "When the rain parts, look up. The sky is tuned to a dead channel."',
    x: -6.8,
    z: 15.2,
    color: '#22d3ee',
  },
  {
    id: 'ocular-scanner',
    name: 'Voight-Class Iris Scanner',
    location: 'outside Kuro\'s Bio-Mod Clinic',
    lore: 'Frozen screen reads: "BASELINE: TORTOISE IN DESERT — EMOTIONAL RESPONSE DETECTED."',
    x: 7.0,
    z: -12.4,
    color: '#34d399',
  },
  {
    id: 'trolley-pass-404',
    name: 'Trolley Pass #404',
    location: 'on the Sector 9 Tram Stop bench',
    lore: 'Stamped: "DESTINATION: BEYOND BLOCK 32 — PASSENGERS DISSOLVE INTO POLYGONS."',
    x: 9.8,
    z: -7.4,
    color: '#f472b6',
  },
  {
    id: 'mochi-x',
    name: 'Stray Bio-Cat Mochi-X',
    location: 'sheltering under Gekko Mart\'s awning',
    lore: 'Its tiny glowing ear-tag blinks: "PROPERTY OF NO ONE • 9 LIVES LEFT."',
    x: 6.8,
    z: 15.6,
    color: '#fbbf24',
  },
];

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/**
 * Walkable street height:
 * - Strictly Y = 0 across the entire North-South pedestrian corridor, both portals (|z| > 26),
 *   AND the entire perpendicular East-West boulevard (|z| <= CROSS_ROAD_HALF_WIDTH).
 * - Smooth 0.14 m curb step up onto the 4 raised corner sidewalks in the quadrants!
 */
export function stationHeight(x: number, z: number): number {
  if (Math.abs(z) > 26.5) return 0;
  const ax = Math.abs(x);
  const az = Math.abs(z);
  const outX = smoothstep(PEDESTRIAN_HALF_WIDTH, PEDESTRIAN_HALF_WIDTH + 0.55, ax);
  const outZ = smoothstep(CROSS_ROAD_HALF_WIDTH, CROSS_ROAD_HALF_WIDTH + 0.55, az);
  return 0.14 * outX * outZ;
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
