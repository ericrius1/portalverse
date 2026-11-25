import type { Plugin } from 'vite';
import limits from './room-budgets.json';

/** Charge dependencies shared by several rooms to each room that needs them. */
export function roomBuildBudget(): Plugin {
  return {
    name: 'room-build-budget',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const outputs = Object.values(bundle);
      const sizes = new Map(outputs.map(file => [file.fileName, Buffer.byteLength(
        file.type === 'chunk' ? file.code : file.source,
      )]));
      function collect(start: string[], includeDynamic: boolean, alreadyLoaded = new Set<string>()) {
        const seen = new Set<string>();
        const pending = [...start];
        while (pending.length) {
          const name = pending.pop()!;
          if (seen.has(name) || alreadyLoaded.has(name)) continue;
          seen.add(name);
          const file = bundle[name];
          if (file?.type !== 'chunk') continue;
          pending.push(...file.imports, ...file.referencedFiles,
            ...(file.viteMetadata?.importedAssets ?? []), ...(file.viteMetadata?.importedCss ?? []));
          if (includeDynamic) pending.push(...file.dynamicImports);
        }
        return seen;
      }
      const bootstrap = collect(outputs.filter(f => f.type === 'chunk' && f.isEntry)
        .map(f => f.fileName), false);
      for (const file of outputs) {
        if (file.type !== 'chunk') continue;
        const id = file.facadeModuleId?.match(/\/worlds\/([^/]+)\/index\.ts$/)?.[1];
        if (!id) continue;
        // The entry imports the room catalog lazily. Stop at bootstrap chunks so
        // importing shared engine symbols doesn't charge the entire catalog.
        const seen = collect([file.fileName], true, bootstrap);
        let bytes = 0;
        for (const name of seen) {
          const size = sizes.get(name) ?? 0;
          if (size > limits.fileBytes) this.error(`${id}: ${name} exceeds the 4 MiB file budget`);
          bytes += size;
        }
        if (bytes > limits.roomBytes) this.error(`${id} exceeds the 12 MiB bundled room budget`);
        this.info(`${id}: ${(bytes / 1024).toFixed(1)} KiB bundled beyond app startup`);
      }
    },
  };
}
