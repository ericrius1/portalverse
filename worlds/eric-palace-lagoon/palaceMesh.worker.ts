/// <reference lib="webworker" />
/**
 * Off the main thread: fetch Earth's Palace mesh from Earth's R2, inflate it, move it
 * into the room's frame and pack it smaller, then hand the buffers back without a copy.
 *
 * (Lowered by PALACE.floor, so the rotunda's podium deck is the room's y = 0, level with the portals.)
 *
 * Earth's format (pipeline/palace_model.py): zlib, then 'PFA1', vertex and index
 * counts, 9 floats a vertex (position, normal, uv, tag) and u32 indices. Packed here
 * to 7 words a vertex (position, uv, the normal octahedron-encoded in two snorm16s,
 * the tag): 28 bytes instead of 36.
 */
import { separateCoplanar } from '@ericrius1/weft/coplanar';
import { PALACE } from './layout';
import earth from './palace.json';

interface Request { url: string }
export interface PalaceMeshData { verts: ArrayBuffer; indices: ArrayBuffer; count: number }

const PAVING_MAT = 8;
const PODIUM_MAT = 12;
/** Earth's box_cluster pad corners sit at ±(2.3 + 1.25) = ±3.55 m around each cluster center (radius 5.0205 m) at STYLO = 0.2 m. */
const CLUSTER_PAD_R = Math.hypot(3.55, 3.55);
const CLUSTER_PAD_LIFT = 0.024;

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
    f[b + 1] = src[a + 1] - PALACE.earthDatum - PALACE.floor;
    f[b + 2] = x * s + z * c + az;
    f[b + 3] = src[a + 6];
    f[b + 4] = src[a + 7];
    const nx = src[a + 3], nz = src[a + 5];
    u[b + 5] = octEncode(nx * c - nz * s, src[a + 4], nx * s + nz * c);
    u[b + 6] = srcTags[a + 8];
  }
  const indices = raw.slice(12 + nv * 36, 12 + nv * 36 + ni * 4);
  // Separate Earth's box_cluster square pads from the curved colonnade wing stylobate:
  // both emit coplanar PAVING faces at y_earth = 0.20 m, which Z-fight from above.
  const idx = new Uint32Array(indices);
  const lift = new Uint8Array(nv);
  const clusters = earth.clusters;
  for (let t = 0; t + 2 < ni; t += 3) {
    const i0 = idx[t], i1 = idx[t + 1], i2 = idx[t + 2];
    const m0 = srcTags[i0 * 9 + 8] & 255;
    if (m0 !== PAVING_MAT && m0 !== PODIUM_MAT) continue;
    const m1 = srcTags[i1 * 9 + 8] & 255;
    const m2 = srcTags[i2 * 9 + 8] & 255;
    if (m1 !== m0 || m2 !== m0) continue;
    // Check if all 3 vertices lie on the exact square corner ring of one box_cluster pad.
    const x0 = src[i0 * 9], z0 = src[i0 * 9 + 2];
    const x1 = src[i1 * 9], z1 = src[i1 * 9 + 2];
    const x2 = src[i2 * 9], z2 = src[i2 * 9 + 2];
    for (let k = 0; k < clusters.length; k++) {
      const ccx = clusters[k][0], ccz = clusters[k][1];
      if (
        Math.abs(Math.hypot(x0 - ccx, z0 - ccz) - CLUSTER_PAD_R) < 0.06 &&
        Math.abs(Math.hypot(x1 - ccx, z1 - ccz) - CLUSTER_PAD_R) < 0.06 &&
        Math.abs(Math.hypot(x2 - ccx, z2 - ccz) - CLUSTER_PAD_R) < 0.06
      ) {
        if (Math.abs(src[i0 * 9 + 1] - PALACE.earthDatum - 0.2) < 0.04) lift[i0] = 1;
        if (Math.abs(src[i1 * 9 + 1] - PALACE.earthDatum - 0.2) < 0.04) lift[i1] = 1;
        if (Math.abs(src[i2 * 9 + 1] - PALACE.earthDatum - 0.2) < 0.04) lift[i2] = 1;
        break;
      }
    }
  }
  for (let i = 0; i < nv; i++) {
    if (lift[i]) f[i * 7 + 1] += CLUSTER_PAD_LIFT;
  }
  // Separate coplanar overlapping faces across the rotunda, piers, colonnade & hall using weft's coplanar solver.
  separateCoplanar(f, idx, { stride: 7, offset: 0, eps: 0.004 });
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
