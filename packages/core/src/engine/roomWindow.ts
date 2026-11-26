/** Which way the player is travelling: 1 toward the next room in catalog order (through `exit`), -1 back. */
export type Heading = 1 | -1;

/** Rooms kept loaded on each side of the player's room. */
export const ROOM_WINDOW_RADIUS = 2;

/**
 * The other rooms to keep loaded around `center` in the circular catalog `order`,
 * in the order to load them: nearest first, the side being headed toward first.
 * Empty when `center` isn't in the loop.
 */
export function roomWindow(
  order: readonly string[],
  center: string,
  heading: Heading = 1,
  radius = ROOM_WINDOW_RADIUS,
): Array<{ id: string; distance: number }> {
  const at = order.indexOf(center);
  if (at < 0) return [];
  const seen = new Set([center]);
  const window: Array<{ id: string; distance: number }> = [];
  for (let distance = 1; distance <= radius; distance++) {
    for (const side of [heading, -heading]) {
      const id = order[(((at + side * distance) % order.length) + order.length) % order.length];
      if (seen.has(id)) continue;
      seen.add(id);
      window.push({ id, distance });
    }
  }
  return window;
}
