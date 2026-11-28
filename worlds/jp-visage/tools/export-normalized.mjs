// Run from repository root with Vite running:
// node --import tsx worlds/jp-visage/tools/export-normalized.mjs /tmp/head.json
import { writeFile } from 'node:fs/promises';
import { loadSplitHead } from '../headGeometry.ts';
globalThis.ProgressEvent ??= class { constructor(type, props) { Object.assign(this, props); this.type = type; } };
const head = await loadSplitHead('http://localhost:5173/worlds/jp-visage/assets/female_human_head_game.glb');
const parts = {};
for (const name of ['skin', 'eyes']) {
  const g = head[name];
  parts[name] = { positions: Array.from(g.attributes.position.array), normals: Array.from(g.attributes.normal.array), indices: Array.from(g.index.array) };
}
await writeFile(process.argv[2], JSON.stringify(parts));
