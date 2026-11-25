import catalog from '../../../../registry.json';
import type { RegistryFile, WorldModule } from '../types';

/** Bind the room's scene builder to the same manifest the directory and server use. */
export function defineRoom(id: string, scene: Pick<WorldModule, 'mount'>): WorldModule {
  const manifest = (catalog as unknown as RegistryFile).worlds.find(room => room.id === id);
  if (manifest?.kind !== 'local' || !manifest.spawns.default) {
    throw new Error(`Room "${id}" needs a local registry entry with a default spawn`);
  }
  return { manifest, mount: scene.mount };
}
