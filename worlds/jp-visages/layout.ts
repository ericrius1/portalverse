import type { RoomCollider, Vec3Tuple } from '@portalverse/core/types';
import { seededRandom } from '@portalverse/core/rooms/kit';

/** Route gates sit at Z = +36.25 (entrance) and Z = -36.25 (exit). */
export const ENTRANCE_Z = 36.25;
export const EXIT_Z = -36.25;

/** Central path half-width that stays flat, rough stone, and unobstructed. */
export const PATH_HALF_WIDTH = 7.5;

/** X distance from centerline to each row of colossal heads. */
export const HEAD_ROW_X = 21.5;

/** Spacing along Z between consecutive pairs of colossal heads (m). */
export const HEAD_SPACING = 28;

/** Pairs extend from -HEAD_PAIR_HALF_COUNT to +HEAD_PAIR_HALF_COUNT (±280 m). */
export const HEAD_PAIR_HALF_COUNT = 10;

/** Uniform monumental scale applied to the normalized head mesh (~25 m above ground). */
export const HEAD_BASE_SCALE = 3.85;

/** Raw world Y (after GLB root transform) where upper neck/under-chin meets ground y = 0. */
export const HEAD_SINK_Y = 3.05;

/** Anatomical symmetry center of the loaded head mesh (after GLB root transform). */
export const HEAD_CENTER_X = 0.511;
export const HEAD_CENTER_Z = 3.2;

/** Walk bounds extended along Z so players can explore past the portals into the dark. */
export const WALK_BOUNDS = {
  minX: -95,
  maxX: 95,
  minZ: -175,
  maxZ: 175,
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
  /** Approximate solid foot/chin collision cylinder center & radius in world XZ. */
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
  seed: number;
}

export interface VisageScenePlan {
  heads: HeadPlacement[];
  pillars: PillarPlacement[];
  rubble: RubblePlacement[];
}

/**
 * Two strictly upright rows of massive heads facing inward toward the path,
 * extending well past both portals (+36.25 / -36.25) into the infinite dark.
 */
export function buildHeadPlacements(rand: () => number): HeadPlacement[] {
  const heads: HeadPlacement[] = [];
  for (let i = -HEAD_PAIR_HALF_COUNT; i <= HEAD_PAIR_HALF_COUNT; i++) {
    const baseZ = i * HEAD_SPACING;
    for (const side of [-1, 1] as const) {
      const scale = HEAD_BASE_SCALE * (0.96 + rand() * 0.08);
      // Slight subtle sink variation so each ancient colossus sits organically in rubble.
      const sinkOffset = (rand() - 0.5) * 0.7;
      // Strictly upright: yaw faces inward toward the central corridor (+X for left row, -X for right row).
      const yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      const x = side * (HEAD_ROW_X + (rand() - 0.5) * 0.8);
      const z = baseZ + (rand() - 0.5) * 1.1;
      // Forward face/jaw extends inward toward the path along -side * X.
      const colliderX = x - side * (scale * 1.25);
      const colliderRadius = scale * 2.15;
      heads.push({
        side,
        index: i,
        x,
        y: sinkOffset,
        z,
        yaw,
        scale,
        seed: rand(),
        colliderX,
        colliderZ: z,
        colliderRadius,
      });
    }
  }
  return heads;
}

/**
 * Ruined monolithic stone pillars rising in the darkness behind and between the massive heads,
 * echoing the stark jagged background ruins in the reference art.
 */
export function buildPillarPlacements(rand: () => number): PillarPlacement[] {
  const pillars: PillarPlacement[] = [];
  const minZ = -(HEAD_PAIR_HALF_COUNT + 1) * HEAD_SPACING;
  const maxZ = (HEAD_PAIR_HALF_COUNT + 1) * HEAD_SPACING;
  const count = 96;

  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const t = i / (count - 1);
    const z = minZ + t * (maxZ - minZ) + (rand() - 0.5) * 18;
    const band = rand();
    // Place some peeking between heads, others deeper in the dark flanks.
    const dist = band < 0.35 ? 25 + rand() * 9 : 34 + rand() * 32;
    const x = side * dist;
    const width = 1.6 + rand() * 3.2;
    const depth = 1.4 + rand() * 2.8;
    const height = 16 + rand() * 38;
    pillars.push({
      x,
      y: -0.6,
      z,
      yaw: (rand() - 0.5) * 0.45 + (side < 0 ? 0.1 : -0.1),
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
 * Rough matte stones, shards, and rubble scattered along the path edges and piled around
 * the buried chins of every colossal head. Keeps the central walking lane & portals clear.
 */
export function buildRubblePlacements(rand: () => number, heads: readonly HeadPlacement[]): RubblePlacement[] {
  const rubble: RubblePlacement[] = [];
  const spanZ = HEAD_PAIR_HALF_COUNT * HEAD_SPACING;

  const isNearPortal = (x: number, z: number) =>
    Math.abs(x) < 4.5 && (Math.abs(z - ENTRANCE_Z) < 5.5 || Math.abs(z - EXIT_Z) < 5.5);

  // 1. Low flat/angular path stones along the corridor margins & sparse pebbles near the center.
  for (let i = 0; i < 240; i++) {
    const z = (rand() * 2 - 1) * spanZ;
    const side = rand() < 0.5 ? -1 : 1;
    const edgeBias = rand();
    const x = side * (edgeBias < 0.18 ? 1.8 + rand() * 2.0 : 3.6 + rand() * 6.5);
    if (isNearPortal(x, z)) continue;
    const inWalkLane = Math.abs(x) < 3.6;
    const base = inWalkLane ? 0.18 + rand() * 0.28 : 0.35 + rand() * 1.15;
    const flat = inWalkLane ? 0.25 + rand() * 0.22 : 0.42 + rand() * 0.55;
    rubble.push({
      x,
      y: terrainHeightAt(x, z) - base * flat * 0.28,
      z,
      rotX: (rand() - 0.5) * 0.35,
      rotY: rand() * Math.PI * 2,
      rotZ: (rand() - 0.5) * 0.35,
      scaleX: base * (0.85 + rand() * 0.65),
      scaleY: base * flat,
      scaleZ: base * (0.85 + rand() * 0.65),
      variant: i % 4,
      seed: rand(),
    });
  }

  // 2. Dramatic rubble mounds piled around the jawline/chin base of every colossal head.
  for (const head of heads) {
    const count = 6;
    for (let k = 0; k < count; k++) {
      const spreadAngle = (rand() - 0.5) * 2.1;
      const inwardDir = -head.side;
      const radial = 6.2 + rand() * 6.8;
      const x = head.x + inwardDir * Math.cos(spreadAngle) * radial;
      const z = head.z + Math.sin(spreadAngle) * radial * 1.15;
      if (Math.abs(x) < 6.8 || isNearPortal(x, z)) continue;
      const s = 0.85 + rand() * 2.25;
      rubble.push({
        x,
        y: terrainHeightAt(x, z) - s * 0.25,
        z,
        rotX: (rand() - 0.5) * 0.6,
        rotY: rand() * Math.PI * 2,
        rotZ: (rand() - 0.5) * 0.6,
        scaleX: s * (0.9 + rand() * 0.7),
        scaleY: s * (0.55 + rand() * 0.65),
        scaleZ: s * (0.9 + rand() * 0.7),
        variant: (k + Math.abs(head.index)) % 4,
        seed: rand(),
      });
    }
  }

  return rubble;
}

/**
 * Deterministic ground elevation:
 *  - Level at y = 0 across the central walking corridor (|x| <= 7.5) and both portals.
 *  - Gently rises into uneven rocky rubble embankments outside the corridor beneath the heads.
 */
export function terrainHeightAt(x: number, z: number): number {
  const ax = Math.abs(x);
  if (ax <= PATH_HALF_WIDTH) return 0;
  const edge = Math.min(1, (ax - PATH_HALF_WIDTH) / 14);
  const smooth = edge * edge * (3 - 2 * edge);
  const undulation =
    Math.sin(z * 0.085 + x * 0.14) * 0.55 +
    Math.cos(z * 0.19 - x * 0.09) * 0.35 +
    0.85;
  return smooth * Math.max(0, undulation);
}

/** Build the complete deterministic room layout plan. */
export function buildVisageScenePlan(): VisageScenePlan {
  const rand = seededRandom(20261126);
  const heads = buildHeadPlacements(rand);
  const pillars = buildPillarPlacements(rand);
  const rubble = buildRubblePlacements(rand, heads);
  return { heads, pillars, rubble };
}

/**
 * Solid push-out collider for the massive stone heads and background monolith pillars
 * so players slide cleanly around the colossal jaws instead of walking inside them.
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

      // Above the towering crowns (~27 m) players in flight clear everything cleanly.
      if (y > 28) return [x, z];

      // Heads occupy two rows at |x| >= ~9.5 m; skip loop cleanly when walking down the middle.
      if (Math.abs(x) + radius > 7.5) {
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

      if (Math.abs(x) + radius > 20) {
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
