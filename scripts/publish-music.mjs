// Publish the soundtrack to R2. The stems and portal sounds (made in Suno Studio, cut into seamless 8-bar loops at
// 88 BPM) are served from Cloudflare R2, not from the Railway deploy: the portalverse-assets bucket behind its asset
// Worker (deploy/assets, https://portalverse-assets.ericrius1.workers.dev). Each file is content-addressed,
// objects/<sha256>/<name>, immutable and never overwritten.
//
// The audio files stay out of git (assets-src/ is ignored). What's committed is the map the game reads:
//   packages/core/src/audio/musicAssets.json   stem id -> { webm, m4a } URLs
//
//   node scripts/publish-music.mjs         upload assets-src/music/<id>.{webm,m4a} that aren't on R2 yet (Wrangler,
//                                          as you're logged in there), then rewrite the map. Commit the map.
//   node scripts/publish-music.mjs --check is every mapped file readable from the Worker? (exit 1 if not)
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'assets-src', 'music');
const MAP = join(ROOT, 'packages', 'core', 'src', 'audio', 'musicAssets.json');
const BUCKET = 'portalverse-assets';
const ORIGIN = 'https://portalverse-assets.ericrius1.workers.dev/';
const TYPES = { '.webm': 'audio/webm', '.m4a': 'audio/mp4' };

const readMap = () => (existsSync(MAP) ? JSON.parse(readFileSync(MAP, 'utf8')) : {});
const run = (args) => new Promise((ok, fail) => {
  const p = spawn('npx', ['-y', 'wrangler@4.158.0', ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => (code === 0 ? ok(out) : fail(new Error(out.trim().split('\n').slice(-3).join(' ')))));
});

async function check() {
  let bad = 0;
  for (const [id, entry] of Object.entries(readMap())) {
    for (const url of Object.values(entry)) {
      const r = await fetch(url, { method: 'HEAD' }).catch(() => null);
      if (!r?.ok) { bad++; console.log(`  ${id}: ${url} -> ${r ? r.status : 'unreachable'}`); }
    }
  }
  console.log(bad ? `${bad} missing` : 'every mapped file is on R2');
  process.exit(bad ? 1 : 0);
}

async function publish() {
  const map = readMap();
  const files = existsSync(SRC) ? readdirSync(SRC).filter((f) => TYPES[extname(f)]) : [];
  if (!files.length) { console.log(`nothing in ${SRC}`); return; }
  for (const f of files.sort()) {
    const ext = extname(f), id = f.slice(0, -ext.length), body = readFileSync(join(SRC, f));
    const key = `objects/${createHash('sha256').update(body).digest('hex')}/${f}`;
    const url = ORIGIN + key;
    if (map[id]?.[ext.slice(1)] === url) continue;
    await run(['r2', 'object', 'put', `${BUCKET}/${key}`, '--file', join(SRC, f), '--content-type', TYPES[ext],
      '--cache-control', 'public, max-age=31536000, immutable', '--remote']);
    map[id] = { ...map[id], [ext.slice(1)]: url };
    console.log(`  ${f} -> ${key}`);
  }
  const sorted = Object.fromEntries(Object.keys(map).sort().map((k) => [k, { webm: map[k].webm, m4a: map[k].m4a }]));
  writeFileSync(MAP, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`map: ${MAP.slice(ROOT.length + 1)} (${Object.keys(sorted).length} sounds)`);
}

await (process.argv.includes('--check') ? check() : publish());
