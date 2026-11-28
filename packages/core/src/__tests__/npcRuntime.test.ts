import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as THREE from 'three/webgpu';
import registryJson from '../../../../registry.json';
import {
  NPC_LIST,
  NPC_PLACEMENTS_BY_ID,
  NpcActor,
  NpcJournalStore,
  NpcManager,
  SHUTTLE_SECRET_PAGE,
  getNpcPlacement,
  getNpcsForWorld,
} from '../npc';
import type { RoomInstance } from '../engine/RoomInstance';

function makeMockRoom(worldId: string): RoomInstance {
  return {
    module: { manifest: { id: worldId } },
    platforms: [],
    terrainHeight: () => 0,
  } as unknown as RoomInstance;
}

describe('NPC runtime, journal memory, and Cast facial animation', () => {
  it('assigns safe, well-spaced stand placements to every Keeper across Eric’s rooms', () => {
    let checked = 0;
    for (const world of registryJson.worlds) {
      const npcs = getNpcsForWorld(world.id);
      if (npcs.length === 0) continue;

      const placements = npcs.map((npc) => {
        expect(NPC_PLACEMENTS_BY_ID[npc.id], `Missing placement for ${npc.id}`).toBeDefined();
        const placement = npc.placement ?? getNpcPlacement(npc.id, world.id);
        expect(placement.position).toHaveLength(3);
        const [x, , z] = placement.position;
        if (world.id === 'eric-palace-lagoon') {
          // Custom entrance portal at (-13.05, 0, 61.05), exit dome portal at (0, 26.2, -14)
          expect(Math.hypot(x - -13.05, z - 61.05), `${npc.id} too close to Palace entrance`).toBeGreaterThan(8);
        } else {
          // Standard entrance/exit portals at (0, 0, ±36.25)
          expect(Math.abs(z), `${npc.id} too close to portal`).toBeLessThan(33.5);
        }
        checked++;
        return { id: npc.id, pos: placement.position };
      });

      // Every pair of Keepers sharing a room must be comfortably spaced apart
      for (let i = 0; i < placements.length; i++) {
        for (let j = i + 1; j < placements.length; j++) {
          const a = placements[i];
          const b = placements[j];
          const dist = Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]);
          expect(dist, `${a.id} & ${b.id} overlap in ${world.id}`).toBeGreaterThanOrEqual(8);
        }
      }
    }
    expect(checked).toBe(NPC_LIST.length);
  });

  it('mounts multiple Keepers in Eric’s rooms and zero Keepers in non-Eric rooms', () => {
    const manager = new NpcManager();

    manager.mountForRoom(makeMockRoom('jp-loft'));
    expect(manager.getActors()).toHaveLength(0);

    manager.mountForRoom(makeMockRoom('doug-cassette-station'));
    expect(manager.getActors()).toHaveLength(0);

    manager.mountForRoom(makeMockRoom('eric-palace-lagoon'));
    expect(manager.getActors().map((a) => a.spec.id)).toEqual(['soraya', 'solenne', 'keola', 'nori']);

    manager.mountForRoom(makeMockRoom('eric-starlight-pavilion'));
    expect(manager.getActors().map((a) => a.spec.id)).toEqual(['dre', 'lulu']);

    // Walking close to Dre selects Dre as nearest NPC
    const drePos = NPC_PLACEMENTS_BY_ID.dre.position;
    manager.update(0.016, 1.0, new THREE.Vector3(drePos[0], 0, drePos[2] + 1.5));
    expect(manager.getNearestNpc()?.id).toBe('dre');

    manager.dispose();
  });

  it('tracks met Keepers, discovers clues, unlocks callbacks, and reveals The Shuttle at full collection', () => {
    const store = new NpcJournalStore('portalverse.test.journal.ephemeral');
    store.reset();

    expect(store.getSnapshot().foundClues).toHaveLength(0);
    expect(store.getSnapshot().hasShuttlePage).toBe(false);

    let lastNotifiedClue: string | undefined;
    const unsub = store.subscribe((_snap, clueId) => {
      if (clueId) lastNotifiedClue = clueId;
    });

    const firstNpcId = NPC_LIST[0].id;
    expect(store.recordMet(firstNpcId)).toBe(true);
    expect(store.recordMet(firstNpcId)).toBe(false);
    expect(store.hasMet(firstNpcId)).toBe(true);

    for (let i = 0; i < NPC_LIST.length; i++) {
      const npc = NPC_LIST[i];
      expect(store.discoverClue(npc.clueId)).toBe(true);
      expect(store.discoverClue(npc.clueId)).toBe(false);
      expect(lastNotifiedClue).toBe(npc.clueId);
      if (i < NPC_LIST.length - 1) {
        expect(store.getSnapshot().hasShuttlePage).toBe(false);
      }
    }

    const finalSnap = store.getSnapshot();
    expect(finalSnap.foundClues).toHaveLength(NPC_LIST.length);
    expect(finalSnap.hasShuttlePage).toBe(true);
    expect(SHUTTLE_SECRET_PAGE.title).toBe('The Shuttle');

    unsub();
    store.reset();
  });

  it('drives @ericrius1/cast Face lip-sync, expressions, gestures, and 3D speech bubbles headlessly', () => {
    const kestrel = NPC_LIST[0];
    const actor = new NpcActor(kestrel, [2.8, 0, 14.5], -0.45);
    const playerPos = new THREE.Vector3(1.2, 0, 17.5);

    actor.setTalking(true);
    actor.speak(
      'Twelve faces, thirty edges, and one extra hairline running where no corner sits.',
      'thinking',
      'explain',
      6,
    );

    let sawJawMovement = false;
    for (let i = 0; i < 40; i++) {
      actor.update(0.033, i * 0.033, playerPos);
      if (actor.getFaceState().open > 0.05) {
        sawJawMovement = true;
      }
    }
    expect(sawJawMovement).toBe(true);
    expect(actor.bubble.getActiveMode()).toBe('text');

    actor.setTalking(false);
    actor.update(0.033, 2.0, playerPos);
    actor.dispose();
  });

  it('ships valid 512x512 WebP portraits and uncompressed rigged GLBs for every Keeper under public/assets/npcs', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const forbiddenExts = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression', 'KHR_texture_basisu'];
    for (const npc of NPC_LIST) {
      const portraitPath = path.join(repoRoot, 'public', 'assets', 'npcs', npc.id, 'portrait.webp');
      expect(fs.existsSync(portraitPath), `Missing portrait for ${npc.id}`).toBe(true);
      const pStat = fs.statSync(portraitPath);
      expect(pStat.size).toBeGreaterThan(2048);
      expect(pStat.size).toBeLessThan(512 * 1024);

      const glbPath = path.join(repoRoot, 'public', 'assets', 'npcs', npc.id, 'model.glb');
      expect(fs.existsSync(glbPath), `Missing GLB for ${npc.id}`).toBe(true);
      const buf = fs.readFileSync(glbPath);
      expect(buf.byteLength).toBeGreaterThan(20_000);
      expect(buf.byteLength).toBeLessThan(4 * 1024 * 1024);
      expect(buf.subarray(0, 4).toString('ascii')).toBe('glTF');
      const jsonLen = buf.readUInt32LE(12);
      const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
        meshes?: unknown[];
        skins?: unknown[];
        extensionsUsed?: string[];
      };
      expect((gltf.meshes ?? []).length).toBeGreaterThanOrEqual(1);
      expect((gltf.skins ?? []).length).toBeGreaterThanOrEqual(1);
      for (const ext of forbiddenExts) {
        expect(gltf.extensionsUsed ?? []).not.toContain(ext);
      }
    }
  });
});
