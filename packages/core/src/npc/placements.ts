import type { NpcPlacement } from './types';

/**
 * Verified scenic stand points for each Keeper beside their room's walkable promenade,
 * well clear of entrance/exit portals (Z = ±36.25) and room colliders.
 * Y is a baseline hint; NpcManager snaps every Keeper cleanly onto the room's live
 * terrainHeight / platforms when mounted.
 *
 * Yaw uses Three.js standard +Z forward convention (0 faces +Z toward arriving players
 * walking down from the +36.25 entrance portal).
 */
export const DEFAULT_NPC_PLACEMENTS: Readonly<Record<string, NpcPlacement>> = Object.freeze({
  'jp-world': { position: [-2.8, 0, 16.0], yaw: 0.45 },
  'jp-garden': { position: [2.4, 0, 15.0], yaw: -0.4 },
  fishpond: { position: [-2.2, 0, 14.0], yaw: 0.42 },
  'jp-reef': { position: [2.5, 0, 14.5], yaw: -0.42 },
  'jp-loft': { position: [-3.1, 0, 14.0], yaw: 0.55 },
  // Steady landing stones near the entrance before the drifting chasm begins
  'jp-abyss': { position: [1.35, 0, 30.8], yaw: -0.38 },
  'jp-visages-synthesis': { position: [-3.6, 0, 16.5], yaw: 0.5 },
  'jp-visages': { position: [-3.6, 0, 16.5], yaw: 0.5 },
  'jp-visages-claude': { position: [-3.6, 0, 16.5], yaw: 0.5 },
  'jp-visages-codex': { position: [-3.6, 0, 16.5], yaw: 0.5 },
  // Right on the inlaid 8-point Alhambra star plaza inside the rotunda north arch
  'eric-palace-lagoon': { position: [1.85, 0.06, 2.15], yaw: -0.58 },
  'laser-lab': { position: [3.6, 0, 15.0], yaw: -0.5 },
  'alpine-sled': { position: [-2.6, 0, 16.0], yaw: 0.46 },
  'eric-biolum-grove': { position: [2.7, 0, 15.5], yaw: -0.48 },
  // On the grand central marble plaza beneath the colossal brass armillary rings
  'eric-sun-observatory': { position: [4.5, 0, 3.4], yaw: -0.82 },
  'honey-hood': { position: [-3.1, 0, 17.5], yaw: 0.44 },
  // Beside the glowing rain shelter & cat bench on the level station promenade
  'doug-cassette-station': { position: [-3.6, 0, 13.5], yaw: 0.52 },
  // Starlight Dance Pavilion mounts Soraya, Dex & Ermelin live on stage; fallback spot sits beside promenade
  'eric-starlight-pavilion': { position: [-4.2, 0, 14.5], yaw: 0.45 },
});

export function getNpcPlacement(worldId: string): NpcPlacement {
  return DEFAULT_NPC_PLACEMENTS[worldId] ?? { position: [2.6, 0, 15.0], yaw: -0.45 };
}

export function getNpcModelUrl(npcId: string): string {
  return `/assets/npcs/${npcId}/model.glb`;
}

export function getNpcPortraitUrl(npcId: string): string {
  return `/assets/npcs/${npcId}/portrait.webp`;
}
