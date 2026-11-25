import type { PortalDefinition, SpawnPoint, WorldManifest } from '../types';

export const RUN_SPEED = 14.5;
export const ROUTE_LENGTH = RUN_SPEED * 5;
export const SIDE_PORTALS = 5;
export const PORTAL_RADIUS = 2.85;
export const PORTAL_CENTER_Y = 2.85;
export const GATE_WIDTH = PORTAL_RADIUS * 2;
export const GATE_HEIGHT = PORTAL_CENTER_Y + PORTAL_RADIUS;
export const FAR_PORTAL_MIN_SCALE = 0.3;
export const PORTAL_LENS_EXACT_DIST = 12;
export const PORTAL_LENS_REF_DIST = 15.5;
const PORTAL_LENS_SPAN =
  ((PORTAL_LENS_REF_DIST - PORTAL_LENS_EXACT_DIST) * (ROUTE_LENGTH - PORTAL_LENS_EXACT_DIST)) /
  (ROUTE_LENGTH - PORTAL_LENS_REF_DIST);

/**
 * Smooth C1 distance-compression curve for live depth-1 portal lenses:
 * - Inside 12m: exact 1:1 physical distance (d_eff === d) for distortion-free crossing.
 * - Across the room (72.5m): compresses smoothly to 15.5m — matching the depth-2
 *   snapshot FOV so trees, lanterns, palms & flowers stay visible with zero pop-in.
 */
export function effectivePortalDistance(distance: number): number {
  const d = Math.abs(distance);
  if (d <= PORTAL_LENS_EXACT_DIST) return d;
  const x = d - PORTAL_LENS_EXACT_DIST;
  return PORTAL_LENS_EXACT_DIST + (PORTAL_LENS_SPAN * x) / (PORTAL_LENS_SPAN + x);
}

/**
 * Forced-perspective de-emphasis for far (depth-2) portals seen inside the next
 * room: starts small (0.30x) when viewed from across the current room so the next
 * room's own scenery dominates, and smoothly grows to exact 1.0x as you approach
 * the threshold (d <= ROUTE_LENGTH) so there is zero size jump when entering.
 */
export function farPortalScaleByDistance(distance: number): number {
  if (distance <= ROUTE_LENGTH) return 1;
  const t = Math.min(1, (distance - ROUTE_LENGTH) / ROUTE_LENGTH);
  return 1 - (1 - FAR_PORTAL_MIN_SCALE) * Math.pow(t, 0.75);
}

export function farPortalScale(
  cameraPos: { x: number; z: number },
  portalPos: readonly [number, number, number],
): number {
  return farPortalScaleByDistance(Math.hypot(cameraPos.x - portalPos[0], cameraPos.z - portalPos[2]));
}

export function livePortalSlots(room?: Pick<WorldManifest, 'portals' | 'customPortalSlots'> | null): number {
  return SIDE_PORTALS - (room?.customPortalSlots ?? 0) - (room?.portals?.length ?? 0);
}

export type RouteEnd = 'entrance' | 'exit';

export function threshold(end: RouteEnd): SpawnPoint {
  return {
    position: [0, 0, (end === 'entrance' ? 1 : -1) * ROUTE_LENGTH / 2],
    yaw: end === 'entrance' ? 0 : Math.PI,
    pitch: 0,
  };
}

/** Catalog order defines a circular promenade. Its two gates are engine-owned. */
export function routeGates(id: string, catalog: WorldManifest[]): PortalDefinition[] {
  const rooms = catalog.filter(room => room.kind === 'local');
  const i = rooms.findIndex(room => room.id === id);
  if (i < 0) throw new Error(`Missing local room "${id}"`);
  return (['entrance', 'exit'] as const).map(end => {
    const next = rooms[(i + (end === 'entrance' ? -1 : 1) + rooms.length) % rooms.length];
    const landing = threshold(end);
    return {
      id: end,
      label: next.name,
      subtitle: end === 'exit' ? 'Next room' : 'Previous room',
      position: landing.position,
      yaw: end === 'exit' ? 0 : Math.PI,
      targetWorldId: next.id,
      targetSpawnId: end === 'exit' ? 'entrance' : 'exit',
      colorA: next.accentColor,
    };
  });
}
