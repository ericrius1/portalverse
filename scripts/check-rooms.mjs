// Run from the repository root. Sizes are raw bytes, including files Vite inlines.
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const MiB = 1024 ** 2;
const { roomBytes: maxRoomBytes, fileBytes: maxFileBytes, textureEdge: maxTextureEdge } =
  JSON.parse(await readFile(new URL('./room-budgets.json', import.meta.url), 'utf8'));
const catalog = JSON.parse(await readFile(join(root, 'registry.json'), 'utf8'));
const rooms = catalog.worlds.filter(room => room.kind === 'local');
const errors = [];

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (entry.isFile()) result.push(path);
    else errors.push(`${relative(root, path)} must be a regular file`);
  }
  return result;
}

function imageDimensions(bytes, path) {
  if (/\.png$/i.test(path) && bytes.length >= 24 && bytes.toString('hex', 0, 8) === '89504e470d0a1a0a') {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (/\.ktx2$/i.test(path) && bytes.length >= 48 && bytes.toString('hex', 0, 12) === 'ab4b5458203230bb0d0a1a0a') {
    return [bytes.readUInt32LE(20), bytes.readUInt32LE(24)];
  }
  return [];
}

const folders = await readdir(join(root, 'worlds'), { withFileTypes: true });
const ids = new Set(rooms.map(room => room.id));
if (ids.size !== rooms.length) errors.push('Local room IDs must be unique');
for (const folder of folders) {
  if (!folder.isDirectory() || !ids.has(folder.name)) errors.push(`Unregistered room folder worlds/${folder.name}`);
}
for (const room of rooms) {
  if (!folders.some(f => f.isDirectory() && f.name === room.id)) {
    errors.push(`Missing worlds/${room.id}`);
    continue;
  }
  const slots = room.customPortalSlots ?? 0;
  const links = room.portals ?? [];
  if (!Array.isArray(links) || !Number.isInteger(slots) || slots < 0 || slots + links.length > 5) {
    errors.push(`${room.id} exceeds five side portals`);
  } else {
    const portalIds = new Set(['entrance', 'exit']);
    for (const link of links) {
      if (!link.id || portalIds.has(link.id) || (!link.remoteUrl && !ids.has(link.targetWorldId))) {
        errors.push(`${room.id} has an invalid side portal "${link.id}"`);
      }
      portalIds.add(link.id);
    }
  }
  const dir = join(root, 'worlds', room.id);
  const paths = await files(dir);
  if (!paths.includes(join(dir, 'index.ts'))) errors.push(`${room.id} needs index.ts`);
  let total = 0;
  for (const path of paths) {
    const label = relative(root, path);
    const { size } = await lstat(path);
    total += size;
    if (size > maxFileBytes) errors.push(`${label} exceeds 4 MiB`);
    if (/\.(png|ktx2)$/i.test(path) && size <= maxFileBytes) {
      const dimensions = imageDimensions(await readFile(path), path);
      if (dimensions.length !== 2 || dimensions.some(edge => edge < 1 || edge > maxTextureEdge)) {
        errors.push(`${label} needs valid dimensions of 1–2048 pixels per edge`);
      }
    }
  }
  if (total > maxRoomBytes) errors.push(`${room.id} exceeds 12 MiB total`);
  console.log(`${room.id}: ${(total / MiB).toFixed(3)} MiB / 12 MiB`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
}
