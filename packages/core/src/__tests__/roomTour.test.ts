import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import catalog from '../../../../registry.json';
import type { RegistryFile } from '../types';
import { catalogForTour, tourShareBase, VISAGES_TOUR } from '../portal/roomTour';
import { routeGates } from '../portal/roomLayout';
import { buildShareableWorldUrl } from '../portal/handoff';
import { roomWindow } from '../engine/roomWindow';

const fullCatalog = catalog as unknown as RegistryFile;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Visages comparison tour', () => {
  it('selects just the Visages variants, starting in Neon, without changing the full catalog', () => {
    const original = JSON.stringify(fullCatalog);
    const tour = catalogForTour(fullCatalog, '?tour=visages&world=jp-visages-synthesis');
    expect(tour.worlds.map(room => room.id)).toEqual(VISAGES_TOUR);
    expect(tour.defaultWorldId).toBe('jp-visages');
    expect(tour.worlds.map(room => room.name).join(' ')).toMatch(/Neon.*Claude.*Codex.*Synthesis/);
    expect(JSON.stringify(fullCatalog)).toBe(original);
    expect(catalogForTour(fullCatalog, '')).toBe(fullCatalog);
    expect(catalogForTour(fullCatalog, '?tour=unknown')).toBe(fullCatalog);
  });

  it('closes the four-room loop in both directions and preloads only the other tour variants', () => {
    const tour = catalogForTour(fullCatalog, '?tour=visages');
    const count = VISAGES_TOUR.length;
    expect(count).toBe(4);
    for (const [i, id] of VISAGES_TOUR.entries()) {
      const [entrance, exit] = routeGates(id, tour.worlds);
      expect(entrance.targetWorldId).toBe(VISAGES_TOUR[(i - 1 + count) % count]);
      expect(exit.targetWorldId).toBe(VISAGES_TOUR[(i + 1) % count]);
      expect(entrance.targetSpawnId).toBe('exit');
      expect(exit.targetSpawnId).toBe('entrance');
      expect(roomWindow(VISAGES_TOUR, id).map(room => room.id).sort())
        .toEqual(VISAGES_TOUR.filter(other => other !== id).sort());
    }
  });

  it('preserves the tour when crossing, sharing and reloading any of the tour rooms', () => {
    let url = 'http://localhost:5173/?tour=visages&world=jp-visages-synthesis&spawn=exit#stale';
    for (const id of [...VISAGES_TOUR, VISAGES_TOUR[0]]) {
      url = buildShareableWorldUrl(tourShareBase(url), { worldId: id });
      expect(new URL(url).searchParams.get('world')).toBe(id);
      expect(new URL(url).searchParams.has('spawn')).toBe(false);
      expect(catalogForTour(fullCatalog, new URL(url).search).worlds.map(room => room.id)).toEqual(VISAGES_TOUR);
    }
    expect(tourShareBase('https://example.test/?world=fishpond&tour=unknown'))
      .toBe('https://example.test/');
  });

  it('throws a clear error if a tour room is missing from the catalog', () => {
    const incomplete: RegistryFile = {
      ...fullCatalog,
      worlds: fullCatalog.worlds.filter(room => room.id !== 'jp-visages-synthesis'),
    };
    expect(() => catalogForTour(incomplete, '?tour=visages')).toThrow(/all Visages rooms installed/i);
  });

  it('mounts the engine-owned gates using the same tour as the directory and previews', async () => {
    vi.stubGlobal('window', { location: { search: '?tour=visages' } });
    vi.resetModules();
    const { sessionCatalog } = await import('../portal/sessionCatalog');
    const { RoomInstance } = await import('../engine/RoomInstance');
    const { PortalPreviews } = await import('../engine/PortalPreviews');
    const renderer = {} as THREE.WebGPURenderer;
    const previews = new PortalPreviews(renderer, async () => undefined!);
    const count = VISAGES_TOUR.length;
    try {
      expect(sessionCatalog.worlds.map(room => room.id)).toEqual(VISAGES_TOUR);
      // Verify the real default preview order; an explicit test order would hide
      // a regression where the directory changed but prefetch still used all rooms.
      expect((previews as unknown as { order: string[] }).order).toEqual(VISAGES_TOUR);
      for (const [i, manifest] of sessionCatalog.worlds.entries()) {
        const room = await RoomInstance.mount({ manifest, mount() {} }, renderer);
        try {
          expect(room.portals.map(handle => handle.portal.targetWorldId))
            .toEqual([VISAGES_TOUR[(i - 1 + count) % count], VISAGES_TOUR[(i + 1) % count]]);
        } finally {
          room.dispose();
        }
      }
    } finally {
      previews.clear();
    }
  });
});
