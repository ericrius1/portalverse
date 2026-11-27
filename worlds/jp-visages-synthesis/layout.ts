import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';
import { seededRandom } from '@portalverse/core/rooms/kit';

/** Route gates sit at Z = +36.25 (entrance) and Z = -36.25 (exit), both at X = 0. */
export const ENTRANCE_Z = 36.25;
export const EXIT_Z = -36.25;

/** Ground stays dead level (y = 0) across this half-width around the centerline. */
export const PATH_FLAT_HALF_WIDTH = 5.8;

/** Visible cobbled stone road half-width (inside the dead-level strip). */
export const PATH_HALF_WIDTH = 5.1;

/** X distance from centerline to each facing row of colossal stone heads. */
export const HEAD_ROW_X = 22.8;

/** Spacing along Z between consecutive pairs of colossal heads (m). */
export const HEAD_SPACING = 28;

/**
 * Pairs extend from -HEAD_PAIR_HALF_COUNT to +HEAD_PAIR_HALF_COUNT (±392 m, 58 heads),
 * far beyond both portals so the avenue reads as endless in both directions.
 */
export const HEAD_PAIR_HALF_COUNT = 14;

/** Heads within this distance of Z = 0 use the full-detail mesh; beyond use decimated far LOD. */
export const NEAR_LOD_Z = 228;

/** Uniform monumental scale applied to the normalized head mesh (~27.5 m tall above ground). */
export const HEAD_BASE_SCALE = 4.2;

/** Raw world Y (after GLB root transform) where upper neck/under-chin meets ground y = 0. */
export const HEAD_SINK_Y = 3.05;

/** Anatomical symmetry center of the loaded head mesh (after GLB root transform). */
export const HEAD_CENTER_X = 0.511;
export const HEAD_CENTER_Z = 3.2;

/** Extended walk bounds along Z so players can explore deep past either portal into the dark. */
export const WALK_BOUNDS = {
  minX: -95,
  maxX: 95,
  minZ: -215,
  maxZ: 215,
} as const;

export interface HeadPlacement {
  side: -1 | 1;
  index: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  seed: number;
  /** 0..1 intensity of thin crimson blood trails weeping from the eye sockets. */
  weeping: number;
  /** Angle (radians) controlling which side/region of the face carries heavier crack patches. */
  crackAngle: number;
  /** 0..1 overall fracture density for this individual statue. */
  crackDensity: number;
  /** Approximate solid chin/jaw collision cylinder in world XZ. */
  colliderX: number;
  colliderZ: number;
  colliderRadius: number;
}

export interface PillarPlacement {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tiltX: number;
  tiltZ: number;
  width: number;
  depth: number;
  height: number;
  variant: number;
  seed: number;
}

export interface RubblePlacement {
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  scaleZ: number;
  variant: number;
  /** 0..1 brightness variation (large fragments near heads lean paler like statue limestone). */
  shade: number;
  seed: number;
}

export interface VisageSynthesisPlan {
  heads: HeadPlacement[];
  pillars: PillarPlacement[];
  rubble: RubblePlacement[];
}

const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Deterministic ground elevation:
 *  - Dead level at y = 0 across the cobbled road and both portals (|x| <= PATH_FLAT_HALF_WIDTH).
 *  - Rises outside the path into uneven, sculpted dirt-and-rubble mounds around the buried chins.
 */
export function terrainHeightAt(x: number, z: number): number {
  const ax = Math.abs(x);
  if (ax <= PATH_FLAT_HALF_WIDTH) return 0;
  const verge = smooth(PATH_FLAT_HALF_WIDTH, 15.5, ax);
  const bumps =
    0.42 * Math.sin(x * 0.21 + z * 0.17) * Math.sin(z * 0.11 - x * 0.06) +
    0.24 * Math.sin(x * 0.78 + z * 0.56) * Math.sin(z * 0.67 + x * 0.29) +
    0.16 * Math.cos(z * 0.14 - x * 0.12);
  const bank = verge * Math.max(0.08, 0.92 + bumps);
  const headMound = smooth(17.5, 32, ax) * 1.35;
  const outerRidge = smooth(52, 115, ax) * 4.2;
  return bank + headMound + outerRidge;
}

/**
 * Two strictly upright rows of massive stone heads facing inward across the path,
 * marching ~392 m in both directions well past both portals.
 */
export function buildHeadPlacements(rand: () => number): HeadPlacement[] {
  const heads: HeadPlacement[] = [];
  for (let i = -HEAD_PAIR_HALF_COUNT; i <= HEAD_PAIR_HALF_COUNT; i++) {
    const baseZ = i * HEAD_SPACING;
    for (const side of [-1, 1] as const) {
      const scale = HEAD_BASE_SCALE * (0.95 + rand() * 0.1);
      const x = side * (HEAD_ROW_X + (rand() - 0.5) * 1.1);
      const z = baseZ + (rand() - 0.5) * 1.4;
      // Ground beneath the head rises into a dirt/rubble embankment; sink slightly so chin settles naturally.
      const groundY = terrainHeightAt(x, z);
      const sinkOffset = groundY - 0.45 + (rand() - 0.5) * 0.65;
      // Strictly upright (pitch = 0, roll = 0); slight organic yaw variance while facing inward.
      const baseYaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const yaw = baseYaw + (rand() - 0.5) * 0.07;

      // Forward face/jaw projects inward along -side * X.
      const colliderX = x - side * (scale * 1.25);
      const colliderRadius = scale * 2.1;

      // ~68% of statues weep distinct blood trails; the rest have faint or no trails.
      const weeping = rand() < 0.68 ? 0.5 + rand() * 0.5 : rand() * 0.14;
      // Asymmetric crack angle & varied fracture intensity so neighboring faces look genuinely unique.
      const crackAngle = rand() * Math.PI * 2;
      const crackDensity = 0.35 + rand() * 0.65;

      heads.push({
        side,
        index: i,
        x,
        y: sinkOffset,
        z,
        yaw,
        scale,
        seed: rand(),
        weeping,
        crackAngle,
        crackDensity,
        colliderX,
        colliderZ: z,
        colliderRadius,
      });
    }
  }
  return heads;
}

/**
 * Jagged ruined stone monolith pillars looming behind and between the massive heads
 * all the way down the corridor into the dark.
 */
export function buildPillarPlacements(rand: () => number): PillarPlacement[] {
  const pillars: PillarPlacement[] = [];
  const minZ = -(HEAD_PAIR_HALF_COUNT + 1) * HEAD_SPACING;
  const maxZ = (HEAD_PAIR_HALF_COUNT + 1) * HEAD_SPACING;
  const count = 128;

  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = i / (count - 1);
    const z = minZ + t * (maxZ - minZ) + (rand() - 0.5) * 18;
    const band = rand();
    const dist = band < 0.38 ? 26.5 + rand() * 9.5 : 36 + rand() * 32;
    const x = side * dist;
    const width = 1.6 + rand() * 3.3;
    const depth = 1.4 + rand() * 2.8;
    const height = 16 + rand() * 40;
    pillars.push({
      x,
      y: terrainHeightAt(x, z) - 1.2,
      z,
      yaw: (rand() - 0.5) * 0.45 + (side < 0 ? 0.12 : -0.12),
      tiltX: (rand() - 0.5) * 0.06,
      tiltZ: (rand() - 0.5) * 0.08,
      width,
      depth,
      height,
      variant: i % 3,
      seed: rand(),
    });
  }
  return pillars;
}

/**
 * Fractured stones, verge pebbles, and dramatic rubble mounds piled around every colossal jaw.
 * Keeps the central walking lane and both portal thresholds clean and unobstructed.
 */
export function buildRubblePlacements(rand: () => number, heads: readonly HeadPlacement[]): RubblePlacement[] {
  const rubble: RubblePlacement[] = [];
  const spanZ = HEAD_PAIR_HALF_COUNT * HEAD_SPACING;

  const isNearPortal = (x: number, z: number) =>
    Math.abs(x) < 4.8 && (Math.abs(z - ENTRANCE_Z) < 6.0 || Math.abs(z - EXIT_Z) < 6.0);

  // 1. Low angular path-edge stones & loose debris along the cobble-to-dirt seam.
  for (let i = 0; i < 360; i++) {
    const z = (rand() * 2 - 1) * spanZ;
    const side = rand() < 0.5 ? -1 : 1;
    const edgeBias = rand();
    const x = side * (edgeBias < 0.16 ? 2.8 + rand() * 1.9 : 4.6 + rand() * 7.2);
    if (isNearPortal(x, z)) continue;
    const inRoad = Math.abs(x) < PATH_HALF_WIDTH;
    const base = inRoad ? 0.16 + rand() * 0.24 : 0.32 + rand() * 1.1;
    const flat = inRoad ? 0.24 + rand() * 0.2 : 0.4 + rand() * 0.52;
    rubble.push({
      x,
      y: terrainHeightAt(x, z) - base * flat * 0.26,
      z,
      rotX: (rand() - 0.5) * 0.38,
      rotY: rand() * Math.PI * 2,
      rotZ: (rand() - 0.5) * 0.38,
      scaleX: base * (0.82 + rand() * 0.68),
      scaleY: base * flat,
      scaleZ: base * (0.82 + rand() * 0.68),
      variant: i % 4,
      shade: 0.28 + rand() * 0.42,
      seed: rand(),
    });
  }

  // 2. Small bedded pebbles along the uneven dirt banks beside the path.
  for (let i = 0; i < 320; i++) {
    const z = (rand() * 2 - 1) * (spanZ * 0.85);
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (PATH_HALF_WIDTH + 0.3 + rand() * 9.5);
    if (isNearPortal(x, z)) continue;
    const base = 0.09 + rand() * rand() * 0.32;
    const flat = 0.35 + rand() * 0.32;
    rubble.push({
      x,
      y: terrainHeightAt(x, z) - base * flat * 0.32,
      z,
      rotX: (rand() - 0.5) * 0.45,
      rotY: rand() * Math.PI * 2,
      rotZ: (rand() - 0.5) * 0.45,
      scaleX: base * (0.85 + rand() * 0.55),
      scaleY: base * flat,
      scaleZ: base * (0.85 + rand() * 0.55),
      variant: (i + 1) % 4,
      shade: 0.18 + rand() * 0.36,
      seed: rand(),
    });
  }

  // 3. Dramatic fallen limestone shards & rubble boulders heaped around each colossal chin.
  for (const head of heads) {
    const count = 6;
    for (let k = 0; k < count; k++) {
      const spreadAngle = (rand() - 0.5) * 2.15;
      const inwardDir = -head.side;
      const radial = 6.4 + rand() * 7.4;
      const x = head.x + inwardDir * Math.cos(spreadAngle) * radial;
      const z = head.z + Math.sin(spreadAngle) * radial * 1.15;
      if (Math.abs(x) < 6.4 || isNearPortal(x, z)) continue;
      const s = 0.85 + rand() * 2.4;
      rubble.push({
        x,
        y: terrainHeightAt(x, z) - s * 0.25,
        z,
        rotX: (rand() - 0.5) * 0.6,
        rotY: rand() * Math.PI * 2,
        rotZ: (rand() - 0.5) * 0.6,
        scaleX: s * (0.88 + rand() * 0.72),
        scaleY: s * (0.52 + rand() * 0.64),
        scaleZ: s * (0.88 + rand() * 0.72),
        variant: (k + Math.abs(head.index)) % 4,
        // Larger fragments fallen near the statues lean paler like the ancient head stone.
        shade: 0.55 + rand() * 0.45,
        seed: rand(),
      });
    }
  }

  return rubble;
}

/** Build the complete deterministic synthesis room layout plan. */
export function buildVisageSynthesisPlan(): VisageSynthesisPlan {
  const rand = seededRandom(20261127);
  const heads = buildHeadPlacements(rand);
  const pillars = buildPillarPlacements(rand);
  const rubble = buildRubblePlacements(rand, heads);
  return { heads, pillars, rubble };
}

/**
 * Solid push-out collider for all massive stone heads and background monolith pillars
 * so players slide cleanly around the colossal jaws instead of clipping into stone.
 */
export function createVisageCollider(
  heads: readonly HeadPlacement[],
  pillars: readonly PillarPlacement[],
): RoomCollider {
  return {
    move(_from: Readonly<Vec3Tuple>, to: Readonly<Vec3Tuple>, radius: number, _height: number): [number, number] {
      let x = to[0];
      let z = to[2];
      const y = to[1];

      // Above the towering crowns (~30 m) players in flight clear everything cleanly.
      if (y > 31) return [x, z];

      // Skip head loop cleanly when walking down the middle cobbled corridor.
      if (Math.abs(x) + radius > 8.0) {
        for (const h of heads) {
          if (Math.abs(z - h.colliderZ) > h.colliderRadius + radius + 2) continue;
          const dx = x - h.colliderX;
          const dz = z - h.colliderZ;
          const minDist = h.colliderRadius + radius;
          const distSq = dx * dx + dz * dz;
          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            if (dist > 1e-5) {
              const push = (minDist - dist) / dist;
              x += dx * push;
              z += dz * push;
            } else {
              x = h.colliderX - h.side * minDist;
            }
          }
        }
      }

      if (Math.abs(x) + radius > 22) {
        for (const p of pillars) {
          if (y > p.height) continue;
          const pr = Math.max(p.width, p.depth) * 0.55;
          if (Math.abs(z - p.z) > pr + radius + 1) continue;
          const dx = x - p.x;
          const dz = z - p.z;
          const minDist = pr + radius;
          const distSq = dx * dx + dz * dz;
          if (distSq < minDist * minDist) {
            const dist = Math.sqrt(distSq);
            if (dist > 1e-5) {
              const push = (minDist - dist) / dist;
              x += dx * push;
              z += dz * push;
            } else {
              x += minDist;
            }
          }
        }
      }

      return [x, z];
    },
  };
}
