"""
Portalverse AA NPCs - Batch A (Keepers 1-5): Kestrel, Solenne, Fen, Keola, Nori.

Run headless (one character per process, or all in sequence):
  blender -b --factory-startup --python tools/npcs/build_batch_a.py -- --only kestrel
  blender -b --factory-startup --python tools/npcs/build_batch_a.py            # all five

Exports public/assets/npcs/<id>/model.glb (uncompressed) and renders
tools/npcs/renders/<id>_sheet.png through the shared kit (tools/npcs/blender_kit.py).

Conventions (from the kit): stand on Z = 0, face -Y, standard humanoid bone names.
Batch-specific choices layered on top of the kit (the kit itself is untouched):
  * Every part is modelled in world space, then the whole figure is uniformly scaled
    so its bounding height equals the bible's heightMeters exactly.
  * Standard bones are moved onto this character's actual joints after
    create_humanoid_armature, so lip-sync, gaze and gestures pivot where the mesh bends.
  * EyeL / EyeR point UP from the eye centre: NpcRig rotates eyes with (pitch, yaw) in
    bone space and blinks by scaling bone-local Y, so an upward bone gives a real
    vertical blink and a true yaw (a forward bone would only roll the eyeball).
  * Arms and the spine get distance-blended weights along their chains after
    bind_parts_to_bones, so elbows and the torso bend smoothly instead of hinging.
"""

from __future__ import annotations

import argparse
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import blender_kit as K  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX = os.path.join(HERE, "textures")
TAU = math.tau
PI = math.pi

TARGETS = {
    "kestrel": {"height": 1.78, "bg": "#0b1a26"},
    "solenne": {"height": 1.84, "bg": "#2b3322"},
    "fen": {"height": 1.52, "bg": "#22382c"},
    "keola": {"height": 1.76, "bg": "#1d3330"},
    "nori": {"height": 1.58, "bg": "#0f2a36"},
}


# ---------------------------------------------------------------------------
# Small geometry helpers (all coordinates are world space, Z up, front = -Y)
# ---------------------------------------------------------------------------

def V(x, y=None, z=None) -> Vector:
    if y is None:
        return Vector(x)
    return Vector((x, y, z))


def lerp(a, b, t):
    return a + (b - a) * t


def tex(pack: str, kind: str) -> str | None:
    p = os.path.join(TEX, pack, f"{kind}.png")
    return p if os.path.isfile(p) else None


def mat(name, color, *, pack=None, maps=(), uv=3.0, nstr=0.6, **kw):
    keymap = {"albedo": "albedo_path", "normal": "normal_path", "roughness": "roughness_path", "emissive": "emissive_path"}
    paths = {}
    for m in maps:
        p = tex(pack, m) if pack else None
        if p:
            paths[keymap[m]] = p
    mt = K.make_pbr_material(name, color, uv_scale=uv, normal_strength=nstr, **paths, **kw)
    if kw.get("alpha", 1.0) < 0.999 and hasattr(mt, "surface_render_method"):
        mt.surface_render_method = "BLENDED"
    return mt


def bake(obj):
    """Push the object transform into the mesh so every part lives in world space."""
    if obj is None or obj.type != "MESH":
        return obj
    obj.data.transform(obj.matrix_basis)
    obj.matrix_basis = Matrix.Identity(4)
    obj.data.update()
    return obj


def xf(obj, M):
    bake(obj)
    obj.data.transform(M)
    obj.data.update()
    return obj


def basis(z_axis, y_hint=(0.0, 0.0, 1.0)) -> Matrix:
    z = V(z_axis).normalized()
    y = V(y_hint)
    y = y - z * y.dot(z)
    if y.length < 1e-6:
        y = V(0, 1, 0) - z * z.y
        if y.length < 1e-6:
            y = V(1, 0, 0) - z * z.x
    y.normalize()
    x = y.cross(z)
    return Matrix((x, y, z)).transposed()


def M4(origin, R3=None) -> Matrix:
    m = (R3 if R3 is not None else Matrix.Identity(3)).to_4x4()
    m.translation = V(origin)
    return m


def align_z(direction) -> Matrix:
    return V(0, 0, 1).rotation_difference(V(direction).normalized()).to_matrix()


def deform(obj, fn):
    bake(obj)
    for v in obj.data.vertices:
        v.co = fn(v.co.copy())
    obj.data.update()
    return obj


def delete_verts(obj, pred):
    bake(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    kill = [v for v in bm.verts if pred(v.co)]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def flat_shade(obj):
    obj.data.polygons.foreach_set("use_smooth", [False] * len(obj.data.polygons))
    obj.data.update()
    return obj


def solidify(obj, thickness, offset=-1.0):
    mod = obj.modifiers.new("Solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    mod.use_even_offset = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    return obj


def catmull(pts, n_per=4):
    P = [V(p) for p in pts]
    if len(P) < 3:
        return P
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[i] * 2 - P[i + 1]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else P[i + 1] * 2 - P[i]
        for k in range(n_per):
            t = k / n_per
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


def resample_radii(radii, n_ctrl, n_out):
    if isinstance(radii, (int, float)):
        return [float(radii)] * n_out
    out = []
    for i in range(n_out):
        t = i / max(1, n_out - 1) * (n_ctrl - 1)
        k = min(int(t), n_ctrl - 2)
        out.append(lerp(radii[k], radii[k + 1], t - k))
    return out


def tube(name, ctrl, radii, m, *, seg=12, n_per=3, cap=True):
    pts = catmull(ctrl, n_per) if len(ctrl) >= 3 and n_per > 1 else [V(p) for p in ctrl]
    rr = resample_radii(radii, len(ctrl), len(pts))
    return K.make_tube(name, [tuple(p) for p in pts], rr, segments=seg, mat=m, cap_ends=cap)


def sphere(name, r, loc, m, seg=16, rings=10, rot=(0, 0, 0)):
    return K.make_sphere(name, r, location=tuple(loc), rotation=rot, segments=seg, rings=rings, mat=m)


def box(name, size, M, m, bevel=0.0):
    o = K.make_box(name, size, location=(0, 0, 0), bevel=bevel, mat=m)
    return xf(o, M)


def torus(name, R, r, center, axis, m, majs=24, mins=6):
    o = K.make_torus(name, R, r, location=(0, 0, 0), major_segments=majs, minor_segments=mins, mat=m)
    return xf(o, M4(center, align_z(axis)))


def cyl(name, r1, r2, depth, center, axis, m, verts=16):
    o = K.make_cylinder(name, r1, r2, depth, location=(0, 0, 0), vertices=verts, mat=m)
    return xf(o, M4(center, align_z(axis)))


def lathe(name, profile, m, seg=24, cap_bottom=True, cap_top=True):
    return K.make_lathe(name, profile, segments=seg, mat=m, cap_bottom=cap_bottom, cap_top=cap_top)


def profile_at(profile, z):
    """Interpolate an elliptical lathe profile [(z, rx, ry, yoff)] at height z."""
    P = sorted(profile, key=lambda e: e[0])
    if z <= P[0][0]:
        e = P[0]
        return e[1], e[2], e[3]
    if z >= P[-1][0]:
        e = P[-1]
        return e[1], e[2], e[3]
    for a, b in zip(P, P[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / max(1e-6, b[0] - a[0])
            return lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)
    return P[-1][1], P[-1][2], P[-1][3]


def on_profile(profile, a, z, off=0.0):
    rx, ry, yo = profile_at(profile, z)
    return V(math.cos(a) * (rx + off), math.sin(a) * (ry + off) + yo, z)


def shell(name, rings, m, *, center=-PI / 2, nseg=24, thickness=0.0, flat=False, zfn=None):
    """Partial (or closed) garment sheet. rings: (z, rx, ry, yoff, half_angle[, front_dz]).
    Returns (obj, grid of Vectors)."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    grid_v, grid_p = [], []
    for ri, ring in enumerate(rings):
        z, rx, ry, yo, half = ring[:5]
        fdz = ring[5] if len(ring) > 5 else 0.0
        row_v, row_p = [], []
        for i in range(nseg + 1):
            a = center - half + 2 * half * (i / nseg)
            front = max(0.0, -math.sin(a))
            p = V(math.cos(a) * rx, math.sin(a) * ry + yo, z + fdz * front * front)
            if zfn:
                p = zfn(p, a, ri)
            row_p.append(p)
            row_v.append(bm.verts.new(p))
        grid_v.append(row_v)
        grid_p.append(row_p)
    # rows run top->bottom or bottom->top; orient faces outward either way
    up = rings[-1][0] >= rings[0][0]
    for r in range(len(rings) - 1):
        for i in range(nseg):
            a0, a1 = grid_v[r][i], grid_v[r][i + 1]
            b0, b1 = grid_v[r + 1][i], grid_v[r + 1][i + 1]
            quad = (a0, a1, b1, b0) if up else (a0, b0, b1, a1)
            try:
                f = bm.faces.new(quad)
            except ValueError:
                continue
            for li, (u, v) in zip(range(4), ((i, r), (i + 1, r), (i + 1, r + 1), (i, r + 1)) if up else ((i, r), (i, r + 1), (i + 1, r + 1), (i + 1, r))):
                f.loops[li][uvl].uv = (u / nseg, v / max(1, len(rings) - 1))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    K.assign_material(obj, m)
    if thickness > 0:
        solidify(obj, thickness)
    if flat:
        flat_shade(obj)
    else:
        K.set_smooth(obj)
    return obj, grid_p


def ribbon(name, pts, widths, m, *, side_fn=None, up_hint=(1, 0, 0), twist=None, thickness=0.0, n_per=3):
    P = catmull(pts, n_per) if len(pts) >= 3 else [V(p) for p in pts]
    n = len(P)
    W = resample_radii(widths, len(pts), n)
    T = resample_radii(twist, len(pts), n) if twist is not None else [0.0] * n
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rows = []
    for i, p in enumerate(P):
        tg = (P[min(n - 1, i + 1)] - P[max(0, i - 1)]).normalized()
        if side_fn:
            sd = V(side_fn(p, tg, i / max(1, n - 1)))
        else:
            sd = V(up_hint)
        sd = (sd - tg * sd.dot(tg))
        if sd.length < 1e-6:
            sd = tg.orthogonal()
        sd.normalize()
        if T[i]:
            sd = Matrix.Rotation(T[i], 3, tg) @ sd
        rows.append((bm.verts.new(p - sd * W[i] * 0.5), bm.verts.new(p + sd * W[i] * 0.5)))
    for i in range(n - 1):
        a, b = rows[i], rows[i + 1]
        try:
            f = bm.faces.new((a[0], a[1], b[1], b[0]))
            v0, v1 = i / (n - 1), (i + 1) / (n - 1)
            for li, uv in enumerate(((0, v0), (1, v0), (1, v1), (0, v1))):
                f.loops[li][uvl].uv = uv
        except ValueError:
            pass
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    K.assign_material(obj, m)
    if thickness > 0:
        solidify(obj, thickness, offset=0.0)
    K.set_smooth(obj)
    return obj, P


def leaf(name, base, axis, normal, length, width, m, *, rows=12, cols=4, shape="ellipse",
         cup=0.10, droop=0.12, slits=0, slit_depth=0.62, twist=0.0, rib_mat=None, rib_r=0.0):
    """Curved leaf / fin / bract blade. Optional monstera slits and a midrib tube."""
    ax = V(axis).normalized()
    nz = V(normal)
    nz = (nz - ax * nz.dot(ax)).normalized()
    xx = ax.cross(nz)
    base = V(base)

    def width_at(u):
        if shape == "blade":
            w = min(1.0, u * 5.0) * (1.0 - u) ** 0.7
        elif shape == "monstera":
            w = math.sin(PI * (0.10 + 0.90 * u)) ** 0.55 * (1.0 - 0.18 * u)
        elif shape == "fin":
            w = min(1.0, u * 3.0) * (1.0 - u) ** 0.35
        elif shape == "bract":
            w = math.sin(PI * min(1.0, 0.15 + u * 0.85)) ** 0.9
        else:
            w = math.sin(PI * u) ** 0.75
        return max(0.03, w)

    shear = 0.22 if slits else 0.0
    if slits:
        rows = max(rows, 3 * slits + 4)
    slit_rows = {int(round((0.16 + 0.70 * (k + 0.5) / slits) * rows)) for k in range(slits)} if slits else set()

    def pos(u, v):
        u = min(1.0, u + shear * abs(v) * 2.0 * u * (1.0 - u))
        w = width_at(u)
        x = v * 0.5 * width * w
        y = u * length
        z = cup * width * (v * v) * w - droop * length * u * u
        if twist:
            ang = twist * u
            x, z = x * math.cos(ang) - z * math.sin(ang), x * math.sin(ang) + z * math.cos(ang)
        return base + xx * x + ax * y + nz * z

    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    grid = []
    for i in range(rows + 1):
        u = i / rows
        grid.append([bm.verts.new(pos(u, j / cols)) for j in range(-cols, cols + 1)])
    for i in range(rows):
        for j in range(2 * cols):
            if i in slit_rows and abs(((j + 0.5) - cols) / cols) > 1.0 - slit_depth:
                continue
            f = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            for li, (uu, vv) in enumerate(((j, i), (j + 1, i), (j + 1, i + 1), (j, i + 1))):
                f.loops[li][uvl].uv = (uu / (2 * cols), vv / rows)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    K.assign_material(obj, m)
    K.set_smooth(obj)
    out = [obj]
    if rib_mat is not None and rib_r > 0:
        rib = [pos(u, 0.0) + nz * rib_r * 0.6 for u in (0.0, 0.25, 0.5, 0.75, 0.95)]
        out.append(K.make_tube(name + "_rib", [tuple(p) for p in rib], [rib_r, rib_r * 0.8, rib_r * 0.6, rib_r * 0.4, rib_r * 0.2], segments=6, mat=rib_mat))
    return out


def gear(name, r, teeth, thick, center, normal, m):
    o = K.make_cylinder(name, r, r, thick, location=(0, 0, 0), vertices=teeth * 2, mat=m)
    for v in o.data.vertices:
        ang = math.atan2(v.co.y, v.co.x)
        k = round(ang / (PI / teeth))
        if k % 2:
            v.co.x *= 0.76
            v.co.y *= 0.76
    return xf(o, M4(center, align_z(normal)))


def outline_hull(obj, t, m):
    """Inverted-hull ink outline (single-sided, normals flipped) for the graphic look."""
    bake(obj)
    dup = obj.copy()
    dup.data = obj.data.copy()
    dup.name = obj.name + "_ink"
    bpy.context.collection.objects.link(dup)
    bm = bmesh.new()
    bm.from_mesh(dup.data)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * t
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(dup.data)
    bm.free()
    dup.data.materials.clear()
    dup.data.materials.append(m)
    for p in dup.data.polygons:
        p.material_index = 0
    dup.data.update()
    return dup


def bvh_of(objs):
    verts, polys = [], []
    for o in objs:
        bake(o)
        off = len(verts)
        verts += [v.co.copy() for v in o.data.vertices]
        polys += [[off + i for i in p.vertices] for p in o.data.polygons]
    return BVHTree.FromPolygons(verts, polys)


def project(bvh, origin, direction, off=0.0):
    d = V(direction).normalized()
    hit, nrm, _i, _d = bvh.ray_cast(V(origin), d)
    if hit is None:
        return V(origin), -d
    if nrm.dot(d) > 0:
        nrm = -nrm
    return hit + nrm * off, nrm


# ---------------------------------------------------------------------------
# Body-part builders
# ---------------------------------------------------------------------------

def hand(name, wrist, direction, side, m, *, s=1.0, curl=0.45, thick=1.0, flen=1.0, spread=1.0, nfing=4):
    """Hand hanging from `wrist` along `direction`; palm faces the body (-X*side), thumb forward."""
    objs = [sphere(name + "_palm", (0.020 * s * thick, 0.041 * s, 0.050 * s), (0, 0, -0.050 * s), m, 12, 8)]
    specs = [(-0.027, 0.072, 0.0093), (-0.009, 0.080, 0.0096), (0.009, 0.076, 0.0091), (0.025, 0.060, 0.0082)]
    if nfing == 3:
        specs = [(-0.022, 0.078, 0.0105), (0.0, 0.084, 0.0105), (0.021, 0.070, 0.0098)]
    for i, (fy, fl, fr) in enumerate(specs):
        p = V(0.0, fy * s * spread, -0.090 * s)
        pts = [p.copy()]
        L = fl * s * flen
        for k in range(4):
            ang = curl * (k + 1) / 4 * 1.25
            d = V(-side * math.sin(ang), 0.0, -math.cos(ang))
            p = p + d * (L / 4)
            pts.append(p.copy())
        rad = [fr * s * thick * (1.0 - 0.28 * k / 4) for k in range(5)]
        objs.append(K.make_tube(f"{name}_f{i}", [tuple(q) for q in pts], rad, segments=8, mat=m))
    t0 = V(-side * 0.010 * s, -0.034 * s, -0.028 * s)
    pts = [t0]
    p = t0.copy()
    for k in range(3):
        d = V(-side * (0.30 + 0.25 * k * curl), -0.55, -0.75).normalized()
        p = p + d * 0.022 * s
        pts.append(p.copy())
    objs.append(K.make_tube(name + "_thumb", [tuple(q) for q in pts], [0.0125 * s * thick, 0.0112 * s * thick, 0.0100 * s * thick, 0.0086 * s * thick], segments=8, mat=m))
    j = K.join_objects(objs, name)
    bake(j)
    R = V(0, 0, -1).rotation_difference(V(direction).normalized()).to_matrix()
    j.data.transform(M4(wrist, R))
    j.data.update()
    return j


def fist(name, center, axis, wrist, m, *, s=1.0, rod_r=0.016, thick=1.0):
    """Fist wrapped around a rod through `center` along `axis`; palm/back of hand toward `wrist`."""
    z = V(axis).normalized()
    x = V(wrist) - V(center)
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    R = Matrix((x, y, z)).transposed()
    rr = rod_r + 0.0105 * s * thick
    objs = [sphere(name + "_palm", (0.024 * s * thick, 0.036 * s, 0.046 * s), (rr + 0.010 * s, 0, 0), m, 12, 8)]
    for i, zo in enumerate((0.027, 0.009, -0.009, -0.026)):
        pts = []
        for k in range(8):
            a = math.radians(70 + k * 32)
            pts.append((math.cos(a) * rr, math.sin(a) * rr, zo * s))
        objs.append(K.make_tube(f"{name}_r{i}", pts, 0.0105 * s * thick * (1.0 - 0.06 * i), segments=8, mat=m))
    th = []
    for k in range(6):
        a = math.radians(-60 + k * 30)
        th.append((math.cos(a) * (rr + 0.004), math.sin(a) * (rr + 0.004), 0.040 * s))
    objs.append(K.make_tube(name + "_thumb", th, [0.012 * s, 0.012 * s, 0.011 * s, 0.010 * s, 0.009 * s, 0.008 * s], segments=8, mat=m))
    j = K.join_objects(objs, name)
    bake(j)
    j.data.transform(M4(center, R))
    j.data.update()
    return j


def shoe(name, ankle, side, upper_m, sole_m, *, length=0.27, width=0.10, height=0.095, toe_drop=0.45):
    ax, ay, _az = ankle
    cy = ay - length * 0.30
    up = sphere(name, (width / 2, length / 2, height * 0.62), (ax, cy, height * 0.45), upper_m, 20, 12)
    sole_z = 0.018

    def f(p):
        x, y, zz = p.x, p.y, p.z
        if zz < sole_z:
            zz = sole_z - (sole_z - zz) * 0.08
        yr = (y - cy) / (length / 2)
        if yr < -0.15:
            k = min(1.0, (-yr - 0.15) / 0.85)
            zz = sole_z + (zz - sole_z) * (1.0 - toe_drop * k)
            x += side * 0.010 * k
        return V(x, y, zz)

    deform(up, f)
    so = sphere(name + "_sole", (width / 2 + 0.005, length / 2 + 0.007, 0.021), (ax + side * 0.003, cy, 0.017), sole_m, 20, 8)
    deform(so, lambda p: V(p.x, p.y, max(0.0, p.z)))
    return [up, so]


def eyelids(name, hc, s, m, *, upper_cut=0.006, lower_cut=None, slope=0.0):
    cx, cy, cz = hc
    out = []
    for sx in (1.0, -1.0):
        ex, ey, ez = cx + sx * 0.037 * s, cy - 0.097 * s, cz + 0.008 * s
        r = 0.0212 * s
        lid = sphere(f"{name}_lid{'L' if sx > 0 else 'R'}", r, (ex, ey, ez), m, 18, 12)
        delete_verts(lid, lambda c, ex=ex, ey=ey, ez=ez, sx=sx: (c.z - ez) < (upper_cut * s + slope * s * sx * (c.x - ex) / (0.02 * s)) or (c.y - ey) > 0.008 * s)
        out.append(lid)
        if lower_cut is not None:
            lo = sphere(f"{name}_lowlid{'L' if sx > 0 else 'R'}", r * 0.99, (ex, ey, ez), m, 18, 12)
            delete_verts(lo, lambda c, ey=ey, ez=ez: (c.z - ez) > lower_cut * s or (c.y - ey) > 0.006 * s)
            out.append(lo)
    return out


def head_eye_pos(hc, s, sx):
    cx, cy, cz = hc
    return V(cx + sx * 0.037 * s, cy - 0.097 * s, cz + 0.008 * s)


def head_cap(name, c, radii, m, cover, *, nseg=28, top=0.997, thickness=0.0):
    """Ellipsoidal cap over a head with a smooth hairline. cover: [(z_rel, half_angle_from_back)] low->high."""
    a, b, cz = radii
    rings = []
    zs = [z for z, _h in cover]
    z_hi = cz * top
    extra = [zs[-1] + (z_hi - zs[-1]) * t for t in (0.35, 0.65, 0.85, 1.0)]
    for z, h in cover + [(z, PI) for z in extra]:
        k = math.sqrt(max(0.0, 1.0 - (z / cz) ** 2))
        rings.append((c.z + z, a * k, b * k, c.y, h))
    o, _g = shell(name, rings, m, center=PI / 2, nseg=nseg, thickness=thickness)
    deform(o, lambda p: p + V(c.x, 0, 0))
    return o


# ---------------------------------------------------------------------------
# Rig, binding, weights, normalisation
# ---------------------------------------------------------------------------

def mirror(p):
    return V(-p[0], p[1], p[2])


def std_bones(L):
    B = {
        "Root": (V(0, 0, 0), V(0, 0, 0.14)),
        "Pelvis": (V(L["pelvis"]), V(L["spine"])),
        "Spine": (V(L["spine"]), V(L["chest"])),
        "Chest": (V(L["chest"]), V(L["neck"])),
        "Neck": (V(L["neck"]), V(L["head"])),
        "Head": (V(L["head"]), V(L["head_top"])),
        "Jaw": (V(L["jaw"]), V(L["jaw_tip"])),
    }
    for side in ("L", "R"):
        def g(k):
            if k + side in L:
                return V(L[k + side])
            return mirror(L[k + "L"]) if side == "R" else V(L[k + "L"])
        eye = g("eye")
        B["Eye" + side] = (eye, eye + V(0, 0, 0.035))
        B["Shoulder" + side] = (g("clav"), g("sj"))
        B["Arm" + side] = (g("sj"), g("el"))
        B["Forearm" + side] = (g("el"), g("wr"))
        B["Hand" + side] = (g("wr"), g("tip"))
        B["Thigh" + side] = (g("hip"), g("kn"))
        B["Shin" + side] = (g("kn"), g("an"))
        B["Foot" + side] = (g("an"), g("toe"))
    return B


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.dot(ab))))
    return (p - (a + ab * t)).length


def blend_chains(mesh_obj, arm_obj, chains, power=5.0):
    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm_obj.data.bones}
    chain_of = {}
    for ch in chains:
        for b in ch:
            chain_of[b] = ch
    vgs = mesh_obj.vertex_groups
    names = {vg.index: vg.name for vg in vgs}
    plan = []
    for v in mesh_obj.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda gg: gg.weight)
        ch = chain_of.get(names[g.group])
        if not ch:
            continue
        p = v.co
        ws = [1.0 / max(1e-4, seg_dist(p, *segs[b])) ** power for b in ch]
        ranked = sorted(zip(ch, ws), key=lambda e: -e[1])[:3]
        tot = sum(w for _, w in ranked)
        plan.append((v.index, ch, {b: w / tot for b, w in ranked if w / tot > 0.02}))
    for idx, ch, wmap in plan:
        for b in ch:
            if b in wmap:
                vgs[b].add([idx], wmap[b], "REPLACE")
            else:
                vgs[b].remove([idx])


def normalise_figure(parts, joints, extra, target_h):
    objs = [o for lst in parts.values() for o in lst]
    for o in objs:
        bake(o)
    zs = [v.co.z for o in objs for v in o.data.vertices]
    zmin, zmax = min(zs), max(zs)
    s = target_h / (zmax - zmin)
    T = Matrix.Scale(s, 4) @ Matrix.Translation(V(0, 0, -zmin))
    for o in objs:
        o.data.transform(T)
        o.data.update()

    def tp(p):
        return T @ V(p)

    joints = {k: (tp(h), tp(t)) for k, (h, t) in joints.items()}
    extra = {k: (par, tp(h), tp(t)) for k, (par, h, t) in extra.items()}
    return joints, extra, s


def build_rig(cid, joints, extra, height):
    arm = K.create_humanoid_armature(
        cid, height=height, extra_bones={k: (par, tuple(h), tuple(t)) for k, (par, h, t) in extra.items()}
    )
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for name, (h, t) in joints.items():
        b = eb[name]
        b.head = V(h)
        b.tail = V(t)
        b.roll = 0.0
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(False)
    return arm


ARM_CHAINS = [["ArmL", "ForearmL", "HandL"], ["ArmR", "ForearmR", "HandR"]]
TORSO_CHAIN = ["Pelvis", "Spine", "Chest", "Neck"]


def blend_ankles(mesh_obj, arm_obj, below=0.03, above=0.06, radius=0.075):
    """Cross-fade Shin -> Foot weights by height around each ankle, so the leg inside a shoe
    collar and the collar itself move as one if the ankle ever bends (no gap can open)."""
    vgs = mesh_obj.vertex_groups
    names = {vg.index: vg.name for vg in vgs}
    for side in ("L", "R"):
        shin, foot = "Shin" + side, "Foot" + side
        an = arm_obj.data.bones[foot].head_local
        z0, z1 = an.z - below, an.z + above
        for v in mesh_obj.data.vertices:
            if not v.groups:
                continue
            g = max(v.groups, key=lambda gg: gg.weight)
            if names[g.group] not in (shin, foot):
                continue
            p = v.co
            if math.hypot(p.x - an.x, p.y - an.y) > radius or not (z0 < p.z < z1):
                continue
            t = (z1 - p.z) / (z1 - z0)
            wf = t * t * (3 - 2 * t)
            vgs[foot].add([v.index], wf, "REPLACE")
            vgs[shin].add([v.index], 1.0 - wf, "REPLACE")


def finish(cid, parts, L, extra, chains, render=True, ankles=False):
    target = TARGETS[cid]["height"]
    if os.environ.get("NPC_TRI_REPORT"):
        rows = sorted(((sum(len(p.vertices) - 2 for p in o.data.polygons), o.name) for lst in parts.values() for o in lst), reverse=True)
        print("TRI_REPORT", cid, sum(r[0] for r in rows), rows[:30])
    joints = std_bones(L)
    joints, extra, s = normalise_figure(parts, joints, extra, target)
    arm = build_rig(cid, joints, extra, target)
    mesh = K.bind_parts_to_bones(arm, {b: lst for b, lst in parts.items() if lst}, mesh_name=f"{cid}_Body")
    blend_chains(mesh, arm, chains)
    if ankles:
        blend_ankles(mesh, arm)
    metrics = K.finalize_and_export(cid, arm, mesh, repo_root=REPO, bg_hex=TARGETS[cid]["bg"], render_sheet=render)
    metrics["designScale"] = round(s, 4)
    if os.environ.get("NPC_POSE_TEST"):
        pose_test(cid, arm, mesh, os.environ["NPC_POSE_TEST"])
    metrics["materials"] = len(mesh.data.materials)
    print("BATCH_A_METRICS", cid, metrics)
    return metrics


def pose_test(cid, arm, mesh, out_dir):
    """Review aid: pose the rig the way NpcRig does mid-gesture (bone-local, three.js YXZ order)
    and render a sheet so elbow blending, jaw, gaze, blink and extra bones can be checked."""
    pose = {
        "ArmR": (-1.35, 0.0, -0.41), "ForearmR": (-0.95, 0.0, 0.0), "ArmL": (-0.55, 0.0, 0.06), "ForearmL": (-0.6, 0.0, 0.0),
        "Spine": (0.08, 0.0, 0.0), "Neck": (0.05, 0.15, 0.0), "Head": (0.08, 0.3, 0.06), "Jaw": (0.32, 0.0, 0.0),
        "EyeL": (0.0, 0.3, 0.0), "EyeR": (0.0, 0.3, 0.0), "Cloak": (0.12, 0.0, 0.05), "Tail1": (0.05, 0.22, 0.0),
        "Tail2": (0.04, -0.28, 0.0), "Halo": (0.0, 1.2, 0.0), "EarL": (0.0, 0.0, 0.22), "EarR": (0.0, 0.0, -0.22), "Lantern": (0.09, 0.0, 0.07),
    }
    for name, (rx, ry, rz) in pose.items():
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        pb.rotation_mode = "ZXY"
        pb.rotation_euler = (rx, ry, rz)
    for name in ("EyeL", "EyeR"):
        if name in arm.pose.bones:
            arm.pose.bones[name].scale = (1.0, 0.35, 1.0)
    bpy.context.view_layer.update()
    K.render_turnaround_sheet(arm, mesh, os.path.join(out_dir, f"{cid}_pose.png"), bg_hex=TARGETS[cid]["bg"])
    for pb in arm.pose.bones:
        pb.rotation_euler = (0, 0, 0)
        pb.scale = (1, 1, 1)


class Parts(dict):
    def add(self, bone, *objs):
        for o in objs:
            if o is None:
                continue
            if isinstance(o, (list, tuple)):
                self.add(bone, *o)
                continue
            self.setdefault(bone, []).append(o)


# ===========================================================================
# 1. KESTREL, the Draftwright (1.78 m) - holographic drafting familiar
# ===========================================================================

def build_kestrel():
    core = mat("K_Core", "#0e3a4a", pack="kestrel", maps=("albedo", "normal", "emissive"), uv=2.2, nstr=0.5,
               roughness=0.18, alpha=0.62, emission_strength=1.8, coat_weight=0.8, coat_roughness=0.05)
    plate = mat("K_FacePlate", "#041a24", roughness=0.10, metallic=0.25, coat_weight=1.0, coat_roughness=0.03)
    light = mat("K_LightPlane", "#7ce7f5", roughness=0.32, emission_color="#22d3ee", emission_strength=0.55, coat_weight=0.5)
    line = mat("K_Line", "#cffafe", roughness=0.2, emission_color="#cffafe", emission_strength=4.5)
    accent = mat("K_Accent", "#22d3ee", roughness=0.25, emission_color="#22d3ee", emission_strength=3.2)
    scroll = mat("K_Blueprint", "#0e3a4a", pack="kestrel", maps=("albedo", "emissive"), uv=3.5, roughness=0.35,
                 alpha=0.86, double_sided=True, emission_strength=2.0)

    P = Parts()
    hc = V(0, 0.0, 1.585)
    L = {
        "pelvis": (0, 0, 0.86), "spine": (0, 0, 1.00), "chest": (0, 0, 1.18), "neck": (0, 0, 1.40),
        "head": (0, 0, 1.47), "head_top": (0, 0, 1.70), "jaw": (0, -0.02, 1.50), "jaw_tip": (0, -0.09, 1.48),
        "clavL": (0.05, 0.0, 1.37), "sjL": (0.155, 0.0, 1.365), "elL": (0.215, 0.02, 1.12),
        "wrL": (0.25, -0.03, 0.83), "tipL": (0.262, -0.05, 0.64),
        "elR": (-0.215, 0.025, 1.12), "wrR": (-0.235, -0.12, 0.86), "tipR": (-0.24, -0.20, 0.74),
        "hipL": (0.085, 0.0, 0.88), "knL": (0.10, -0.005, 0.47), "anL": (0.118, 0.006, 0.13), "toeL": (0.125, 0.01, 0.0),
    }

    # --- Head: elongated oval light-volume + dark face plate with drawn features ---
    rx, ry, rz = 0.082, 0.092, 0.118
    head = sphere("K_head", (rx, ry, rz), hc, core, 28, 20)

    def egg(p):
        d = p - hc
        if d.z < 0:
            t = min(1.0, -d.z / rz)
            d.x *= 1.0 - 0.30 * t ** 1.5
            d.y *= 1.0 - 0.12 * t ** 1.5
        return hc + d

    deform(head, egg)
    P.add("Head", head)

    def plate_pt(az, el, off=0.0):
        d = V(math.sin(az) * math.cos(el) * (rx + off), -math.cos(az) * math.cos(el) * (ry + off), math.sin(el) * (rz + off))
        return egg(hc + d)

    bm = bmesh.new()
    rings_n, phi_n = 7, 28
    centre = bm.verts.new(plate_pt(0.0, 0.02, 0.004))
    ringsv = []
    for i in range(1, rings_n + 1):
        r = i / rings_n
        ringsv.append([bm.verts.new(plate_pt(r * math.cos(TAU * k / phi_n) * 1.05, 0.02 + r * math.sin(TAU * k / phi_n) * 0.92, 0.004)) for k in range(phi_n)])
    for k in range(phi_n):
        bm.faces.new((centre, ringsv[0][k], ringsv[0][(k + 1) % phi_n]))
    for i in range(rings_n - 1):
        for k in range(phi_n):
            bm.faces.new((ringsv[i][k], ringsv[i + 1][k], ringsv[i + 1][(k + 1) % phi_n], ringsv[i][(k + 1) % phi_n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new("K_plate")
    bm.to_mesh(me)
    bm.free()
    plate_o = bpy.data.objects.new("K_plate", me)
    bpy.context.collection.objects.link(plate_o)
    K.assign_material(plate_o, plate)
    K.set_smooth(plate_o)
    for poly in plate_o.data.polygons:
        if poly.normal.y > 0:
            poly.flip()
    P.add("Head", plate_o)
    rim = [plate_pt(math.cos(TAU * k / 40) * 1.05, 0.02 + math.sin(TAU * k / 40) * 0.92, 0.006) for k in range(41)]
    P.add("Head", K.make_tube("K_plate_rim", [tuple(p) for p in rim], 0.0032, segments=6, mat=accent))

    # eyes: two bright drafted arcs (bound to EyeL/EyeR so blink squashes them)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        az0, el0 = sx * 0.37, 0.10
        arc = [plate_pt(az0 + math.cos(math.radians(a)) * 0.21, el0 - 0.035 + math.sin(math.radians(a)) * 0.13, 0.009) for a in range(15, 170, 11)]
        P.add("Eye" + side, K.make_tube(f"K_eye{side}", [tuple(p) for p in arc], 0.0046, segments=6, mat=line))
        dot = plate_pt(az0, el0 - 0.06, 0.010)
        P.add("Eye" + side, sphere(f"K_eyedot{side}", 0.0062, dot, line, 8, 6))
        L["eye" + side] = tuple(plate_pt(az0, el0 - 0.02, -0.02))
        brow = [plate_pt(az0 + sx * d, el0 + 0.20 + 0.06 * (-sx * d), 0.008) for d in (-0.20, -0.07, 0.06, 0.18)]
        P.add("Head", K.make_tube(f"K_brow{side}", [tuple(p) for p in brow], 0.0026, segments=5, mat=accent))
        # construction tick marks at the temples (drafting registration marks)
        t0 = plate_pt(sx * 0.95, 0.05, 0.0)
        P.add("Head", K.make_tube(f"K_tick{side}", [tuple(t0), tuple(plate_pt(sx * 1.12, 0.05, 0.004))], 0.0022, segments=5, mat=accent))

    # crown: compass hinge pin (the drafting-compass silhouette)
    top = hc + V(0, 0, rz)
    P.add("Head", cyl("K_pin", 0.010, 0.014, 0.030, top + V(0, 0, 0.008), (0, 0, 1), line, 12))
    P.add("Head", torus("K_hinge", 0.024, 0.0055, top + V(0, 0, 0.040), (0, 1, 0), accent, 24, 8))
    P.add("Head", sphere("K_knob", 0.012, top + V(0, 0, 0.068), line, 12, 8))
    P.add("Head", cyl("K_hingeaxle", 0.007, 0.007, 0.06, top + V(0, 0, 0.040), (0, 1, 0), line, 10))

    # neck
    P.add("Neck", tube("K_neck", [(0, 0.004, 1.38), (0, 0.0, 1.44), (0, -0.004, 1.50)], [0.036, 0.031, 0.030], core, seg=14))
    P.add("Neck", torus("K_neckring", 0.036, 0.004, V(0, 0.0, 1.445), (0, 0, 1), accent, 24, 6))

    # --- Smock of faceted solid light planes ---
    smock_rings = [
        (1.445, 0.052, 0.046, 0.0, PI),
        (1.418, 0.080, 0.064, 0.0, PI),
        (1.402, 0.108, 0.072, 0.002, PI),
        (1.372, 0.128, 0.080, 0.004, PI),
        (1.32, 0.134, 0.088, 0.0, PI),
        (1.25, 0.132, 0.088, -0.004, PI),
        (1.15, 0.110, 0.078, -0.002, PI),
        (1.05, 0.104, 0.074, 0.0, PI),
        (0.97, 0.130, 0.090, 0.004, PI - 0.06),
        (0.88, 0.160, 0.110, 0.012, PI - 0.24),
        (0.78, 0.192, 0.132, 0.022, PI - 0.44, 0.035),
    ]
    smock, grid = shell("K_smock", smock_rings, light, center=PI / 2, nseg=16, thickness=0.008, flat=True)
    P.add("Spine", smock)
    hem = grid[-1]
    P.add("Spine", K.make_tube("K_hem", [tuple(p) for p in hem], 0.0035, segments=6, mat=accent))
    for col in (0, len(grid[0]) - 1):
        edge = [grid[r][col] for r in range(7, len(grid))]
        P.add("Spine", K.make_tube(f"K_split{col}", [tuple(p) for p in edge], 0.0032, segments=6, mat=accent))
    P.add("Chest", K.make_tube("K_collar", [tuple(p) for p in grid[0]] + [tuple(grid[0][0])], 0.0035, segments=6, mat=accent))
    # scan lines across the chest panels
    for zi, zz in enumerate((1.30, 1.22, 1.14)):
        rxz, ryz, yoz = profile_at([(r[0], r[1], r[2], r[3]) for r in smock_rings], zz)
        pts = [V(math.cos(a) * (rxz + 0.007), math.sin(a) * (ryz + 0.007) + yoz, zz) for a in [(-PI / 2) + (k - 5) * 0.11 for k in range(11)]]
        P.add("Chest", K.make_tube(f"K_scan{zi}", [tuple(p) for p in pts], 0.0018, segments=4, mat=accent))
    # inner core volume visible through the front split
    P.add("Pelvis", lathe("K_hips", [(0.79, 0.05, 0.04, 0.0), (0.83, 0.10, 0.070, 0.0), (0.92, 0.112, 0.076, 0.0), (1.00, 0.098, 0.068, 0.0)], core, seg=18))

    # --- Arms: translucent core, long forearms, compass-pivot joints ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sj = V(L["sjL"]) if side == "L" else mirror(L["sjL"])
        el = V(L["el" + side]) if "el" + side in L else mirror(L["elL"])
        wr = V(L["wr" + side])
        P.add("Shoulder" + side, sphere(f"K_shoulder{side}", 0.044, sj + V(-sx * 0.006, 0, 0.004), core, 14, 10))
        up = tube(f"K_upper{side}", [sj, lerp(sj, el, 0.5), el], [0.037, 0.032, 0.029], core, seg=12)
        P.add("Arm" + side, up)
        # faceted cap sleeve of light planes
        d = (el - sj).normalized()
        pad = sphere(f"K_pauldron{side}", (0.052, 0.048, 0.018), (0, 0, 0), light, 12, 6)
        xf(pad, M4(sj + V(-sx * 0.012, 0, 0.032), basis(V(sx * 0.55, 0, 1.0), (0, -1, 0))))
        flat_shade(pad)
        P.add("Shoulder" + side, pad)
        P.add("Arm" + side, torus(f"K_armband{side}", 0.036, 0.003, sj + d * 0.07, d, accent, 20, 5))
        P.add("Forearm" + side, sphere(f"K_elbow{side}", 0.026, el, line, 12, 8))
        P.add("Forearm" + side, torus(f"K_elbowring{side}", 0.034, 0.003, el, (1, 0, 0), accent, 20, 5))
        P.add("Forearm" + side, tube(f"K_fore{side}", [el, lerp(el, wr, 0.5), wr], [0.029, 0.025, 0.020], core, seg=12))
        P.add("Hand" + side, sphere(f"K_wrist{side}", 0.017, wr, line, 10, 8))
        if side == "L":
            P.add("Hand" + side, hand("K_handL", wr, (wr - el), sx, core, s=0.92, curl=0.30, flen=1.30, thick=0.85))

    # right hand grips the glowing dividers (taller than her forearm)
    wrR, elR = V(L["wrR"]), V(L["elR"])
    fdir = (wrR - elR).normalized()
    grip = wrR + fdir * 0.060
    A = V(0.08, -0.42, -1.0).normalized()
    P.add("HandR", fist("K_fistR", grip, A, wrR, core, s=0.92, rod_r=0.010, thick=0.9))
    hinge = grip + A * 0.045
    xs = A.cross(V(0, 0, 1)).normalized()
    div = [sphere("K_div_knob", 0.012, grip - A * 0.065, line, 12, 8),
           tube("K_div_handle", [grip - A * 0.06, grip + A * 0.04], [0.0075, 0.0085], line, seg=10, n_per=1),
           torus("K_div_hinge", 0.020, 0.0055, hinge, xs.cross(A), accent, 24, 8)]
    spread = math.radians(10)
    for k, sg in enumerate((1, -1)):
        legd = (A * math.cos(spread) + xs * sg * math.sin(spread)).normalized()
        tip = hinge + legd * 0.43
        div.append(tube(f"K_div_leg{k}", [hinge, hinge + legd * 0.22, tip], [0.0085, 0.0065, 0.0012], line, seg=10, n_per=1))
    arc = [hinge + (A * math.cos(a) + xs * math.sin(a)) * 0.16 for a in [spread * (t / 4.0 * 2 - 1) for t in range(5)]]
    div.append(K.make_tube("K_div_arc", [tuple(p) for p in arc], 0.003, segments=5, mat=accent))
    P.add("PropR", div)

    # --- Legs: taper to hovering needle points like a compass ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        hip = V(L["hipL"]) if sx > 0 else mirror(L["hipL"])
        kn = V(L["knL"]) if sx > 0 else mirror(L["knL"])
        an = V(L["anL"]) if sx > 0 else mirror(L["anL"])
        toe = V(L["toeL"]) if sx > 0 else mirror(L["toeL"])
        P.add("Thigh" + side, tube(f"K_thigh{side}", [hip + V(0, 0, 0.04), lerp(hip, kn, 0.5), kn], [0.060, 0.050, 0.038], core, seg=14))
        P.add("Shin" + side, sphere(f"K_knee{side}", 0.030, kn, line, 12, 8))
        P.add("Shin" + side, torus(f"K_kneering{side}", 0.040, 0.0032, kn, (1, 0, 0), accent, 20, 5))
        P.add("Shin" + side, tube(f"K_shin{side}", [kn, lerp(kn, an, 0.5), an], [0.035, 0.026, 0.014], core, seg=12))
        P.add("Foot" + side, tube(f"K_needle{side}", [an, lerp(an, toe, 0.5), toe], [0.014, 0.008, 0.0015], line, seg=10))
        P.add("Shin" + side, torus(f"K_anklering{side}", 0.022, 0.0028, an + V(0, 0, 0.02), (0, 0, 1), accent, 18, 5))

    # --- Orbiting tool belt (Halo bone spins it around the waist) ---
    belt_z, belt_r = 1.0, 0.235
    belt = [torus("K_orbit", belt_r, 0.0028, V(0, 0, belt_z), (0, 0, 1), accent, 48, 5)]

    def orbit(a, dz=0.0, rr=belt_r):
        return V(math.cos(a) * rr, math.sin(a) * rr, belt_z + dz)

    a = -1.05  # ruler, front-right
    tang = V(-math.sin(a), math.cos(a), 0)
    belt.append(box("K_ruler", (0.012, 0.25, 0.034), M4(orbit(a, 0.01), basis((math.cos(a), math.sin(a), 0), (0, 0, 1)) @ Matrix.Rotation(0, 3, "Z")), light))
    for k in range(9):
        tk = orbit(a, 0.024, belt_r + 0.007) + tang * (-0.11 + k * 0.0275)
        belt.append(box(f"K_tick{k}", (0.004, 0.003, 0.012 if k % 2 else 0.018), M4(tk, basis((math.cos(a), math.sin(a), 0), (0, 0, 1))), line))
    a = 2.35  # protractor ring, back-left
    pc = orbit(a, 0.01)
    radial = V(math.cos(a), math.sin(a), 0)
    belt.append(torus("K_protractor", 0.065, 0.0045, pc, radial, line, 32, 6))
    tang = V(-math.sin(a), math.cos(a), 0)
    belt.append(K.make_tube("K_protractor_base", [tuple(pc - tang * 0.065), tuple(pc + tang * 0.065)], 0.0035, segments=6, mat=line))
    for k in range(7):
        ang = PI * k / 6
        belt.append(K.make_tube(f"K_prot_ray{k}", [tuple(pc), tuple(pc + (tang * math.cos(ang) + V(0, 0, 1) * math.sin(ang)) * 0.058)], 0.0014, segments=4, mat=accent))
    a = 0.55  # pencil of light, back-right
    tang = V(-math.sin(a), math.cos(a), 0)
    pc = orbit(a, -0.02)
    belt.append(tube("K_pencil", [pc - tang * 0.10, pc + tang * 0.06, pc + tang * 0.10], [0.0085, 0.0085, 0.001], line, seg=8, n_per=1))
    a = 3.75  # set-square, left
    pc = orbit(a, 0.0)
    radial = V(math.cos(a), math.sin(a), 0)
    tang = V(-math.sin(a), math.cos(a), 0)
    tri = [pc - tang * 0.05 - V(0, 0, 0.03), pc + tang * 0.05 - V(0, 0, 0.03), pc - tang * 0.05 + V(0, 0, 0.06), pc - tang * 0.05 - V(0, 0, 0.03)]
    belt.append(K.make_tube("K_setsquare", [tuple(p) for p in tri], 0.0035, segments=5, mat=line))
    P.add("Halo", belt)

    # --- Two trailing blueprint ribbon scrolls (Tail1/Tail2) ---
    for k, (bone, sx) in enumerate((("Tail1", 1.0), ("Tail2", -1.0))):
        ctrl = [(sx * 0.055, 0.080, 1.31), (sx * 0.085, 0.15, 1.20), (sx * 0.135, 0.25, 1.02), (sx * 0.115, 0.32, 0.84),
                (sx * 0.155, 0.37, 0.66), (sx * 0.175, 0.41, 0.48)]
        rib, pts = ribbon(f"K_scroll{k}", ctrl, [0.07, 0.10, 0.12, 0.13, 0.135, 0.135], scroll,
                          up_hint=(1, 0, 0), twist=[0.0, 0.35 * sx, -0.25 * sx, 0.3 * sx, -0.2 * sx, 0.1 * sx], n_per=4)
        P.add(bone, rib)
        end = pts[-1]
        tg = (pts[-1] - pts[-2]).normalized()
        sd = V(1, 0, 0) - tg * tg.x
        sd.normalize()
        sd = Matrix.Rotation(0.1 * sx, 3, tg) @ sd
        P.add(bone, tube(f"K_roll{k}", [end - sd * 0.072, end + sd * 0.072], 0.019, scroll, seg=12, n_per=1))
        P.add(bone, tube(f"K_rollcap{k}", [end - sd * 0.078, end + sd * 0.078], 0.0065, accent, seg=8, n_per=1))
        # glowing edge lines along both ribbon borders
        for e in (-1, 1):
            edge = []
            for i, p in enumerate(pts):
                tg2 = (pts[min(len(pts) - 1, i + 1)] - pts[max(0, i - 1)]).normalized()
                sd2 = V(1, 0, 0) - tg2 * tg2.x
                sd2.normalize()
                tw = resample_radii([0.0, 0.35 * sx, -0.25 * sx, 0.3 * sx, -0.2 * sx, 0.1 * sx], 6, len(pts))[i]
                sd2 = Matrix.Rotation(tw, 3, tg2) @ sd2
                w = resample_radii([0.07, 0.10, 0.12, 0.13, 0.135, 0.135], 6, len(pts))[i]
                edge.append(p + sd2 * e * w * 0.5)
            P.add(bone, K.make_tube(f"K_scrolledge{k}{e}", [tuple(q) for q in edge[::2]], 0.0022, segments=4, mat=accent))

    extra = {
        "Halo": ("Pelvis", (0, 0, belt_z), (0, 0, belt_z + 0.12)),
        "Tail1": ("Chest", (0.055, 0.08, 1.31), (0.13, 0.30, 0.92)),
        "Tail2": ("Chest", (-0.055, 0.08, 1.31), (-0.13, 0.30, 0.92)),
        "PropR": ("HandR", tuple(grip), tuple(grip + A * 0.2)),
    }
    return finish("kestrel", P, L, extra, ARM_CHAINS + [TORSO_CHAIN])


# ===========================================================================
# 2. SOLENNE, Keeper of the Brass Arches (1.84 m) - solarpunk elder tinker
# ===========================================================================

def build_solenne():
    skin = mat("S_Skin", "#5a3726", roughness=0.72, coat_weight=0.04, coat_roughness=0.6)
    skin_dark = mat("S_SkinCrease", "#462a1d", roughness=0.6)
    lip = mat("S_Lip", "#4a2a22", roughness=0.4)
    eye_w = mat("S_EyeWhite", "#f1ebe1", roughness=0.15, coat_weight=1.0)
    iris = mat("S_Iris", "#3d2312", roughness=0.2, coat_weight=1.0)
    pupil = mat("S_Pupil", "#0b0705", roughness=0.1)
    silver = mat("S_Silver", "#c9c6bf", pack="solenne", maps=("normal",), uv=6, nstr=0.8, roughness=0.62)
    wrap_m = mat("S_Wrap", "#e9b43a", pack="solenne", maps=("normal", "roughness"), uv=5, nstr=0.9)
    linen = mat("S_Linen", "#f3ecd0", pack="solenne", maps=("normal", "roughness"), uv=4.5, nstr=0.9)
    ochre = mat("S_Waistcoat", "#a8623a", pack="solenne", maps=("normal",), uv=4.0, nstr=0.7, roughness=0.7)
    canvas = mat("S_Canvas", "#5f6e35", pack="solenne", maps=("albedo", "normal", "roughness"), uv=2.5, nstr=1.0, tint_strength=1.0)
    trouser = mat("S_Trousers", "#7d6c4c", pack="solenne", maps=("normal",), uv=4, nstr=0.8, roughness=0.78)
    leather = mat("S_Leather", "#5c3a22", roughness=0.5, coat_weight=0.35, coat_roughness=0.4)
    leather2 = mat("S_LeatherPatch", "#8a5a34", roughness=0.62)
    sole_m = mat("S_Sole", "#2a1d14", roughness=0.8)
    brass = mat("S_Brass", "#c8a24a", pack="_shared_brass", maps=("albedo", "normal"), uv=3, nstr=0.6, metallic=0.9, roughness=0.32)
    wood = mat("S_Wood", "#8a5a34", pack="_shared_wood", maps=("albedo",), uv=2.5, roughness=0.55)
    glass = mat("S_Glass", "#a8d8e8", roughness=0.05, alpha=0.35, coat_weight=1.0)
    solar = mat("S_SolarCell", "#1d2d5a", roughness=0.12, metallic=0.4, coat_weight=1.0)
    green = mat("S_SeedGreen", "#79a756", roughness=0.6)
    pink = mat("S_SeedPink", "#d9727f", roughness=0.6)
    rag = mat("S_Rag", "#b5483a", pack="solenne", maps=("normal",), uv=6, roughness=0.85)

    P = Parts()
    s = 0.97
    hc = V(0, -0.008, 1.585)
    L = {
        "pelvis": (0, 0, 0.93), "spine": (0, 0, 1.05), "chest": (0, 0, 1.22), "neck": (0, 0, 1.42),
        "head": (0, -0.004, 1.49), "head_top": (0, -0.008, 1.71), "jaw": (0, -0.03, 1.548), "jaw_tip": (0, -0.11, 1.525),
        "clavL": (0.06, 0.0, 1.39), "sjL": (0.19, 0.01, 1.375), "elL": (0.245, 0.035, 1.10),
        "wrL": (0.272, -0.005, 0.855), "tipL": (0.285, -0.03, 0.70),
        "elR": (-0.25, 0.035, 1.10), "wrR": (-0.29, -0.165, 0.965), "tipR": (-0.30, -0.26, 0.93),
        "hipL": (0.095, 0.0, 0.92), "knL": (0.10, -0.01, 0.50), "anL": (0.105, 0.015, 0.085), "toeL": (0.105, -0.16, 0.02),
    }
    for sx, side in ((1, "L"), (-1, "R")):
        L["eye" + side] = tuple(head_eye_pos(hc, s, sx))

    # --- head & face ---
    H = K.sculpt_stylized_head("S", center=tuple(hc), scale=s, skin_mat=skin, eye_white_mat=eye_w, iris_mat=iris,
                               pupil_mat=pupil, brow_mat=silver, lip_mat=lip, jaw_taper=0.74, cheek_fullness=1.15)
    P.add("Head", H["head"], H["brows"], H.get("ears"))
    P.add("Jaw", H["jaw"])
    P.add("EyeL", H["eye_l"])
    P.add("EyeR", H["eye_r"])
    P.add("Head", eyelids("S", hc, s, skin, upper_cut=-0.003, lower_cut=-0.0135, slope=0.10))
    hb = bvh_of([H["head"]])
    # laugh lines, crow's feet and cheekbone freckles
    for sx in (1, -1):
        pts = [project(hb, (sx * x * s, -0.4, hc.z + z * s), (0, 1, 0), 0.0006)[0] for x, z in ((0.024, -0.030), (0.033, -0.046), (0.036, -0.060))]
        P.add("Head", K.make_tube(f"S_laugh{sx}", [tuple(p) for p in pts], [0.0010, 0.0017, 0.0008], segments=5, mat=skin_dark))
        for k, (fx, fz) in enumerate(((0.045, -0.014), (0.055, -0.019), (0.049, -0.026), (0.039, -0.021), (0.061, -0.010), (0.031, -0.012))):
            p, _n = project(hb, (sx * fx * s, -0.4, hc.z + fz * s), (0, 1, 0), -0.0008)
            P.add("Head", sphere(f"S_freckle{sx}{k}", 0.0019, p, skin_dark, 6, 4))

    # --- sun-yellow headwrap with locs gathered at the back ---
    P.add("Head", head_cap("S_wrap", hc + V(0, 0.004, 0.004), (0.111 * s, 0.123 * s, 0.132 * s), wrap_m,
                           [(-0.075, 1.30), (-0.045, 1.32), (-0.015, 1.40), (0.015, 1.75), (0.035, 2.35), (0.05, PI)], nseg=28))
    knot = hc + V(0, 0.118, 0.0)
    P.add("Head", sphere("S_wrapknot", (0.055, 0.042, 0.048), knot, wrap_m, 16, 10))
    P.add("Head", torus("S_wrapband", 0.040, 0.010, knot + V(0, 0.022, -0.02), (0, 1, 0.5), wrap_m, 20, 8))
    locs = []
    for k in range(11):
        a = (k / 10.0 - 0.5) * 2.2
        base = knot + V(math.sin(a) * 0.032, 0.030, -0.030 - abs(math.sin(a)) * 0.01)
        spread = V(math.sin(a) * 0.07, 0.03 + 0.012 * math.cos(k * 1.7), 0)
        length = 0.24 + 0.05 * math.sin(k * 2.3)
        ctrl = [base, base + spread * 0.4 + V(0, 0.02, -length * 0.35), base + spread + V(0, 0.01, -length * 0.7), base + spread * 1.2 + V(0, -0.005, -length)]
        locs.append(tube(f"S_loc{k}", ctrl, [0.0125, 0.0115, 0.0105, 0.0075], silver, seg=6, n_per=2))
    P.add("Cloak", locs)

    # --- slatted brass solar-collector sun hat ---
    hat = []
    zb = 1.66
    hat.append(lathe("S_crown", [(zb - 0.01, 0.116, 0.126, -0.004), (zb + 0.05, 0.112, 0.122, -0.004), (zb + 0.094, 0.106, 0.115, -0.004),
                                  (zb + 0.110, 0.099, 0.108, -0.004), (zb + 0.118, 0.075, 0.082, -0.004), (zb + 0.121, 0.0, 0.0, -0.004)], brass, seg=28))
    hat.append(lathe("S_hatband", [(zb - 0.006, 0.119, 0.129, -0.004), (zb + 0.004, 0.121, 0.131, -0.004), (zb + 0.03, 0.119, 0.129, -0.004), (zb + 0.036, 0.116, 0.126, -0.004)], leather, seg=28, cap_bottom=False, cap_top=False))
    hat.append(cyl("S_solarcell", 0.05, 0.05, 0.008, V(0, -0.02, zb + 0.118), (0, -0.2, 1), solar, 20))
    hat.append(torus("S_solarrim", 0.05, 0.0045, V(0, -0.02, zb + 0.118), (0, -0.2, 1), brass, 24, 6))
    n_sl = 36
    r_in, r_out, droop = 0.112, 0.335, 0.15
    for k in range(n_sl):
        a = TAU * k / n_sl
        rm = (r_in + r_out) * 0.5
        c = V(math.cos(a) * rm, math.sin(a) * rm - 0.004, zb - math.sin(droop) * (rm - r_in))
        R = Matrix.Rotation(a, 3, "Z") @ Matrix.Rotation(droop, 3, "Y") @ Matrix.Rotation(0.30, 3, "X")
        hat.append(flat_shade(box(f"S_slat{k}", (r_out - r_in, 0.026, 0.004), M4(c, R), brass, bevel=0.0)))
    for rr in (0.205, r_out):
        hat.append(torus(f"S_brimring{rr}", rr, 0.0048, V(0, -0.004, zb - math.sin(droop) * (rr - r_in)), (0, 0, 1), brass, 40, 5))
    P.add("Hat", hat)

    # --- neck, linen shirt, waistcoat ---
    P.add("Neck", tube("S_neck", [(0, 0.006, 1.39), (0, 0.0, 1.46), (0, -0.006, 1.53)], [0.050, 0.046, 0.044], skin, seg=16))
    shirt_prof = [(0.88, 0.150, 0.108, 0.0), (0.98, 0.152, 0.110, 0.0), (1.06, 0.140, 0.102, 0.0), (1.15, 0.150, 0.106, -0.004),
                  (1.24, 0.165, 0.115, -0.008), (1.32, 0.172, 0.112, -0.004), (1.375, 0.150, 0.098, 0.002), (1.41, 0.095, 0.075, 0.004), (1.435, 0.058, 0.056, 0.004)]
    P.add("Chest", lathe("S_shirt", shirt_prof, linen, seg=22))
    col, cg = shell("S_collar", [(1.405, 0.066, 0.062, 0.004, PI - 0.42), (1.43, 0.066, 0.062, 0.006, PI - 0.50), (1.448, 0.072, 0.068, 0.010, PI - 0.62)],
                    linen, center=PI / 2, nseg=20, thickness=0.004)
    P.add("Neck", col)
    for sx in (1, -1):
        flap, _ = ribbon(f"S_collarpt{sx}", [(sx * 0.030, -0.070, 1.432), (sx * 0.048, -0.096, 1.392), (sx * 0.064, -0.112, 1.360)], [0.034, 0.028, 0.005], linen,
                         side_fn=lambda p, t, u: t.cross(V(0, -1, 0.3)), thickness=0.003)
        P.add("Chest", flap)
    vest_rings = [(1.02, 0.158, 0.117, 0.0, PI, -0.045), (1.10, 0.150, 0.111, 0.0, PI), (1.20, 0.162, 0.119, -0.006, PI - 0.06),
                  (1.28, 0.175, 0.122, -0.006, PI - 0.30), (1.34, 0.178, 0.119, -0.004, PI - 0.52), (1.385, 0.157, 0.104, 0.002, PI - 0.78)]
    vest, vg = shell("S_vest", vest_rings, ochre, center=PI / 2, nseg=26, thickness=0.006)
    P.add("Chest", vest)
    vprof = [(r[0], r[1], r[2], r[3]) for r in vest_rings]
    for k, zz in enumerate((1.29, 1.225, 1.16, 1.095)):
        p = on_profile(vprof, -PI / 2 + 0.07, zz, 0.010)
        P.add("Chest", gear(f"S_button{k}", 0.0115, 8, 0.005, p, (0, -1, 0.1), brass))
    pk = on_profile(vprof, -PI / 2 + 0.55, 1.23, 0.008)
    P.add("Chest", box("S_vestpocket", (0.055, 0.004, 0.008), M4(pk, basis((0.5, -1, 0), (0, 0, 1))), leather))
    # monocle-sextant on its chain from the vest pocket
    mono_c = on_profile(vprof, -PI / 2 + 0.38, 1.145, 0.016)
    chain = [pk + V(0, -0.004, 0), lerp(pk, mono_c, 0.5) + V(0, -0.012, -0.03), mono_c + V(0, 0, 0.024)]
    P.add("Chest", tube("S_chain", chain, 0.0018, brass, seg=5))
    P.add("Chest", torus("S_monocle", 0.021, 0.0035, mono_c, (0.25, -1, 0), brass, 24, 6))
    P.add("Chest", cyl("S_monoglass", 0.019, 0.019, 0.002, mono_c, (0.25, -1, 0), glass, 20))
    arcp = [mono_c + V(math.cos(a) * 0.04 * 0.97, -0.004, math.sin(a) * 0.04 - 0.012) for a in [math.radians(200 + 28 * t) for t in range(6)]]
    P.add("Chest", K.make_tube("S_sextant", [tuple(p) for p in arcp], 0.0025, segments=5, mat=brass))

    # --- multi-pocket sage canvas apron (waist to knee) ---
    ap_rings = [(1.075, 0.153, 0.113, 0.0, 1.78), (1.00, 0.160, 0.118, 0.0, 1.76), (0.90, 0.178, 0.130, -0.006, 1.62),
                (0.76, 0.198, 0.146, -0.012, 1.48), (0.62, 0.210, 0.156, -0.016, 1.38), (0.50, 0.214, 0.160, -0.02, 1.32)]
    apron, ag = shell("S_apron", ap_rings, canvas, center=-PI / 2, nseg=26, thickness=0.006,
                      zfn=lambda p, a, ri: p + V(0, 0, 0.006 * math.sin(a * 7) if ri == len(ap_rings) - 1 else 0))
    P.add("Pelvis", apron)
    aprof = [(r[0], r[1], r[2], r[3]) for r in ap_rings]
    P.add("Pelvis", lathe("S_apronband", [(1.055, 0.155, 0.115, 0.0), (1.06, 0.159, 0.119, 0.0), (1.085, 0.159, 0.119, 0.0), (1.09, 0.155, 0.115, 0.0)], canvas, seg=28, cap_bottom=False, cap_top=False))
    for sx in (1, -1):
        tie, _ = ribbon(f"S_tie{sx}", [(sx * 0.02, 0.122, 1.07), (sx * 0.05, 0.14, 0.98), (sx * 0.06, 0.135, 0.88)], [0.03, 0.028, 0.026], canvas,
                        up_hint=(1, 0, 0), thickness=0.004)
        P.add("Pelvis", tie)
    P.add("Pelvis", sphere("S_tieknot", (0.022, 0.014, 0.018), V(0, 0.125, 1.07), canvas, 10, 8))
    pockets = [(-PI / 2 - 0.62, 0.86, 0.36), (-PI / 2 - 0.05, 0.84, 0.30), (-PI / 2 + 0.55, 0.86, 0.34), (-PI / 2 + 0.25, 0.67, 0.28)]
    for k, (ac, zc, hw) in enumerate(pockets):
        rings = []
        for zz in (zc - 0.07, zc + 0.03):
            rx_, ry_, yo_ = profile_at(aprof, zz)
            rings.append((zz, rx_ + 0.008, ry_ + 0.008, yo_, hw * 0.5))
        pocket, _ = shell(f"S_pocket{k}", rings, canvas, center=ac, nseg=8, thickness=0.005)
        P.add("Pelvis", pocket)
        top = [on_profile(aprof, ac + d, zc + 0.03, 0.012) for d in (-hw * 0.5, 0, hw * 0.5)]
        P.add("Pelvis", K.make_tube(f"S_pockethem{k}", [tuple(p) for p in top], 0.0035, segments=5, mat=leather2))
    # pocket contents: seed packets, tuning fork, rag
    for k, (da, h, m_) in enumerate(((-0.10, 0.07, green), (0.0, 0.085, pink), (0.11, 0.065, wrap_m))):
        ac = pockets[0][0] + da
        p = on_profile(aprof, ac, pockets[0][1] + 0.03 + h * 0.3, 0.016)
        nrm = V(math.cos(ac), math.sin(ac), 0)
        P.add("Pelvis", box(f"S_seed{k}", (0.045, h, 0.004), M4(p, basis(nrm, (0.12 * (k - 1), 0, 1))), m_))
    fc = on_profile(aprof, pockets[2][0] + 0.05, pockets[2][1] + 0.05, 0.016)
    P.add("Pelvis", tube("S_fork_stem", [fc - V(0, 0, 0.05), fc + V(0, 0, 0.01)], 0.0035, brass, seg=8, n_per=1))
    P.add("Pelvis", tube("S_fork_u", [fc + V(-0.009, 0, 0.065), fc + V(-0.009, 0, 0.012), fc + V(0, 0, 0.004), fc + V(0.009, 0, 0.012), fc + V(0.009, 0, 0.065)], 0.003, brass, seg=6, n_per=2))
    rc = on_profile(aprof, pockets[1][0] + 0.03, pockets[1][1] + 0.02, 0.02)
    P.add("Pelvis", tube("S_rag", [rc + V(0.0, 0, 0.03), rc + V(0.012, -0.012, -0.01), rc + V(0.004, -0.018, -0.07), rc + V(0.012, -0.012, -0.12)], [0.02, 0.018, 0.014, 0.009], rag, seg=8))

    # --- wide-legged trousers tucked into patched boots ---
    P.add("Pelvis", lathe("S_hips", [(0.77, 0.10, 0.075, 0.0), (0.81, 0.155, 0.108, 0.0), (0.90, 0.153, 0.108, 0.0), (0.97, 0.146, 0.104, 0.0)], trouser, seg=24))
    for side, sx in (("L", 1.0), ("R", -1.0)):
        hip = V(sx * 0.095, 0.0, 0.86)
        kn = V(sx * 0.10, -0.01, 0.50)
        an = V(sx * 0.105, 0.015, 0.085)
        P.add("Thigh" + side, tube(f"S_thigh{side}", [hip, lerp(hip, kn, 0.5), kn + V(0, 0, 0.03)], [0.090, 0.086, 0.080], trouser, seg=14, n_per=2))
        P.add("Shin" + side, tube(f"S_calf{side}", [kn + V(0, 0, 0.04), kn - V(0, -0.004, 0.08), V(sx * 0.104, 0.004, 0.36), V(sx * 0.104, 0.008, 0.31)], [0.080, 0.084, 0.086, 0.062], trouser, seg=14, n_per=2))
        boot_top = 0.34
        P.add("Shin" + side, tube(f"S_bootshaft{side}", [V(sx * 0.105, 0.01, 0.06), V(sx * 0.105, 0.008, 0.20), V(sx * 0.104, 0.006, boot_top)], [0.058, 0.060, 0.066], leather, seg=14, n_per=2))
        P.add("Shin" + side, torus(f"S_bootcuff{side}", 0.066, 0.009, V(sx * 0.104, 0.006, boot_top), (0, 0, 1), leather, 20, 6))
        patch = sphere(f"S_bootpatch{side}", (0.006, 0.032, 0.038), V(sx * 0.163, 0.0, 0.21), leather2, 10, 8)
        P.add("Shin" + side, patch)
        for kk in range(4):
            st = V(sx * 0.168, -0.028 + kk * 0.018, 0.17)
            P.add("Shin" + side, box(f"S_stitch{side}{kk}", (0.003, 0.004, 0.012), M4(st), sole_m))
        P.add("Foot" + side, shoe(f"S_boot{side}", an, sx, leather, sole_m, length=0.275, width=0.104, height=0.10, toe_drop=0.40))
        P.add("Foot" + side, sphere(f"S_toecap{side}", (0.036, 0.03, 0.022), V(sx * 0.108, -0.175, 0.048), leather2, 12, 8))

    # --- arms: rolled linen sleeves, bare forearms ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sj = V(L["sjL"]) if sx > 0 else mirror(L["sjL"])
        el = V(L["el" + side]) if ("el" + side) in L else mirror(L["elL"])
        wr = V(L["wr" + side])
        fd = (wr - el).normalized()
        # tailored sleeve head: a low dome that emerges from under the vest's armhole
        # (no separate delt ball standing proud of the shoulder line)
        ud = (el - sj).normalized()
        roll_c = el + fd * 0.055
        P.add("Arm" + side, tube(f"S_sleeve{side}", [sj - ud * 0.002, sj + ud * 0.012, sj + ud * 0.034, sj + ud * 0.07, lerp(sj, el, 0.55), el, roll_c],
                                 [0.012, 0.036, 0.052, 0.058, 0.053, 0.050, 0.048], linen, seg=14, n_per=2))
        P.add("Forearm" + side, torus(f"S_roll{side}", 0.046, 0.015, roll_c, fd, linen, 18, 6))
        P.add("Forearm" + side, torus(f"S_roll2{side}", 0.043, 0.012, roll_c + fd * 0.022, fd, linen, 18, 6))
        P.add("Forearm" + side, tube(f"S_fore{side}", [roll_c, lerp(roll_c, wr, 0.5), wr + fd * 0.01], [0.037, 0.033, 0.027], skin, seg=14))
        if side == "L":
            P.add("HandL", hand("S_handL", wr, fd, sx, skin, s=1.02, curl=0.5))

    # --- the tuning staff in her right fist ---
    wrR, elR = V(L["wrR"]), V(L["elR"])
    fd = (wrR - elR).normalized()
    G = wrR + fd * 0.062
    B = V(-0.34, -0.26, 0.0)
    ax = (G - B).normalized()
    T = B + ax * 1.62
    P.add("HandR", fist("S_fistR", G, ax, wrR, skin, s=1.03, rod_r=0.017))
    staff = [tube("S_staff", [B + ax * 0.04, lerp(B, T, 0.5), T], [0.0165, 0.016, 0.015], wood, seg=12, n_per=1),
             tube("S_ferrule", [B, B + ax * 0.06], [0.014, 0.019], brass, seg=12, n_per=1),
             tube("S_gripband", [G + ax * 0.045, G + ax * 0.095], 0.0185, brass, seg=12, n_per=1)]
    arch_pts = [T + V(math.cos(a) * 0.072, 0, math.sin(a) * 0.072) for a in [PI * k / 10 for k in range(11)]]
    staff.append(K.make_tube("S_arch", [tuple(p) for p in arch_pts], 0.0085, segments=8, mat=brass))
    staff.append(K.make_tube("S_archbase", [tuple(T + V(-0.082, 0, 0)), tuple(T + V(0.082, 0, 0))], 0.0075, segments=8, mat=brass))
    for k in (1, 2, 3):
        a = PI * k / 4
        staff.append(K.make_tube(f"S_archslat{k}", [tuple(T + V(math.cos(a) * 0.022, 0, math.sin(a) * 0.022)), tuple(T + V(math.cos(a) * 0.066, 0, math.sin(a) * 0.066))], 0.0035, segments=5, mat=brass))
    staff.append(tube("S_forkstem", [T, T + V(0, 0, 0.085)], 0.0055, brass, seg=8, n_per=1))
    staff.append(tube("S_forkU", [T + V(-0.013, 0, 0.19), T + V(-0.013, 0, 0.10), T + V(0, 0, 0.083), T + V(0.013, 0, 0.10), T + V(0.013, 0, 0.19)], 0.0045, brass, seg=8, n_per=2))
    P.add("PropR", staff)

    extra = {
        "Hat": ("Head", (0, -0.004, zb), (0, -0.004, zb + 0.14)),
        "Cloak": ("Head", tuple(knot + V(0, 0.03, -0.03)), tuple(knot + V(0, 0.05, -0.27))),
        "PropR": ("HandR", tuple(G), tuple(G + ax * 0.25)),
    }
    return finish("solenne", P, L, extra, ARM_CHAINS + [TORSO_CHAIN])


# ===========================================================================
# 3. FEN, the Breeze Between Leaves (1.52 m) - leaf-woven breeze spirit
# ===========================================================================

def build_fen():
    core = mat("F_Core", "#9bd16b", pack="fen", maps=("albedo",), uv=2.0, roughness=0.75)
    banana = mat("F_Banana", "#9bd16b", pack="fen", maps=("normal",), uv=3, nstr=0.3, roughness=0.7, double_sided=True)
    banana2 = mat("F_BananaPale", "#c9e891", pack="fen", maps=("normal",), uv=3, nstr=0.3, roughness=0.7, double_sided=True)
    banana3 = mat("F_BananaDeep", "#79bd52", pack="fen", maps=("normal",), uv=3, nstr=0.3, roughness=0.7, double_sided=True)
    monstera = mat("F_Monstera", "#2e7d4f", pack="fen", maps=("normal",), uv=2.5, nstr=0.4, roughness=0.65, double_sided=True)
    rib_m = mat("F_Rib", "#8fcf6c", roughness=0.7)
    headm = mat("F_Head", "#b3e07f", roughness=0.7)
    pink = mat("F_Bromeliad", "#f08a9b", roughness=0.6, double_sided=True)
    yellow = mat("F_Sun", "#ffd166", roughness=0.6, double_sided=True)
    seed = mat("F_SeedEye", "#15110f", roughness=0.06, coat_weight=1.0, coat_roughness=0.02)
    glint = mat("F_Glint", "#fff6dc", roughness=0.2, emission_color="#fff6dc", emission_strength=2.5)
    mouth = mat("F_Mouth", "#1f5a37", roughness=0.6)
    ink = mat("F_Ink", "#16261c", roughness=0.9)
    if hasattr(ink, "use_backface_culling_shadow"):
        ink.use_backface_culling_shadow = True  # the hull must not shadow the shape it outlines
    stem = mat("F_Stem", "#2e7d4f", roughness=0.7)

    P = Parts()
    L = {
        "pelvis": (0, 0, 0.45), "spine": (0, 0, 0.65), "chest": (0, 0, 0.85), "neck": (0, 0, 1.05),
        "head": (0, -0.005, 1.10), "head_top": (0, -0.01, 1.36), "jaw": (0, -0.08, 1.17), "jaw_tip": (0, -0.14, 1.155),
        "clavL": (0.08, 0.0, 0.97), "sjL": (0.19, 0.0, 0.965), "elL": (0.29, -0.02, 0.87), "wrL": (0.355, -0.06, 0.80), "tipL": (0.50, -0.14, 0.66),
        "hipL": (0.06, 0.0, 0.45), "knL": (0.06, 0.0, 0.29), "anL": (0.05, 0.0, 0.13), "toeL": (0.05, -0.04, 0.05),
    }

    # --- teardrop body that swirls to a point ---
    prof = [(0.0, 0.004, 0.004, 0.0), (0.05, 0.018, 0.018, 0.0), (0.14, 0.042, 0.040, 0.0), (0.27, 0.078, 0.070, 0.0), (0.41, 0.114, 0.100, 0.0),
            (0.56, 0.148, 0.124, 0.0), (0.70, 0.177, 0.143, 0.0), (0.82, 0.197, 0.153, 0.0), (0.91, 0.205, 0.157, 0.0), (0.99, 0.196, 0.150, 0.0),
            (1.05, 0.168, 0.131, 0.0), (1.09, 0.115, 0.097, 0.0), (1.115, 0.05, 0.05, 0.0)]

    def swirl(z):
        k = max(0.0, 1.0 - z / 0.48) ** 2
        return V(0.075 * k * math.sin(z * 9.0), 0.06 * k, 0)

    body = lathe("F_body", prof, core, seg=26)
    deform(body, lambda p: p + swirl(p.z))
    P.add("Spine", body)
    P.add("Spine", outline_hull(body, 0.007, ink))

    # spiral-woven banana-leaf ribbons
    for k in range(7):
        ph = TAU * k / 7
        pts, wid = [], []
        for i in range(26):
            t = i / 25
            z = 0.02 + t * 1.07
            a = ph + t * TAU * 1.05
            p = on_profile(prof, a, z, 0.006) + swirl(z)
            pts.append(p)
            rx_, _ry, _yo = profile_at(prof, z)
            wid.append(max(0.012, 0.60 * rx_ * math.sin(PI * min(1.0, 0.08 + t * 0.95)) ** 0.5))

        def side_fn(p, tg, u, ph=ph):
            radial = V(p.x, p.y, 0)
            if radial.length < 1e-5:
                radial = V(1, 0, 0)
            return tg.cross(radial.normalized())

        rib, _ = ribbon(f"F_weave{k}", pts, wid, (banana, banana2, banana3)[k % 3], side_fn=side_fn, n_per=1)
        deform(rib, lambda p, k=k: p + V(p.x, p.y, 0).normalized() * 0.0015 * (k % 3) if (p.x * p.x + p.y * p.y) > 1e-8 else p)
        P.add("Spine", rib)

    # --- leaf-bud head with seed-black eyes ---
    hc = V(0, -0.012, 1.215)
    hr = (0.150, 0.135, 0.145)
    head = sphere("F_head", hr, hc, headm, 28, 20)

    def bud(p):
        d = p - hc
        if d.z > 0:
            d.z += 0.05 * (d.z / hr[2]) ** 4
            d.y += 0.012 * (d.z / hr[2]) ** 3
        else:
            d.x *= 1.0 - 0.10 * (-d.z / hr[2])
        return hc + d

    deform(head, bud)
    P.add("Head", head)
    P.add("Head", outline_hull(head, 0.006, ink))
    hb = bvh_of([head])
    for side, sx in (("L", 1.0), ("R", -1.0)):
        surf, nrm = project(hb, (sx * 0.060, -0.5, 1.232), (0, 1, 0), 0.0)
        ec = surf + nrm * 0.004
        R = basis(nrm, (0, 0, 1))
        eye = sphere(f"F_eye{side}", (0.032, 0.044, 0.020), (0, 0, 0), seed, 20, 14)
        xf(eye, M4(ec, R))
        P.add("Eye" + side, eye)
        P.add("Eye" + side, sphere(f"F_glint{side}", 0.0085, ec + nrm * 0.016 + V(-0.010, 0, 0.016), glint, 10, 8))
        P.add("Eye" + side, sphere(f"F_glint2{side}", 0.0042, ec + nrm * 0.016 + V(0.008, 0, -0.014), glint, 8, 6))
        L["eye" + side] = tuple(ec - nrm * 0.006)
        # bromeliad-bract cheeks
        cs, cn = project(hb, (sx * 0.098, -0.5, 1.180), (0, 1, 0), 0.002)
        for j in range(3):
            d = Matrix.Rotation(sx * (0.9 + j * 0.45), 3, cn) @ (V(0, 0, 1) - cn * cn.z).normalized()
            P.add("Head", leaf(f"F_cheek{side}{j}", cs - d * 0.012, d, cn, 0.038, 0.020, pink, rows=5, cols=2, shape="bract", cup=0.05, droop=0.0))
    m0, mn = project(hb, (0.0, -0.5, 1.158), (0, 1, 0), 0.002)
    mouth_pts = [project(hb, (x, -0.5, 1.158 + 0.25 * x * x / 0.03), (0, 1, 0), 0.003)[0] for x in (-0.026, -0.014, 0.0, 0.014, 0.026)]
    P.add("Jaw", K.make_tube("F_mouth", [tuple(p) for p in mouth_pts], 0.0045, segments=6, mat=mouth))
    P.add("Jaw", leaf("F_lipleaf", m0 + V(0, -0.002, -0.004), (0, -0.2, -1), (0, -1, 0.2), 0.016, 0.022, monstera, rows=4, cols=2, shape="ellipse", cup=0.05, droop=0.0))

    # --- pink bromeliad crown (Hat) ---
    crown = []
    ctop = hc + V(0, 0.004, hr[2] + 0.025)
    for k in range(9):
        a = TAU * k / 9 + 0.2
        out = V(math.cos(a), math.sin(a), 0)
        axis = (out * 0.55 + V(0, 0, 0.9)).normalized()
        nrm = out.cross(axis).cross(axis) * -1
        crown += leaf(f"F_bract{k}", ctop + out * 0.022 - V(0, 0, 0.02), axis, nrm, 0.17 + 0.02 * math.sin(k * 1.9), 0.055, pink, rows=9, cols=2, shape="blade", cup=0.25, droop=0.18)
    for k in range(5):
        a = TAU * k / 5
        out = V(math.cos(a), math.sin(a), 0)
        axis = (out * 0.25 + V(0, 0, 1.0)).normalized()
        nrm = out.cross(axis).cross(axis) * -1
        crown += leaf(f"F_sun{k}", ctop + out * 0.008 - V(0, 0, 0.01), axis, nrm, 0.11, 0.035, yellow, rows=6, cols=2, shape="blade", cup=0.2, droop=0.08)
    P.add("Hat", crown)

    # --- stem arms with oversized monstera hands ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sj = V(L["sjL"]) if sx > 0 else mirror(L["sjL"])
        el = V(L["elL"]) if sx > 0 else mirror(L["elL"])
        wr = V(L["wrL"]) if sx > 0 else mirror(L["wrL"])
        P.add("Shoulder" + side, sphere(f"F_shoulder{side}", 0.035, sj - V(sx * 0.02, 0, 0), stem, 10, 8))
        P.add("Arm" + side, tube(f"F_upper{side}", [sj - V(sx * 0.02, 0, 0), lerp(sj, el, 0.5) + V(0, 0, 0.012), el], [0.024, 0.021, 0.019], stem, seg=10))
        P.add("Forearm" + side, tube(f"F_fore{side}", [el, lerp(el, wr, 0.5), wr], [0.019, 0.017, 0.015], stem, seg=10))
        axis = V(sx * 0.75, -0.42, -0.50)
        nrm = V(sx * 0.25, -0.95, 0.35)
        P.add("Hand" + side, leaf(f"F_hand{side}", wr, axis, nrm, 0.34, 0.30, monstera, rows=18, cols=6, shape="monstera", cup=0.10, droop=0.10,
                                  slits=5, rib_mat=rib_m, rib_r=0.006, twist=sx * 0.25))
        P.add("Hand" + side, sphere(f"F_wristknot{side}", 0.02, wr, stem, 10, 8))

    # --- monstera-leaf cape on the back (Cloak) ---
    cape = []
    for k, (dx, ln, wd, tw) in enumerate(((0.0, 0.70, 0.46, 0.0), (0.16, 0.58, 0.40, 0.3), (-0.16, 0.58, 0.40, -0.3))):
        base = V(dx * 0.6, 0.11, 1.03)
        axis = V(dx * 1.6, 0.42, -1.0)
        nrm = V(dx * 0.8, 1.0, 0.35)
        cape += leaf(f"F_cape{k}", base, axis, nrm, ln, wd, monstera, rows=18, cols=6, shape="monstera", cup=-0.10, droop=-0.05,
                     slits=5, rib_mat=rib_m, rib_r=0.008, twist=tw)
    P.add("Cloak", cape)

    # --- orbiting breeze-tail of single leaves (Tail1 / Tail2) ---
    mats = [banana, monstera, yellow, banana2, pink, monstera, banana3, yellow, banana2]

    def tail_path(t):
        ang = 0.9 + TAU * 0.95 * t
        r = 0.21 - 0.06 * t
        return V(r * math.cos(ang), 0.16 + 0.52 * t, 0.52 + 0.85 * r * math.sin(ang) + 0.10 * t)

    for i in range(9):
        t = i / 8
        c = tail_path(t)
        tg = (tail_path(t + 0.02) - tail_path(t - 0.02)).normalized()
        radial = (c - V(0, c.y, 0.52 + 0.10 * t))
        radial = (radial - tg * radial.dot(tg)).normalized()
        size = 0.20 - 0.08 * t
        P.add("Tail1" if i < 5 else "Tail2", leaf(f"F_tail{i}", c - tg * size * 0.5, tg, radial, size, size * 0.52, mats[i], rows=7, cols=2,
                                               shape="ellipse", cup=0.18, droop=0.12, twist=0.5, rib_mat=rib_m if mats[i] in (monstera, banana3) else None, rib_r=0.0035))

    extra = {
        "Hat": ("Head", tuple(ctop - V(0, 0, 0.02)), tuple(ctop + V(0, 0, 0.16))),
        "Cloak": ("Chest", (0, 0.11, 1.03), (0, 0.30, 0.50)),
        "Tail1": ("Pelvis", (0, 0.12, 0.52), (0, 0.42, 0.56)),
        "Tail2": ("Tail1", (0, 0.42, 0.56), (0, 0.70, 0.62)),
    }
    return finish("fen", P, L, extra, ARM_CHAINS + [["Pelvis", "Spine", "Chest"]])


# ===========================================================================
# 4. UNCLE KEOLA, Kiaʻi Loko (1.76 m) - fishpond caretaker
# ===========================================================================

def build_keola():
    skin = mat("U_Skin", "#7d4f33", roughness=0.5, coat_weight=0.1, coat_roughness=0.4)
    skin_dark = mat("U_SkinCrease", "#55331f", roughness=0.6)
    lip = mat("U_Lip", "#6a3b2a", roughness=0.45)
    eye_w = mat("U_EyeWhite", "#efe8dc", roughness=0.15, coat_weight=1.0)
    iris = mat("U_Iris", "#2c1a0e", roughness=0.2, coat_weight=1.0)
    pupil = mat("U_Pupil", "#090604", roughness=0.1)
    grey = mat("U_Grey", "#8c867e", pack="solenne", maps=("normal",), uv=7, nstr=0.8, roughness=0.7)
    stache = mat("U_Moustache", "#77726b", pack="solenne", maps=("normal",), uv=9, nstr=1.0, roughness=0.75)
    aloha = mat("U_Aloha", "#3d6b5e", pack="keola", maps=("albedo", "normal"), uv=2.2, nstr=0.7, roughness=0.78)
    ulu = mat("U_UluPrint", "#a7c8b6", pack="keola", maps=("normal",), uv=4, nstr=0.4, roughness=0.8, double_sided=True)
    sunshirt = mat("U_SunShirt", "#e8fbf7", pack="keola", maps=("normal",), uv=4, nstr=0.6, roughness=0.75)
    olive = mat("U_Shorts", "#6b5b3e", pack="keola", maps=("normal",), uv=3.5, nstr=0.8, roughness=0.82)
    webbing = mat("U_Belt", "#33352d", roughness=0.7)
    neo = mat("U_Neoprene", "#1f2a2b", pack="keola", maps=("normal",), uv=5, nstr=0.6, roughness=0.42, coat_weight=0.3)
    teal = mat("U_Teal", "#14b8a6", roughness=0.5)
    sole_m = mat("U_Sole", "#121616", roughness=0.85)
    lauhala = mat("U_Lauhala", "#c9a66b", pack="solenne", maps=("normal", "roughness"), uv=7, nstr=1.2)
    lauhala_dk = mat("U_LauhalaBand", "#8a6a3e", pack="solenne", maps=("normal",), uv=9, nstr=1.0, roughness=0.75)
    coconut = mat("U_Coconut", "#5a3b23", roughness=0.5)
    board_m = mat("U_Board", "#8b6a45", pack="_shared_wood", maps=("albedo",), uv=3)
    paper = mat("U_Paper", "#f4f1e8", roughness=0.9)
    ink_m = mat("U_Ink", "#2b3a55", roughness=0.8)
    steel = mat("U_Steel", "#9aa3a8", metallic=0.9, roughness=0.3)
    plastic = mat("U_Ziplock", "#dff3f5", roughness=0.08, alpha=0.28, coat_weight=1.0)
    zip_m = mat("U_Zip", "#2f7fd0", roughness=0.4)
    pencil_m = mat("U_Pencil", "#f2c230", roughness=0.5)
    glove = mat("U_Gloves", "#a99068", roughness=0.85)

    P = Parts()
    s = 1.02
    hc = V(0, -0.034, 1.586)
    L = {
        "pelvis": (0, 0, 0.92), "spine": (0, 0, 1.05), "chest": (0, -0.005, 1.22), "neck": (0, -0.012, 1.41),
        "head": (0, -0.028, 1.48), "head_top": (0, -0.034, 1.716), "jaw": (0, -0.055, 1.548), "jaw_tip": (0, -0.135, 1.525),
        "clavL": (0.06, 0.0, 1.38), "sjL": (0.215, 0.005, 1.36), "elL": (0.268, 0.045, 1.10), "wrL": (0.255, -0.19, 0.995), "tipL": (0.245, -0.33, 0.95),
        "elR": (-0.27, 0.03, 1.10), "wrR": (-0.30, -0.01, 0.86), "tipR": (-0.31, -0.03, 0.70),
        "hipL": (0.10, 0.0, 0.90), "knL": (0.108, -0.012, 0.50), "anL": (0.11, 0.015, 0.085), "toeL": (0.112, -0.16, 0.02),
    }
    for sx, side in ((1, "L"), (-1, "R")):
        L["eye" + side] = tuple(head_eye_pos(hc, s, sx))

    # --- weathered warm face ---
    H = K.sculpt_stylized_head("U", center=tuple(hc), scale=s, skin_mat=skin, eye_white_mat=eye_w, iris_mat=iris,
                               pupil_mat=pupil, brow_mat=grey, lip_mat=lip, jaw_taper=0.84, cheek_fullness=1.25, ear_scale=1.08)
    # broader brows
    deform(H["brows"], lambda p: hc + (p - hc) * V(1.04, 1.0, 1.0) + V(0, 0, -0.002))
    P.add("Head", H["head"], H["brows"], H.get("ears"))
    P.add("Jaw", H["jaw"])
    P.add("EyeL", H["eye_l"])
    P.add("EyeR", H["eye_r"])
    P.add("Head", eyelids("U", hc, s, skin, upper_cut=-0.0045, lower_cut=-0.0098, slope=-0.12))
    hb = bvh_of([H["head"]])
    # grey moustache
    for sx in (1, -1):
        mo = []
        for x in (0.002, 0.012, 0.022, 0.031, 0.037):
            zz = hc.z - 0.041 * s - 0.004 * (x / 0.037) - 0.011 * (x / 0.037) ** 2.2
            mo.append(project(hb, (sx * x * s, -0.5, zz), (0, 1, 0), 0.0045)[0])
        P.add("Head", K.make_tube(f"U_moustache{sx}", [tuple(p) for p in mo], [0.0072, 0.0078, 0.0070, 0.0052, 0.0028], segments=8, mat=stache))
    for sx in (1, -1):
        pts = [project(hb, (sx * x * s, -0.5, hc.z + z * s), (0, 1, 0), 0.0006)[0] for x, z in ((0.026, -0.028), (0.036, -0.046), (0.040, -0.064))]
        P.add("Head", K.make_tube(f"U_smileline{sx}", [tuple(p) for p in pts], [0.0010, 0.0019, 0.0009], segments=5, mat=skin_dark))
    for k in range(2):
        fl = [project(hb, (x * s, -0.5, hc.z + (0.060 + 0.012 * k) * s), (0, 1, 0), 0.0008)[0] for x in (-0.035, -0.012, 0.012, 0.035)]
        P.add("Head", K.make_tube(f"U_forehead{k}", [tuple(p) for p in fl], 0.0013, segments=4, mat=skin_dark))

    # short grey hair at back and sides under the hat
    P.add("Head", head_cap("U_hair", hc + V(0, 0.003, 0.002), (0.111 * s, 0.123 * s, 0.131 * s), grey,
                           [(-0.078, 1.15), (-0.04, 1.30), (0.0, 1.50), (0.04, 1.9), (0.07, 2.5), (0.085, PI)], nseg=26))
    for sx in (1, -1):
        P.add("Head", sphere(f"U_sideburn{sx}", (0.006, 0.011, 0.022), hc + V(sx * 0.104 * s, -0.022, -0.014), grey, 8, 6))

    # --- woven lauhala hat ---
    zb = 1.655
    hat = []
    crown = lathe("U_crown", [(zb - 0.012, 0.114, 0.126, -0.034), (zb + 0.04, 0.112, 0.124, -0.034), (zb + 0.085, 0.104, 0.116, -0.034),
                              (zb + 0.115, 0.088, 0.099, -0.034), (zb + 0.13, 0.055, 0.064, -0.034), (zb + 0.134, 0.0, 0.0, -0.034)], lauhala, seg=28)

    def pinch(p):
        d = p - V(0, -0.034, 0)
        if p.z > zb + 0.09:
            k = (p.z - zb - 0.09) / 0.045
            p.z -= 0.022 * k * math.exp(-(d.x / 0.035) ** 2)
            if d.y < 0:
                p.x *= 1.0 - 0.18 * k * math.exp(-(d.y / 0.06) ** 2)
        return p

    deform(crown, pinch)
    hat.append(crown)
    hat.append(lathe("U_hatband", [(zb - 0.006, 0.117, 0.129, -0.034), (zb + 0.002, 0.119, 0.131, -0.034), (zb + 0.03, 0.117, 0.129, -0.034), (zb + 0.036, 0.114, 0.126, -0.034)], lauhala_dk, seg=28, cap_bottom=False, cap_top=False))
    brim = lathe("U_brim", [(zb - 0.004, 0.113, 0.125, -0.034), (zb - 0.012, 0.215, 0.228, -0.034), (zb - 0.02, 0.232, 0.245, -0.034),
                            (zb - 0.028, 0.226, 0.239, -0.034), (zb - 0.018, 0.21, 0.223, -0.034), (zb - 0.010, 0.113, 0.125, -0.034)], lauhala, seg=36, cap_bottom=False, cap_top=False)

    def snap(p):
        d = p - V(0, -0.034, 0)
        r = math.hypot(d.x, d.y)
        a = math.atan2(d.y, d.x)
        k = max(0.0, (r - 0.12) / 0.12)
        p.z += k * (0.018 * math.cos(2 * a) - 0.010)
        return p

    deform(brim, snap)
    hat.append(brim)
    P.add("Hat", hat)

    # --- neck & aloha shirt over a long-sleeve sun shirt ---
    P.add("Neck", tube("U_neck", [(0, 0.004, 1.39), (0, -0.012, 1.46), (0, -0.03, 1.53)], [0.060, 0.056, 0.052], skin, seg=16))
    shirt_prof = [(0.835, 0.192, 0.148, -0.006), (0.86, 0.194, 0.150, -0.008), (0.95, 0.196, 0.152, -0.014), (1.05, 0.199, 0.153, -0.018),
                  (1.15, 0.202, 0.146, -0.016), (1.25, 0.209, 0.138, -0.010), (1.33, 0.214, 0.130, 0.0), (1.38, 0.186, 0.114, 0.006),
                  (1.415, 0.112, 0.088, 0.0), (1.44, 0.072, 0.068, -0.008)]
    P.add("Chest", lathe("U_aloha", shirt_prof, aloha, seg=30, cap_bottom=True))
    hem = [on_profile(shirt_prof, TAU * k / 28, 0.838, 0.004) for k in range(29)]
    P.add("Spine", K.make_tube("U_hemroll", [tuple(p) for p in hem], 0.0055, segments=5, mat=aloha))
    # camp collar opening showing the sun shirt's crew neck
    P.add("Neck", torus("U_crew", 0.064, 0.008, V(0, -0.012, 1.425), (0, -0.15, 1), sunshirt, 26, 8))
    for sx in (1, -1):
        lap, _ = ribbon(f"U_lapel{sx}", [(sx * 0.036, -0.074, 1.445), (sx * 0.062, -0.110, 1.405), (sx * 0.088, -0.130, 1.37), (sx * 0.094, -0.134, 1.352)],
                        [0.030, 0.046, 0.034, 0.006], aloha, side_fn=lambda p, t, u: t.cross(V(0, -1, 0.35)), thickness=0.004)
        P.add("Chest", lap)
        col, _ = ribbon(f"U_collarband{sx}", [(sx * 0.03, -0.07, 1.445), (sx * 0.075, -0.035, 1.455), (sx * 0.075, 0.03, 1.45), (sx * 0.0, 0.07, 1.445)],
                        [0.03, 0.032, 0.032, 0.03], aloha, side_fn=lambda p, t, u: V(0, 0, 1), thickness=0.004)
        P.add("Neck", col)
    # V of the sun shirt inside the opening
    vneck, _ = shell("U_sunshirt_v", [(1.30, 0.17, 0.130, -0.003, 0.20), (1.38, 0.15, 0.104, 0.004, 0.32), (1.43, 0.07, 0.066, -0.01, 0.42)], sunshirt, center=-PI / 2, nseg=6)
    P.add("Chest", vneck)
    # placket + coconut buttons
    plk = [on_profile(shirt_prof, -PI / 2, z, 0.003) for z in (1.29, 1.2, 1.1, 1.0, 0.9, 0.845)]
    P.add("Chest", K.make_tube("U_placket", [tuple(p) for p in plk], 0.006, segments=6, mat=aloha))
    for k, z in enumerate((1.25, 1.15, 1.05, 0.95)):
        p = on_profile(shirt_prof, -PI / 2, z, 0.008)
        P.add("Chest", cyl(f"U_button{k}", 0.0085, 0.0085, 0.004, p, (0, -1, 0), coconut, 12))
    # breast pocket
    bp_rings = []
    for zz in (1.20, 1.29):
        rx_, ry_, yo_ = profile_at(shirt_prof, zz)
        bp_rings.append((zz, rx_ + 0.006, ry_ + 0.006, yo_, 0.30))
    bpocket, _ = shell("U_pocket", bp_rings, aloha, center=-PI / 2 + 0.62, nseg=6, thickness=0.004)
    P.add("Chest", bpocket)
    # faded ʻulu (breadfruit) leaf print, conformed to the shirt
    for k, (a, z, sz, rot) in enumerate(((-PI / 2 - 0.55, 1.10, 0.10, 0.4), (-PI / 2 + 0.30, 0.95, 0.09, -0.6), (-PI / 2 - 1.15, 1.26, 0.085, 1.2),
                                         (-PI / 2 + 1.05, 1.18, 0.095, -0.2), (PI / 2 - 0.5, 1.15, 0.11, 0.8), (PI / 2 + 0.55, 0.98, 0.10, -0.5),
                                         (PI / 2 + 0.1, 1.30, 0.09, 2.2), (-PI / 2 - 0.2, 1.32, 0.07, 2.6), (PI, 1.06, 0.09, 0.2), (0.0, 0.96, 0.09, -1.0))):
        c = on_profile(shirt_prof, a, z, 0.003)
        nrm = V(math.cos(a), math.sin(a), 0)
        up = Matrix.Rotation(rot, 3, nrm) @ V(0, 0, 1)
        P.add("Chest", leaf(f"U_ulu{k}", c - up * sz * 0.5, up, nrm, sz, sz * 0.85, ulu, rows=13, cols=4, shape="monstera", cup=0.0, droop=0.0, slits=3, slit_depth=0.72))

    # --- arms: wide short aloha sleeves, pushed-up sun-shirt sleeves, strong forearms ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sj = V(L["sjL"]) if sx > 0 else mirror(L["sjL"])
        el = V(L["el" + side])
        wr = V(L["wr" + side])
        ud = (el - sj).normalized()
        fd = (wr - el).normalized()
        # shoulder yoke: carries the shirt's slope from the collar out over the joint so the
        # sleeve head grows out of it instead of standing on the torso as a flat-topped box
        P.add("Shoulder" + side, tube(f"U_yoke{side}", [V(sx * 0.105, 0.0, 1.385), V(sx * 0.160, 0.003, 1.362), sj + V(sx * 0.010, 0.0, -0.025)],
                                      [0.022, 0.036, 0.050], aloha, seg=16, n_per=2))
        sl_end = sj + ud * 0.17
        # domed sleeve head (circular profile) falling into a wide draped short sleeve
        P.add("Arm" + side, tube(f"U_sleeve{side}", [sj - ud * 0.004, sj + ud * 0.010, sj + ud * 0.034, sj + ud * 0.075, sl_end, sl_end + ud * 0.004],
                                 [0.014, 0.040, 0.064, 0.074, 0.077, 0.058], aloha, seg=18, n_per=2))
        P.add("Arm" + side, tube(f"U_upperarm{side}", [sl_end - ud * 0.02, el], [0.054, 0.05], sunshirt, seg=14, n_per=1))
        P.add("Forearm" + side, torus(f"U_bunch{side}", 0.049, 0.014, el + fd * 0.03, fd, sunshirt, 18, 6))
        P.add("Forearm" + side, torus(f"U_bunch2{side}", 0.047, 0.012, el + fd * 0.06, fd, sunshirt, 18, 6))
        P.add("Forearm" + side, tube(f"U_fore{side}", [el + fd * 0.06, lerp(el, wr, 0.45), wr + fd * 0.01], [0.046, 0.045, 0.034], skin, seg=14))
    P.add("HandR", hand("U_handR", V(L["wrR"]), V(L["wrR"]) - V(L["elR"]), -1.0, skin, s=1.08, curl=0.55, thick=1.18))
    # left hand holds the clipboard in its ziplock bag, tilted up to read
    wrL, elL = V(L["wrL"]), V(L["elL"])
    fdl = (wrL - elL).normalized()
    P.add("HandL", hand("U_handL", wrL, fdl, 1.0, skin, s=1.08, curl=0.85, thick=1.18))
    nrm = V(0.05, 0.55, 1.0).normalized()
    fwd = (fdl - nrm * fdl.dot(nrm)).normalized()
    Rb = basis(nrm, fwd)
    across = fwd.cross(nrm).normalized()
    bc = wrL + fdl * 0.05 + across * 0.115 + nrm * 0.022 + fwd * 0.03
    clip = []
    clip.append(box("U_board", (0.225, 0.315, 0.006), M4(bc, Rb), board_m, bevel=0.002))
    clip.append(box("U_paper", (0.205, 0.27, 0.002), M4(bc + nrm * 0.0045 - fwd * 0.012, Rb), paper))
    for k in range(7):
        clip.append(box(f"U_line{k}", (0.15 - 0.03 * (k % 3), 0.0025, 0.0012), M4(bc + nrm * 0.0062 - fwd * (0.09 - k * 0.03) - across * 0.01, Rb), ink_m))
    clip.append(box("U_clip", (0.09, 0.032, 0.014), M4(bc + fwd * 0.14 + nrm * 0.008, Rb), steel, bevel=0.003))
    clip.append(box("U_bag", (0.25, 0.35, 0.020), M4(bc + fwd * 0.012, Rb), plastic, bevel=0.004))
    clip.append(box("U_zip", (0.25, 0.008, 0.012), M4(bc + fwd * 0.186, Rb), zip_m, bevel=0.002))
    pen0 = bc + fwd * 0.15 - across * 0.08 + nrm * 0.012
    pen_top = bc - fwd * 0.10 - across * 0.135 - nrm * 0.07
    clip.append(tube("U_string", [pen0, pen0 - across * 0.05 - nrm * 0.03, lerp(pen0, pen_top, 0.6) - nrm * 0.04, pen_top], 0.0016, steel, seg=4))
    pd = V(0.1, 0.1, -1).normalized()
    clip.append(tube("U_pencil", [pen_top, pen_top + pd * 0.13, pen_top + pd * 0.15], [0.0042, 0.0042, 0.0007], pencil_m, seg=6, n_per=1))
    clip.append(tube("U_eraser", [pen_top - pd * 0.012, pen_top], 0.0045, mat("U_Eraser", "#e08a8a", roughness=0.7), seg=6, n_per=1))
    P.add("PropL", clip)

    # --- olive work shorts, belt, clipped gloves, bandana ---
    sh_prof = [(0.76, 0.115, 0.085, 0.0), (0.80, 0.178, 0.128, 0.0), (0.88, 0.180, 0.130, -0.004), (0.95, 0.176, 0.130, -0.008), (0.99, 0.172, 0.128, -0.008)]
    P.add("Pelvis", lathe("U_shortships", sh_prof, olive, seg=26))
    P.add("Pelvis", lathe("U_belt", [(0.925, 0.183, 0.135, -0.008), (0.93, 0.186, 0.138, -0.008), (0.955, 0.186, 0.138, -0.008), (0.96, 0.183, 0.135, -0.008)], webbing, seg=30, cap_bottom=False, cap_top=False))
    carab = V(-0.168, -0.075, 0.915)
    P.add("Pelvis", torus("U_carabiner", 0.018, 0.0032, carab, (0.9, -0.45, 0), steel, 18, 6))
    for k, dy in enumerate((-0.012, 0.014)):
        gw = carab + V(-0.012, dy, -0.03)
        P.add("Pelvis", sphere(f"U_gloveP{k}", (0.016, 0.042, 0.05), gw + V(-0.004, 0, -0.04), glove, 10, 8))
        for f in range(4):
            fy = -0.024 + f * 0.016
            P.add("Pelvis", tube(f"U_glovef{k}{f}", [gw + V(-0.006, fy, -0.085), gw + V(-0.004 - 0.004 * f, fy * 1.1, -0.13 + 0.006 * abs(f - 1.5))], [0.0085, 0.0075], glove, seg=6, n_per=1))
    band = V(0.07, 0.16, 0.86)
    P.add("Pelvis", tube("U_bandana", [band + V(0, -0.005, 0.03), band + V(0.01, 0.012, -0.02), band + V(-0.004, 0.018, -0.09), band + V(0.006, 0.012, -0.13)], [0.016, 0.02, 0.014, 0.004], teal, seg=8))
    for side, sx in (("L", 1.0), ("R", -1.0)):
        hip = V(sx * 0.10, 0.0, 0.84)
        kn = V(sx * 0.108, -0.012, 0.50)
        an = V(sx * 0.11, 0.015, 0.085)
        P.add("Thigh" + side, tube(f"U_shortleg{side}", [hip, lerp(hip, kn, 0.55), lerp(hip, kn, 0.72)], [0.098, 0.097, 0.094], olive, seg=18, n_per=1))
        hemc = lerp(hip, kn, 0.72)
        P.add("Thigh" + side, torus(f"U_shorthem{side}", 0.094, 0.006, hemc, (0, 0, 1), olive, 26, 6))
        pk_rings = [(0.80, 0.106, 0.104, 0.0, 0.42), (0.67, 0.106, 0.104, 0.0, 0.42)]
        pk, _ = shell(f"U_cargo{side}", pk_rings, olive, center=0.0 if sx > 0 else PI, nseg=6, thickness=0.005,
                      zfn=lambda p, a, ri, sx=sx: p + V(sx * 0.108, -0.006, 0))
        P.add("Thigh" + side, pk)
        # the calf runs on down inside the tabi's neoprene ankle collar (no floating gap)
        P.add("Shin" + side, tube(f"U_leg{side}", [lerp(hip, kn, 0.66), kn + V(0, -0.006, 0), V(sx * 0.11, 0.006, 0.34), V(sx * 0.11, 0.015, 0.16), an + V(0, 0, 0.02), an + V(0, 0.004, -0.028)],
                                  [0.064, 0.058, 0.065, 0.044, 0.038, 0.033], skin, seg=16))
        P.add("Shin" + side, sphere(f"U_kneecap{side}", (0.034, 0.024, 0.036), kn + V(0, -0.03, 0.01), skin, 12, 8))
        # tabi reef shoes: split toe, neoprene, teal heel tab
        sh = shoe(f"U_tabi{side}", an, sx, neo, sole_m, length=0.265, width=0.098, height=0.088, toe_drop=0.5)

        def split(p, sx=sx, an=an):
            if p.y < an.y - 0.14:
                d = p.x - (an.x - sx * 0.012)
                p.y += 0.022 * math.exp(-(d / 0.010) ** 2)
            return p

        deform(sh[0], split)
        P.add("Foot" + side, sh)
        P.add("Foot" + side, sphere(f"U_bigtoe{side}", (0.019, 0.035, 0.026), V(an.x - sx * 0.026, an.y - 0.205, 0.034), neo, 12, 8))
        # neoprene ankle collar rising out of the shoe and hugging the leg, rolled at the top
        P.add("Foot" + side, tube(f"U_cuff{side}", [an + V(0, 0.003, -0.030), an + V(0, 0.001, 0.010), an + V(0, 0.0, 0.044)],
                                  [0.050, 0.050, 0.049], neo, seg=16, n_per=2))
        P.add("Foot" + side, torus(f"U_collar{side}", 0.049, 0.0065, an + V(0, 0.0, 0.044), (0, 0, 1), neo, 22, 6))
        P.add("Foot" + side, box(f"U_heeltab{side}", (0.022, 0.006, 0.04), M4(an + V(0, 0.051, 0.022)), teal, bevel=0.002))
        stripe, _ = shell(f"U_stripe{side}", [(0.030, 0.052, 0.12, 0.0, 0.5), (0.038, 0.053, 0.121, 0.0, 0.5)], teal, center=0.0 if sx > 0 else PI, nseg=8,
                          zfn=lambda p, a, ri, an=an: p + V(an.x, an.y - 0.08, 0))
        P.add("Foot" + side, stripe)

    extra = {
        "Hat": ("Head", (0, -0.034, zb), (0, -0.034, zb + 0.14)),
        "PropL": ("HandL", tuple(wrL + fdl * 0.06), tuple(wrL + fdl * 0.06 + fwd * 0.2)),
    }
    return finish("keola", P, L, extra, ARM_CHAINS + [TORSO_CHAIN], ankles=True)


# ===========================================================================
# 5. NORI, Current-Reader of the Reef (1.58 m) - tidefolk cartographer
# ===========================================================================

def build_nori():
    skin = mat("N_Skin", "#5fd3c6", pack="nori", maps=("normal",), uv=6, nstr=0.25, roughness=0.32, coat_weight=0.7, coat_roughness=0.08, metallic=0.05)
    belly = mat("N_SkinLight", "#a5ece2", roughness=0.35, coat_weight=0.6)
    eye_w = mat("N_EyeWhite", "#e0f7fb", roughness=0.08, coat_weight=1.0)
    iris = mat("N_Iris", "#0e5a6b", roughness=0.1, coat_weight=1.0, emission_color="#22b8cf", emission_strength=0.25)
    pupil = mat("N_Pupil", "#03161b", roughness=0.05, coat_weight=1.0)
    brow = mat("N_Brow", "#0e5a6b", roughness=0.4)
    lip = mat("N_Lip", "#e79c8a", roughness=0.35)
    kelp = mat("N_Kelp", "#0e5a6b", roughness=0.5, coat_weight=0.15, double_sided=True)
    kelp2 = mat("N_KelpLight", "#2f8f80", roughness=0.5, coat_weight=0.15, double_sided=True)
    fin = mat("N_Fin", "#22b8cf", roughness=0.15, alpha=0.62, double_sided=True, emission_color="#22b8cf", emission_strength=0.3)
    glow = mat("N_Biolum", "#bff8ff", roughness=0.2, emission_color="#7ff3ff", emission_strength=4.0)
    net = mat("N_Net", "#5fd3c6", pack="nori", maps=("albedo", "normal", "roughness"), uv=3, nstr=1.0)
    net_dk = mat("N_NetDark", "#0e5a6b", pack="nori", maps=("normal",), uv=4, nstr=1.0, roughness=0.7)
    nacre = mat("N_Nacre", "#f6c6a8", roughness=0.14, metallic=0.35, coat_weight=1.0, coat_roughness=0.02)
    rope = mat("N_Rope", "#d9a582", roughness=0.9)
    silk = mat("N_SeaSilk", "#bff3f0", roughness=0.1, alpha=0.42, double_sided=True, emission_color="#5fd3c6", emission_strength=0.18, coat_weight=0.6)
    glass = mat("N_SeaGlass", "#7fd6c9", roughness=0.06, alpha=0.45, coat_weight=1.0)
    cork = mat("N_Cork", "#a57b52", roughness=0.8)
    plankton = mat("N_Plankton", "#7ff3ff", roughness=0.3, emission_color="#22d3ee", emission_strength=7.0)
    strings = [mat("N_StrCoral", "#f08a7a", roughness=0.8), mat("N_StrSun", "#ffd166", roughness=0.8), mat("N_StrTeal", "#22b8cf", roughness=0.8),
               mat("N_StrFoam", "#e0f7fb", roughness=0.8), mat("N_StrShell", "#f6c6a8", roughness=0.8)]

    P = Parts()
    s = 1.12
    hc = V(0, -0.045, 1.295)
    L = {
        "pelvis": (0, 0.01, 0.74), "spine": (0, 0.0, 0.84), "chest": (0, -0.01, 0.97), "neck": (0, -0.025, 1.11),
        "head": (0, -0.035, 1.17), "head_top": (0, -0.045, 1.44), "jaw": (0, -0.07, 1.248), "jaw_tip": (0, -0.155, 1.225),
        "clavL": (0.05, -0.005, 1.09), "sjL": (0.148, 0.0, 1.075), "elL": (0.195, 0.025, 0.875), "wrL": (0.15, -0.14, 0.80), "tipL": (0.12, -0.24, 0.78),
        "elR": (-0.20, 0.02, 0.875), "wrR": (-0.235, -0.09, 0.715), "tipR": (-0.245, -0.14, 0.61),
        "hipL": (0.075, 0.01, 0.74), "knL": (0.085, -0.075, 0.43), "anL": (0.09, 0.0, 0.15), "toeL": (0.095, -0.07, 0.0),
    }
    for sx, side in ((1, "L"), (-1, "R")):
        e = head_eye_pos(hc, s, sx) + V(sx * 0.008, 0.003, 0.002)
        L["eye" + side] = tuple(e)

    # --- head: big soft face, wide-set eyes, no human ears ---
    H = K.sculpt_stylized_head("N", center=tuple(hc), scale=s, skin_mat=skin, eye_white_mat=eye_w, iris_mat=iris,
                               pupil_mat=pupil, brow_mat=brow, lip_mat=lip, jaw_taper=0.66, cheek_fullness=1.3, ear_scale=0.0)
    for key, sx in (("eye_l", 1.0), ("eye_r", -1.0)):
        eo = H[key]
        c0 = head_eye_pos(hc, s, sx)
        c1 = V(L["eyeL" if sx > 0 else "eyeR"])
        deform(eo, lambda p, c0=c0, c1=c1: c1 + (p - c0) * 1.2)
    jc = sum((v.co for v in bake(H["jaw"]).data.vertices), V(0, 0, 0)) / len(H["jaw"].data.vertices)
    deform(H["jaw"], lambda p: jc + V((p - jc).x * 0.72, (p - jc).y * 0.85, (p - jc).z * 0.75) + V(0, 0.002, 0))
    deform(H["brows"], lambda p: p + V(0, -0.004, 0.012) + V(p.x * 0.18, 0, 0))
    P.add("Head", H["head"], H["brows"])
    P.add("Jaw", H["jaw"])
    P.add("EyeL", H["eye_l"])
    P.add("EyeR", H["eye_r"])
    hb = bvh_of([H["head"]])
    # bioluminescent cheek freckles
    for sx in (1, -1):
        for k, (fx, fz) in enumerate(((0.050, -0.030), (0.062, -0.024), (0.058, -0.040), (0.072, -0.034), (0.046, -0.044), (0.068, -0.048))):
            p, _n = project(hb, (sx * fx * s, -0.6, hc.z + fz * s), (0, 1, 0), 0.0005)
            P.add("Head", sphere(f"N_freckle{sx}{k}", 0.0034, p, glow, 8, 6))
    # scalp cap from which the kelp floats
    sc = hc + V(0, 0.006, 0.004)
    P.add("Head", head_cap("N_scalp", sc, (0.112 * s, 0.124 * s, 0.132 * s), kelp,
                           [(-0.07, 1.20), (-0.035, 1.28), (0.0, 1.45), (0.035, 1.75), (0.06, 2.2), (0.08, 2.7), (0.092, PI)], nseg=26))
    # kelp blades float upward and drift back, with S-waves, twist and ruffled edges
    blades = [(-1.25, -0.25, 0.17), (-0.85, -0.05, 0.22), (-0.45, 0.05, 0.27), (-0.12, 0.0, 0.30), (0.18, 0.08, 0.28), (0.5, 0.0, 0.26),
              (0.9, -0.08, 0.22), (1.3, -0.25, 0.17), (-0.7, 0.45, 0.20), (0.0, 0.55, 0.24), (0.7, 0.45, 0.21)]
    for k, (a, pitch, ln) in enumerate(blades):
        el = 0.95 - 0.35 * abs(a) / 1.6 - 0.25 * max(0.0, pitch)
        rdir = V(math.sin(a) * math.cos(el), 0.30 * pitch + 0.15, math.sin(el) + 0.25).normalized()
        root = sc + V(rdir.x * 0.104 * s, rdir.y * 0.115 * s, rdir.z * 0.118 * s)
        out = V(math.sin(a) * 0.55, 0.32 + pitch * 0.6, 1.0).normalized()
        side = V(math.cos(a), -math.sin(a) * 0.25, 0.0).normalized()
        pts = []
        for i in range(7):
            t = i / 6
            wv = math.sin(t * PI * 1.7 + k * 1.3) * 0.045 * t
            pts.append(root + out * ln * t + side * wv + V(0, 0.07 * t * t, -0.025 * t * t))
        wid = [0.026, 0.040, 0.046, 0.044, 0.038, 0.026, 0.006]
        rib, _ = ribbon(f"N_kelp{k}", pts, [w * (0.85 + 0.3 * ((k * 5) % 3) / 2) for w in wid], (kelp, kelp2)[k % 2], side_fn=(lambda p, tg, u, side=side: side),
                        twist=[0.0, 0.35, -0.25, 0.45, -0.35, 0.25, 0.1], n_per=2)
        bn = out.cross(side).normalized()
        deform(rib, lambda p, root=root, bn=bn: p + bn * 0.005 * math.sin((p - root).length * 85.0))
        P.add("Head", rib)

    # gill-frond ears (EarL / EarR)
    ear_roots = {}
    for side, sx in (("L", 1.0), ("R", -1.0)):
        root = hc + V(sx * 0.108 * s, 0.006, -0.008)
        ear_roots[side] = root
        for j, (up, ln) in enumerate(((0.55, 0.10), (0.1, 0.12), (-0.35, 0.09))):
            axis = V(sx * 0.65, 0.75, up).normalized()
            nrm = V(0, 0, 1).cross(axis) if abs(axis.z) < 0.95 else V(1, 0, 0)
            P.add("Ear" + side, leaf(f"N_gill{side}{j}", root + V(0, 0, up * 0.02), axis, nrm, ln, 0.05, fin, rows=7, cols=3, shape="fin",
                                     cup=0.0, droop=-0.1, slits=3, slit_depth=0.5))
            rays = [root + V(0, 0, up * 0.02) + axis * ln * t for t in (0.0, 0.45, 0.9)]
            P.add("Ear" + side, K.make_tube(f"N_gillray{side}{j}", [tuple(p) for p in rays], [0.0035, 0.0025, 0.001], segments=5, mat=kelp2))

    # --- neck, soft torso, patchwork net & nacre tunic ---
    P.add("Neck", tube("N_neck", [(0, -0.012, 1.08), (0, -0.025, 1.15), (0, -0.04, 1.22)], [0.042, 0.039, 0.038], skin, seg=14))
    t_prof = [(0.555, 0.178, 0.142, -0.025), (0.64, 0.160, 0.128, -0.018), (0.74, 0.137, 0.106, -0.008), (0.82, 0.120, 0.093, -0.004),
              (0.92, 0.124, 0.095, -0.008), (1.00, 0.133, 0.096, -0.012), (1.06, 0.129, 0.089, -0.012), (1.10, 0.10, 0.074, -0.014), (1.125, 0.054, 0.05, -0.02)]
    tunic, tg = shell("N_tunic", [(r[0], r[1], r[2], r[3], PI) for r in t_prof], net, center=PI / 2, nseg=22, thickness=0.006,
                      zfn=lambda p, a, ri: p + V(0, 0, 0.018 * math.sin(a * 7) if ri == 0 else 0.0))
    P.add("Spine", tunic)
    P.add("Chest", lathe("N_tunictop", [(1.10, 0.10, 0.074, -0.014), (1.125, 0.054, 0.05, -0.02), (1.13, 0.04, 0.04, -0.02)], net, seg=20))
    # darker net patches
    for k, (a, z, hw, hz) in enumerate(((-PI / 2 + 0.5, 0.66, 0.35, 0.07), (-PI / 2 - 0.8, 0.86, 0.3, 0.06), (PI / 2 + 0.3, 0.75, 0.4, 0.08), (-PI / 2 - 0.2, 0.95, 0.22, 0.04))):
        rings = []
        for zz in (z - hz, z + hz):
            rx_, ry_, yo_ = profile_at(t_prof, zz)
            rings.append((zz, rx_ + 0.006, ry_ + 0.006, yo_, hw))
        patch, _ = shell(f"N_patch{k}", rings, net_dk, center=a, nseg=6, thickness=0.003)
        P.add("Spine", patch)
    # nacre shell scales over the yoke and shoulders
    k = 0
    for row, (z, n, span) in enumerate(((1.075, 7, 1.9), (1.04, 8, 2.1), (1.005, 7, 1.8))):
        for i in range(n):
            a = -PI / 2 + (i / (n - 1) - 0.5) * span + (0.06 if row % 2 else 0.0)
            p = on_profile(t_prof, a, z, 0.008)
            nrm = V(math.cos(a), math.sin(a), 0.45).normalized()
            sh_ = sphere(f"N_scale{k}", (0.022, 0.025, 0.0065), (0, 0, 0), nacre, 9, 5)
            xf(sh_, M4(p, basis(nrm, (0, 0, 1))))
            P.add("Chest", sh_)
            k += 1
    # current-map string sash: rope band shoulder->hip plus knotted strings
    sash_pts = []
    for i in range(33):
        a = TAU * i / 32
        z = 0.905 + 0.16 * math.cos(a - (-PI / 2 + 0.7))
        sash_pts.append(on_profile(t_prof, a, z, 0.016))
    band, _ = ribbon("N_sash", sash_pts, 0.042, rope, side_fn=lambda p, tg, u: tg.cross(V(p.x, p.y, 0).normalized()), thickness=0.008, n_per=1)
    P.add("Spine", band)
    for i in range(18):
        a = -PI / 2 - 0.15 - 0.95 * (i / 17) + 0.06 * math.sin(i * 3.1)
        z = 0.905 + 0.16 * math.cos(a - (-PI / 2 + 0.7)) - 0.018
        top = on_profile(t_prof, a, z, 0.022)
        ln = 0.14 + 0.13 * ((i * 7) % 5) / 4
        out = V(math.cos(a), math.sin(a), 0) * 0.02
        pts = [top, top + out + V(0, 0, -ln * 0.4), top + out * 1.4 + V(0.006 * math.sin(i), 0, -ln * 0.75), top + out * 1.6 + V(0, 0, -ln)]
        m_ = strings[i % 5]
        P.add("Pelvis", tube(f"N_str{i}", pts, 0.0028, m_, seg=5, n_per=2))
        for kk in range(1 + i % 3):
            kp = lerp(pts[0], pts[-1], 0.3 + 0.25 * kk) + out * (0.6 + 0.2 * kk)
            P.add("Pelvis", sphere(f"N_knot{i}{kk}", 0.0068, kp, m_, 8, 6))

    # --- sea-silk cape (Cloak) ---
    cape_rings = [(1.10, 0.110, 0.082, 0.004, 1.30), (1.04, 0.165, 0.11, 0.035, 1.18), (0.90, 0.20, 0.12, 0.075, 1.12),
                  (0.72, 0.225, 0.135, 0.11, 1.12), (0.52, 0.24, 0.15, 0.15, 1.14), (0.30, 0.25, 0.16, 0.19, 1.16)]
    cape, cgrid = shell("N_cape", cape_rings, silk, center=PI / 2, nseg=24,
                        zfn=lambda p, a, ri: p + V(0.0, 0.025 * math.sin(a * 5 + ri) * (ri / 5), 0.04 * math.sin(a * 6) if ri == 5 else 0.0))
    P.add("Cloak", cape)
    P.add("Cloak", K.make_tube("N_capehem", [tuple(p) for p in cgrid[-1][::2]], 0.003, segments=4, mat=glow))
    for sx in (1, -1):
        P.add("Chest", sphere(f"N_clasp{sx}", (0.022, 0.008, 0.022), V(sx * 0.10, -0.045, 1.085), nacre, 12, 8))

    # --- arms with fin-frills, webbed hands ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        sj = V(L["sjL"]) if sx > 0 else mirror(L["sjL"])
        el = V(L["el" + side])
        wr = V(L["wr" + side])
        fd = (wr - el).normalized()
        P.add("Shoulder" + side, sphere(f"N_shoulder{side}", (0.038, 0.036, 0.034), sj + V(-sx * 0.014, 0, -0.004), skin, 14, 10))
        P.add("Arm" + side, tube(f"N_upper{side}", [sj, lerp(sj, el, 0.5), el], [0.036, 0.031, 0.027], skin, seg=14))
        P.add("Forearm" + side, tube(f"N_fore{side}", [el, lerp(el, wr, 0.5), wr], [0.027, 0.025, 0.021], skin, seg=14))
        out = V(sx, 0.35, 0).normalized()
        out = (out - fd * out.dot(fd)).normalized()
        P.add("Forearm" + side, leaf(f"N_armfin{side}", el + fd * 0.03 + out * 0.018, fd, fd.cross(out), 0.17, 0.075, fin, rows=8, cols=3,
                                     shape="fin", cup=0.0, droop=0.0, slits=4, slit_depth=0.45, twist=0.0))
        P.add("Hand" + side, hand(f"N_hand{side}", wr, fd, sx, skin, s=0.88, curl=0.75 if side == "L" else 0.85, nfing=3, flen=1.1))

    # left hand: the knotted string map spool, unspooled to read the current
    wrL = V(L["wrL"])
    fdl = (wrL - V(L["elL"])).normalized()
    sp = wrL + fdl * 0.075 + V(-0.03, 0, -0.01)
    P.add("PropL", torus("N_spool", 0.030, 0.013, sp, (1, 0, 0.2), rope, 22, 8))
    P.add("PropL", cyl("N_spoolcore", 0.012, 0.012, 0.05, sp, (1, 0, 0.2), cork, 12))
    hang = [sp + V(-0.01, -0.02, -0.02), sp + V(-0.03, -0.05, -0.10), sp + V(-0.02, -0.04, -0.20), sp + V(-0.04, -0.03, -0.29)]
    P.add("PropL", tube("N_mapstring", hang, 0.0028, strings[1], seg=5, n_per=3))
    for kk in range(5):
        P.add("PropL", sphere(f"N_mapknot{kk}", 0.0075, lerp(hang[0], hang[-1], 0.15 + kk * 0.18) + V(-0.004 * kk, -0.004, 0), strings[kk % 5], 8, 6))

    # right hand: sea-glass jar lantern with captive plankton glow (Lantern bone)
    wrR = V(L["wrR"])
    fdr = (wrR - V(L["elR"])).normalized()
    grip = wrR + fdr * 0.075
    jt = grip - V(0, 0, 0.10)
    lan = [tube("N_loop", [grip + V(0.014, 0, 0.01), jt + V(0.03, 0, 0.012), jt + V(0.034, 0, 0.0)], 0.0034, rope, seg=6),
           tube("N_loop2", [grip + V(-0.014, 0, 0.01), jt + V(-0.03, 0, 0.012), jt + V(-0.034, 0, 0.0)], 0.0034, rope, seg=6)]
    jar_prof = [(0.0, 0.040), (0.004, 0.052), (0.03, 0.060), (0.10, 0.061), (0.125, 0.052), (0.14, 0.036), (0.15, 0.035), (0.156, 0.039)]
    jar = lathe("N_jar", [(jt.z - 0.156 + z, r, r, jt.y) for z, r in jar_prof], glass, seg=24, cap_top=False)
    deform(jar, lambda p: p + V(jt.x, 0, 0))
    lan.append(jar)
    lan.append(cyl("N_cork", 0.031, 0.035, 0.026, jt + V(0, 0, 0.006), (0, 0, 1), cork, 16))
    lan.append(torus("N_twine", 0.038, 0.0045, jt - V(0, 0, 0.012), (0, 0, 1), rope, 22, 6))
    lan.append(sphere("N_glowcore", (0.034, 0.034, 0.042), jt - V(0, 0, 0.085), plankton, 12, 9))
    for kk in range(10):
        a = kk * 2.4
        lan.append(sphere(f"N_speck{kk}", 0.0045, jt - V(0, 0, 0.04 + 0.009 * kk) + V(math.cos(a) * 0.045, math.sin(a) * 0.045, 0), plankton, 6, 4))
    P.add("Lantern", lan)

    # --- legs bent in a forward drift, fin feet pointing down ---
    for side, sx in (("L", 1.0), ("R", -1.0)):
        hip = V(sx * 0.075, 0.01, 0.74)
        kn = V(sx * 0.085, -0.075, 0.43)
        an = V(sx * 0.09, 0.0, 0.15)
        toe = V(sx * 0.095, -0.07, 0.0)
        P.add("Thigh" + side, tube(f"N_thigh{side}", [hip + V(0, 0, 0.03), lerp(hip, kn, 0.5), kn], [0.060, 0.052, 0.041], skin, seg=14))
        P.add("Shin" + side, tube(f"N_shin{side}", [kn, lerp(kn, an, 0.45) + V(0, 0.012, 0), an], [0.041, 0.036, 0.025], skin, seg=14))
        P.add("Shin" + side, sphere(f"N_kneeL{side}", (0.040, 0.041, 0.038), kn, skin, 12, 8))
        fdir = (toe - an).normalized()
        P.add("Foot" + side, tube(f"N_foot{side}", [an, lerp(an, toe, 0.5) - V(0, 0.006, 0), toe + fdir * 0.0], [0.026, 0.028, 0.012], skin, seg=12))
        P.add("Foot" + side, leaf(f"N_footfin{side}", an + fdir * 0.02, fdir, V(0, -1, 0.35).cross(V(1, 0, 0)) * -1, 0.17, 0.10, fin, rows=8, cols=3,
                                  shape="fin", cup=0.15, droop=0.0, slits=4, slit_depth=0.4))
        P.add("Shin" + side, leaf(f"N_calffin{side}", lerp(kn, an, 0.25) + V(sx * 0.03, 0.02, 0), (sx * 0.2, 0.6, -0.8), (sx, 0, 0), 0.12, 0.05, fin, rows=6, cols=2,
                                  shape="fin", cup=0.0, droop=0.0))

    extra = {
        "EarL": ("Head", tuple(ear_roots["L"]), tuple(ear_roots["L"] + V(0.05, 0.06, 0.0))),
        "EarR": ("Head", tuple(ear_roots["R"]), tuple(ear_roots["R"] + V(-0.05, 0.06, 0.0))),
        "Cloak": ("Chest", (0, 0.04, 1.08), (0, 0.15, 0.62)),
        "Lantern": ("HandR", tuple(grip), tuple(grip - V(0, 0, 0.16))),
        "PropL": ("HandL", tuple(sp), tuple(sp - V(0, 0, 0.15))),
    }
    return finish("nori", P, L, extra, ARM_CHAINS + [TORSO_CHAIN])


BUILDERS = {"kestrel": build_kestrel, "solenne": build_solenne, "fen": build_fen, "keola": build_keola, "nori": build_nori}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=list(BUILDERS))
    args = ap.parse_args(argv)
    results = {}
    for cid in args.only:
        K.reset_scene()
        results[cid] = BUILDERS[cid]()
    for cid, m in results.items():
        print(f"BATCH_A_DONE {cid} tris={m['tris']} bones={m['bones']} height={m['height']} glb={m['glbBytes']} sheet={m.get('sheetPath')}")


if __name__ == "__main__":
    main()
