import type * as THREE from 'three/webgpu';

export type Vec3Tuple = [number, number, number];

export interface SpawnPoint {
  position: Vec3Tuple;
  /** Facing angle in radians around the Y axis (0 = facing -Z). */
  yaw: number;
  /** Optional initial camera pitch in radians (negative looks down). */
  pitch?: number;
  /** Whether the player starts in 3D flight mode at this spawn. */
  flying?: boolean;
}

export interface PortalDefinition {
  id: string;
  label: string;
  subtitle?: string;
  position: Vec3Tuple;
  /** Rotation around Y axis in radians. */
  yaw?: number;
  /** Destination world ID within this repo (or remote world ID if remoteUrl is set). */
  targetWorldId: string;
  /** Destination spawn key in the target world's manifest. */
  targetSpawnId?: string;
  /** Optional external URL for true federated cross-server portals. */
  remoteUrl?: string;
  /** Primary vortex/magic color hex string (e.g. "#22d3ee"). */
  colorA?: string;
  /** Secondary vortex/magic color hex string (e.g. "#a855f7"). */
  colorB?: string;
  /** Optional trigger radius in meters (defaults to 2.6). */
  triggerRadius?: number;
  /** Optional ID of the player who dynamically spawned this portal. */
  createdBy?: string;
  /**
   * Only enter from the front (+Z) face, like the route gates. Walking through
   * from behind passes harmlessly through the ring. Local to this client.
   */
  oneWay?: boolean;
}

export interface WorldManifest {
  id: string;
  name: string;
  owner?: string;
  author: string;
  description: string;
  accentColor: string;
  kind: 'local' | 'remote';
  remoteUrl?: string;
  /** Allow toggling 3D free-flight in this world (default true). */
  allowFlight?: boolean;
  spawns: Record<string, SpawnPoint>;
  /** Side portals placed by the room builder (reserved across all variants). */
  customPortalSlots?: number;
  portals?: PortalDefinition[];
}

export interface RegistryFile {
  version: number;
  defaultWorldId: string;
  worlds: WorldManifest[];
}

export interface PlayerIdentity {
  id: string;
  name: string;
  color: string;
}

export interface AvatarState {
  id: string;
  name: string;
  color: string;
  worldId: string;
  position: Vec3Tuple;
  yaw: number;
  velocityY: number;
  updatedAt: number;
}

export interface PortalHandoffPayload {
  version: 1;
  playerName: string;
  playerColor: string;
  fromWorldId: string;
  fromWorldName: string;
  returnUrl?: string;
  targetWorldId?: string;
  targetSpawnId?: string;
  sentAt: number;
}

export interface WorldPresenceSummary {
  worldId: string;
  playerCount: number;
  dynamicPortalCount: number;
}

/** Messages sent from client -> server over /ws */
export type ClientNetMessage =
  | {
      type: 'hello';
      player: PlayerIdentity;
      worldId: string;
      position: Vec3Tuple;
      yaw: number;
    }
  | {
      type: 'state';
      position: Vec3Tuple;
      yaw: number;
      velocityY: number;
    }
  | {
      type: 'switch_world';
      worldId: string;
      position: Vec3Tuple;
      yaw: number;
    }
  | {
      type: 'update_profile';
      name: string;
      color: string;
    }
  | {
      type: 'spawn_portal';
      worldId: string;
      portal: PortalDefinition;
    }
  | {
      type: 'remove_portal';
      worldId: string;
      portalId: string;
    }
  | {
      type: 'ping';
      t: number;
    };

/** Messages sent from server -> client over /ws */
export type ServerNetMessage =
  | {
      type: 'welcome';
      playerId: string;
      worldId: string;
      players: AvatarState[];
      roster: AvatarState[];
      dynamicPortals: PortalDefinition[];
    }
  | {
      type: 'player_joined';
      player: AvatarState;
    }
  | {
      type: 'player_left';
      playerId: string;
      worldId: string;
    }
  | {
      type: 'player_state';
      playerId: string;
      worldId: string;
      position: Vec3Tuple;
      yaw: number;
      velocityY: number;
      updatedAt: number;
    }
  | {
      type: 'roster_update';
      roster: AvatarState[];
      event?: string;
    }
  | {
      type: 'portal_spawned';
      worldId: string;
      portal: PortalDefinition;
    }
  | {
      type: 'portal_removed';
      worldId: string;
      portalId: string;
    }
  | {
      type: 'pong';
      t: number;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

export type ConnectionState = 'connecting' | 'connected' | 'offline';

export interface PortalVisualHandle {
  portal: PortalDefinition;
  group: THREE.Group;
  /** Planar XY opening, with UVs spanning its bounds and local +Z facing out. */
  passage?: boolean;
  aperture: THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
  /** World-space center used for proximity triggering. */
  triggerCenter: THREE.Vector3;
  triggerRadius: number;
  /** Optional vertical cylinder bounds [minY, maxY] for tall custom portals. */
  triggerYRange?: [number, number];
  setProximity?: (proximity01: number) => void;
  update?: (dt: number, elapsed: number) => void;
  dispose?: () => void;
}

export interface PlatformCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Top walkable Y height of this surface. */
  topY: number;
}

export interface WorldContext {
  /** Each mount is independent. Preview mounts run scene animation without player input. */
  readonly mode: 'active' | 'preview';
  /**
   * Install player-only behavior each time this instance becomes the active room.
   * Return a cleanup function to stop it when the player leaves and the room goes
   * back to being a preview (rooms you just left stay mounted for instant return).
   */
  onActivate: (fn: () => void | (() => void)) => void;
  scene: THREE.Scene;
  renderer: THREE.WebGPURenderer;
  /** Place a default archway portal prefab in the current world. */
  addPortal: (portal: PortalDefinition) => PortalVisualHandle;
  /** Register a custom-rendered portal (reserve it with `customPortalSlots` first). */
  registerCustomPortal: (handle: PortalVisualHandle) => void;
  /** Register an animated object/callback updated every frame. */
  onUpdate: (fn: (dt: number, elapsed: number) => void) => void;
  /** Register a cleanup callback when leaving the world. */
  onDispose: (fn: () => void) => void;
  /** Register walkable floor height / platform collision bounds. */
  addPlatform: (bounds: PlatformCollider) => void;
  /** Optional procedural terrain height function for rolling hills/meadows. */
  setTerrainHeight: (fn: (x: number, z: number) => number) => void;
  /** Override the default player spawn/flight mode on mount. */
  configureSpawn: (spawn: SpawnPoint) => void;
  /** Trigger entering a portal programmatically. */
  enterPortal: (portal: PortalDefinition) => void;
}

export interface WorldModule {
  manifest: WorldManifest;
  mount: (ctx: WorldContext) => void | Promise<void>;
}
