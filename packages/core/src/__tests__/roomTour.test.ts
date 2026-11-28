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
  it('keeps retired rooms in the repository catalog but skips them in play', () => {
    const normal = catalogForTour(fullCatalog, '');
    for (const id of ['jp-garden', 'fishpond', 'jp-world']) {
      expect(fullCatalog.worlds.some(room => room.id === id)).toBe(true);
      expect(normal.worlds.some(room => room.id === id)).toBe(false);
    }
    const last = normal.worlds.at(-1)!.id;
    expect(routeGates(last, normal.worlds)[1].targetWorldId).toBe('jp-reef');
    expect(routeGates('jp-reef', normal.worlds)[0].targetWorldId).toBe(last);
  });

  it('selects just the Visages variants, starting in Neon, without changing the full catalog', () => {
    const original = JSON.stringify(fullCatalog);
    const tour = catalogForTour(fullCatalog, '?tour=visages&world=jp-visage');
    expect(tour.worlds.map(room => room.id)).toEqual(VISAGES_TOUR);
    expect(tour.defaultWorldId).toBe('jp-visages');
    expect(tour.worlds.map(room => room.name).join(' ')).toMatch(/Neon.*Claude.*Codex.*Visage/);
    expect(JSON.stringify(fullCatalog)).toBe(original);
    expect(catalogForTour(fullCatalog, '?tour=unknown')).toEqual(catalogForTour(fullCatalog, ''));
  });

  it('puts only the winner between Abyss and Palace in the normal loop', () => {
    const normal = catalogForTour(fullCatalog, '');
    expect(normal.worlds.filter(room => room.id === 'jp-visage' || room.id.startsWith('jp-visages')).map(room => room.id))
      .toEqual(['jp-visage']);
    expect(routeGates('jp-abyss', normal.worlds)[1].targetWorldId).toBe('jp-visage');
    expect(routeGates('jp-visage', normal.worlds).map(g => g.targetWorldId))
      .toEqual(['jp-abyss', 'eric-palace-lagoon']);
    expect(routeGates('eric-palace-lagoon', normal.worlds)[0].targetWorldId).toBe('jp-visage');
    expect(fullCatalog.worlds.filter(room => room.comparisonOnly)).toHaveLength(3);
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
    let url = 'http://localhost:5173/?tour=visages&world=jp-visage&spawn=exit#stale';
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
      worlds: fullCatalog.worlds.filter(room => room.id !== 'jp-visage'),
    };
    expect(() => catalogForTour(incomplete, '?tour=visages')).toThrow(/all Visages rooms installed/i);
  });

  it('preserves the optional blind eye study across share URLs without exposing its answer key', () => {
    const url = buildShareableWorldUrl(tourShareBase(
      'http://localhost:5173/?tour=visages&eyes=compare&world=jp-visage',
    ), { worldId: 'jp-visage' });
    expect(new URL(url).searchParams.get('eyes')).toBe('compare');
    expect(new URL(url).searchParams.get('tour')).toBe('visages');
    expect(tourShareBase('http://localhost:5173/?eyes=unknown')).toBe('http://localhost:5173/');
  });

  it.each(['', '?tour=visages'])('mounts gates using the same catalog as the directory and previews (%s)', async search => {
    vi.stubGlobal('window', { location: { search } });
    vi.resetModules();
    const { sessionCatalog } = await import('../portal/sessionCatalog');
    const { RoomInstance } = await import('../engine/RoomInstance');
    const { PortalPreviews } = await import('../engine/PortalPreviews');
    const renderer = {} as THREE.WebGPURenderer;
    const previews = new PortalPreviews(renderer, async () => undefined!);
    const expected = search ? [...VISAGES_TOUR] : fullCatalog.worlds
      .filter(room => room.inRotation !== false && !room.comparisonOnly).map(room => room.id);
    const count = expected.length;
    try {
      expect(sessionCatalog.worlds.map(room => room.id)).toEqual(expected);
      // Verify the real default preview order; an explicit test order would hide
      // a regression where the directory changed but prefetch still used all rooms.
      expect((previews as unknown as { order: string[] }).order).toEqual(expected);
      for (const [i, manifest] of sessionCatalog.worlds.entries()) {
        const room = await RoomInstance.mount({ manifest, mount() {} }, renderer);
        try {
          expect(room.portals.map(handle => handle.portal.targetWorldId))
            .toEqual([expected[(i - 1 + count) % count], expected[(i + 1) % count]]);
        } finally {
          room.dispose();
        }
      }
    } finally {
      previews.clear();
    }
  });
});
