import { readdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Plugin } from 'vite';

/** File types that shrink; images such as PNG, JPEG and WebP are compressed already. */
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.gltf', '.glb', '.hdr', '.svg', '.wasm', '.txt']);
/** Below this a file fits in a packet or two either way. */
const MIN_BYTES = 1024;

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/** Write `.br` and `.gz` copies beside every file under `root` that gets smaller compressed. */
export async function precompressDirectory(root: string): Promise<void> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() || !COMPRESSIBLE.has(extname(entry.name).toLowerCase())) return;
    const path = join(entry.parentPath, entry.name);
    const source = await readFile(path);
    if (source.length < MIN_BYTES) return;
    const copies = await Promise.all([
      brotli(source, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
        },
      }).then((data) => ({ suffix: '.br', data })),
      gz(source, { level: constants.Z_BEST_COMPRESSION }).then((data) => ({ suffix: '.gz', data })),
    ]);
    await Promise.all(copies
      .filter(({ data }) => data.length < source.length)
      .map(({ suffix, data }) => writeFile(path + suffix, data)));
  }));
}

/** Compress the finished build once, so the server has no compressing to do per request. */
export function precompress(): Plugin {
  let outDir = '';
  return {
    name: 'portalverse-precompress',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    async closeBundle() {
      await precompressDirectory(outDir);
    },
  };
}
