import * as THREE from 'three/webgpu';
import { breathe, disposeObject, loadGLB, seededRandom } from '@portalverse/core/rooms/kit';
import { HEAD_CENTER_X, HEAD_CENTER_Z, HEAD_SINK_Y } from './layout';

export interface SplitHeadAssets {
  skin: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  /** Normalized local centers of the two eyeballs (for socket AO and weeping blood trails). */
  leftEyeCenter: THREE.Vector3;
  rightEyeCenter: THREE.Vector3;
  eyeRadius: number;
}

const headCache = new Map<string, Promise<SplitHeadAssets>>();

/**
 * Load the head GLB once, split out the two eyeball connected components from the stone head/skin,
 * normalize it upright centered on (0, 0, 0) with the under-chin/neck at y = 0, trim buried
 * shoulder triangles deep underground. Shared across mounts; distance LODs are prepared offline.
 */
export function loadSplitHead(url: string): Promise<SplitHeadAssets> {
  let pending = headCache.get(url);
  if (!pending) {
    pending = buildSplitHead(url).catch(err => {
      headCache.delete(url);
      throw err;
    });
    headCache.set(url, pending);
  }
  return pending;
}

/**
 * Normal-aware vertex-clustering decimation: merges vertices inside each grid cell that face
 * the same cardinal direction so thin features (eyelids, lips, nose) stay intact while cutting
 * distant triangle count cleanly.
 */
export async function decimateGeometry(
  src: THREE.BufferGeometry,
  cell: number,
  pause: () => Promise<void> = breathe,
): Promise<THREE.BufferGeometry> {
  const posAttr = src.getAttribute('position') as THREE.BufferAttribute;
  const normAttr = src.getAttribute('normal') as THREE.BufferAttribute;
  const idxAttr = src.getIndex();
  const count = posAttr.count;

  const cluster = new Int32Array(count);
  const ids = new Map<string, number>();
  const sums: number[] = [];

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    const nx = normAttr.getX(i);
    const ny = normAttr.getY(i);
    const nz = normAttr.getZ(i);
    const facing =
      Math.abs(nx) > Math.abs(ny)
        ? Math.abs(nx) > Math.abs(nz)
          ? nx > 0
            ? 0
            : 1
          : nz > 0
            ? 4
            : 5
        : Math.abs(ny) > Math.abs(nz)
          ? ny > 0
            ? 2
            : 3
          : nz > 0
            ? 4
            : 5;
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)},${facing}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      sums.push(0, 0, 0, 0);
    }
    cluster[i] = id;
    sums[id * 4] += x;
    sums[id * 4 + 1] += y;
    sums[id * 4 + 2] += z;
    sums[id * 4 + 3] += 1;
    if ((i & 2047) === 2047) await pause();
  }

  const clusterCount = ids.size;
  const outPos = new Float32Array(clusterCount * 3);
  for (let c = 0; c < clusterCount; c++) {
    const n = sums[c * 4 + 3];
    outPos[c * 3] = sums[c * 4] / n;
    outPos[c * 3 + 1] = sums[c * 4 + 1] / n;
    outPos[c * 3 + 2] = sums[c * 4 + 2] / n;
  }

  const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(count / 3);
  const getIdx = (k: number) => (idxAttr ? idxAttr.getX(k) : k);
  const triangles: number[] = [];
  const faces = new Set<string>();

  for (let t = 0; t < triCount; t++) {
    const a = cluster[getIdx(t * 3)];
    const b = cluster[getIdx(t * 3 + 1)];
    const c = cluster[getIdx(t * 3 + 2)];
    if (a === b || b === c || a === c) continue;
    const key = a < b
      ? (b < c ? `${a},${b},${c}` : a < c ? `${a},${c},${b}` : `${c},${a},${b}`)
      : (a < c ? `${b},${a},${c}` : b < c ? `${b},${c},${a}` : `${c},${b},${a}`);
    if (faces.has(key)) continue;
    faces.add(key);
    triangles.push(a, b, c);
    if ((t & 4095) === 4095) await pause();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setIndex(
    new THREE.BufferAttribute(
      clusterCount < 65535 ? new Uint16Array(triangles) : new Uint32Array(triangles),
      1,
    ),
  );
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

async function buildSplitHead(url: string): Promise<SplitHeadAssets> {
  const gltf = await loadGLB(url);
  await breathe();

  try {
    gltf.scene.updateMatrixWorld(true);
    let sourceMesh: THREE.Mesh | null = null;
    gltf.scene.traverse(obj => {
      if (!sourceMesh && (obj as THREE.Mesh).isMesh) {
        sourceMesh = obj as THREE.Mesh;
      }
    });
    if (!sourceMesh) throw new Error('jp-visage: head GLB contains no mesh');

    const mesh = sourceMesh as THREE.Mesh;
    const srcGeo = mesh.geometry;
    const posAttr = srcGeo.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = srcGeo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const idxAttr = srcGeo.getIndex();
    const vertCount = posAttr.count;

    const worldMat = mesh.matrixWorld;
    const normalMat = new THREE.Matrix3().getNormalMatrix(worldMat);
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();

    for (let i = 0; i < vertCount; i++) {
      v.fromBufferAttribute(posAttr, i).applyMatrix4(worldMat);
      positions[i * 3] = v.x - HEAD_CENTER_X;
      positions[i * 3 + 1] = v.y - HEAD_SINK_Y;
      positions[i * 3 + 2] = v.z - HEAD_CENTER_Z;
      if (normAttr) {
        n.fromBufferAttribute(normAttr, i).applyMatrix3(normalMat).normalize();
        normals[i * 3] = n.x;
        normals[i * 3 + 1] = n.y;
        normals[i * 3 + 2] = n.z;
      }
      if ((i & 4095) === 4095) await breathe();
    }

    // Union-Find connected components welded by quantized position so split UV seams stay joined.
    const parent = new Int32Array(vertCount);
    for (let i = 0; i < vertCount; i++) parent[i] = i;
    const find = (a: number): number => {
      let r = a;
      while (parent[r] !== r) r = parent[r];
      while (parent[a] !== r) {
        const next = parent[a];
        parent[a] = r;
        a = next;
      }
      return r;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    const weld = new Map<string, number>();
    for (let i = 0; i < vertCount; i++) {
      const key = `${Math.round(positions[i * 3] * 1000)},${Math.round(positions[i * 3 + 1] * 1000)},${Math.round(positions[i * 3 + 2] * 1000)}`;
      const prev = weld.get(key);
      if (prev !== undefined) union(i, prev);
      else weld.set(key, i);
      if ((i & 4095) === 4095) await breathe();
    }

    const triCount = idxAttr ? Math.floor(idxAttr.count / 3) : Math.floor(vertCount / 3);
    const getIdx = (k: number) => (idxAttr ? idxAttr.getX(k) : k);

    for (let t = 0; t < triCount; t++) {
      const a = getIdx(t * 3);
      const b = getIdx(t * 3 + 1);
      const c = getIdx(t * 3 + 2);
      union(a, b);
      union(b, c);
      if ((t & 8191) === 8191) await breathe();
    }

    const compStats = new Map<
      number,
      {
        count: number;
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        minZ: number;
        maxZ: number;
      }
    >();
    for (let i = 0; i < vertCount; i++) {
      const r = find(i);
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      let st = compStats.get(r);
      if (!st) {
        st = { count: 0, minX: px, maxX: px, minY: py, maxY: py, minZ: pz, maxZ: pz };
        compStats.set(r, st);
      }
      st.count++;
      if (px < st.minX) st.minX = px;
      if (px > st.maxX) st.maxX = px;
      if (py < st.minY) st.minY = py;
      if (py > st.maxY) st.maxY = py;
      if (pz < st.minZ) st.minZ = pz;
      if (pz > st.maxZ) st.maxZ = pz;
    }

    const sortedComps = [...compStats.entries()].sort((a, b) => b[1].count - a[1].count);
    const skinRoot = sortedComps[0][0];
    const eyeRoots = new Set<number>();
    const eyeCenters: THREE.Vector3[] = [];
    let eyeRadiusSum = 0;

    for (let k = 1; k < sortedComps.length; k++) {
      const [rootId, st] = sortedComps[k];
      if (st.count >= 100) {
        eyeRoots.add(rootId);
        eyeCenters.push(
          new THREE.Vector3(
            (st.minX + st.maxX) * 0.5,
            (st.minY + st.maxY) * 0.5,
            (st.minZ + st.maxZ) * 0.5,
          ),
        );
        eyeRadiusSum += (st.maxX - st.minX + (st.maxY - st.minY) + (st.maxZ - st.minZ)) / 6;
      }
    }

    eyeCenters.sort((a, b) => a.x - b.x);
    const rightEyeCenter = eyeCenters[0] ?? new THREE.Vector3(-0.84, 3.41, 1.69);
    const leftEyeCenter = eyeCenters[1] ?? new THREE.Vector3(0.84, 3.41, 1.69);
    const eyeRadius = eyeCenters.length > 0 ? eyeRadiusSum / eyeCenters.length : 0.49;

    const skinIndices: number[] = [];
    const eyeIndices: number[] = [];
    const SKIN_CUTOFF_Y = -1.1;

    for (let t = 0; t < triCount; t++) {
      const a = getIdx(t * 3);
      const b = getIdx(t * 3 + 1);
      const c = getIdx(t * 3 + 2);
      const rootId = find(a);
      if (eyeRoots.has(rootId)) {
        eyeIndices.push(a, b, c);
      } else if (rootId === skinRoot) {
        const ya = positions[a * 3 + 1];
        const yb = positions[b * 3 + 1];
        const yc = positions[c * 3 + 1];
        if (ya >= SKIN_CUTOFF_Y || yb >= SKIN_CUTOFF_Y || yc >= SKIN_CUTOFF_Y) {
          skinIndices.push(a, b, c);
        }
      }
      if ((t & 8191) === 8191) await breathe();
    }

    const skin = compactSubGeometry(positions, normals, skinIndices, !normAttr);
    await breathe();
    const eyes = compactSubGeometry(positions, normals, eyeIndices, !normAttr);
    await breathe();

    return { skin, eyes, leftEyeCenter, rightEyeCenter, eyeRadius };
  } finally {
    disposeObject(gltf.scene);
  }
}

function compactSubGeometry(
  srcPos: Float32Array,
  srcNorm: Float32Array,
  srcIndices: number[],
  computeNormals: boolean,
): THREE.BufferGeometry {
  const remap = new Int32Array(srcPos.length / 3).fill(-1);
  const uniqueVerts: number[] = [];
  const outIdx = new Uint32Array(srcIndices.length);

  for (let i = 0; i < srcIndices.length; i++) {
    const oldIdx = srcIndices[i];
    let mapped = remap[oldIdx];
    if (mapped === -1) {
      mapped = uniqueVerts.length;
      remap[oldIdx] = mapped;
      uniqueVerts.push(oldIdx);
    }
    outIdx[i] = mapped;
  }

  const count = uniqueVerts.length;
  const outPos = new Float32Array(count * 3);
  const outNorm = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const oldIdx = uniqueVerts[i];
    outPos[i * 3] = srcPos[oldIdx * 3];
    outPos[i * 3 + 1] = srcPos[oldIdx * 3 + 1];
    outPos[i * 3 + 2] = srcPos[oldIdx * 3 + 2];
    outNorm[i * 3] = srcNorm[oldIdx * 3];
    outNorm[i * 3 + 1] = srcNorm[oldIdx * 3 + 1];
    outNorm[i * 3 + 2] = srcNorm[oldIdx * 3 + 2];
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(outNorm, 3));
  geo.setIndex(new THREE.BufferAttribute(count < 65535 ? new Uint16Array(outIdx) : outIdx, 1));
  if (computeNormals) geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Create a mount-local BufferGeometry wrapping shared vertex arrays so each mount
 * can dispose its own GPU buffers cleanly without destroying the module cache.
 */
export function copyOfGeometry(template: THREE.BufferGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(template.attributes)) {
    geo.setAttribute(name, new THREE.BufferAttribute(attr.array, attr.itemSize));
  }
  if (template.index) {
    geo.setIndex(new THREE.BufferAttribute(template.index.array, 1));
  }
  if (!template.boundingSphere) template.computeBoundingSphere();
  geo.boundingSphere = template.boundingSphere!.clone();
  return geo;
}

/** Four varied angular, rough-hewn stone/rubble boulder geometries (flat-shaded facets). */
export function buildRockGeometries(): THREE.BufferGeometry[] {
  const rand = seededRandom(8849);
  const shapes: THREE.BufferGeometry[] = [];
  for (let variant = 0; variant < 4; variant++) {
    const base = new THREE.IcosahedronGeometry(1, variant < 2 ? 1 : 2);
    const geo = base.toNonIndexed();
    base.dispose();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const planes = Array.from({ length: 6 }, () => ({
      nx: rand() * 2 - 1,
      ny: rand() * 2 - 1,
      nz: rand() * 2 - 1,
      d: 0.56 + rand() * 0.34,
    }));
    for (const pl of planes) {
      const len = Math.hypot(pl.nx, pl.ny, pl.nz) || 1;
      pl.nx /= len;
      pl.ny /= len;
      pl.nz /= len;
    }
    const sx = 0.8 + rand() * 0.5;
    const sy = 0.55 + rand() * 0.45;
    const sz = 0.8 + rand() * 0.5;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      for (const pl of planes) {
        const dot = x * pl.nx + y * pl.ny + z * pl.nz;
        if (dot > pl.d) {
          const push = dot - pl.d;
          x -= pl.nx * push * 0.85;
          y -= pl.ny * push * 0.85;
          z -= pl.nz * push * 0.85;
        }
      }
      // Subtle organic jagged roughness along quantized coords so shared edges stay watertight.
      const qx = Math.round(x * 100);
      const qy = Math.round(y * 100);
      const qz = Math.round(z * 100);
      const jitter = Math.sin(qx * 12.9898 + qy * 78.233 + qz * 37.719 + variant * 19) * 43758.5453;
      const j = 0.86 + (jitter - Math.floor(jitter)) * 0.28;
      pos.setXYZ(i, x * sx * j, y * sy * j, z * sz * j);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    shapes.push(geo);
  }
  return shapes;
}

/** Three jagged ruined rectangular stone monolith / broken obelisk geometries (unit width/depth, height 0..1). */
export function buildPillarGeometries(): THREE.BufferGeometry[] {
  const rand = seededRandom(5527);
  const shapes: THREE.BufferGeometry[] = [];
  for (let variant = 0; variant < 3; variant++) {
    const base = new THREE.BoxGeometry(1, 1, 1, 2, 7, 2);
    base.translate(0, 0.5, 0);
    const geo = base.toNonIndexed();
    base.dispose();
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const shearX = (rand() - 0.5) * 0.48;
    const shearZ = (rand() - 0.5) * 0.48;
    const taper = 0.62 + rand() * 0.24;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      let y = pos.getY(i);
      let z = pos.getZ(i);
      const s = 1 - y * (1 - taper);
      x *= s;
      z *= s;
      if (y > 0.72) {
        const breakAmt = (y - 0.72) / 0.28;
        y += (x * shearX + z * shearZ) * breakAmt * 0.58;
      }
      const qx = Math.round(x * 50);
      const qy = Math.round(y * 50);
      const qz = Math.round(z * 50);
      const h = Math.sin(qx * 17.3 + qy * 41.7 + qz * 29.1 + variant * 13) * 19381.1;
      const chip = (h - Math.floor(h) - 0.5) * 0.14;
      pos.setXYZ(i, x + chip, Math.max(0, y), z + chip);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    shapes.push(geo);
  }
  return shapes;
}
