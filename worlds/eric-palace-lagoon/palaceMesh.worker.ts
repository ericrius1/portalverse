/// <reference lib="webworker" />
/**
 * Off the main thread: fetch Earth's Palace mesh from Earth's R2, inflate it, move it
 * into the room's frame and pack it smaller, then hand the buffers back without a copy.
 *
 * Earth's format (pipeline/palace_model.py): zlib, then 'PFA1', vertex and index
 * counts, 9 floats a vertex (position, normal, uv, tag) and u32 indices. Packed here
 * to 7 words a vertex (position, uv, the normal octahedron-encoded in two snorm16s,
 * the tag): 28 bytes instead of 36.
 */
import { PALACE } from './layout';

interface Request { url: string }
export interface PalaceMeshData { verts: ArrayBuffer; indices: ArrayBuffer; count: number }

function octEncode(x: number, y: number, z: number): number {
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / l, v = y / l;
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  const su = Math.round(Math.max(-1, Math.min(1, u)) * 32767) & 0xffff;
  const sv = Math.round(Math.max(-1, Math.min(1, v)) * 32767) & 0xffff;
  return (su | (sv << 16)) >>> 0;
}

async function load(url: string): Promise<PalaceMeshData> {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`palace mesh: ${response.status}`);
  const raw = await new Response(response.body.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer();
  const dv = new DataView(raw);
  if (dv.getUint32(0, true) !== 0x31414650) throw new Error('palace mesh: not a PFA1 mesh');
  const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true);
  const src = new Float32Array(raw, 12, nv * 9);
  const srcTags = new Uint32Array(raw, 12, nv * 9);

  const c = Math.cos(PALACE.turn), s = Math.sin(PALACE.turn);
  const [cx, cz] = PALACE.earthCentre;
  const [ax, az] = PALACE.at;
  const out = new ArrayBuffer(nv * 28);
  const f = new Float32Array(out);
  const u = new Uint32Array(out);
  for (let i = 0; i < nv; i++) {
    const a = i * 9, b = i * 7;
    const x = src[a] - cx, z = src[a + 2] - cz;
    f[b] = x * c - z * s + ax;
    f[b + 1] = src[a + 1] - PALACE.earthDatum;
    f[b + 2] = x * s + z * c + az;
    f[b + 3] = src[a + 6];
    f[b + 4] = src[a + 7];
    const nx = src[a + 3], nz = src[a + 5];
    u[b + 5] = octEncode(nx * c - nz * s, src[a + 4], nx * s + nz * c);
    u[b + 6] = srcTags[a + 8];
  }
  const indices = raw.slice(12 + nv * 36, 12 + nv * 36 + ni * 4);
  return { verts: out, indices, count: ni };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const mesh = await load(event.data.url);
    (self as unknown as Worker).postMessage({ mesh }, [mesh.verts, mesh.indices]);
  } catch (error) {
    (self as unknown as Worker).postMessage({ error: String(error) });
  }
};
