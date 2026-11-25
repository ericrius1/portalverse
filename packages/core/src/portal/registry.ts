import type { RegistryFile, WorldManifest, WorldModule } from '../types';
import { sanitizeHttpUrl, sanitizeId } from './handoff';

export type LocalWorldLoader = () => Promise<{ default: WorldModule } | WorldModule>;

function isWorldModule(value: unknown): value is WorldModule {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as WorldModule).mount === 'function' &&
    !!(value as WorldModule).manifest &&
    typeof (value as WorldModule).manifest.id === 'string'
  );
}

function cloneManifest(manifest: WorldManifest): WorldManifest {
  return typeof structuredClone === 'function'
    ? structuredClone(manifest)
    : (JSON.parse(JSON.stringify(manifest)) as WorldManifest);
}

/**
 * Lookup + lazy loading for every world the client knows about: local worlds
 * declared in `registry.json` (each backed by a dynamic-import loader) plus
 * remote worlds registered at runtime (reached through federated portals).
 */
export class WorldRegistry {
  private readonly manifests = new Map<string, WorldManifest>();
  private readonly loaders = new Map<string, LocalWorldLoader>();
  private readonly loaded = new Map<string, Promise<WorldModule>>();
  private readonly defaultWorldId: string;

  constructor(registryFile: RegistryFile, localLoaders: Record<string, LocalWorldLoader>) {
    for (const manifest of registryFile.worlds ?? []) {
      if (!sanitizeId(manifest?.id)) continue;
      this.manifests.set(manifest.id, cloneManifest(manifest));
    }
    for (const [worldId, loader] of Object.entries(localLoaders ?? {})) {
      if (typeof loader === 'function') this.loaders.set(worldId, loader);
    }

    const firstLocal = [...this.manifests.values()].find((m) => m.kind === 'local');
    this.defaultWorldId = this.manifests.has(registryFile.defaultWorldId)
      ? registryFile.defaultWorldId
      : (firstLocal?.id ?? registryFile.defaultWorldId);
  }

  getDefaultWorldId(): string {
    return this.defaultWorldId;
  }

  listWorlds(): WorldManifest[] {
    return [...this.manifests.values()];
  }

  getManifest(worldId: string): WorldManifest | undefined {
    return this.manifests.get(worldId);
  }

  hasWorld(worldId: string): boolean {
    return this.manifests.has(worldId) || this.loaders.has(worldId);
  }

  /** Adds (or replaces) a remote world. Local worlds cannot be shadowed. */
  registerRemoteWorld(manifest: WorldManifest): void {
    const id = sanitizeId(manifest?.id);
    if (!id) throw new Error('Remote world manifest needs a valid id');
    const existing = this.manifests.get(id);
    if ((existing && existing.kind === 'local') || this.loaders.has(id)) {
      throw new Error(`Cannot register remote world "${id}": a local world already uses that id`);
    }
    const remoteUrl = sanitizeHttpUrl(manifest.remoteUrl);
    if (!remoteUrl) {
      throw new Error(`Remote world "${id}" needs an http(s) remoteUrl`);
    }
    this.manifests.set(id, { ...cloneManifest(manifest), id, kind: 'remote', remoteUrl });
  }

  /** Lazily imports a local world (once; concurrent callers share the promise). */
  loadWorld(worldId: string): Promise<WorldModule> {
    const cached = this.loaded.get(worldId);
    if (cached) return cached;

    const manifest = this.manifests.get(worldId);
    if (manifest?.kind === 'remote') {
      return Promise.reject(
        new Error(`World "${worldId}" is remote; travel there via ${manifest.remoteUrl}`),
      );
    }
    const loader = this.loaders.get(worldId);
    if (!loader) {
      return Promise.reject(new Error(`Unknown world "${worldId}" (no local loader registered)`));
    }

    const promise = (async () => {
      const result = await loader();
      const mod = isWorldModule(result)
        ? result
        : isWorldModule((result as { default?: unknown })?.default)
          ? (result as { default: WorldModule }).default
          : null;
      if (!mod) throw new Error(`World "${worldId}" loader did not return a WorldModule`);
      if (mod.manifest.id !== worldId) {
        throw new Error(
          `World "${worldId}" loader returned a module whose manifest id is "${mod.manifest.id}"`,
        );
      }
      if (!this.manifests.has(worldId)) this.manifests.set(worldId, cloneManifest(mod.manifest));
      return mod;
    })();

    this.loaded.set(worldId, promise);
    // Failed loads are not cached so a retry (e.g. after a HMR fix) can succeed.
    promise.catch(() => {
      if (this.loaded.get(worldId) === promise) this.loaded.delete(worldId);
    });
    return promise;
  }
}
