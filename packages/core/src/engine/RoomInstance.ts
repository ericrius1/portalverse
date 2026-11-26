import catalog from '../../../../registry.json';
import { routeGates, threshold, SIDE_PORTALS } from '../portal/roomLayout';
import * as THREE from 'three/webgpu';
import type { FallSettings, RegistryFile, PlatformCollider, PlayerView, PortalDefinition, PortalVisualHandle, SpawnPoint, TerrainHeight, WorldModule } from '../types';
import { createArchwayPortal } from './PortalMesh';
import { breathe } from './breathe';

const noEntry = (): void => {};

/**
 * One mount of a room. The active room and every preview own independent state.
 * A room can switch between active and preview many times: the engine keeps the
 * room you just left mounted as a preview so turning back is instant.
 */
export class RoomInstance {
  readonly scene = new THREE.Scene();
  readonly portals: PortalVisualHandle[] = [];
  readonly platforms: PlatformCollider[] = [];
  terrainHeight: TerrainHeight | null = null;
  /** Set when the room lets players fall; null keeps a floor everywhere. */
  falling: FallSettings | null = null;
  private active = false;
  private player: PlayerView | null = null;
  private enter: (portal: PortalDefinition) => void = noEntry;
  private readonly activation: Array<() => void | (() => void)> = [];
  private activeCleanups: Array<() => void> = [];
  private spawnOverride?: SpawnPoint;
  private readonly updates: Array<(dt: number, elapsed: number) => void> = [];
  private readonly cleanups: Array<() => void> = [];

  private constructor(readonly module: WorldModule) {}

  static async mount(module: WorldModule, renderer: THREE.WebGPURenderer): Promise<RoomInstance> {
    const room = new RoomInstance(module);
    const register = (handle: PortalVisualHandle) => {
      room.scene.add(handle.group);
      room.portals.push(handle);
      return handle;
    };
    const slots = module.manifest.customPortalSlots ?? 0;
    const links = module.manifest.portals ?? [];
    if (!Number.isInteger(slots) || slots < 0 || slots + links.length > SIDE_PORTALS) {
      throw new Error(`${module.manifest.id} exceeds the five side-portal slots`);
    }
    const registerCustom = (handle: PortalVisualHandle) => {
      if (['entrance', 'exit'].includes(handle.portal.id) || room.portals.some(p => p.portal.id === handle.portal.id)) {
        handle.dispose?.();
        throw new Error(`Duplicate or reserved portal ID "${handle.portal.id}" in ${module.manifest.id}`);
      }
      if (room.portals.length >= slots) {
        handle.dispose?.();
        throw new Error(`Declare customPortalSlots for ${module.manifest.id} before adding this portal`);
      }
      return register(handle);
    };
    try {
      await module.mount({
        scene: room.scene,
        renderer,
        get mode() { return room.active ? 'active' : 'preview'; },
        get player() { return room.player; },
        onActivate: fn => room.activation.push(fn),
        enterPortal: portal => room.enter(portal),
        addPortal: portal => registerCustom(createArchwayPortal(portal, { passage: true })),
        registerCustomPortal: registerCustom,
        addPlatform: bounds => room.platforms.push(bounds),
        setTerrainHeight: fn => { room.terrainHeight = fn; },
        allowFalling: (settings = {}) => { room.falling = { ...settings }; },
        breathe,
        configureSpawn: spawn => { room.spawnOverride = spawn; },
        onUpdate: fn => room.updates.push(fn),
        onDispose: fn => room.cleanups.push(fn),
      });
      for (const link of links) register(createArchwayPortal(link, { passage: true }));
      for (const gate of routeGates(module.manifest.id, (catalog as unknown as RegistryFile).worlds)) {
        register(createArchwayPortal(gate, { passage: true, routeGate: true }));
      }
      return room;
    } catch (error) {
      room.dispose();
      throw error;
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Make this the room the player is in and start its player-only behavior. */
  activate(enter: (portal: PortalDefinition) => void, player: PlayerView | null = null): void {
    this.enter = enter;
    this.player = player;
    if (this.active) return;
    this.active = true;
    for (const fn of this.activation) {
      try {
        const cleanup = fn();
        if (typeof cleanup === 'function') this.activeCleanups.push(cleanup);
      } catch (error) {
        console.warn('Room activation failed', error);
      }
    }
  }

  /** Return to preview mode: stop player-only behavior but keep the scene mounted. */
  deactivate(): void {
    if (!this.active) return;
    this.active = false;
    this.player = null;
    this.enter = noEntry;
    const cleanups = this.activeCleanups.reverse();
    this.activeCleanups = [];
    for (const fn of cleanups) {
      try { fn(); } catch (error) { console.warn('Room deactivation failed', error); }
    }
  }

  spawn(id?: string): SpawnPoint {
    if (id === 'entrance' || id === 'exit') return threshold(id);
    const spawns = this.module.manifest.spawns;
    return (id && id !== 'default' ? spawns[id] : undefined) ?? this.spawnOverride ?? spawns.default;
  }

  update(dt: number, elapsed: number): void {
    for (const fn of this.updates) fn(dt, elapsed);
  }

  dispose(): void {
    this.deactivate();
    for (const fn of this.cleanups) {
      try { fn(); } catch (error) { console.warn('Room cleanup failed', error); }
    }
    for (const portal of this.portals) portal.dispose?.();
    this.scene.clear();
  }
}
