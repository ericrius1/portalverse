import type { RoomCollider } from '@portalverse/core/types';

export const PATH_HALF_WIDTH = 2.45;
export const FIELD_HALF_LENGTH = 44;

/** Straight, level portal landings, with two broad bends in between. */
export function pathCenter(z: number): number {
  const t = Math.max(0, Math.min(1, (z + 33) / 66));
  return 6.7 * Math.sin(t * Math.PI * 3) * Math.sin(t * Math.PI) ** 2;
}

export function pathWidth(z: number): number {
  return PATH_HALF_WIDTH + 0.22 * Math.sin(z * 0.23) ** 2;
}

export function bankHeight(x: number, z: number): number {
  const edge = Math.max(0, Math.abs(x - pathCenter(z)) - pathWidth(z));
  return Math.min(1, edge * 0.38) * (0.32 + 0.12 * Math.sin(z * 0.4));
}

/** Project onto the curved corridor normal, preserving motion along the hedge. */
export function createHedgeCollider(clearance: () => number = () => 0): RoomCollider {
  return {
    move(_from, to, radius) {
      let x = to[0];
      let z = to[2];
      for (let i = 0; i < 8; i++) {
        const side = x < pathCenter(z) ? -1 : 1;
        const margin = Math.max(0.15, pathWidth(z) + clearance() - radius);
        const excess = side * (x - pathCenter(z)) - margin;
        if (excess <= 1e-6) break;
        const delta = 0.01;
        const slope = (pathCenter(z + delta) - pathCenter(z - delta)) / (2 * delta);
        const widthSlope = (pathWidth(z + delta) - pathWidth(z - delta)) / (2 * delta);
        const dz = -side * slope - widthSlope;
        const correction = excess / (1 + dz * dz);
        x -= side * correction;
        z -= dz * correction;
      }
      // Exact containment after large teleports, without changing ordinary slides.
      const margin = Math.max(0.15, pathWidth(z) + clearance() - radius);
      x = Math.max(pathCenter(z) - margin, Math.min(pathCenter(z) + margin, x));
      return [x, z];
    },
  };
}

export const hedgeCollider = createHedgeCollider();
