"""
Verify the Starlight Pavilion prop GLBs (plain Python 3, no dependencies).

    python tools/starlight_pavilion/verify_glbs.py

Checks each GLB parses as glTF 2.0 binary, uses no compression extensions
(KHR_draco_mesh_compression, EXT_meshopt_compression, KHR_texture_basisu), contains its
named animated node, and fits the size budgets. Prints triangles, glTF-space dimensions
(Y up, front +Z), the animated node's pivot, and byte size.
"""

from __future__ import annotations

import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSET_DIR = os.path.join(REPO, "worlds", "eric-starlight-pavilion", "assets")
EXPECT = {
    "dance_gazebo.glb": "ChandelierCore",
    "dj_gramophone.glb": "TurntablePlatter",
    "chime_totem.glb": "ChimeCrystal",
    "star_fountain.glb": "GeyserRing",
}
FORBIDDEN = {"KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"}
MAX_FILE = int(1.5 * 1024 * 1024)
MAX_TOTAL = 4 * 1024 * 1024


def read_glb(path):
    data = open(path, "rb").read()
    magic, version, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a GLB (bad magic)"
    assert version == 2, f"GLB container version {version} != 2"
    assert length == len(data), "GLB length header does not match file size"
    off, gltf, binchunk = 12, None, None
    while off < len(data):
        clen, ctype = struct.unpack_from("<II", data, off)
        chunk = data[off + 8: off + 8 + clen]
        if ctype == 0x4E4F534A:
            gltf = json.loads(chunk.decode("utf-8"))
        elif ctype == 0x004E4942:
            binchunk = chunk
        off += 8 + clen
    assert gltf is not None, "missing JSON chunk"
    return gltf, binchunk


def verify(name, anim_name):
    path = os.path.join(ASSET_DIR, name)
    size = os.path.getsize(path)
    gltf, _ = read_glb(path)
    errors = []
    if gltf.get("asset", {}).get("version") != "2.0":
        errors.append("asset.version != 2.0")
    used = set(gltf.get("extensionsUsed", [])) | set(gltf.get("extensionsRequired", []))
    bad = used & FORBIDDEN
    if bad:
        errors.append(f"compression extensions present: {sorted(bad)}")
    for img in gltf.get("images", []):
        if img.get("mimeType") not in ("image/png", "image/jpeg"):
            errors.append(f"unexpected image type {img.get('mimeType')}")
    nodes = gltf.get("nodes", [])
    names = [n.get("name") for n in nodes]
    if anim_name not in names:
        errors.append(f"missing node {anim_name}")
    if size >= MAX_FILE:
        errors.append(f"{size} bytes >= 1.5 MiB budget")
    acc = gltf["accessors"]
    tris = 0
    lo = [1e9, 1e9, 1e9]
    hi = [-1e9, -1e9, -1e9]
    scene_nodes = gltf["scenes"][gltf.get("scene", 0)]["nodes"]

    def walk(ni, offset):
        nonlocal tris
        n = nodes[ni]
        if "rotation" in n and n["rotation"] not in ([0, 0, 0, 1], [0.0, 0.0, 0.0, 1.0]):
            errors.append(f"node {n.get('name')} has a rotation; bounds check assumes none")
        if "scale" in n and any(abs(s - 1) > 1e-6 for s in n["scale"]):
            errors.append(f"node {n.get('name')} has a scale; bounds check assumes none")
        t = n.get("translation", [0, 0, 0])
        o = [offset[i] + t[i] for i in range(3)]
        if "mesh" in n:
            for prim in gltf["meshes"][n["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    errors.append("non-triangle primitive")
                if prim.get("extensions"):
                    errors.append(f"primitive extensions {list(prim['extensions'])}")
                cnt = acc[prim["indices"]]["count"] if "indices" in prim else acc[prim["attributes"]["POSITION"]]["count"]
                tris += cnt // 3
                pa = acc[prim["attributes"]["POSITION"]]
                for i in range(3):
                    lo[i] = min(lo[i], pa["min"][i] + o[i])
                    hi[i] = max(hi[i], pa["max"][i] + o[i])
        for c in n.get("children", []):
            walk(c, o)

    for ni in scene_nodes:
        walk(ni, [0, 0, 0])
    anim = nodes[names.index(anim_name)] if anim_name in names else {}
    dims = [hi[i] - lo[i] for i in range(3)]
    if abs(lo[1]) > 1e-3:
        errors.append(f"base not on Y=0 (minY={lo[1]:.4f})")
    centre = [(lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2]
    if max(abs(c) for c in centre) > 0.02:
        errors.append(f"not centred in XZ: {centre}")
    return {
        "file": name, "bytes": size, "MiB": round(size / 1048576, 3), "tris": tris,
        "dims_xyz_m": [round(d, 3) for d in dims], "minY": round(lo[1], 4),
        "topLevelNodes": [nodes[i].get("name") for i in scene_nodes],
        "animatedNode": anim_name, "pivot_gltf": [round(v, 4) for v in anim.get("translation", [0, 0, 0])],
        "materials": len(gltf.get("materials", [])), "images": len(gltf.get("images", [])),
        "extensionsUsed": sorted(used), "errors": errors,
    }


def main():
    total, ok = 0, True
    for name, anim in EXPECT.items():
        r = verify(name, anim)
        total += r["bytes"]
        ok &= not r["errors"]
        print(json.dumps(r))
    print(f"TOTAL {total} bytes ({total / 1048576:.3f} MiB) budget {MAX_TOTAL / 1048576:.1f} MiB")
    if total >= MAX_TOTAL:
        ok = False
        print("ERROR total over budget")
    print("VERIFY_OK" if ok else "VERIFY_FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
