import { describe, expect, it, vi } from 'vitest';
import catalog from '../../../../registry.json';
import type { RegistryFile, WorldManifest } from '../types';
import {
  COSMIC_CONSTELLATIONS,
  CosmicMetaView,
  SNOWGLOBE_RADIUS,
  buildSnowglobeDiorama,
  computeSnowglobeLayout,
  getConstellationBasis,
  getConstellationById,
  projectConstellationPoint,
} from '../meta';

const localWorlds = (catalog as unknown as RegistryFile).worlds.filter((w) => w.kind === 'local');

describe('cosmic constellations', () => {
  it('includes buffalo, aliens, plants, and concepts with valid stars and edges', () => {
    const categories = new Set(COSMIC_CONSTELLATIONS.map((c) => c.category));
    expect(categories.has('fauna')).toBe(true);
    expect(categories.has('aliens')).toBe(true);
    expect(categories.has('plants')).toBe(true);
    expect(categories.has('concepts')).toBe(true);

    // Explicitly verify buffalo, aliens, plants, and concepts constellations exist
    expect(getConstellationById('buffalo')?.name).toMatch(/Buffalo/i);
    expect(COSMIC_CONSTELLATIONS.some((c) => c.category === 'aliens')).toBe(true);
    expect(COSMIC_CONSTELLATIONS.some((c) => c.category === 'plants')).toBe(true);
    expect(COSMIC_CONSTELLATIONS.some((c) => c.category === 'concepts')).toBe(true);

    const ids = new Set<string>();
    for (const spec of COSMIC_CONSTELLATIONS) {
      expect(ids.has(spec.id)).toBe(false);
      ids.add(spec.id);
      expect(spec.stars.length).toBeGreaterThanOrEqual(8);
      expect(spec.edges.length).toBeGreaterThanOrEqual(8);
      expect(spec.artStrokes.length).toBeGreaterThanOrEqual(1);

      for (const [a, b] of spec.edges) {
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThan(spec.stars.length);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(spec.stars.length);
        expect(a).not.toBe(b);
      }
    }
  });

  it('projects constellation star coordinates onto an orthonormal spherical shell', () => {
    for (const spec of COSMIC_CONSTELLATIONS) {
      const basis = getConstellationBasis(spec);
      const dirLen = Math.hypot(...basis.dir);
      const rightLen = Math.hypot(...basis.right);
      const upLen = Math.hypot(...basis.up);
      expect(dirLen).toBeCloseTo(1, 5);
      expect(rightLen).toBeCloseTo(1, 5);
      expect(upLen).toBeCloseTo(1, 5);

      // Basis vectors must be mutually orthogonal
      const dotDR = basis.dir[0] * basis.right[0] + basis.dir[1] * basis.right[1] + basis.dir[2] * basis.right[2];
      const dotDU = basis.dir[0] * basis.up[0] + basis.dir[1] * basis.up[1] + basis.dir[2] * basis.up[2];
      const dotRU = basis.right[0] * basis.up[0] + basis.right[1] * basis.up[1] + basis.right[2] * basis.up[2];
      expect(dotDR).toBeCloseTo(0, 5);
      expect(dotDU).toBeCloseTo(0, 5);
      expect(dotRU).toBeCloseTo(0, 5);

      for (const s of spec.stars) {
        const pt = projectConstellationPoint(spec, s.x, s.y);
        expect(Math.hypot(...pt)).toBeCloseTo(spec.distance, 3);
      }
    }
  });
});

describe('snowglobe layout & miniature dioramas', () => {
  it('places every catalog world with generous non-overlapping clearance', () => {
    const activeCatalog = localWorlds.filter((w) => !w.comparisonOnly);
    const placements = computeSnowglobeLayout(activeCatalog, SNOWGLOBE_RADIUS);
    expect(placements.length).toBe(activeCatalog.length);

    for (let i = 0; i < placements.length; i++) {
      for (let j = i + 1; j < placements.length; j++) {
        const a = placements[i].position;
        const b = placements[j].position;
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(dist).toBeGreaterThan(SNOWGLOBE_RADIUS * 2.5);
      }
    }

    expect(computeSnowglobeLayout([])).toEqual([]);
    expect(computeSnowglobeLayout([activeCatalog[0]])[0].position).toEqual([0, 0, 0]);
  });

  it('builds, animates, and disposes a bespoke or fallback diorama for every world', () => {
    const customFallback: WorldManifest = {
      id: 'future-community-world',
      name: 'Future World',
      author: 'Community',
      description: 'Procedurally generated fallback test',
      accentColor: '#38bdf8',
      kind: 'local',
      spawns: { default: { position: [0, 0, 35.75], yaw: 0 } },
    };

    for (const world of [...localWorlds, customFallback]) {
      const diorama = buildSnowglobeDiorama(world);
      expect(diorama.group.children.length).toBeGreaterThan(0);
      expect(Number.isFinite(diorama.flurry.fallSpeed)).toBe(true);
      diorama.update(0.016, 1.25);
      diorama.dispose();
    }
  });
});

describe('CosmicMetaView lifecycle', () => {
  it('focuses snowglobes and constellations, shakes globes, syncs presence, and triggers dive-in world entry', () => {
    const activeCatalog = localWorlds.filter((w) => !w.comparisonOnly);
    const onFocusChange = vi.fn();
    const onEnterWorld = vi.fn();

    const meta = new CosmicMetaView({
      worlds: activeCatalog,
      activeWorldId: activeCatalog[0].id,
      isMobile: true,
      callbacks: { onFocusChange, onEnterWorld },
    });

    try {
      expect(meta.getFocus()).toEqual({ kind: 'overview' });

      // Focus a constellation (The Great Buffalo)
      expect(meta.focusConstellation('buffalo')).toBe(true);
      expect(meta.getFocus().kind).toBe('constellation');
      expect(meta.focusConstellation('nonexistent')).toBe(false);

      // Focus a world snowglobe and sync live explorers
      const targetWorld = activeCatalog[1];
      expect(meta.focusWorld(targetWorld.id)).toBe(true);
      meta.syncPresence([
        {
          id: 'p-1',
          name: 'Nova',
          color: '#38bdf8',
          worldId: targetWorld.id,
          position: [0, 0, 0],
          yaw: 0,
          velocityY: 0,
          updatedAt: Date.now(),
        },
      ]);
      const worldFocus = meta.getFocus();
      expect(worldFocus.kind).toBe('world');
      if (worldFocus.kind === 'world') {
        expect(worldFocus.world.id).toBe(targetWorld.id);
        expect(worldFocus.playerCount).toBe(1);
      }

      // Toggle constellation atlas art & shake snowglobes
      meta.setShowConstellationArt(false);
      expect(meta.getShowConstellationArt()).toBe(false);
      meta.setShowConstellationArt(true);
      meta.shakeGlobe(targetWorld.id);
      meta.shakeGlobe();

      // Advance simulation & trigger dive-in transition
      meta.enterWorld(targetWorld.id);
      for (let i = 0; i < 30; i++) {
        meta.update(0.02, i * 0.02);
      }
      expect(onEnterWorld).toHaveBeenCalledWith(targetWorld.id);

      // Step through worlds and constellations
      meta.stepWorld(1);
      expect(meta.getFocus().kind).toBe('world');
      meta.stepConstellation(1);
      expect(meta.getFocus().kind).toBe('constellation');
      meta.focusOverview();
      expect(meta.getFocus().kind).toBe('overview');
    } finally {
      meta.dispose();
    }
  });
});
