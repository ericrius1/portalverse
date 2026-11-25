import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three/webgpu';
import type { RegistryFile, SpawnPoint, WorldModule } from '../types';
import { ROUTE_LENGTH, RUN_SPEED, routeGates, threshold } from '../portal/roomLayout';
import { RoomInstance } from '../engine/RoomInstance';
import { framePortal, portalPixels, PortalPreviews } from '../engine/PortalPreviews';
import { WorldRegistry } from '../portal/registry';
import catalog from '../../../../registry.json';

describe('room modules', () => {
  it('loads every local catalog entry and matches every room folder to its manifest', async () => {
    const modules = import.meta.glob<{ default: WorldModule }>('../../../../worlds/*/index.ts');
    const loaders = Object.fromEntries(Object.entries(modules).map(([path, load]) => [path.split('/').at(-2)!, load]));
    const registry = new WorldRegistry(catalog as unknown as RegistryFile, loaders);
    const localIds = registry.listWorlds().filter(room => room.kind === 'local').map(room => room.id);
    expect(Object.keys(loaders).sort()).toEqual(localIds.sort());
    for (const id of localIds) {
      const room = await registry.loadWorld(id);
      expect(room.manifest).toEqual(registry.getManifest(id));
      expect(room.manifest.spawns.default.position).toHaveLength(3);
    }
  });
});

describe('portal perspective', () => {
  const spawn: SpawnPoint = { position: [8, 0, 2], yaw: Math.PI / 2 };
  it('keeps destination points on the same physical pixels as the live scene up to the threshold', () => {
    const aperture = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), new THREE.MeshBasicMaterial());
    aperture.position.set(0, 1, 0);
    aperture.updateMatrixWorld();
    const size = new THREE.Vector2(2560, 1440);
    for (const system of [THREE.WebGLCoordinateSystem, THREE.WebGPUCoordinateSystem] as const) {
      const viewer = new THREE.PerspectiveCamera(60, size.x / size.y, 0.1, 450);
      viewer.coordinateSystem = system;
      viewer.updateProjectionMatrix();
      const camera = new THREE.PerspectiveCamera();
      for (const side of [1, -1]) {
        for (const distance of [12, 2, 0.05, 0.001]) {
          viewer.position.set(0.25, 1.65, side * distance);
          viewer.rotation.set(-0.08, side < 0 ? Math.PI : 0, 0, 'YXZ');
          viewer.updateMatrixWorld();
          const rect = portalPixels(aperture, viewer, size, new THREE.Vector4());
          if (distance < 0.1) expect(rect.toArray()).toEqual([0, 0, size.x, size.y]);
          framePortal(camera, viewer, aperture, spawn, 0, 0, size, rect);
          const local = new THREE.Vector3(0.8, 1, -side * 6);
          const expected = local.clone().project(viewer);
          const dest = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), spawn.yaw - (side < 0 ? Math.PI : 0));
          const pixel = dest.add(new THREE.Vector3().fromArray(spawn.position)).project(camera);
          expect(rect.x + (pixel.x + 1) * rect.z / 2).toBeCloseTo((expected.x + 1) * size.x / 2);
          expect(rect.y + (1 - pixel.y) * rect.w / 2).toBeCloseTo((1 - expected.y) * size.y / 2);
          expect(pixel.z).toBeLessThan(1);
          expect(pixel.z).toBeGreaterThan(system === THREE.WebGPUCoordinateSystem ? 0 : -1);
        }
      }
    }
  });
});

it('gives each local room reciprocal entrance and exit thresholds five sprint seconds apart', () => {
  const rooms = (catalog as unknown as RegistryFile).worlds;
  for (const room of rooms.filter(room => room.kind === 'local')) {
    const gates = routeGates(room.id, rooms);
    expect(gates.map(g => g.id)).toEqual(['entrance', 'exit']);
    expect(gates[0].position[2] - gates[1].position[2]).toBe(ROUTE_LENGTH);
    expect(ROUTE_LENGTH / RUN_SPEED).toBe(5);
    for (const gate of gates) {
      const opposite = routeGates(gate.targetWorldId, rooms).find(p => p.id === gate.targetSpawnId)!;
      expect(opposite.targetWorldId).toBe(room.id);
      expect(threshold(gate.id as 'entrance' | 'exit').position).toEqual(gate.position);
    }
  }
});

it('promotes the same in-flight preview and transfers disposal to the active scene', async () => {
  const instance = { dispose: vi.fn() } as unknown as RoomInstance;
  const mount = vi.spyOn(RoomInstance, 'mount').mockResolvedValue(instance);
  try {
    const loader = vi.fn(async () => ({}) as WorldModule);
    const previews = new PortalPreviews({} as THREE.WebGPURenderer, loader);
    const pending = previews.prepare('jp-world', 'nexus');
    expect(previews.prepare('jp-world', 'nexus')).toBe(pending);
    expect(previews.take('jp-world', 'nexus')).toBe(pending);
    previews.clear();
    expect(await pending).toBe(instance);
    expect(mount).toHaveBeenCalledTimes(1);
    expect(instance.dispose).not.toHaveBeenCalled();
  } finally {
    mount.mockRestore();
  }
});
