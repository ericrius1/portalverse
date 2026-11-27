/** Shared measurements for rendering and collision. The route remains flat at y=0. */
export const HEAD_HEIGHT = 30;
export const ROW_X = 22;
export const HEAD_SPACING = 32;
export const HEAD_STATIONS = Array.from({ length: 21 }, (_, i) => (i - 10) * HEAD_SPACING);
export const WALK_BOUNDS = { minX: -44, maxX: 44, minZ: -245, maxZ: 245 };

/** Conservative horizontal envelopes keep walking/flying players out of stone. */
export function collideHeads(
  _from: readonly number[], to: readonly number[], radius: number, height: number,
): [number, number] {
  let x = to[0];
  let z = to[2];
  if (to[1] >= HEAD_HEIGHT || to[1] + height <= 0) return [x, z];
  for (const station of HEAD_STATIONS) {
    for (const side of [-1, 1]) {
      const rx = 14.9 + radius;
      const rz = 10.8 + radius;
      const dx = (x - side * ROW_X) / rx;
      const dz = (z - station) / rz;
      const distance = Math.hypot(dx, dz);
      if (distance < 1) {
        if (distance < 0.0001) { x = side * (ROW_X - rx); continue; }
        x = side * ROW_X + dx / distance * rx;
        z = station + dz / distance * rz;
      }
    }
  }
  return [x, z];
}
