/**
 * Turns the supplied female head bust into the pieces the Visages room draws.
 *
 * The GLB is one mesh: the skin of a bust (head, neck, shoulders) plus two loose
 * eyeballs. The model already stands upright and looks down +Z once its node
 * transform is applied, so nothing is tilted here. We:
 *
 * - split the eyeballs from the skin (connected components, welding seams),
 * - centre the skull on the origin in X/Z (keeping Y, so 0 is the bust's base),
 * - drop the shoulders, which always end up buried, to save triangles,
 * - and build a coarse copy of the skin for heads deep in the fog.
 *
 * Everything is plain typed arrays so it can be computed once per page and shared
 * by every mount (each mount wraps the arrays in its own BufferGeometry).
 */

export interface MeshPart {
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array;
}

export interface HeadParts {
  skin: MeshPart;
  /** The skin decimated by vertex clustering, for far heads. */
  skinFar: MeshPart;
  eyes: MeshPart;
  /** Eye centres in the centred model space, left to right. */
  eyeCenters: Array<[number, number, number]>;
  eyeRadius: number;
  /** Highest point of the crown. */
  crownY: number;
  /** Furthest forward point (nose tip). */
  frontZ: number;
  /** Furthest back point of the skull. */
  backZ: number;
  /** Half the skull's width at eye height and above. */
  halfWidth: number;
}

export interface ProcessOptions {
  /** Skin triangles entirely below this height (model units, before centring) are dropped. */
  trimBelowY: number;
  /** Cluster size for the far copy, in model units. */
  farCell: number;
  /** Called now and then so a caller can yield to the browser. */
  pause?: () => Promise<void>;
}

const noPause = async () => {};

/** Connected components of a triangle mesh, welding vertices that share a position. */
export async function components(position: Float32Array, index: ArrayLike<number>, pause = noPause): Promise<Int32Array> {
  const count = position.length / 3;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const seen = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${position[i * 3].toFixed(5)},${position[i * 3 + 1].toFixed(5)},${position[i * 3 + 2].toFixed(5)}`;
    const other = seen.get(key);
    if (other === undefined) seen.set(key, i);
    else union(other, i);
    if (i % 1000 === 999) await pause();
  }
  for (let t = 0; t < index.length; t += 3) {
    union(index[t], index[t + 1]);
    union(index[t], index[t + 2]);
    if (t % 3000 === 0) await pause();
  }
  const label = new Int32Array(count);
  for (let i = 0; i < count; i++) label[i] = find(i);
  return label;
}

/** Copy the triangles that pass `keep` into a compact part (only the vertices they use). */
async function extract(
  position: Float32Array,
  normal: Float32Array,
  index: ArrayLike<number>,
  keep: (a: number, b: number, c: number) => boolean,
  pause = noPause,
): Promise<MeshPart> {
  const remap = new Int32Array(position.length / 3).fill(-1);
  const triangles: number[] = [];
  let used = 0;
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t];
    const b = index[t + 1];
    const c = index[t + 2];
    if (t % 3000 === 0) await pause();
    if (!keep(a, b, c)) continue;
    for (const v of [a, b, c]) {
      if (remap[v] < 0) remap[v] = used++;
      triangles.push(remap[v]);
    }
  }
  const outPosition = new Float32Array(used * 3);
  const outNormal = new Float32Array(used * 3);
  for (let v = 0; v < remap.length; v++) {
    const to = remap[v];
    if (to < 0) continue;
    for (let k = 0; k < 3; k++) {
      outPosition[to * 3 + k] = position[v * 3 + k];
      outNormal[to * 3 + k] = normal[v * 3 + k];
    }
  }
  return { position: outPosition, normal: outNormal, index: Uint32Array.from(triangles) };
}

/**
 * Vertex-clustering decimation: snap vertices to a grid of `cell`, merge each cell
 * into one averaged vertex and drop triangles that collapse. Normals are rebuilt
 * from the surviving faces (area weighted), so creases soften a little, which the
 * fog hides at the distances the far copy is used.
 */
export async function decimate(part: MeshPart, cell: number, pause = noPause): Promise<MeshPart> {
  const count = part.position.length / 3;
  const cluster = new Int32Array(count);
  const ids = new Map<string, number>();
  const sums: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = part.position[i * 3];
    const y = part.position[i * 3 + 1];
    const z = part.position[i * 3 + 2];
    // Split cells by which way the surface faces too, so thin shells (ears, lips) don't fuse.
    const nx = part.normal[i * 3];
    const ny = part.normal[i * 3 + 1];
    const nz = part.normal[i * 3 + 2];
    const facing = Math.abs(nx) > Math.abs(ny)
      ? (Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 0 : 1) : (nz > 0 ? 4 : 5))
      : (Math.abs(ny) > Math.abs(nz) ? (ny > 0 ? 2 : 3) : (nz > 0 ? 4 : 5));
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)},${facing}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = ids.size;
      ids.set(key, id);
      sums.push(0, 0, 0, 0);
    }
    if (i % 1000 === 999) await pause();
    cluster[i] = id;
    sums[id * 4] += x;
    sums[id * 4 + 1] += y;
    sums[id * 4 + 2] += z;
    sums[id * 4 + 3] += 1;
  }
  const clusters = ids.size;
  const position = new Float32Array(clusters * 3);
  for (let c = 0; c < clusters; c++) {
    const n = sums[c * 4 + 3];
    position[c * 3] = sums[c * 4] / n;
    position[c * 3 + 1] = sums[c * 4 + 1] / n;
    position[c * 3 + 2] = sums[c * 4 + 2] / n;
  }
  const triangles: number[] = [];
  const faces = new Set<string>();
  for (let t = 0; t < part.index.length; t += 3) {
    if (t % 3000 === 0) await pause();
    const a = cluster[part.index[t]];
    const b = cluster[part.index[t + 1]];
    const c = cluster[part.index[t + 2]];
    if (a === b || b === c || a === c) continue;
    const key = [a, b, c].sort((p, q) => p - q).join(',');
    if (faces.has(key)) continue;
    faces.add(key);
    triangles.push(a, b, c);
  }
  const index = Uint32Array.from(triangles);
  return { position, normal: faceNormals(position, index), index };
}

/** Area-weighted vertex normals from faces. */
export function faceNormals(position: Float32Array, index: Uint32Array): Float32Array {
  const normal = new Float32Array(position.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3;
    const b = index[t + 1] * 3;
    const c = index[t + 2] * 3;
    const ux = position[b] - position[a];
    const uy = position[b + 1] - position[a + 1];
    const uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a];
    const vy = position[c + 1] - position[a + 1];
    const vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normal[v] += nx;
      normal[v + 1] += ny;
      normal[v + 2] += nz;
    }
  }
  for (let v = 0; v < normal.length; v += 3) {
    const length = Math.hypot(normal[v], normal[v + 1], normal[v + 2]) || 1;
    normal[v] /= length;
    normal[v + 1] /= length;
    normal[v + 2] /= length;
  }
  return normal;
}

/**
 * Split, centre, trim and decimate the bust. `position`/`normal`/`index` are the
 * mesh with its node transform already applied (Y up, face toward +Z).
 */
export async function processHead(
  position: Float32Array,
  normal: Float32Array,
  index: ArrayLike<number>,
  options: ProcessOptions,
): Promise<HeadParts> {
  const pause = options.pause ?? noPause;
  const label = await components(position, index, pause);
  const sizes = new Map<number, number>();
  for (const l of label) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  let skinLabel = -1;
  let largest = 0;
  for (const [l, size] of sizes) {
    if (size > largest) {
      largest = size;
      skinLabel = l;
    }
  }
  // Small loose pieces in the upper half of the bust are the eyeballs.
  const eyeLabels = [...sizes.keys()].filter(l => l !== skinLabel && (sizes.get(l) ?? 0) >= 8);
  const eyeSet = new Set(eyeLabels);

  // Centre the skull: X on the midpoint between the eyes (the face's symmetry line),
  // Z on the middle of the head's depth from the nose up.
  const eyeBoxes = eyeLabels.map(() => ({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }));
  for (let i = 0; i < label.length; i++) {
    const e = eyeLabels.indexOf(label[i]);
    if (e < 0) continue;
    for (let k = 0; k < 3; k++) {
      eyeBoxes[e].min[k] = Math.min(eyeBoxes[e].min[k], position[i * 3 + k]);
      eyeBoxes[e].max[k] = Math.max(eyeBoxes[e].max[k], position[i * 3 + k]);
    }
  }
  const rawEyes = eyeBoxes
    .map(box => box.min.map((v, k) => (v + box.max[k]) / 2) as [number, number, number])
    .sort((a, b) => a[0] - b[0]);
  const eyeRadius = eyeBoxes.length
    ? eyeBoxes.reduce((sum, box) => sum + (box.max[1] - box.min[1]) / 2, 0) / eyeBoxes.length
    : 0.5;
  const eyeY = rawEyes.length ? rawEyes.reduce((s, e) => s + e[1], 0) / rawEyes.length : 0;
  let cx = rawEyes.length ? rawEyes.reduce((s, e) => s + e[0], 0) / rawEyes.length : 0;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  let crownY = -Infinity;
  for (let i = 0; i < label.length; i++) {
    if (label[i] !== skinLabel) continue;
    const y = position[i * 3 + 1];
    crownY = Math.max(crownY, y);
    if (y < eyeY - 1.6) continue;
    minX = Math.min(minX, position[i * 3]);
    maxX = Math.max(maxX, position[i * 3]);
    minZ = Math.min(minZ, position[i * 3 + 2]);
    maxZ = Math.max(maxZ, position[i * 3 + 2]);
  }
  if (!rawEyes.length) cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const centred = new Float32Array(position);
  for (let i = 0; i < centred.length; i += 3) {
    centred[i] -= cx;
    centred[i + 2] -= cz;
  }
  await pause();

  const trim = options.trimBelowY;
  const y = (v: number) => position[v * 3 + 1];
  const skin = await extract(centred, normal, index, (a, b, c) =>
    label[a] === skinLabel && !(y(a) < trim && y(b) < trim && y(c) < trim), pause);
  await pause();
  const eyes = await extract(centred, normal, index, a => eyeSet.has(label[a]), pause);
  await pause();
  const skinFar = await decimate(skin, options.farCell, pause);
  await pause();

  return {
    skin,
    skinFar,
    eyes,
    eyeCenters: rawEyes.map(([x, ey, z]) => [x - cx, ey, z - cz]),
    eyeRadius,
    crownY,
    frontZ: maxZ - cz,
    backZ: minZ - cz,
    halfWidth: Math.max(maxX - cx, cx - minX),
  };
}
