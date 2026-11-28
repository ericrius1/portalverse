import type { NpcPlacement } from './types';

/**
 * Verified scenic stand points for each Keeper, spread across Eric's four rooms
 * (`eric-palace-lagoon`, `eric-biolum-grove`, `eric-sun-observatory`, `eric-starlight-pavilion`),
 * well clear of portals, stage dancers, water, and room colliders.
 *
 * Y is a baseline hint; NpcManager snaps every Keeper cleanly onto the room's live
 * terrainHeight / platforms when mounted.
 *
 * Yaw uses Three.js standard +Z forward convention (0 faces +Z toward arriving players).
 */
export const NPC_PLACEMENTS_BY_ID: Readonly<Record<string, NpcPlacement>> = Object.freeze({
  // ── Palace Lagoon (4 Keepers: wildflower meadow → lagoon cove bridge → north arch → star plaza)
  soraya: { position: [1.85, 0.06, 2.15], yaw: -0.58 },
  keola: { position: [-1.05, 0.08, 13.0], yaw: 0.45 },
  nori: { position: [2.05, 0.34, 24.8], yaw: -0.68 },
  solenne: { position: [12.0, 0, 46.0], yaw: -0.85 },

  // ── Bioluminescent Redwood Grove (4 Keepers staggered down the glowing forest trail)
  myrrow: { position: [2.9, 0, 21.0], yaw: -0.52 },
  fen: { position: [-3.0, 0, 7.5], yaw: 0.48 },
  cairn: { position: [3.0, 0, -7.5], yaw: -0.48 },
  vesper: { position: [-2.9, 0, -21.5], yaw: 0.52 },

  // ── Sun Observatory (4 Keepers across the marble bridge approaches & central armillary plaza)
  juno: { position: [-2.6, 0, 22.5], yaw: 0.48 },
  halcyon: { position: [5.4, 0, 3.6], yaw: -0.85 },
  ermelin: { position: [-5.6, 0, -3.4], yaw: 0.92 },
  dex: { position: [2.6, 0, -22.5], yaw: -0.52 },

  // ── Starlight Dance Pavilion (2 Keepers on the south & north lantern promenades;
  //    Soraya, Dex & Ermelin perform live on the central dance stage)
  dre: { position: [-2.5, 0, 25.5], yaw: 0.55 },
  lulu: { position: [2.5, 0, -24.5], yaw: -0.55 },
});

/** Default lead stand point per room for callers looking up by worldId. */
export const DEFAULT_NPC_PLACEMENTS: Readonly<Record<string, NpcPlacement>> = Object.freeze({
  'eric-palace-lagoon': NPC_PLACEMENTS_BY_ID.soraya,
  'eric-biolum-grove': NPC_PLACEMENTS_BY_ID.myrrow,
  'eric-sun-observatory': NPC_PLACEMENTS_BY_ID.halcyon,
  'eric-starlight-pavilion': NPC_PLACEMENTS_BY_ID.dre,
});

export function getNpcPlacement(npcIdOrWorldId: string, fallbackWorldId?: string): NpcPlacement {
  return (
    NPC_PLACEMENTS_BY_ID[npcIdOrWorldId] ??
    DEFAULT_NPC_PLACEMENTS[npcIdOrWorldId] ??
    (fallbackWorldId ? DEFAULT_NPC_PLACEMENTS[fallbackWorldId] : undefined) ?? {
      position: [2.6, 0, 15.0],
      yaw: -0.45,
    }
  );
}

export function getNpcModelUrl(npcId: string): string {
  return `/assets/npcs/${npcId}/model.glb`;
}

export function getNpcPortraitUrl(npcId: string): string {
  return `/assets/npcs/${npcId}/portrait.webp`;
}
