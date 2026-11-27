"""Offline asset preparation; run with Python + NumPy and the supplied GLB path.
Preserves the supplied face and eye shells; removes shoulders, normalizes axes,
and creates a clustered distant silhouette. No geometry compression or textures.
"""
import json
import struct
import sys
from pathlib import Path
import numpy as np

source = Path(sys.argv[1]).read_bytes()
length = struct.unpack_from('<I', source, 12)[0]
doc = json.loads(source[20:20 + length])
binary = source[28 + length:]

def accessor(index):
    a = doc['accessors'][index]
    view = doc['bufferViews'][a['bufferView']]
    width = {'VEC3': 3, 'SCALAR': 1}[a['type']]
    return np.frombuffer(binary, dtype={5126: '<f4', 5123: '<u2'}[a['componentType']],
                         count=a['count'] * width,
                         offset=view.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(-1, width)

# The supplied Blender export has a +90 degree X node rotation. Bake it, ignoring
# its staging translation/scale. Its face looks along +Z and its eye line is level.
p = accessor(0)[:, [0, 2, 1]].copy()
p[:, 1] *= -1
normals = accessor(1)[:, [0, 2, 1]].copy()
normals[:, 1] *= -1
triangles = accessor(3).reshape(-1, 3)
parent = np.arange(len(p))

def root(i):
    while parent[i] != i:
        parent[i] = parent[parent[i]]
        i = parent[i]
    return i

def union(a, b):
    parent[root(a)] = root(b)

seen = {}
for i, point in enumerate(p):
    key = tuple(np.round(point, 4))
    if key in seen:
        union(i, seen[key])
    else:
        seen[key] = i
for a, b, c in triangles:
    union(a, b)
    union(a, c)
components = {}
for i in range(len(p)):
    components.setdefault(root(i), []).append(i)
assert sorted(map(len, components.values())) == [986, 988, 21334], 'Unexpected source topology'
skin_root = max(components, key=lambda key: len(components[key]))
scale = 30 / (float(p[:, 1].max()) - 8.2)

def extract(eyes):
    vertices, indices, unique = [], [], {}
    for tri in triangles:
        if (root(tri[0]) != skin_root) != eyes:
            continue
        polygon = [np.concatenate([p[i], normals[i]]) for i in tri]
        clipped = []
        for a, b in zip(polygon, polygon[1:] + polygon[:1]):
            if a[1] >= 8.2:
                clipped.append(a)
            if (a[1] >= 8.2) != (b[1] >= 8.2):
                clipped.append(a + (b - a) * ((8.2 - a[1]) / (b[1] - a[1])))
        for i in range(1, len(clipped) - 1):
            for v in [clipped[0], clipped[i], clipped[i + 1]]:
                key = tuple(np.round(v, 5))
                if key not in unique:
                    unique[key] = len(vertices)
                    vertices.append(v)
                indices.append(unique[key])
    v = np.array(vertices)
    v[:, :3] = (v[:, :3] - [15.969429, 8.2, 8.472836]) * scale
    v[:, 3:] /= np.maximum(np.linalg.norm(v[:, 3:], axis=1)[:, None], 1e-9)
    return v, np.array(indices).reshape(-1, 3)

parts = [extract(False), extract(True)]

def clustered(vertices, triangles):
    keys = np.round(vertices[:, :3] / 0.65).astype(int)
    _, ids = np.unique(keys, axis=0, return_inverse=True)
    v = np.zeros((ids.max() + 1, 6))
    counts = np.bincount(ids)
    np.add.at(v, ids, vertices)
    v /= counts[:, None]
    v[:, 3:] /= np.maximum(np.linalg.norm(v[:, 3:], axis=1)[:, None], 1e-9)
    t = ids[triangles]
    t = t[(t[:, 0] != t[:, 1]) & (t[:, 1] != t[:, 2]) & (t[:, 0] != t[:, 2])]
    return v, t

def write(path, meshes):
    blob = bytearray()
    views, accessors, primitives = [], [], []
    def append(values, kind, component):
        while len(blob) % 4:
            blob.append(0)
        raw = values.astype('<f4' if component == 5126 else '<u2').tobytes()
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(raw)})
        blob.extend(raw)
        a = {'bufferView': len(views) - 1, 'componentType': component,
             'count': len(values), 'type': kind}
        if kind == 'VEC3':
            a.update(min=values.min(0).tolist(), max=values.max(0).tolist())
        accessors.append(a)
        return len(accessors) - 1
    for material, (v, t) in enumerate(meshes):
        primitives.append({'attributes': {'POSITION': append(v[:, :3], 'VEC3', 5126),
                                          'NORMAL': append(v[:, 3:], 'VEC3', 5126)},
                           'indices': append(t.flatten(), 'SCALAR', 5123), 'material': material})
    while len(blob) % 4:
        blob.append(0)
    result = {'asset': {'version': '2.0', 'generator': 'Portalverse source-preserving head preparation'},
              'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'Upright head'}],
              'meshes': [{'primitives': primitives}],
              'materials': [{'name': 'Ancient stone'}, {'name': 'Black eyes'}],
              'buffers': [{'byteLength': len(blob)}], 'bufferViews': views, 'accessors': accessors}
    js = json.dumps(result, separators=(',', ':')).encode()
    js += b' ' * (-len(js) % 4)
    path.write_bytes(struct.pack('<3I', 0x46546c67, 2, 28 + len(js) + len(blob)) +
                     struct.pack('<2I', len(js), 0x4e4f534a) + js +
                     struct.pack('<2I', len(blob), 0x004e4942) + blob)
    print(path.name, path.stat().st_size, 'bytes;', [len(t) for _, t in meshes], 'triangles')

out = Path(__file__).resolve().parents[1] / 'assets'
write(out / 'head.glb', parts)
write(out / 'head-distant.glb', [clustered(*part) for part in parts])
