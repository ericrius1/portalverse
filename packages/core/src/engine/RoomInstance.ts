import catalog from '../../../../registry.json';
import { routeGates, threshold, SIDE_PORTALS } from '../portal/roomLayout';
import { createPaintingPortal } from './PaintingPortal';
import * as THREE from 'three/webgpu';
import type { RegistryFile, HubStyle, PlatformCollider, PortalDefinition, PortalVisualHandle, SpawnPoint, WorldModule } from '../types';
import { createArchwayPortal } from './PortalMesh';

/** One mount of a room. The active room and every preview own independent state. */
export class RoomInstance {
  readonly scene = new THREE.Scene();
  readonly portals: PortalVisualHandle[] = [];
  readonly platforms: PlatformCollider[] = [];
  terrainHeight: ((x: number, z: number) => number) | null = null;
  private active = false;
  private enter: (portal: PortalDefinition) => void = () => {};
  private readonly activation: Array<() => void> = [];
  private spawnOverride?: SpawnPoint;
  private readonly updates: Array<(dt: number, elapsed: number) => void> = [];
  private readonly cleanups: Array<() => void> = [];

  private constructor(readonly module: WorldModule) {}

  static async mount(module: WorldModule, renderer: THREE.WebGPURenderer, hubStyle: HubStyle): Promise<RoomInstance> {
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
        scene: room.scene, renderer, hubStyle,
        get mode() { return room.active ? 'active' : 'preview'; },
        onActivate: fn => room.activation.push(fn),
        enterPortal: portal => room.enter(portal),
        addPortal: portal => registerCustom(createArchwayPortal(portal)),
        registerCustomPortal: registerCustom,
        addPlatform: bounds => room.platforms.push(bounds),
        setTerrainHeight: fn => { room.terrainHeight = fn; },
        configureSpawn: spawn => { room.spawnOverride = spawn; },
        onUpdate: fn => room.updates.push(fn),
        onDispose: fn => room.cleanups.push(fn),
      });
      for (const link of links) register(createPaintingPortal(link));
      for (const gate of routeGates(module.manifest.id, (catalog as unknown as RegistryFile).worlds)) {
        register(createPaintingPortal(gate));
      }
      return room;
    } catch (error) {
      room.dispose();
      throw error;
    }
  }

  activate(enter: (portal: PortalDefinition) => void): void {
    this.active = true;
    this.enter = enter;
    for (const fn of this.activation) fn();
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
    for (const fn of this.cleanups) {
      try { fn(); } catch (error) { console.warn('Room cleanup failed', error); }
    }
    for (const portal of this.portals) portal.dispose?.();
    this.scene.clear();
  }
}
