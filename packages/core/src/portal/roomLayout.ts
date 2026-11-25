import type { PortalDefinition, SpawnPoint, WorldManifest } from '../types';

export const RUN_SPEED = 14.5;
export const ROUTE_LENGTH = RUN_SPEED * 5;
export const SIDE_PORTALS = 5;
export const GATE_WIDTH = 7.2;
export const GATE_HEIGHT = 4.8;
export function livePortalSlots(room?: Pick<WorldManifest, 'portals' | 'customPortalSlots'> | null): number {
  return SIDE_PORTALS - (room?.customPortalSlots ?? 0) - (room?.portals?.length ?? 0);
}

export type RouteEnd = 'entrance' | 'exit';

export function threshold(end: RouteEnd): SpawnPoint {
  return { position: [0, 0, (end === 'entrance' ? 1 : -1) * ROUTE_LENGTH / 2],
    yaw: end === 'entrance' ? 0 : Math.PI, pitch: 0 };
}

/** Catalog order defines a circular promenade. Its two gates are engine-owned. */
export function routeGates(id: string, catalog: WorldManifest[]): PortalDefinition[] {
  const rooms = catalog.filter(room => room.kind === 'local');
  const i = rooms.findIndex(room => room.id === id);
  if (i < 0) throw new Error(`Missing local room "${id}"`);
  return (['entrance', 'exit'] as const).map(end => {
    const next = rooms[(i + (end === 'entrance' ? -1 : 1) + rooms.length) % rooms.length];
    const landing = threshold(end);
    return { id: end, label: next.name, subtitle: end === 'exit' ? 'Next room' : 'Previous room',
      position: landing.position, yaw: end === 'exit' ? 0 : Math.PI, targetWorldId: next.id,
      targetSpawnId: end === 'exit' ? 'entrance' : 'exit', colorA: next.accentColor };
  });
}
