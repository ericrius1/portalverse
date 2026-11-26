import type { FallSettings } from '../types';

/** A terrain height meaning "nothing to stand on here", for rooms that allow falling. */
export const NO_GROUND = -Infinity;

/** In a room that allows falling but sets no limit, falling this far still ends in a respawn. */
export const DEEPEST_FALL = -400;

/** Rooms that don't allow falling keep players from sinking further than this. */
export const FLOOR_LIMIT = -10;

/** The height below which a fallen player is offered a respawn, or null when the room doesn't allow falling. */
export function respawnHeight(settings: FallSettings | null): number | null {
  if (!settings) return null;
  return Number.isFinite(settings.respawnBelow) ? settings.respawnBelow! : DEEPEST_FALL;
}
