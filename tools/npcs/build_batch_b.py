"""
Portalverse AA NPCs - Batch B (Keepers 6-10): Juno, Cairn, Vesper, Soraya, Dex.

Run headless (all five, or a subset by id):
  blender -b -P tools/npcs/build_batch_b.py
  blender -b -P tools/npcs/build_batch_b.py -- juno vesper

Builds each keeper from bespoke sculpted geometry on top of the shared kit
(`blender_kit.py`), rigs it to the standard Portalverse humanoid skeleton (plus
character bones), skins limbs and torsos with smooth joint falloff, exports an
uncompressed GLB to public/assets/npcs/<id>/model.glb and renders a 4-view sheet
to tools/npcs/renders/<id>_sheet.png.

Conventions (from the kit): feet on Z = 0, facing -Y in Blender (+Z in glTF).
The character's LEFT is +X.
"""

from __future__ import annotations

import json
import math
import os
import random
import sys
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import blender_kit as K  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX = os.path.join(HERE, "textures")
GEN = os.path.join(tempfile.gettempdir(), "portalverse_npc_batch_b")
V = Vector
TAU = math.tau
PI = math.pi
X = V((1.0, 0.0, 0.0))
Y = V((0.0, 1.0, 0.0))
Z = V((0.0, 0.0, 1.0))


# ---------------------------------------------------------------------------
# Small maths helpers
# ---------------------------------------------------------------------------

def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def smooth01(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def catmull(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def spline(points, n=4):
    """Catmull-Rom through control points; returns n samples per segment."""
    P = [V(p) for p in points]
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[i] * 2 - P[i + 1]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else P[i + 1] * 2 - P[i]
        for k in range(n):
            out.append(catmull(p0, p1, p2, p3, k / n))
    out.append(P[-1].copy())
    return out


def spline_vals(vals, n=4):
    out = []
    for i in range(len(vals) - 1):
        for k in range(n):
            out.append(lerp(vals[i], vals[i + 1], smooth01(k / n) * 0.5 + (k / n) * 0.5))
    out.append(vals[-1])
    return out


def table(tab, z):
    """Catmull-Rom interpolate a sorted [(z, value...)] table at z (returns tuple)."""
    if z <= tab[0][0]:
        return tab[0][1:]
    if z >= tab[-1][0]:
        return tab[-1][1:]
    for i in range(len(tab) - 1):
        if tab[i][0] <= z <= tab[i + 1][0]:
            t = (z - tab[i][0]) / (tab[i + 1][0] - tab[i][0])
            res = []
            for c in range(1, len(tab[i])):
                p0 = tab[i - 1][c] if i > 0 else tab[i][c]
                p3 = tab[i + 2][c] if i + 2 < len(tab) else tab[i + 1][c]
                res.append(catmull(p0, tab[i][c], tab[i + 1][c], p3, t))
            return tuple(res)
    return tab[-1][1:]


def frame_from(f, hint):
    f = V(f).normalized()
    n = (V(hint) - f * f.dot(V(hint))).normalized()
    return f, n


def track_euler(direction):
    return V(direction).to_track_quat("Z", "Y").to_euler()


# ---------------------------------------------------------------------------
# Geometry helpers (all return baked, world-space objects)
# ---------------------------------------------------------------------------

def bm_obj(bm, name, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    if mat is not None:
        K.assign_material(ob, mat)
    if smooth:
        K.set_smooth(ob)
    return ob


def bake(ob):
    mb = ob.matrix_basis.copy()
    if mb != Matrix.Identity(4):
        ob.data.transform(mb)
        ob.matrix_basis = Matrix.Identity(4)
    return ob


def scale_uvs(ob, su, sv, ou=0.0, ov=0.0):
    me = ob.data
    if not me.uv_layers:
        return
    for d in me.uv_layers.active.data:
        d.uv = (d.uv[0] * su + ou, d.uv[1] * sv + ov)


def mats_on(ob, mats):
    ob.data.materials.clear()
    for m in mats:
        ob.data.materials.append(m)


def ellipsoid(name, center, radii, *, axes=None, segs=16, rings=10, mat=None, deform=None):
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0, calc_uvs=True)
    c = V(center)
    ax = axes or (X, Y, Z)
    for v in bm.verts:
        p = ax[0] * (v.co.x * radii[0]) + ax[1] * (v.co.y * radii[1]) + ax[2] * (v.co.z * radii[2])
        if deform:
            p = deform(p)
        v.co = c + p
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = bm_obj(bm, name, mat)
    rm = sum(radii) / 3.0
    scale_uvs(ob, TAU * rm, PI * rm)
    return ob


def rock(name, center, radii, *, rng, axes=None, subdiv=1, jitter=0.18, mat=None, flat_bottom=None):
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0, calc_uvs=True)
    c = V(center)
    ax = axes or (X, Y, Z)
    for v in bm.verts:
        j = 1.0 + rng.uniform(-jitter, jitter)
        p = v.co * j
        if flat_bottom is not None and p.z < flat_bottom:
            p.z = flat_bottom
        v.co = c + ax[0] * (p.x * radii[0]) + ax[1] * (p.y * radii[1]) + ax[2] * (p.z * radii[2])
    for e in bm.edges:
        e.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_obj(bm, name, mat)


def tube(name, pts, radii, *, segs=12, mat=None, cap=True, n=None):
    if n:
        r_in = radii if isinstance(radii, (list, tuple)) else [radii] * len(pts)
        pts = spline(pts, n)
        radii = spline_vals(list(r_in), n)
    ob = K.make_tube(name, [tuple(p) for p in pts], radii, segments=segs, mat=mat, cap_ends=cap)
    length = sum((V(pts[i + 1]) - V(pts[i])).length for i in range(len(pts) - 1))
    rr = radii if isinstance(radii, (list, tuple)) else [radii]
    scale_uvs(ob, TAU * (sum(rr) / len(rr)), length)
    return ob


def torus(name, center, axis, R, r, *, mat=None, maj=24, mnr=8, scale=None):
    ob = K.make_torus(name, R, r, location=tuple(center), rotation=tuple(track_euler(axis)),
                      major_segments=maj, minor_segments=mnr, mat=mat)
    if scale:
        ob.scale = scale
    bake(ob)
    scale_uvs(ob, TAU * R, TAU * r)
    return ob


def cylinder(name, a, b, r1, r2, *, verts=16, mat=None):
    a, b = V(a), V(b)
    d = b - a
    ob = K.make_cylinder(name, r1, r2, d.length, location=tuple((a + b) / 2), rotation=tuple(track_euler(d)),
                         vertices=verts, mat=mat)
    bake(ob)
    K.ensure_box_uv(ob, 4.0)
    return ob


def box(name, center, size, *, axes=None, bevel=0.004, mat=None):
    ob = K.make_box(name, size=tuple(size), location=(0, 0, 0), bevel=bevel, mat=mat)
    bake(ob)
    if axes:
        m = Matrix((axes[0], axes[1], axes[2])).transposed().to_4x4()
        ob.data.transform(m)
    ob.data.transform(Matrix.Translation(V(center)))
    return ob


def ring(z, rx, ry, *, yoff=0.0, xoff=0.0, n=32, gap=None, rfn=None, zfn=None):
    """Elliptical ring of points at height z. `gap` (half-angle, rad) opens it at the front (-Y)."""
    pts = []
    if gap is None:
        angs = [-PI / 2 + TAU * i / n for i in range(n)]
    else:
        a0, a1 = -PI / 2 + gap, 3 * PI / 2 - gap
        angs = [a0 + (a1 - a0) * i / (n - 1) for i in range(n)]
    for a in angs:
        m = rfn(a) if rfn else 1.0
        zz = z + (zfn(a) if zfn else 0.0)
        pts.append(V((xoff + math.cos(a) * rx * m, yoff + math.sin(a) * ry * m, zz)))
    return pts


def loft(name, rings, *, closed=True, mat=None, flip=False, cap_start=False, cap_end=False, uv_norm=False):
    """Skin a list of point rings (ascending) into a quad surface with metric (or 0..1) UVs."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    nr = len(rings)
    # per-ring cumulative u
    us = []
    for r in rings:
        acc = [0.0]
        for i in range(1, n):
            acc.append(acc[-1] + (r[i] - r[i - 1]).length)
        total = acc[-1] + ((r[0] - r[-1]).length if closed else 0.0)
        us.append((acc, max(total, 1e-6)))
    vs = [0.0]
    for ri in range(1, nr):
        d = sum((rings[ri][i] - rings[ri - 1][i]).length for i in range(n)) / n
        vs.append(vs[-1] + d)
    vtot = max(vs[-1], 1e-6)

    def uv(ri, i, wrap=False):
        acc, tot = us[ri]
        u = tot if wrap else acc[i]
        v = vs[ri]
        if uv_norm:
            return (u / tot, v / vtot)
        return (u, v)

    segs = n if closed else n - 1
    for ri in range(nr - 1):
        for i in range(segs):
            j = (i + 1) % n
            wrap = closed and j == 0
            quad = [(ri, i, False), (ri, j, wrap), (ri + 1, j, wrap), (ri + 1, i, False)]
            if flip:
                quad.reverse()
            try:
                f = bm.faces.new([vr[a][b] for a, b, _ in quad])
            except ValueError:
                continue
            for loop, (a, b, w) in zip(f.loops, quad):
                loop[uvl].uv = uv(a, b, w)
    for flag, ri in ((cap_start, 0), (cap_end, nr - 1)):
        if not flag:
            continue
        c = bm.verts.new(sum(rings[ri], V()) / n)
        for i in range(segs):
            j = (i + 1) % n
            tri = [c, vr[ri][j], vr[ri][i]] if ri == 0 else [c, vr[ri][i], vr[ri][j]]
            if flip:
                tri.reverse()
            try:
                bm.faces.new(tri)
            except ValueError:
                pass
    return bm_obj(bm, name, mat)


def delete_verts(ob, pred):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = [v for v in bm.verts if pred(v.co)]
    if kill:
        bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def deform_verts(ob, fn):
    for v in ob.data.vertices:
        v.co = fn(v.co.copy())
    ob.data.update()
    return ob


def solidify(ob, thickness, offset=1.0):
    mod = ob.modifiers.new("Solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    ob.select_set(False)
    K.set_smooth(ob)
    return ob


def star_prism(name, center, axes, r_out, r_in, depth, points=8, *, mat=None):
    """Extruded star (zellige tile) in the plane of axes[0], axes[1]; depth along axes[2]."""
    bm = bmesh.new()
    bm.loops.layers.uv.new("UVMap")
    c = V(center)
    ring_f, ring_b = [], []
    for i in range(points * 2):
        a = PI / 2 + i * PI / points
        r = r_out if i % 2 == 0 else r_in
        p = axes[0] * math.cos(a) * r + axes[1] * math.sin(a) * r
        ring_f.append(bm.verts.new(c + p - axes[2] * depth / 2))
        ring_b.append(bm.verts.new(c + p + axes[2] * depth / 2))
    cf = bm.verts.new(c - axes[2] * (depth / 2 + depth * 0.35))
    cb = bm.verts.new(c + axes[2] * depth / 2)
    m = len(ring_f)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((ring_f[i], ring_f[j], ring_b[j], ring_b[i]))
        bm.faces.new((cf, ring_f[j], ring_f[i]))
        bm.faces.new((cb, ring_b[i], ring_b[j]))
    for e in bm.edges:
        e.smooth = False
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_obj(bm, name, mat)


# ---------------------------------------------------------------------------
# Generated textures (plaid, embroidered robe band, holographic film)
# ---------------------------------------------------------------------------

def hex01(h):
    h = h.lstrip("#")
    return np.array([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)], dtype=np.float32)


def save_image(name, rgb):
    """rgb: HxWx3 float sRGB (row 0 = top). Saves PNG to GEN and returns its path."""
    os.makedirs(GEN, exist_ok=True)
    h, w = rgb.shape[:2]
    px = np.ones((h, w, 4), dtype=np.float32)
    px[:, :, :3] = np.clip(rgb[::-1], 0.0, 1.0)
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    img.pixels.foreach_set(px.ravel())
    path = os.path.join(GEN, f"{name}.png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path


def gen_plaid(name, base, band, line, size=256):
    y, x = np.mgrid[0:size, 0:size].astype(np.float32) / size
    col = np.ones((size, size, 3), np.float32) * hex01(base)
    bx = ((x * 2) % 1.0 < 0.30).astype(np.float32)
    by = ((y * 2) % 1.0 < 0.30).astype(np.float32)
    nb = hex01(band)
    col = col * (1 - 0.62 * bx[..., None]) + nb * 0.62 * bx[..., None]
    col = col * (1 - 0.62 * by[..., None]) + nb * 0.62 * by[..., None]
    lx = (np.abs(((x * 2) % 1.0) - 0.62) < 0.012).astype(np.float32)
    ly = (np.abs(((y * 2) % 1.0) - 0.62) < 0.012).astype(np.float32)
    ln = np.clip(lx + ly, 0, 1)[..., None]
    col = col * (1 - 0.8 * ln) + hex01(line) * 0.8 * ln
    twill = 0.94 + 0.06 * np.sin((x + y) * size * 1.6)[..., None]
    return save_image(name, col * twill)


def gen_robe(name, size=512):
    """Saffron-ochre over-robe with an embroidered 12-fold-star band at the hem (v<0.11) and front edges."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    v = 1.0 - yy  # v=0 at bottom row
    u = xx
    saffron, ochre = hex01("#e8a33d"), hex01("#c27a22")
    t = np.clip(v * 1.1, 0, 1)[..., None]
    col = saffron * (1 - t) + ochre * t * 0.35 + saffron * t * 0.65
    lattice = (np.abs(np.sin(u * 120) * np.sin(v * 140)) > 0.93).astype(np.float32)[..., None]
    col = col * (1 - 0.08 * lattice) + hex01("#f6cf7a") * 0.08 * lattice
    indigo, gold, teal, cream = hex01("#1f4e79"), hex01("#f2b866"), hex01("#0f766e"), hex01("#fff3dc")

    def star_field(cu, cv, rr):
        du, dv = u - cu, v - cv
        rho = np.sqrt(du * du + dv * dv) / rr
        th = np.arctan2(dv, du)
        tri = np.abs(((th * 12 / TAU) % 1.0) * 2 - 1)
        return rho, rho < (0.55 + 0.45 * tri)

    band = v < 0.11
    col[band] = indigo
    for edge_v in (0.004, 0.102):
        m = np.abs(v - edge_v) < 0.006
        col[m] = gold
    n_st = 12
    for i in range(n_st):
        rho, inside = star_field((i + 0.5) / n_st, 0.054, 0.034)
        m = band & inside
        col[m] = gold
        col[band & (rho < 0.45)] = teal
        col[band & (rho < 0.18)] = cream
        # small diamonds between stars
        dm = band & (np.abs(u - (i + 1.0) / n_st) + np.abs(v - 0.054) * 0.8 < 0.012)
        col[dm] = cream
    for lo, hi in ((0.0, 0.034), (0.966, 1.0)):
        m = (u >= lo) & (u <= hi) & (v >= 0.1)
        col[m] = indigo
        mid = (lo + hi) / 2
        col[m & (np.abs(u - mid) < 0.003)] = gold
        dmd = m & ((np.abs(u - mid) * 2.2 + np.abs(((v * 30) % 1.0) - 0.5) * 0.06) < 0.024)
        col[dmd] = gold
    return save_image(name, col)


def gen_holo(name, size=256):
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) / size
    t = 0.5 + 0.5 * np.sin(xx * TAU + 1.4 * np.sin(yy * TAU) + 0.5 * np.sin((xx + 2 * yy) * TAU))
    mag, vio, cyan = hex01("#ff2a85"), hex01("#7a3cff"), hex01("#00e5ff")
    t3 = t[..., None]
    col = np.where(t3 < 0.5, mag * (1 - t3 * 2) + vio * (t3 * 2), vio * (2 - t3 * 2) + cyan * (t3 * 2 - 1))
    sheen = 0.94 + 0.06 * np.sin(yy * TAU * 6)[..., None]
    return save_image(name, col * sheen)


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def tex(pack, kind):
    return os.path.join(TEX, pack, f"{kind}.png")


_DERIVED = {}


def derived(path, *, size=512, fmt="JPEG", quality=90):
    """Compact copy of a pack texture (JPEG colour/normal, small PNG roughness) so GLBs stay <= 2 MiB."""
    key = (path, size, fmt)
    if key in _DERIVED:
        return _DERIVED[key]
    os.makedirs(GEN, exist_ok=True)
    rel = os.path.relpath(path, TEX).replace(os.sep, "_").rsplit(".", 1)[0]
    out = os.path.join(GEN, f"{rel}_{size}.{'jpg' if fmt == 'JPEG' else 'png'}")
    img = bpy.data.images.load(path)
    if img.size[0] != size:
        img.scale(size, size)
    img.filepath_raw = out
    img.file_format = fmt
    try:
        img.save(filepath=out, quality=quality)
    except TypeError:
        img.save()
    bpy.data.images.remove(img)
    _DERIVED[key] = out
    return out


def M(name, color, *, pack=None, albedo=False, normal=True, rough=False, emissive=False, uv=1.0, ns=0.75,
      tint=0.0, albedo_path=None, normal_path=None, **kw):
    return K.make_pbr_material(
        name,
        color,
        albedo_path=albedo_path or (derived(tex(pack, "albedo")) if pack and albedo else None),
        normal_path=normal_path or (derived(tex(pack, "normal"), quality=92) if pack and normal else None),
        roughness_path=derived(tex(pack, "roughness"), size=256, fmt="PNG") if pack and rough else None,
        emissive_path=derived(tex(pack, "emissive"), size=256) if pack and emissive else None,
        uv_scale=uv,
        normal_strength=ns,
        tint_strength=tint,
        **kw,
    )


def glow(name, color, strength=3.0, alpha=1.0, double_sided=False):
    return K.make_pbr_material(name, color, roughness=0.35, emission_color=color, emission_strength=strength, alpha=alpha,
                               double_sided=double_sided)


# ---------------------------------------------------------------------------
# Rig builder: collects parts per bone, soft joint chains, auto-scales to height
# ---------------------------------------------------------------------------

class Rig:
    def __init__(self, npc_id, height):
        self.id = npc_id
        self.H = height
        self.parts = []  # (bone, obj, figure)
        self.chains = {}  # tuple(bones) -> (id, width)

    def add(self, bone, ob, *, chain=None, width=0.06, figure=True):
        bake(ob)
        if chain:
            key = tuple(chain)
            if key not in self.chains:
                self.chains[key] = (len(self.chains) + 1, width)
            cid = self.chains[key][0]
            attr = ob.data.attributes.new("pvchain", "INT", "POINT")
            attr.data.foreach_set("value", [cid] * len(ob.data.vertices))
        self.parts.append((bone, ob, figure))
        return ob

    def measure(self):
        zmin, zmax = 1e9, -1e9
        for _, ob, fig in self.parts:
            zs = [v.co.z for v in ob.data.vertices]
            if not zs:
                continue
            zmin = min(zmin, min(zs))
            if fig:
                zmax = max(zmax, max(zs))
        return zmin, zmax

    def finish(self, bones, extras, *, bg="#162033", sheet_top=None):
        zmin, zmax = self.measure()
        k = self.H / (zmax - zmin)
        S = Matrix.Translation(V((0, 0, 0))) @ Matrix.Scale(k, 4)
        for _, ob, _ in self.parts:
            ob.data.transform(Matrix.Translation(V((0, 0, -zmin))))
            ob.data.transform(S)

        def sc(p):
            return (V(p) - V((0, 0, zmin))) * k

        extras_s = {n: (par, tuple(sc(a)), tuple(sc(b))) for n, (par, a, b) in extras.items()}
        arm = K.create_humanoid_armature(self.id, height=1.72 * k, extra_bones=extras_s)
        bpy.context.view_layer.objects.active = arm
        arm.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        eb = arm.data.edit_bones
        for name, (a, b) in bones.items():
            if name in eb:
                eb[name].head = sc(a)
                eb[name].tail = sc(b)
                eb[name].roll = 0.0
        bpy.ops.object.mode_set(mode="OBJECT")
        arm.select_set(False)

        bone_map = {}
        for bone, ob, _ in self.parts:
            me = ob.data
            if not me.uv_layers:
                K.ensure_box_uv(ob, 2.0)
            me.uv_layers[0].name = "UVMap"
            # the kit's ensure_box_uv rewrites the *active* UV layer; give it a scratch layer so the
            # authored UVs (embroidered hem band, plaid, metric fabric UVs) survive binding.
            me.uv_layers.active = me.uv_layers.new(name="KitScratch")
            bone_map.setdefault(bone, []).append(ob)
        mesh = K.bind_parts_to_bones(arm, bone_map, mesh_name=f"{self.id}_Body")
        uvl = mesh.data.uv_layers
        if "KitScratch" in uvl:
            uvl.remove(uvl["KitScratch"])
        uvl.active = uvl["UVMap"]
        uvl["UVMap"].active_render = True
        self.apply_chains(arm, mesh)

        metrics = K.finalize_and_export(self.id, arm, mesh, repo_root=REPO, bg_hex=bg, render_sheet=False)
        metrics["figureHeight"] = round(self.H, 3)
        metrics["materials"] = len(mesh.data.materials)
        sheet = os.path.join(REPO, "tools", "npcs", "renders", f"{self.id}_sheet.png")
        bounds = mesh
        if sheet_top:
            me = bpy.data.meshes.new("SheetBounds")
            me.from_pydata([(0, 0, 0), (0, 0, sheet_top)], [], [])
            bounds = bpy.data.objects.new("SheetBounds", me)
            bpy.context.collection.objects.link(bounds)
        K.render_turnaround_sheet(arm, bounds, sheet, bg_hex=bg)
        metrics["sheetPath"] = sheet
        return metrics

    def apply_chains(self, arm, mesh):
        attr = mesh.data.attributes.get("pvchain")
        if attr is None:
            print("WARN: pvchain attribute lost on join; rigid skinning only")
            return
        ids = [0] * len(mesh.data.vertices)
        attr.data.foreach_get("value", ids)
        bones = arm.data.bones
        by_id = {}
        for key, (cid, width) in self.chains.items():
            segs = []
            for bn in key:
                b = bones[bn]
                segs.append((bn, b.head_local.copy(), b.tail_local.copy()))
            by_id[cid] = (segs, width)
        groups = {g.name: g for g in mesh.vertex_groups}
        verts = mesh.data.vertices
        for vi, cid in enumerate(ids):
            if cid == 0 or cid not in by_id:
                continue
            segs, width = by_id[cid]
            p = verts[vi].co
            ws = []
            for bn, a, b in segs:
                d = b - a
                L2 = max(d.length_squared, 1e-9)
                t = (p - a).dot(d) / L2
                dout = max(0.0, -t, t - 1.0) * math.sqrt(L2)
                ws.append(math.exp(-((dout / width) ** 2)))
            tot = sum(ws) or 1.0
            for (bn, _, _), w in zip(segs, ws):
                g = groups[bn]
                w /= tot
                if w < 0.02:
                    g.remove([vi])
                else:
                    g.add([vi], w, "REPLACE")
        mesh.data.attributes.remove(mesh.data.attributes["pvchain"])


def std_bones(h):
    B = {
        "Root": ((0, 0, 0), (0, 0, 0.14 * h)),
        "Pelvis": ((0, 0, 0.88 * h), (0, 0, 1.02 * h)),
        "Spine": ((0, 0, 1.02 * h), (0, 0, 1.22 * h)),
        "Chest": ((0, 0, 1.22 * h), (0, 0, 1.42 * h)),
        "Neck": ((0, 0, 1.42 * h), (0, 0, 1.50 * h)),
        "Head": ((0, 0, 1.50 * h), (0, 0, 1.72 * h)),
    }
    for side, sx in (("L", 1.0), ("R", -1.0)):
        B[f"Thigh{side}"] = ((sx * 0.10 * h, 0, 0.88 * h), (sx * 0.10 * h, 0, 0.48 * h))
        B[f"Shin{side}"] = ((sx * 0.10 * h, 0, 0.48 * h), (sx * 0.10 * h, 0.01 * h, 0.09 * h))
        B[f"Foot{side}"] = ((sx * 0.10 * h, 0.01 * h, 0.09 * h), (sx * 0.10 * h, -0.14 * h, 0.02 * h))
    return {k: (V(a), V(b)) for k, (a, b) in B.items()}


def set_arm(B, side, sh, el, wr, tip, root_z):
    sx = 1.0 if side == "L" else -1.0
    B[f"Shoulder{side}"] = (V((sx * 0.06 * abs(sh[0]) / 0.19, 0, root_z)), V(sh))
    B[f"Arm{side}"] = (V(sh), V(el))
    B[f"Forearm{side}"] = (V(el), V(wr))
    B[f"Hand{side}"] = (V(wr), V(tip))


def set_leg(B, side, hip, kn, an, toe):
    B[f"Thigh{side}"] = (V(hip), V(kn))
    B[f"Shin{side}"] = (V(kn), V(an))
    B[f"Foot{side}"] = (V(an), V(toe))


def set_face(B, c, s, neck_base, jaw_drop=1.0):
    c = V(c)
    for side, sx in (("L", 1.0), ("R", -1.0)):
        e = c + V((sx * 0.037 * s, -0.097 * s, 0.008 * s))
        B[f"Eye{side}"] = (e, e + V((0, -0.035 * s, 0)))
    B["Jaw"] = (c + V((0, -0.02 * s, -0.07 * s * jaw_drop)), c + V((0, -0.11 * s, -0.088 * s * jaw_drop)))
    B["Neck"] = (V(neck_base), c + V((0, 0.0, -0.105 * s)))
    B["Head"] = (c + V((0, 0.0, -0.105 * s)), c + V((0, 0, 0.13 * s)))


# ---------------------------------------------------------------------------
# Body-part builders
# ---------------------------------------------------------------------------

FINGERS = (  # (lateral offset, length, radius) for index..pinky, in hand-scale units
    (0.026, 0.078, 0.0106),
    (0.0085, 0.086, 0.011),
    (-0.0095, 0.080, 0.0105),
    (-0.026, 0.064, 0.0094),
)


def hand_joints(wrist, f, n, side, s, *, curl=(0.25, 0.35, 0.2), spread=0.08, fingers=(1, 1, 1, 1), thumb_curl=0.35,
                length=1.0):
    """Returns (palm_center, palm_axes, palm_radii, [finger joint lists], thumb joints)."""
    f, n = frame_from(f, n)
    lt = f.cross(n) if side == "R" else n.cross(f)  # toward the thumb
    wrist = V(wrist)
    palm_c = wrist + f * 0.046 * s
    fingers_out = []
    for idx, (lat, ln, rad) in enumerate(FINGERS):
        if not fingers[idx]:
            fingers_out.append(None)
            continue
        base = wrist + f * 0.088 * s + lt * lat * s + n * 0.002 * s
        if idx in (0, 3):
            base -= f * 0.006 * s
        segl = [ln * 0.46 * s * length, ln * 0.31 * s * length, ln * 0.25 * s * length]
        side_dir = lt * (spread * (lat / 0.026))
        pts = [base - f * 0.012 * s, base]
        th = 0.0
        for k in range(3):
            th += curl[k]
            d = (f * math.cos(th) + n * math.sin(th) + side_dir * (1.0 - k * 0.3)).normalized()
            pts.append(pts[-1] + d * segl[k])
        fingers_out.append((pts, rad * s))
    # thumb
    tb = wrist + f * 0.022 * s + lt * 0.026 * s + n * 0.012 * s
    d0 = (f * 0.55 + lt * 0.7 + n * 0.45).normalized()
    tpts = [tb, tb + d0 * 0.034 * s]
    d = d0
    for k, L in enumerate((0.032 * s, 0.026 * s)):
        d = (d * math.cos(thumb_curl) + (f + n * 0.8).normalized() * math.sin(thumb_curl)).normalized()
        tpts.append(tpts[-1] + d * L)
    return palm_c, (lt, n, f), (0.041 * s, 0.017 * s, 0.05 * s), fingers_out, (tpts, 0.0105 * s)


def make_hand(rig, side, wrist, f, n, s, skin, *, glove=None, **kw):
    palm_c, axes, radii, fingers, thumb = hand_joints(wrist, f, n, side, s, **kw)
    bone = f"Hand{side}"
    rig.add(bone, ellipsoid(f"hand_palm_{side}", palm_c, radii, axes=axes, segs=14, rings=10, mat=glove or skin,
                            deform=lambda p: p + axes[1] * (abs(p.dot(axes[0])) * 0.12)))
    for i, fd in enumerate(fingers):
        if fd is None:
            continue
        pts, rad = fd
        rads = [rad * 1.05, rad, rad * 0.93, rad * 0.86, rad * 0.78]
        if glove is not None:
            rig.add(bone, tube(f"glove_f{i}_{side}", pts[:3], [r * 1.12 for r in rads[:3]], segs=8, mat=glove))
            rig.add(bone, tube(f"finger{i}_{side}", pts[2:], rads[2:], segs=8, mat=skin))
        else:
            rig.add(bone, tube(f"finger{i}_{side}", pts, rads, segs=8, mat=skin, n=2))
    tpts, tr = thumb
    rig.add(bone, tube(f"thumb_{side}", tpts, [tr * 1.25, tr, tr * 0.9, tr * 0.78], segs=8, mat=glove or skin, n=2))
    return palm_c, axes


def human_head(rig, c, s, mats, *, jaw_taper=0.74, cheek=1.0, ear=1.0, lids=True, lid_mat=None, lash_mat=None,
               lid_cut=0.42, long_jaw=1.0, lip_scale=1.0, nose=1.0):
    parts = K.sculpt_stylized_head(
        f"{rig.id}", center=tuple(c), scale=s, skin_mat=mats["skin"], eye_white_mat=mats["eye"],
        iris_mat=mats["iris"], pupil_mat=mats["pupil"], brow_mat=mats["brow"], lip_mat=mats.get("lip"),
        jaw_taper=jaw_taper, cheek_fullness=cheek, ear_scale=ear,
    )
    c = V(c)
    head = bake(parts["head"])
    if long_jaw != 1.0:
        def stretch(p):
            if p.z < c.z:
                p.z = c.z + (p.z - c.z) * long_jaw
            return p
        deform_verts(head, stretch)
        jaw_obj = bake(parts["jaw"])
        deform_verts(jaw_obj, lambda p: p + V((0, 0, -0.058 * s * (long_jaw - 1.0))))
    # upper lip + mouth corners give the lower (Jaw) lip something to part from
    zl = c.z - 0.058 * s * long_jaw
    jl = bake(parts["jaw"])
    jc = sum((v.co for v in jl.data.vertices), V()) / max(1, len(jl.data.vertices))
    deform_verts(jl, lambda p: jc + V(((p - jc).x * (0.85 + 0.15 * lip_scale), (p - jc).y * lip_scale, (p - jc).z * lip_scale)))
    rig.add("Head", ellipsoid("upper_lip", c + V((0, -0.106 * s, zl - c.z + 0.012 * s)),
                              (0.024 * s, 0.011 * s * lip_scale, 0.0068 * s * lip_scale), segs=14, rings=8,
                              mat=mats.get("lip") or mats["skin"]))
    if nose > 0:
        rig.add("Head", ellipsoid("nose_tip", c + V((0, -0.128 * s, -0.024 * s)), (0.0105 * s * nose, 0.009 * s * nose, 0.009 * s * nose),
                                  segs=12, rings=8, mat=mats["skin"]))
        for sx in (1, -1):
            rig.add("Head", ellipsoid(f"nostril{sx}", c + V((sx * 0.0095 * s * nose, -0.12 * s, -0.029 * s)),
                                      (0.006 * s * nose, 0.006 * s, 0.0055 * s), segs=8, rings=6, mat=mats["skin"]))
    rig.add("Head", tube("mouth_line", [c + V((x * s, -0.111 * s + abs(x) * 0.25 * s, zl - c.z + 0.0045 * s - abs(x) * 0.05 * s))
                                        for x in (-0.024, -0.012, 0.0, 0.012, 0.024)],
                         0.0016 * s, segs=6, mat=mats["mouth"], n=2))
    rig.add("Head", head)
    rig.add("Jaw", bake(parts["jaw"]))
    rig.add("EyeL", bake(parts["eye_l"]))
    rig.add("EyeR", bake(parts["eye_r"]))
    rig.add("Head", bake(parts["brows"]))
    if "ears" in parts:
        rig.add("Head", bake(parts["ears"]))
    if lids:
        for sx in (1.0, -1.0):
            e = c + V((sx * 0.037 * s, -0.097 * s, 0.008 * s))
            r = 0.0185 * s
            R = r * 1.14

            def zc(x, e=e, r=r):
                return e.z + r * (lid_cut - 0.55 * ((x - e.x) / r) ** 2)

            lid = ellipsoid(f"lid_{sx}", e, (R, R, R), segs=18, rings=12, mat=lid_mat or mats["skin"])
            delete_verts(lid, lambda p, e=e, r=r, zc=zc: p.z < zc(p.x) or (p.y - e.y) > r * 0.5)
            rig.add("Head", lid)
            lash = []
            for x in np.linspace(-0.98, 0.98, 9):
                px = e.x + x * r
                pz = zc(px) + 0.03 * r
                dy = math.sqrt(max(0.0, (R * 1.02) ** 2 - (px - e.x) ** 2 - (pz - e.z) ** 2))
                lash.append(V((px, e.y - dy, pz)))
            rads = [r * (0.06 + 0.1 * math.sin(PI * (i + 0.5) / 9) * (1.25 if (i - 4) * sx > 0 else 1.0)) for i in range(9)]
            rig.add("Head", tube(f"lash_{sx}", lash, rads, segs=6, mat=lash_mat or mats["pupil"]))
    return parts


def hair_shell(name, c, s, mat, *, scale=(1.07, 1.06, 1.05), offset=(0, 0.004, 0.006), hairline=None, strands=40,
               amp=0.012, lumps=0.02, segs=30, rings=22, extra=None):
    c = V(c)
    off = V(offset) * s

    def deform(p):
        phi = math.atan2(p.x, -p.y)
        zz = p.z / (0.128 * s)
        m = 1.0 + lumps * math.sin(5 * phi + 3 * zz) + amp * math.sin(strands * phi + 2.0 * zz) * (0.5 + 0.5 * zz)
        q = p * m
        if extra:
            q = extra(q)
        return q

    ob = ellipsoid(name, c + off, (0.106 * s * scale[0], 0.118 * s * scale[1], 0.128 * s * scale[2]),
                   segs=segs, rings=rings, mat=mat, deform=deform)
    if hairline:
        delete_verts(ob, lambda p: hairline(p - c))
    return ob


def hair_cap(name, c, s, mat, line, *, top=None, scale=(1.07, 1.06, 1.05), offset=(0, 0.004, 0.006), n=40, m=11,
             strands=40, amp=0.012, lumps=0.018, extra=None, phi_range=None, tuck=True):
    """
    Hair / wrap / stubble cap that follows a clean hairline: rings run from line(phi) up to the crown
    (or up to top(phi) for a band). phi = 0 at the face (-Y), +phi toward the character's left (+X).
    Heights are in head-scale units (s).
    """
    c = V(c) + V(offset) * s
    Rx, Ry, Rz = 0.106 * s * scale[0], 0.118 * s * scale[1], 0.128 * s * scale[2]
    closed = phi_range is None
    if closed:
        phis = [-PI + TAU * i / n for i in range(n)]
    else:
        phis = list(np.linspace(phi_range[0], phi_range[1], n))

    def point(phi, z, rad=1.0):
        zz = clamp(z / Rz, -0.995, 0.995)
        k = math.sqrt(1.0 - zz * zz)
        p = V((Rx * k * math.sin(phi), -Ry * k * math.cos(phi), z))
        mm = 1.0 + lumps * math.sin(5 * phi + 3 * zz) + amp * math.sin(strands * phi + 2.0 * zz) * (0.5 + 0.5 * zz)
        q = V((p.x * mm * rad, p.y * mm * rad, p.z))
        if extra:
            q = extra(q)
        return c + q

    rings = []
    if tuck:
        rings.append([point(ph, (line(ph) - 0.006) * s, 0.94) for ph in phis])
    for t in np.linspace(0.0, 1.0, m):
        row = []
        for ph in phis:
            z0 = line(ph) * s
            z1 = top(ph) * s if top else Rz * 0.985
            tt = t if top else t ** 0.85
            row.append(point(ph, lerp(z0, z1, tt)))
        rings.append(row)
    if top and tuck:
        rings.append([point(ph, (top(ph) + 0.006) * s, 0.94) for ph in phis])
    return loft(name, rings, closed=closed, mat=mat, cap_end=(top is None))


def cap_point(c, s, phi, z, *, scale=(1.07, 1.06, 1.05), offset=(0, 0.004, 0.006), out=1.0):
    """Point on the hair-cap ellipsoid at azimuth phi (0 = face) and height z (head-scale units)."""
    Rx, Ry, Rz = 0.106 * s * scale[0], 0.118 * s * scale[1], 0.128 * s * scale[2]
    zz = clamp(z * s / Rz, -0.995, 0.995)
    k = math.sqrt(1.0 - zz * zz)
    return V(c) + V(offset) * s + V((Rx * k * math.sin(phi) * out, -Ry * k * math.cos(phi) * out, z * s))


def lock(c, s, path, radii, mat, name, *, scale=(1.07, 1.06, 1.05), offset=(0, 0.004, 0.006), segs=7):
    """Hair lock / fabric fold laid along the cap surface: path = [(phi, z, out), ...]."""
    pts = [cap_point(c, s, ph, z, scale=scale, offset=offset, out=o) for ph, z, o in path]
    return tube(name, pts, radii, segs=segs, mat=mat, n=3)


def surface_patch(target, c, samples, offset):
    """Ray-cast a grid of directions from c onto `target`; returns rings of points lifted by `offset`."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new()
    bm.from_mesh(target.data)
    bvh = BVHTree.FromBMesh(bm)
    bm.free()
    out = []
    for row in samples:
        r = []
        for d in row:
            hit = bvh.ray_cast(V(c), V(d).normalized(), 1.0)
            if hit[0] is None:
                r.append(V(c) + V(d))
                continue
            loc, nrm = hit[0], hit[1]
            if nrm.dot(loc - V(c)) < 0:
                nrm = -nrm
            r.append(loc + nrm * offset)
        out.append(r)
    return out


def head_phi(p):
    return math.atan2(p.x, -p.y)


# ===========================================================================
# 6. JUNO PARK - Night-Shift Translator (1.66 m)
# ===========================================================================

def build_juno():
    rng = random.Random(6)
    H = 1.66
    h = 0.93
    rig = Rig("juno", H)

    skin = M("Juno_Skin", "#eac29e", roughness=0.5)
    mats = {
        "skin": skin,
        "eye": M("Juno_EyeWhite", "#f4efe8", roughness=0.15),
        "iris": M("Juno_Iris", "#3a2618", roughness=0.1, coat_weight=0.6),
        "pupil": M("Juno_Pupil", "#0c0807", roughness=0.1),
        "brow": M("Juno_Brow", "#2b1d14", roughness=0.7),
        "lip": M("Juno_Lip", "#c9837a", roughness=0.4),
        "mouth": M("Juno_Mouth", "#6e3b35", roughness=0.6),
    }
    hair = M("Juno_Hair", "#2b1d14", roughness=0.45, coat_weight=0.25, pack="juno", ns=0.25, uv=8)
    tee = M("Juno_Tee", "#8d9096", pack="vesper", ns=0.5, uv=6)
    knit = M("Juno_Knit", "#d9c7a8", pack="juno", albedo=True, rough=True, uv=4.5, ns=1.1, tint=0.35, double_sided=True)
    plaid = M("Juno_Plaid", "#b8572e", albedo_path=gen_plaid("juno_plaid", "#b8572e", "#2f3e5c", "#e9c9a0"),
              uv=6.0, roughness=0.8, pack="vesper", ns=0.4)
    sock_a = M("Juno_SockMustard", "#d9a441", pack="juno", uv=9, ns=0.9)
    sock_b = M("Juno_SockTeal", "#4f7f86", pack="juno", uv=9, ns=0.9)
    cream = M("Juno_Cream", "#f0e2c4", roughness=0.7)
    phones = M("Juno_Headphones", "#2f3e5c", roughness=0.35, coat_weight=0.4)
    accent = M("Juno_Accent", "#f4a259", roughness=0.4)
    wire = M("Juno_Wire", "#b8945a", roughness=0.3, metallic=1.0)
    mug = M("Juno_Mug", "#5d7f8c", roughness=0.18, coat_weight=0.8)
    mug_in = M("Juno_MugInner", "#efe6d3", roughness=0.2)
    clay = M("Juno_Clay", "#c49a72", roughness=0.85)
    tea = M("Juno_Tea", "#8a5426", roughness=0.05, coat_weight=1.0)
    steam = K.make_pbr_material("Juno_Steam", "#ffffff", roughness=0.9, emission_color="#fff4e6", emission_strength=0.35,
                                alpha=0.2, double_sided=True)
    wood = M("Juno_Wood", "#c89a62", pack="_shared_wood", albedo=True, normal=False, uv=14, tint=0.25, roughness=0.6)
    graphite = M("Juno_Graphite", "#2a2a2e", roughness=0.4, metallic=0.4)
    book = M("Juno_Notebook", "#2f5d62", roughness=0.7, pack="vesper", ns=0.6, uv=8)

    B = std_bones(h)
    # ---- pose
    shR, elR, wrR, tipR = V((-0.185 * h, 0, 1.375 * h)), V((-0.245 * h, 0.04 * h, 1.115 * h)), \
        V((-0.135 * h, -0.17 * h, 1.12 * h)), V((-0.095 * h, -0.25 * h, 1.14 * h))
    shL, elL, wrL, tipL = V((0.185 * h, 0, 1.375 * h)), V((0.285 * h, 0.02 * h, 1.115 * h)), \
        V((0.315 * h, -0.02 * h, 0.875 * h)), V((0.322 * h, -0.035 * h, 0.775 * h))
    set_arm(B, "R", shR, elR, wrR, tipR, 1.38 * h)
    set_arm(B, "L", shL, elL, wrL, tipL, 1.38 * h)
    legs = {}
    for side, sx in (("L", 1), ("R", -1)):
        legs[side] = (V((sx * 0.095 * h, 0, 0.90 * h)), V((sx * 0.098 * h, -0.005 * h, 0.48 * h)),
                      V((sx * 0.10 * h, 0.012 * h, 0.085 * h)), V((sx * 0.115 * h, -0.14 * h, 0.02 * h)))
        set_leg(B, side, *legs[side])

    torso_chain = ["Pelvis", "Spine", "Chest"]
    # ---- tee torso
    tee_tab = [(0.84, 0.150, 0.105, 0.005), (0.95, 0.168, 0.114, 0.008), (1.05, 0.142, 0.096, 0.0),
               (1.15, 0.150, 0.100, -0.004), (1.25, 0.164, 0.112, -0.014), (1.32, 0.166, 0.106, -0.008),
               (1.375, 0.168, 0.094, 0.0), (1.415, 0.12, 0.074, 0.004), (1.445, 0.06, 0.056, 0.006)]
    rings_ = [ring(z * h, rx * h, ry * h, yoff=yo * h, n=26) for z, rx, ry, yo in tee_tab]
    rig.add("Chest", loft("tee", rings_, mat=tee, cap_start=True), chain=torso_chain, width=0.07 * h)
    rig.add("Chest", torus("tee_collar", V((0, 0.004 * h, 1.432 * h)), Z, 0.064 * h, 0.007 * h, mat=tee, maj=24, mnr=6))

    # ---- head
    s = 1.15 * h
    c = V((0, 0.0, 1.60 * h - 0.008 * s))
    human_head(rig, c, s, mats, jaw_taper=0.80, cheek=1.35, ear=0.95, lid_cut=0.30, lip_scale=0.72)
    set_face(B, c, s, (0, 0, 1.42 * h))
    rig.add("Neck", tube("neck", [V((0, 0.006 * h, 1.40 * h)), V((0, 0.004 * h, 1.47 * h)), c + V((0, 0.01 * s, -0.07 * s))],
                         [0.05 * h, 0.046 * h, 0.045 * h], segs=14, mat=skin), chain=["Chest", "Neck", "Head"], width=0.04 * h)

    # ---- hair: shell pulled up toward a messy bun, wisps, and a pencil
    def juno_line(phi):
        a = abs(phi) / PI
        return 0.062 - 0.165 * a ** 1.3 - 0.012 * math.exp(-((phi + 0.35) / 0.25) ** 2)

    rig.add("Head", hair_cap("hair", c, s, hair, juno_line, strands=46, amp=0.012, lumps=0.016))
    bun_c = c + V((0, 0.045 * s, 0.128 * s))

    def bun_def(p):
        a = math.atan2(p.y, p.x)
        return p * (1.0 + 0.10 * math.sin(3 * a + p.z * 90) + 0.05 * math.sin(7 * a))

    rig.add("Head", ellipsoid("bun", bun_c, (0.06 * s, 0.056 * s, 0.05 * s), segs=18, rings=12, mat=hair, deform=bun_def))
    for i, (dx, dy, dz) in enumerate(((0.04, 0.02, 0.02), (-0.035, 0.03, 0.03), (0.0, -0.02, 0.045))):
        rig.add("Head", ellipsoid(f"bun_lump{i}", bun_c + V((dx * s, dy * s, dz * s)), (0.032 * s, 0.028 * s, 0.026 * s),
                                  segs=12, rings=8, mat=hair))
    for i, (a0, a1) in enumerate(((0.3, 1.6), (2.2, 3.6), (4.0, 5.4))):
        pts = [bun_c + V((math.cos(a) * 0.062 * s, math.sin(a) * 0.058 * s, (0.012 + 0.03 * math.sin((a - a0) / (a1 - a0) * PI)) * s))
               for a in np.linspace(a0, a1, 6)]
        rig.add("Head", tube(f"bun_loop{i}", pts, [0.006 * s, 0.009 * s, 0.01 * s, 0.009 * s, 0.007 * s, 0.004 * s], segs=6, mat=hair))
    # face-framing wisps
    for sx in (1, -1):
        pts = [c + V((sx * 0.07 * s, -0.08 * s, 0.075 * s)), c + V((sx * 0.092 * s, -0.085 * s, 0.03 * s)),
               c + V((sx * 0.098 * s, -0.078 * s, -0.025 * s)), c + V((sx * 0.092 * s, -0.07 * s, -0.075 * s))]
        rig.add("Head", tube(f"wisp{sx}", pts, [0.009 * s, 0.008 * s, 0.006 * s, 0.002 * s], segs=6, mat=hair, n=3))
    for i, (x, dz) in enumerate(((0.01, 0.0), (0.035, -0.008))):
        pts = [c + V((x * s, -0.075 * s, 0.112 * s)), c + V(((x + 0.03) * s, -0.118 * s, (0.075 + dz) * s)),
               c + V(((x + 0.06) * s, -0.112 * s, (0.04 + dz) * s))]
        rig.add("Head", tube(f"bang{i}", pts, [0.012 * s, 0.009 * s, 0.002 * s], segs=6, mat=hair, n=3))
    pa, pb = bun_c + V((-0.10 * s, -0.01 * s, -0.02 * s)), bun_c + V((0.085 * s, 0.035 * s, 0.05 * s))
    pd = (pb - pa).normalized()
    rig.add("Head", tube("pencil", [pa, pb], 0.0048 * s, segs=6, mat=wood))
    rig.add("Head", cylinder("pencil_tip", pa, pa - pd * 0.022 * s, 0.0048 * s, 0.0012 * s, verts=6, mat=wood))
    rig.add("Head", cylinder("pencil_lead", pa - pd * 0.016 * s, pa - pd * 0.024 * s, 0.0016 * s, 0.0003 * s, verts=6, mat=graphite))
    rig.add("Head", cylinder("pencil_ferrule", pb, pb + pd * 0.008 * s, 0.0052 * s, 0.0052 * s, verts=10, mat=wire))
    rig.add("Head", cylinder("pencil_eraser", pb + pd * 0.008 * s, pb + pd * 0.017 * s, 0.0049 * s, 0.0045 * s, verts=10, mat=accent))

    # ---- big round wire glasses
    gz = c.z + 0.010 * s
    gy = c.y - 0.128 * s
    for sx in (1, -1):
        ex = c.x + sx * 0.039 * s
        rig.add("Head", torus(f"glass_rim{sx}", V((ex, gy, gz)), Y, 0.031 * s, 0.0024 * s, mat=wire, maj=28, mnr=6))
        rig.add("Head", tube(f"glass_arm{sx}", [V((ex + sx * 0.031 * s, gy + 0.004 * s, gz + 0.004 * s)),
                                                V((c.x + sx * 0.098 * s, c.y - 0.085 * s, gz + 0.006 * s)),
                                                V((c.x + sx * 0.113 * s, c.y - 0.03 * s, gz + 0.002 * s)),
                                                V((c.x + sx * 0.108 * s, c.y + 0.004 * s, gz - 0.012 * s))],
                             0.0019 * s, segs=5, mat=wire, n=3))
    rig.add("Head", tube("glass_bridge", [V((c.x - 0.009 * s, gy, gz + 0.004 * s)), V((c.x, gy - 0.003 * s, gz + 0.009 * s)),
                                          V((c.x + 0.009 * s, gy, gz + 0.004 * s))], 0.0021 * s, segs=5, mat=wire, n=3))

    # ---- oversized open cable-knit cardigan (soft A-line)
    card_tab = [  # z, rx, ry, yoff, gap
        (0.62, 0.272, 0.176, 0.012, 0.78), (0.72, 0.258, 0.166, 0.010, 0.68), (0.85, 0.238, 0.155, 0.010, 0.56), (1.00, 0.214, 0.142, 0.006, 0.46),
        (1.15, 0.200, 0.132, 0.000, 0.38), (1.28, 0.198, 0.136, -0.010, 0.40), (1.36, 0.196, 0.122, -0.004, 0.46),
        (1.405, 0.165, 0.098, 0.004, 0.52), (1.44, 0.112, 0.084, 0.008, 0.62)]
    card_rings = []
    zs = np.linspace(0.62, 1.44, 16)
    for z in zs:
        rx, ry, yo, gap = table(card_tab, z)
        low = clamp((1.05 - z) / 0.43, 0, 1)
        card_rings.append(ring(z * h, rx * h, ry * h, yoff=yo * h, n=28, gap=gap,
                               rfn=lambda a, low=low: 1.0 + 0.03 * low * math.sin(7 * a + 0.6) + 0.012 * math.sin(13 * a)))
    card = loft("cardigan", card_rings, closed=False, mat=knit)
    rig.add("Spine", card, chain=torso_chain, width=0.08 * h)
    # button bands along the opening + shawl collar
    for sx, idx in ((1, 0), (-1, -1)):
        edge = [r[idx] + V((0, -0.004 * h, 0)) for r in card_rings]
        rig.add("Spine", tube(f"band{sx}", edge, 0.016 * h, segs=8, mat=knit), chain=torso_chain, width=0.08 * h)
        if sx == 1:
            for i, z in enumerate((0.92, 1.02, 1.12, 1.22)):
                k = int(np.argmin([abs(zz - z) for zz in zs]))
                p = card_rings[k][0] + V((-0.004 * h, -0.02 * h, 0))
                rig.add("Spine", cylinder(f"button{i}", p, p + V((0, -0.008 * h, 0)), 0.011 * h, 0.010 * h, verts=12, mat=wood),
                        chain=torso_chain, width=0.08 * h)
    collar = [V((0.10 * h, -0.115 * h, 1.24 * h)), V((0.112 * h, -0.08 * h, 1.36 * h)), V((0.098 * h, -0.02 * h, 1.445 * h)),
              V((0.0, 0.07 * h, 1.47 * h)), V((-0.098 * h, -0.02 * h, 1.445 * h)), V((-0.112 * h, -0.08 * h, 1.36 * h)),
              V((-0.10 * h, -0.115 * h, 1.24 * h))]
    rig.add("Chest", tube("shawl_collar", collar, [0.02 * h, 0.032 * h, 0.036 * h, 0.036 * h, 0.036 * h, 0.032 * h, 0.02 * h],
                          segs=12, mat=knit, n=4), chain=torso_chain, width=0.08 * h)
    # patch pockets
    for sx in (1, -1):
        ac = -PI / 2 + sx * 0.72
        pr = []
        for z in np.linspace(0.72, 0.89, 4):
            rx, ry, yo, _ = table(card_tab, z)
            pr.append([V((math.cos(a) * (rx + 0.012) * h, math.sin(a) * (ry + 0.012) * h + yo * h, z * h))
                       for a in np.linspace(ac - 0.36, ac + 0.36, 7)])
        rig.add("Pelvis", loft(f"pocket{sx}", pr, closed=False, mat=knit), chain=torso_chain, width=0.08 * h)
        rig.add("Pelvis", tube(f"pocket_rib{sx}", pr[-1], 0.009 * h, segs=6, mat=knit), chain=torso_chain, width=0.08 * h)

    # ---- chunky sleeves (sweater paws) + hands
    def sleeve(side, sh, el, wr, tip):
        sx = 1 if side == "L" else -1
        f = (tip - wr).normalized()
        pts = [V((sx * 0.12 * h, 0.0, 1.40 * h)), sh + V((0, 0, 0.01 * h)), (sh + el) / 2, el, (el + wr) / 2, wr + f * 0.012 * h]
        rad = [0.06 * h, 0.075 * h, 0.07 * h, 0.068 * h, 0.066 * h, 0.06 * h]
        rig.add(f"Arm{side}", tube(f"sleeve{side}", pts, rad, segs=12, mat=knit, n=3),
                chain=[f"Shoulder{side}", f"Arm{side}", f"Forearm{side}"], width=0.05 * h)
        rig.add(f"Forearm{side}", torus(f"cuff{side}", wr + f * 0.004 * h, f, 0.056 * h, 0.014 * h, mat=knit, maj=20, mnr=8))

    sleeve("R", shR, elR, wrR, tipR)
    sleeve("L", shL, elL, wrL, tipL)
    hs = 0.9 * h
    fR = (tipR - wrR).normalized()
    nR = frame_from(fR, V((1.0, 0.0, 0.2)))[1]
    make_hand(rig, "R", wrR, fR, nR, hs, skin, curl=(0.95, 1.05, 0.7), spread=0.02, thumb_curl=0.5)
    fL = (tipL - wrL).normalized()
    nL = frame_from(fL, V((-1.0, 0.0, 0.0)))[1]
    make_hand(rig, "L", wrL, fL, nL, hs, skin, curl=(0.95, 1.05, 0.7), spread=0.0, thumb_curl=0.35)

    # ---- plaid lounge trousers
    pel = [ring(z * h, rx * h, ry * h, yoff=0.006 * h, n=28) for z, rx, ry in
           ((0.78, 0.15, 0.11), (0.86, 0.168, 0.118), (0.95, 0.172, 0.118), (1.035, 0.152, 0.104))]
    rig.add("Pelvis", loft("pants_hip", pel, mat=plaid, cap_start=True), chain=["Pelvis", "Spine"], width=0.08 * h)
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an, toe = legs[side]
        pts = [hip + V((0, 0, 0.05 * h)), hip, (hip + kn) / 2 + V((sx * 0.006 * h, 0, 0)), kn, (kn + an) / 2, an + V((0, 0, 0.03 * h))]
        rig.add(f"Thigh{side}", tube(f"pant{side}", pts, [0.088 * h, 0.095 * h, 0.093 * h, 0.088 * h, 0.085 * h, 0.082 * h],
                                     segs=14, mat=plaid, n=3), chain=["Pelvis", f"Thigh{side}", f"Shin{side}"], width=0.05 * h)
        rig.add(f"Shin{side}", torus(f"pant_hem{side}", an + V((0, 0, 0.03 * h)), Z, 0.078 * h, 0.011 * h, mat=plaid, maj=18, mnr=6))
        # mismatched socks
        sm = sock_a if side == "L" else sock_b
        foot_c = V((an.x + sx * 0.006 * h, -0.045 * h, 0.044 * h))

        def foot_def(p, ):
            if p.z < -0.044 * h:
                p.z = -0.044 * h
            if p.y > 0.04 * h:
                p.z *= 1.05
            return p

        rig.add(f"Foot{side}", ellipsoid(f"sock_foot{side}", foot_c, (0.047 * h, 0.128 * h, 0.05 * h), segs=16, rings=10,
                                         mat=sm, deform=foot_def))
        rig.add(f"Shin{side}", tube(f"sock_ankle{side}", [an + V((0, -0.01 * h, -0.05 * h)), an + V((0, 0, 0.06 * h))],
                                    [0.046 * h, 0.044 * h], segs=12, mat=sm), chain=[f"Shin{side}", f"Foot{side}"], width=0.03 * h)
        rig.add(f"Shin{side}", torus(f"sock_slouch{side}", an + V((0, 0, 0.045 * h)), Z, 0.044 * h, 0.012 * h, mat=sm, maj=16, mnr=6))
        if side == "L":
            # little cream crescent moon on the outer side of the sock
            mc = foot_c + V((0.046 * h, 0.02 * h, 0.012 * h))
            moon = [mc + V((0.001 * h, math.cos(a) * 0.018 * h, math.sin(a) * 0.018 * h)) for a in np.linspace(0.6, 5.2, 9)]
            rig.add("FootL", tube("sock_moon", moon, [0.0015 * h, 0.004 * h, 0.006 * h, 0.007 * h, 0.007 * h, 0.007 * h, 0.006 * h,
                                                      0.004 * h, 0.0015 * h], segs=6, mat=cream))
        else:
            for k, zz in enumerate((0.03, 0.065)):
                rig.add("ShinR", torus(f"sock_stripe{k}", an + V((0, -0.008 * h, zz * h - 0.02 * h)), Z, 0.047 * h, 0.004 * h,
                                       mat=cream, maj=16, mnr=4))

    # ---- headphones resting around the neck
    for sx in (1, -1):
        cup_c = V((sx * 0.098 * h, -0.112 * h, 1.415 * h))
        ax = (V((sx * 0.75, -0.55, 0.35)).normalized(), V((0.4, 0.9, 0.0)).normalized(), Z)
        rig.add("Chest", ellipsoid(f"cup{sx}", cup_c, (0.022 * h, 0.044 * h, 0.05 * h),
                                   axes=(ax[0], ax[0].cross(Z).normalized(), Z), segs=16, rings=10, mat=phones))
        rig.add("Chest", torus(f"cup_ring{sx}", cup_c + ax[0] * 0.02 * h, ax[0], 0.036 * h, 0.004 * h, mat=accent, maj=20, mnr=5))
        rig.add("Chest", ellipsoid(f"cushion{sx}", cup_c - ax[0] * 0.02 * h, (0.012 * h, 0.04 * h, 0.044 * h),
                                   axes=(ax[0], ax[0].cross(Z).normalized(), Z), segs=14, rings=8, mat=book))
    band = [V((0.1 * h, -0.105 * h, 1.465 * h)), V((0.135 * h, -0.02 * h, 1.5 * h)), V((0.0, 0.115 * h, 1.505 * h)),
            V((-0.135 * h, -0.02 * h, 1.5 * h)), V((-0.1 * h, -0.105 * h, 1.465 * h))]
    rig.add("Chest", tube("phone_band", band, 0.009 * h, segs=8, mat=phones, n=4))

    # ---- props: chipped mug of barley tea (PropR) and notebook (PropL)
    mug_c = wrR + fR * 0.06 * hs + nR * 0.06 * hs + V((0, 0, -0.01 * h))
    mr, mh = 0.041, 0.098
    outer = [ring(mug_c.z - mh / 2 + dz, r, r, xoff=mug_c.x, yoff=mug_c.y, n=20) for dz, r in
             ((0.0, mr * 0.9), (0.006, mr * 0.98), (mh * 0.5, mr), (mh - 0.004, mr * 1.02))]
    inner = [ring(mug_c.z - mh / 2 + dz, r, r, xoff=mug_c.x, yoff=mug_c.y, n=20) for dz, r in
             ((mh - 0.004, mr * 0.88), (0.012, mr * 0.84))]
    rig.add("PropR", loft("mug_out", outer, mat=mug, cap_start=True))
    rig.add("PropR", loft("mug_in", inner, mat=mug_in, cap_end=True, flip=False))
    rig.add("PropR", torus("mug_lip", mug_c + V((0, 0, mh / 2 - 0.004)), Z, mr * 0.95, 0.0045, mat=mug_in, maj=24, mnr=6))
    rig.add("PropR", cylinder("tea", mug_c + V((0, 0, mh * 0.22)), mug_c + V((0, 0, mh * 0.30)), mr * 0.86, mr * 0.86, verts=24, mat=tea))
    hdir = V((0.35, -0.94, 0)).normalized()
    hpts = [mug_c + hdir * mr * 0.95 + V((0, 0, 0.03)), mug_c + hdir * (mr + 0.026) + V((0, 0, 0.022)),
            mug_c + hdir * (mr + 0.03) + V((0, 0, -0.006)), mug_c + hdir * (mr + 0.02) + V((0, 0, -0.026)),
            mug_c + hdir * mr * 0.95 + V((0, 0, -0.03))]
    rig.add("PropR", tube("mug_handle", hpts, 0.0065, segs=8, mat=mug, n=3))
    chip_dir = V((-0.6, -0.8, 0)).normalized()
    rig.add("PropR", ellipsoid("mug_chip", mug_c + chip_dir * mr * 1.0 + V((0, 0, mh / 2 - 0.006)), (0.01, 0.006, 0.007),
                               axes=(chip_dir.cross(Z), chip_dir, Z), segs=10, rings=6, mat=clay))
    for i in range(2):
        a0 = i * 3.0 + 0.4
        base = mug_c + V((math.cos(a0) * 0.012, math.sin(a0) * 0.012, mh * 0.32))
        pts = [base + V((0.014 * math.sin(k * 1.4 + i * 2) * (k / 5), 0.012 * math.cos(k * 1.1 + i) * (k / 5), k * 0.024)) for k in range(6)]
        rig.add("PropR", tube(f"steam{i}", pts, [0.0018, 0.003, 0.0034, 0.003, 0.0022, 0.0008], segs=6, mat=steam, n=3), figure=False)
    # notebook held at the left thigh
    pL = wrL + fL * 0.075 * hs + nL * 0.034 * hs
    bx = (nL.cross(fL)).normalized()
    baxes = (nL, bx, -fL)
    rig.add("PropL", box("notebook_cover", pL, (0.02, 0.15, 0.205), axes=baxes, bevel=0.004, mat=book))
    rig.add("PropL", box("notebook_pages", pL + bx * 0.004, (0.016, 0.146, 0.198), axes=baxes, bevel=0.002, mat=cream))
    rig.add("PropL", box("notebook_band", pL + bx * 0.05, (0.023, 0.008, 0.207), axes=baxes, bevel=0.001, mat=accent))

    extras = {
        "PropR": ("HandR", tuple(wrR + fR * 0.05 * hs), tuple(mug_c + V((0, 0, 0.06)))),
        "PropL": ("HandL", tuple(wrL + fL * 0.05 * hs), tuple(pL - fL * 0.06)),
    }
    return rig.finish(B, extras, bg="#1c2236")


# ===========================================================================
# 7. CAIRN - Abbot of the Stepping Stones (2.10 m, Voronoi basalt construct)
# ===========================================================================

def clip_poly(poly, nx, ny, c):
    out = []
    m = len(poly)
    for i in range(m):
        P, Q = poly[i], poly[(i + 1) % m]
        dp = nx * P[0] + ny * P[1] - c
        dq = nx * Q[0] + ny * Q[1] - c
        if dp <= 0:
            out.append(P)
        if (dp <= 0) != (dq <= 0):
            t = dp / (dp - dq)
            out.append((P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t))
    return out


def voronoi_slabs(name, surf, U, Vlen, *, cell, gap, thick, rng, mats, wrap=True, keep=None, route=None,
                  mat_pick=None, flatten=0.65, jitter=0.38, dome=0.35, bottom=0.015):
    """
    Voronoi stone-slab skin over a parametric surface.
    surf(u, v) -> (point, axis_center) with u in [0, U) metric around, v in [0, Vlen] metric along.
    Returns {route_key: object}.
    """
    nu = max(3, int(round(U / cell)))
    nv = max(1, int(round(Vlen / cell)))
    seeds = []
    for j in range(nv):
        for i in range(nu):
            su = (i + 0.5 + (0.5 if j % 2 else 0.0) + rng.uniform(-jitter, jitter)) * U / nu
            sv = (j + 0.5 + rng.uniform(-jitter, jitter)) * Vlen / nv
            su = su % U if wrap else clamp(su, 0.0, U)
            seeds.append((su, clamp(sv, 0.0, Vlen)))
    ext = list(seeds)
    if wrap:
        ext += [(u + U, v) for u, v in seeds] + [(u - U, v) for u, v in seeds]

    e = 1e-3

    def S(u, v):
        return surf(u, v)[0]

    def N(u, v):
        p, cen = surf(u, v)
        du = S(u + e, v) - S(u - e, v)
        dv = S(u, min(v + e, Vlen + e)) - S(u, max(v - e, -e))
        n = du.cross(dv)
        if n.length < 1e-9:
            n = p - cen
        n.normalize()
        if n.dot(p - cen) < 0:
            n = -n
        return n

    # handedness of the parameterisation (faces built CCW in (u, v))
    p0, c0 = surf(U * 0.25, Vlen * 0.5)
    du0 = S(U * 0.25 + e, Vlen * 0.5) - S(U * 0.25 - e, Vlen * 0.5)
    dv0 = S(U * 0.25, Vlen * 0.5 + e) - S(U * 0.25, Vlen * 0.5 - e)
    mirrored = du0.cross(dv0).dot(p0 - c0) < 0

    builders = {}

    def get_bm(key):
        if key not in builders:
            bm = bmesh.new()
            builders[key] = (bm, bm.loops.layers.uv.new("UVMap"))
        return builders[key]

    R = cell * 2.2
    for si, (su, sv) in enumerate(seeds):
        u0 = su - R if wrap else max(0.0, su - R)
        u1 = su + R if wrap else min(U, su + R)
        poly = [(u0, max(0.0, sv - R)), (u1, max(0.0, sv - R)), (u1, min(Vlen, sv + R)), (u0, min(Vlen, sv + R))]
        for ou, ov in ext:
            if ou == su and ov == sv:
                continue
            dx, dy = ou - su, ov - sv
            d2 = dx * dx + dy * dy
            if d2 > (2 * R) ** 2 or d2 < 1e-12:
                continue
            d = math.sqrt(d2)
            nx, ny = dx / d, dy / d
            c = nx * (su + dx / 2) + ny * (sv + dy / 2) - gap / 2
            poly = clip_poly(poly, nx, ny, c)
            if len(poly) < 3:
                break
        if len(poly) < 3:
            continue
        # densify
        dense = []
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            k = max(1, int(L / (cell * 0.4)))
            for t in range(k):
                dense.append((lerp(a[0], b[0], t / k), lerp(a[1], b[1], t / k)))
        cu = sum(p[0] for p in dense) / len(dense)
        cv = sum(p[1] for p in dense) / len(dense)
        if keep and not keep(cu % U if wrap else cu, cv, rng):
            continue
        key = route(cu % U if wrap else cu, cv) if route else 0
        bm, uvl = get_bm(key)
        mi = mat_pick(rng) if mat_pick else 0
        ht = thick * rng.uniform(0.75, 1.3)
        Pc = S(cu, cv)
        Nc = N(cu, cv)
        top_c = Pc + Nc * ht

        def lift(u, v, hh, fl=flatten):
            p = S(u, v) + N(u, v) * hh
            proj = p - Nc * (p - (Pc + Nc * hh)).dot(Nc)
            return p.lerp(proj, fl)

        bot = [bm.verts.new(S(u, v) - N(u, v) * bottom) for u, v in dense]
        wtop = [bm.verts.new(lift(u, v, ht * 0.8)) for u, v in dense]
        outer = [bm.verts.new(lift(u, v, ht * 0.8)) for u, v in dense]
        inner2 = [(lerp(cu, u, 0.7), lerp(cv, v, 0.7)) for u, v in dense]
        inner = [bm.verts.new(lift(u, v, ht)) for u, v in inner2]
        cen = bm.verts.new(top_c + Nc * ht * dome)
        m = len(dense)
        per = 0.0

        def add(face_verts, uvs):
            fv = list(face_verts)
            uv = list(uvs)
            if mirrored:
                fv.reverse()
                uv.reverse()
            try:
                f = bm.faces.new(fv)
            except ValueError:
                return
            f.material_index = mi
            for lp, t in zip(f.loops, uv):
                lp[uvl].uv = t

        for i in range(m):
            j = (i + 1) % m
            seg = math.hypot(dense[j][0] - dense[i][0], dense[j][1] - dense[i][1])
            add((bot[i], bot[j], wtop[j], wtop[i]), ((per, 0), (per + seg, 0), (per + seg, ht), (per, ht)))
            per += seg
            add((outer[i], outer[j], inner[j], inner[i]),
                (dense[i], dense[j], inner2[j], inner2[i]))
            add((inner[i], inner[j], cen), (inner2[i], inner2[j], (cu, cv)))
    out = {}
    for key, (bm, _) in builders.items():
        ob = bm_obj(bm, f"{name}_{key}", None)
        mats_on(ob, mats)
        out[key] = ob
    return out


def lathe_surf(tab, *, z0, z1, gap_fn=None):
    """Surface over a (z, rx, ry, yoff) table; u is metric arc around, v metric up from z0."""
    def surf(u, v, U):
        z = z0 + v
        rx, ry, yo = table(tab, z)
        a = -PI / 2 + u / U * TAU
        return V((math.cos(a) * rx, math.sin(a) * ry + yo, z)), V((0, yo, z))
    return surf


def cone_surf(a, b, r0, r1, flare=1.0):
    a, b = V(a), V(b)
    ax = (b - a)
    L = ax.length
    axn = ax.normalized()
    e1 = axn.cross(Z if abs(axn.dot(Z)) < 0.9 else X).normalized()
    e2 = axn.cross(e1).normalized()

    def surf(u, v, U):
        t = clamp(v / L, 0.0, 1.0)
        cen = a + ax * t
        r = lerp(r0, r1, t ** flare)
        ang = u / U * TAU
        return cen + (e1 * math.cos(ang) + e2 * math.sin(ang)) * r, cen
    return surf, L


def build_cairn():
    rng = random.Random(7)
    H = 2.10
    rig = Rig("cairn", H)
    basalt = M("Cairn_Basalt", "#2a2f33", pack="cairn", albedo=True, uv=2.2, ns=1.2, tint=0.4)
    slate = M("Cairn_Slate", "#55606a", pack="_shared_stone", albedo=True, uv=2.0, ns=1.1, tint=0.45)
    lichen = M("Cairn_Lichen", "#9ea7a3", pack="_shared_stone", uv=3.0, ns=1.0)
    seam = glow("Cairn_Seam", "#3ff2c8", 3.2)
    core = K.make_pbr_material("Cairn_Core", "#06201b", roughness=0.6, emission_color="#2fdcb4", emission_strength=1.6)
    void = M("Cairn_Void", "#030605", roughness=1.0)
    rope = M("Cairn_Rope", "#7b6446", pack="_shared_wood", uv=10, ns=1.4)
    stone_mats = [basalt, slate, lichen]

    def pick(r):
        x = r.random()
        return 0 if x < 0.62 else (1 if x < 0.9 else 2)

    B = std_bones(H / 1.72)
    # ---- robe body (torso + skirt) : emissive core + Voronoi slab skin
    robe_tab = [(0.0, 0.40, 0.33, 0.01), (0.25, 0.37, 0.30, 0.01), (0.55, 0.34, 0.28, 0.0), (0.85, 0.315, 0.255, 0.0),
                (1.05, 0.30, 0.245, 0.0), (1.25, 0.325, 0.255, -0.01), (1.42, 0.37, 0.27, -0.005),
                (1.54, 0.41, 0.275, 0.0), (1.62, 0.37, 0.25, 0.01), (1.70, 0.24, 0.19, 0.02), (1.74, 0.16, 0.15, 0.025)]
    z0, z1 = 0.02, 1.72
    base = lathe_surf(robe_tab, z0=z0, z1=z1)
    Ur = TAU * 0.33
    core_rings = [ring(z, *[x * 0.985 for x in table(robe_tab, z)[:2]], yoff=table(robe_tab, z)[2], n=32)
                  for z in np.linspace(z0, z1, 18)]
    rig.add("Spine", loft("core_body", core_rings, mat=core, cap_start=True, cap_end=True),
            chain=["Cloak", "Pelvis", "Spine", "Chest"], width=0.18)

    def route_body(u, v):
        z = z0 + v
        return "Chest" if z > 1.30 else "Spine" if z > 1.0 else "Pelvis" if z > 0.62 else "Cloak"

    body = voronoi_slabs("robe", lambda u, v: base(u, v, Ur), Ur, z1 - z0, cell=0.165, gap=0.022, thick=0.05, rng=rng,
                         mats=stone_mats, route=route_body, mat_pick=pick)
    for key, ob in body.items():
        rig.add(key, ob)
    # outer drifting robe layer: thinner, flatter, larger slabs on the skirt
    outer_tab = [(z, rx + 0.05, ry + 0.05, yo) for z, rx, ry, yo in robe_tab if z <= 1.1]
    outer = lathe_surf(outer_tab, z0=0.0, z1=0.98)
    layer = voronoi_slabs("robe_layer", lambda u, v: outer(u, v, Ur * 1.15), Ur * 1.15, 0.98, cell=0.24, gap=0.03,
                          thick=0.022, rng=rng, mats=stone_mats, mat_pick=pick, flatten=0.85,
                          keep=lambda u, v, r: r.random() < 0.6 and min(u / (Ur * 1.15) * TAU, TAU - u / (Ur * 1.15) * TAU) > 0.45,
                          route=lambda u, v: "Cloak")
    for key, ob in layer.items():
        rig.add(key, ob)

    # ---- hood (Head): open front, dark void, single teal eye-seam
    hood_tab = [(1.60, 0.25, 0.27, 0.03), (1.70, 0.27, 0.29, 0.03), (1.80, 0.265, 0.285, 0.035), (1.90, 0.24, 0.262, 0.045),
                (1.98, 0.2, 0.222, 0.06), (2.06, 0.135, 0.158, 0.085), (2.13, 0.065, 0.08, 0.115), (2.17, 0.012, 0.015, 0.14)]
    hz0, hz1 = 1.60, 2.17
    hsurf = lathe_surf(hood_tab, z0=hz0, z1=hz1)
    Uh = TAU * 0.27

    def open_half(z):
        if 1.71 < z < 2.0:
            return 0.70 * math.sin(PI * (z - 1.71) / 0.29) ** 0.45
        return 0.0

    def hood_keep(u, v, r):
        z = hz0 + v
        a = u / Uh * TAU  # 0 == front
        da = min(a, TAU - a)
        return da > open_half(z) + 0.05

    hood = voronoi_slabs("hood", lambda u, v: hsurf(u, v, Uh), Uh, hz1 - hz0, cell=0.12, gap=0.018, thick=0.042, rng=rng,
                         mats=stone_mats, keep=hood_keep, mat_pick=pick)
    for ob in hood.values():
        rig.add("Head", ob)
    hood_core = []
    for z in np.linspace(hz0, hz1 - 0.01, 14):
        rx, ry, yo = table(hood_tab, z)
        g = open_half(z)
        hood_core.append(ring(z, rx * 0.97, ry * 0.97, yoff=yo, n=30, gap=(g + 0.12) if g > 0 else 0.02))
    rig.add("Head", loft("hood_core", hood_core, closed=False, mat=core))
    rig.add("Head", ellipsoid("hood_void", (0, 0.04, 1.86), (0.215, 0.215, 0.24), segs=20, rings=14, mat=void))
    # smooth worn-stone lip framing the face opening
    rim = []
    for sx in (1, -1):
        side_pts = []
        for z in np.linspace(1.72, 1.985, 7):
            rx, ry, yo = table(hood_tab, z)
            a = -PI / 2 + sx * (open_half(z) + 0.03)
            side_pts.append(V((math.cos(a) * (rx + 0.022), math.sin(a) * (ry + 0.022) + yo, z)))
        rim.append(side_pts)
    rx, ry, yo = table(hood_tab, 2.01)
    path = rim[0] + [V((0, -ry - 0.02 + yo, 2.01))] + list(reversed(rim[1]))
    rig.add("Head", tube("hood_rim", path, [0.03, 0.034, 0.036, 0.036, 0.034, 0.032, 0.03, 0.03, 0.03, 0.032, 0.034, 0.036, 0.036,
                                            0.034, 0.03], segs=8, mat=basalt, n=2))
    eye_z = 1.885
    for side, sx in (("L", 1), ("R", -1)):
        pts = [V((sx * x, -0.176 - 0.02 * (x / 0.09) ** 2 * 0 + 0.012 * (x / 0.09) ** 2, eye_z)) for x in (0.0, 0.03, 0.06, 0.088)]
        rig.add(f"Eye{side}", tube(f"eye_seam{side}", pts, [0.0085, 0.0085, 0.007, 0.003], segs=8, mat=seam, n=2))
        B[f"Eye{side}"] = (V((sx * 0.045, -0.15, eye_z)), V((sx * 0.045, -0.19, eye_z)))
    # lower hood lip on the Jaw (moves softly when Cairn speaks)
    rig.add("Jaw", rock("hood_chin", (0, -0.17, 1.735), (0.09, 0.045, 0.03), rng=rng, subdiv=1, jitter=0.1, mat=basalt))
    B["Jaw"] = (V((0, -0.05, 1.76)), V((0, -0.18, 1.74)))
    B["Neck"] = (V((0, 0, 1.62)), V((0, 0, 1.70)))
    B["Head"] = (V((0, 0, 1.70)), V((0, 0, 2.06)))

    # ---- halo of four orbiting basalt prayer-bead pebbles (Halo bone)
    hc = V((0, 0.06, 1.92))
    for i in range(4):
        a = i * TAU / 4 + PI / 4
        p = hc + V((math.cos(a) * 0.45, math.sin(a) * 0.45, 0.08 * math.sin(a + 1.0)))
        rr = 0.068 + 0.012 * (i % 2)
        rig.add("Halo", rock(f"pebble{i}", p, (rr, rr * 0.85, rr * 0.8), rng=rng, subdiv=2, jitter=0.08, mat=slate))
        rig.add("Halo", torus(f"pebble_band{i}", p, Z, rr * 0.96, 0.0032, mat=seam, maj=18, mnr=4, scale=(1.0, 0.85, 1.0)))

    # ---- arms: big slab sleeves, glowing-joint stone hands
    joints = {}
    for side, sx in (("L", 1), ("R", -1)):
        sh = V((sx * 0.40, 0.0, 1.52))
        el = V((sx * 0.50, 0.03, 1.22))
        wr = V((sx * 0.33, -0.34, 1.10 if side == "R" else 1.02))
        tip = wr + V((-sx * 0.03, -0.12, 0.03))
        joints[side] = (sh, el, wr, tip)
        set_arm(B, side, sh, el, wr, tip, 1.62)
        B[f"Shoulder{side}"] = (V((sx * 0.12, 0, 1.62)), sh)
        for part, (a, b, r0, r1, flare, bone) in {
            "upper": (sh + V((-sx * 0.06, 0, 0.06)), el, 0.15, 0.14, 1.0, f"Arm{side}"),
            "fore": (el, wr - (wr - el).normalized() * 0.07, 0.14, 0.185, 1.6, f"Forearm{side}"),
        }.items():
            sfun, L = cone_surf(a, b, r0, r1, flare)
            Uc = TAU * (r0 + r1) / 2
            cells = voronoi_slabs(f"sleeve_{part}{side}", lambda u, v, sfun=sfun, Uc=Uc: sfun(u, v, Uc), Uc, L, cell=0.13,
                                  gap=0.02, thick=0.036, rng=rng, mats=stone_mats, mat_pick=pick)
            for ob in cells.values():
                rig.add(bone, ob)
            cr = []
            for t in np.linspace(0, 1, 6):
                cen = sfun(0, t * L, Uc)[1]
                rad = lerp(r0, r1, t ** flare) * 0.96
                d = (b - a).normalized()
                e1 = d.cross(Z if abs(d.dot(Z)) < 0.9 else X).normalized()
                e2 = d.cross(e1).normalized()
                cr.append([cen + (e1 * math.cos(q) + e2 * math.sin(q)) * rad for q in np.linspace(0, TAU, 20, endpoint=False)])
            rig.add(bone, loft(f"sleeve_core_{part}{side}", cr, mat=core))
        rig.add(f"Arm{side}", rock(f"elbow{side}", el + V((sx * 0.02, 0.04, 0)), (0.12, 0.12, 0.11), rng=rng, subdiv=1,
                                   jitter=0.12, mat=basalt))

    def stone_hand(side, wr, f, n, missing):
        s = 1.85
        palm_c, axes, radii, fingers, thumb = hand_joints(wr, f, n, side, s, curl=(0.35, 0.4, 0.3), spread=0.12,
                                                         fingers=(1, 1, 1, 1), thumb_curl=0.3)
        bone = f"Hand{side}"
        rig.add(bone, rock(f"palm{side}", palm_c, (radii[0] * 1.1, radii[1] * 1.5, radii[2] * 1.05), rng=rng, axes=axes, subdiv=2,
                           jitter=0.06, mat=slate))
        rig.add(bone, ellipsoid(f"wrist_glow{side}", wr - f * 0.01, (0.045, 0.045, 0.03), axes=(n.cross(f), n, f), segs=12, rings=8,
                                mat=seam))
        for i, fd in enumerate(fingers):
            pts, rad = fd
            knuckles = pts[1:]
            stub = i in missing
            nseg = 1 if stub else 3
            for k in range(nseg):
                a, b = knuckles[k], knuckles[k + 1]
                d = b - a
                mid = a + d * (0.25 if stub else 0.5)
                L = d.length * (0.25 if stub else 0.42)
                dn = d.normalized()
                e1 = dn.cross(n).normalized()
                e2 = dn.cross(e1)
                rig.add(bone, rock(f"fing{side}{i}{k}", mid, (rad * 1.25, rad * 1.15, L * 1.08), rng=rng, axes=(e1, e2, dn),
                                   subdiv=1, jitter=0.08, mat=slate))
                rig.add(bone, ellipsoid(f"knuckle{side}{i}{k}", a, (rad * 0.36,) * 3, segs=8, rings=6, mat=seam))
            if stub:
                rig.add(bone, ellipsoid(f"stub_glow{side}{i}", knuckles[0] + (knuckles[1] - knuckles[0]) * 0.52,
                                        (rad * 0.85, rad * 0.85, rad * 0.85), segs=10, rings=6, mat=seam))
        tpts, tr = thumb
        for k in range(len(tpts) - 1):
            a, b = tpts[k], tpts[k + 1]
            d = b - a
            dn = d.normalized()
            e1 = dn.cross(n).normalized()
            rig.add(bone, rock(f"thumb{side}{k}", a + d * 0.5, (tr * 1.15, tr * 1.05, d.length * 0.48), rng=rng,
                               axes=(e1, dn.cross(e1), dn), subdiv=1, jitter=0.08, mat=slate))
            rig.add(bone, ellipsoid(f"tknuckle{side}{k}", a, (tr * 0.36,) * 3, segs=8, rings=6, mat=seam))
        return axes

    shR, elR, wrR, tipR = joints["R"]
    fR = (tipR - wrR).normalized()
    nR = frame_from(fR, V((0.3, 0, 1.0)))[1]
    stone_hand("R", wrR, fR, nR, missing=())
    shL, elL, wrL, tipL = joints["L"]
    fL = (tipL - wrL).normalized()
    nL = frame_from(fL, V((-0.3, 0, 1.0)))[1]
    stone_hand("L", wrL, fL, nL, missing=(1, 2, 3))

    # ---- rune-tablet prop ("here") standing on the right palm
    tab_c = wrR + fR * 0.13 + nR * 0.11
    tax = (X, -Y, Z)
    tab_c = tab_c + V((0, 0, 0.04))
    rig.add("PropR", box("tablet", tab_c, (0.17, 0.04, 0.24), bevel=0.016, mat=slate))
    gy = tab_c.y - 0.021
    glyph = [[(-0.045, 0.075), (0.0, 0.03), (0.045, 0.075)], [(0.0, 0.03), (0.0, -0.075)], [(-0.05, -0.035), (0.05, -0.035)]]
    for gi, stroke in enumerate(glyph):
        pts = [V((tab_c.x + gx, gy, tab_c.z + gz)) for gx, gz in stroke]
        rig.add("PropR", tube(f"glyph{gi}", pts, 0.0075, segs=6, mat=seam))

    # ---- woven rope sash with hanging rune tablets
    sash_z = 1.06
    rx, ry, yo = table(robe_tab, sash_z)
    rx += 0.058
    ry += 0.058
    for strand in range(2):
        pts = []
        for i in range(73):
            a = i / 72 * TAU
            base_p = V((math.cos(a) * rx, math.sin(a) * ry + yo, sash_z))
            radial = V((math.cos(a), math.sin(a), 0))
            ph = a * 22 + strand * PI
            pts.append(base_p + radial * 0.011 * math.cos(ph) + Z * 0.011 * math.sin(ph))
        rig.add("Spine", tube(f"rope{strand}", pts, 0.0125, segs=6, mat=rope, cap=False))
    knot = V((math.cos(-PI / 2 + 0.55) * rx, math.sin(-PI / 2 + 0.55) * ry + yo, sash_z))
    rig.add("Spine", ellipsoid("rope_knot", knot + V((0, -0.01, 0)), (0.035, 0.03, 0.032), segs=12, rings=8, mat=rope))
    for i, (dx, L) in enumerate(((-0.05, 0.26), (0.0, 0.36), (0.055, 0.2))):
        top = knot + V((dx, -0.02, -0.01))
        bot = top + V((dx * 0.3, -0.03 - 0.03 * i, -L))
        rig.add("Cloak", tube(f"cord{i}", [top, (top + bot) / 2 + V((0, -0.02, 0)), bot], 0.007, segs=6, mat=rope, n=2))
        tc = bot + V((0, -0.005, -0.05))
        rig.add("Cloak", box(f"rune{i}", tc, (0.06, 0.014, 0.085), bevel=0.006, mat=basalt))
        rig.add("Cloak", tube(f"rune_glyph{i}", [tc + V((-0.015, -0.009, 0.02)), tc + V((0.0, -0.009, -0.002)),
                                                 tc + V((0.015, -0.009, 0.02))], 0.0035, segs=5, mat=seam))
        rig.add("Cloak", tube(f"rune_glyph_b{i}", [tc + V((0.0, -0.009, -0.002)), tc + V((0.0, -0.009, -0.03))], 0.0035,
                              segs=5, mat=seam))

    extras = {
        "Cloak": ("Pelvis", (0, 0, 1.0), (0, 0, 0.35)),
        "Halo": ("Head", tuple(hc), tuple(hc + V((0, 0, 0.16)))),
        "PropR": ("HandR", tuple(wrR + fR * 0.08), tuple(tab_c + V((0, 0, 0.1)))),
    }
    return rig.finish(B, extras, bg="#0e1a1f")


# ===========================================================================
# 8. VESPER - Last Lamplighter of the Avenue (2.02 m)
# ===========================================================================

def build_vesper():
    rng = random.Random(8)
    H = 2.02
    h = H / 1.72 * 0.985
    rig = Rig("vesper", H)
    skin = M("Vesper_Skin", "#e7d9cf", roughness=0.45)
    mats = {
        "skin": skin,
        "eye": M("Vesper_EyeWhite", "#efe8e2", roughness=0.15),
        "iris": M("Vesper_Iris", "#2a1d1a", roughness=0.1, coat_weight=0.7),
        "pupil": M("Vesper_Pupil", "#0a0708", roughness=0.1),
        "brow": M("Vesper_Brow", "#1c1418", roughness=0.7),
        "lip": M("Vesper_Lip", "#a77a7a", roughness=0.4),
        "mouth": M("Vesper_Mouth", "#5a3437", roughness=0.6),
    }
    hair = M("Vesper_Hair", "#1c1418", roughness=0.4, coat_weight=0.3, pack="vesper", ns=0.2, uv=10)
    wool = M("Vesper_Wool", "#6e6a6f", pack="vesper", uv=5, ns=0.9, double_sided=True)
    lining = M("Vesper_Lining", "#d11824", roughness=0.28, coat_weight=0.5, metallic=0.05)
    dark = M("Vesper_Dark", "#1c1418", pack="vesper", uv=6, ns=0.7)
    felt = M("Vesper_Felt", "#2b2326", pack="vesper", uv=8, ns=1.0)
    mask = M("Vesper_MaskStone", "#d8cbb0", pack="_shared_stone", uv=7, ns=1.3, roughness=0.85)
    silver = M("Vesper_Silver", "#8f8c88", pack="_shared_brass", metallic=1.0, uv=6, ns=0.5)
    flame = glow("Vesper_Flame", "#ffcf7a", 7.0)
    lampglass = K.make_pbr_material("Vesper_LampGlass", "#f6dca0", roughness=0.1, emission_color="#c9b48a",
                                    emission_strength=2.2, alpha=0.55)
    glint = glow("Vesper_Glint", "#5dff9e", 0.8)
    cloth = M("Vesper_Cloth", "#e9dcc4", pack="vesper", uv=10, ns=0.6, double_sided=True)

    B = std_bones(h)
    shR, elR, wrR = V((-0.172 * h, 0, 1.38 * h)), V((-0.235 * h, 0.03 * h, 1.12 * h)), V((-0.27 * h, -0.13 * h, 1.01 * h))
    fR = V((-0.1, -1.0, -0.12)).normalized()
    nR = frame_from(fR, V((1.0, 0.0, 0.0)))[1]
    tipR = wrR + fR * 0.1 * h
    shL, elL, wrL = V((0.172 * h, 0, 1.38 * h)), V((0.25 * h, -0.01 * h, 1.12 * h)), V((0.265 * h, -0.10 * h, 0.90 * h))
    fL = V((0.02, -0.45, -1.0)).normalized()
    nL = frame_from(fL, V((-1.0, 0.0, 0.0)))[1]
    tipL = wrL + fL * 0.1 * h
    set_arm(B, "R", shR, elR, wrR, tipR, 1.38 * h)
    set_arm(B, "L", shL, elL, wrL, tipL, 1.38 * h)
    legs = {}
    for side, sx in (("L", 1), ("R", -1)):
        legs[side] = (V((sx * 0.085 * h, 0, 0.9 * h)), V((sx * 0.088 * h, -0.01 * h, 0.48 * h)),
                      V((sx * 0.09 * h, 0.01 * h, 0.085 * h)), V((sx * 0.098 * h, -0.15 * h, 0.02 * h)))
        set_leg(B, side, *legs[side])
    torso_chain = ["Pelvis", "Spine", "Chest"]

    # ---- shirt / torso under the coat
    shirt_tab = [(0.95, 0.15, 0.1), (1.1, 0.13, 0.09), (1.3, 0.15, 0.1), (1.38, 0.15, 0.09), (1.42, 0.1, 0.07), (1.45, 0.055, 0.05)]
    rig.add("Chest", loft("shirt", [ring(z * h, rx * h, ry * h, n=24) for z, rx, ry in shirt_tab], mat=dark, cap_start=True),
            chain=torso_chain, width=0.07 * h)

    # ---- head: long jaw, gentle right eye, porcelain-stone half mask on the upper left
    s = 0.97 * h
    c = V((0, 0.0, 1.60 * h - 0.008 * s))
    parts = human_head(rig, c, s, mats, jaw_taper=0.64, cheek=0.45, ear=0.9, long_jaw=1.12, lip_scale=0.7)
    set_face(B, c, s, (0, 0, 1.42 * h), jaw_drop=1.12)
    delete_verts(parts["brows"], lambda p: p.x > c.x + 0.005 * s)
    rig.add("Neck", tube("neck", [V((0, 0.008 * h, 1.40 * h)), V((0, 0.006 * h, 1.48 * h)), c + V((0, 0.012 * s, -0.08 * s))],
                         [0.043 * h, 0.04 * h, 0.04 * h], segs=14, mat=skin), chain=["Chest", "Neck", "Head"], width=0.04 * h)
    # swept-back dark hair
    def vesper_line(phi):
        a = abs(phi) / PI
        return 0.080 - 0.014 * math.exp(-(phi / 0.16) ** 2) - 0.205 * a ** 1.5

    # porcelain-stone half-mask: a clean polar patch around the left eye, ray-cast onto the head surface
    head = parts["head"]
    eye_l = c + V((0.037 * s, -0.097 * s, 0.008 * s))
    phi_e, z_e = math.atan2(0.037, 0.097), 0.008

    def in_mask(phi, z):
        if phi < -0.04 + 0.03 * math.sin(z * 120):
            return False
        if phi > 1.42 + 0.06 * math.sin(z * 60):
            return False
        lo = -0.012 - 0.03 * smooth01((phi - 0.22) / 0.4) + 0.006 * math.sin(phi * 11.0)
        hi = min(0.094 - 0.03 * smooth01((phi - 0.9) / 0.5) + 0.004 * math.sin(phi * 14), vesper_line(phi) - 0.008)
        return lo < z < hi

    ARC = 0.112  # metres of arc per radian of phi (head-scale units)
    thetas = np.linspace(0, TAU, 56, endpoint=False)
    r_hole = 0.0215
    r_out = []
    for th in thetas:
        r = r_hole
        while r < 0.3:
            ph = phi_e + math.cos(th) * r / ARC
            z = z_e + math.sin(th) * r
            if not in_mask(ph, z):
                break
            r += 0.002
        r_out.append(r)
    samples = []
    for t in np.linspace(0.0, 1.0, 9):
        row = []
        for th, ro in zip(thetas, r_out):
            r = lerp(r_hole, ro, t)
            ph = phi_e + math.cos(th) * r / ARC
            z = z_e + math.sin(th) * r
            kk = math.sqrt(max(0.0, 1.0 - (z / 0.128) ** 2))
            row.append(V((0.106 * kk * math.sin(ph), -0.118 * kk * math.cos(ph), z)))
        samples.append(row)
    pts = surface_patch(head, c, samples, 0.0042 * s)
    for i, row in enumerate(pts):
        for j, p in enumerate(row):
            if 0 < i < len(pts) - 1:
                row[j] = p + (p - c).normalized() * 0.0006 * s * math.sin(j * 2.3 + i * 1.7)
    mk = loft("mask", pts, mat=mask)
    solidify(mk, 0.006 * s, offset=-1.0)
    rig.add("Head", mk)
    for k in range(3):  # weathering cracks
        th0 = 0.9 + k * 1.9
        crack = [pts[i][int((th0 / TAU) * 56 + i * 0.6) % 56] for i in range(3, 9)]
        crack = [p + (p - c).normalized() * 0.0015 * s for p in crack]
        rig.add("Head", tube(f"mask_crack{k}", crack, 0.0011 * s, segs=4, mat=mats["mouth"]))
    rig.add("Head", tube("mask_glint", [eye_l + V((x * s, -0.017 * s, (-0.013 + 2.0 * x * x) * s))
                                        for x in (-0.012, -0.004, 0.004, 0.012)], 0.0012 * s, segs=5, mat=glint, n=2))

    hsc, hoff = (1.06, 1.08, 1.07), (0, 0.006, 0.006)

    def sweep(q):
        if q.z > 0:
            q.y += q.z * 0.10
        return q

    rig.add("Head", hair_cap("hair", c, s, hair, vesper_line, scale=hsc, offset=hoff, strands=28, amp=0.009, lumps=0.01,
                             extra=sweep))
    for i, (p0, p1) in enumerate(((-0.2, -1.1), (-0.55, -1.6), (0.25, 1.2), (-0.05, 2.6))):
        path = [(p0, 0.07, 1.01), (lerp(p0, p1, 0.35), 0.105, 1.05), (lerp(p0, p1, 0.7), 0.09, 1.05), (p1, 0.02, 1.02)]
        rig.add("Head", lock(c, s, path, [0.006 * s, 0.012 * s, 0.011 * s, 0.004 * s], hair, f"sweep{i}", scale=hsc, offset=hoff))
    for i, x in enumerate((-0.05, 0.0, 0.05)):
        pts = [c + V((x * s, 0.11 * s, -0.06 * s)), c + V((x * 1.1 * s, 0.12 * s, -0.12 * s)), c + V((x * 1.3 * s, 0.10 * s, -0.16 * s))]
        rig.add("Head", tube(f"nape{i}", pts, [0.016 * s, 0.012 * s, 0.004 * s], segs=6, mat=hair, n=3))

    # ---- moth-grey greatcoat: fitted bodice, high collar, flared ankle-length skirt with crimson lining
    bod_tab = [(0.98, 0.168, 0.118, 0.0, 0.03), (1.08, 0.152, 0.108, 0.0, 0.03), (1.2, 0.162, 0.112, -0.004, 0.03),
               (1.3, 0.172, 0.118, -0.006, 0.12), (1.36, 0.172, 0.106, 0.0, 0.26), (1.405, 0.13, 0.086, 0.004, 0.4),
               (1.44, 0.078, 0.07, 0.006, 0.5)]
    bod = []
    for z in np.linspace(0.98, 1.44, 10):
        rx, ry, yo, g = table(bod_tab, z)
        bod.append(ring(z * h, rx * h, ry * h, yoff=yo * h, n=30, gap=g))
    rig.add("Chest", loft("coat_bodice", bod, closed=False, mat=wool), chain=torso_chain, width=0.08 * h)
    for idx in (0, -1):
        rig.add("Chest", tube(f"placket{idx}", [r[idx] for r in bod], 0.008 * h, segs=6, mat=wool, n=1),
                chain=torso_chain, width=0.08 * h)
    for i, z in enumerate(np.linspace(1.02, 1.28, 4)):
        for sx in (1, -1):
            rx, ry, yo, g = table(bod_tab, z)
            a = -PI / 2 + sx * 0.32
            p = V((math.cos(a) * (rx + 0.006) * h, math.sin(a) * (ry + 0.006) * h + yo * h, z * h))
            rig.add("Chest", ellipsoid(f"button{i}{sx}", p, (0.009 * h, 0.006 * h, 0.009 * h), segs=10, rings=6, mat=silver),
                    chain=torso_chain, width=0.08 * h)
    # standing collar with crimson inside
    col_rings, col_in = [], []
    for z, rx, ry, g in ((1.40, 0.095, 0.082, 0.62), (1.47, 0.088, 0.08, 0.55), (1.54, 0.098, 0.09, 0.5), (1.585, 0.112, 0.1, 0.48)):
        col_rings.append(ring(z * h, rx * h, ry * h, yoff=0.01 * h, n=26, gap=g))
        col_in.append(ring(z * h, (rx - 0.006) * h, (ry - 0.006) * h, yoff=0.01 * h, n=26, gap=g))
    rig.add("Chest", loft("collar", col_rings, closed=False, mat=wool), chain=["Chest", "Neck"], width=0.05 * h)
    rig.add("Chest", loft("collar_lining", col_in, closed=False, mat=lining, flip=True), chain=["Chest", "Neck"], width=0.05 * h)
    rig.add("Chest", tube("collar_rim", col_rings[-1], 0.006 * h, segs=6, mat=wool), chain=["Chest", "Neck"], width=0.05 * h)
    # belt
    rig.add("Spine", torus("belt", V((0, 0.0, 1.0 * h)), Z, 0.16 * h, 0.012 * h, mat=dark, scale=(1.08, 0.76, 1.6), maj=28, mnr=6),
            chain=torso_chain, width=0.08 * h)
    rig.add("Spine", box("buckle", V((0, -0.13 * h, 1.0 * h)), (0.05 * h, 0.012 * h, 0.04 * h), bevel=0.003, mat=silver),
            chain=torso_chain, width=0.08 * h)
    # flared skirt (Cloak), split at the front
    sk_tab = [(0.07, 0.30, 0.26, 0.02, 0.36), (0.3, 0.27, 0.22, 0.015, 0.3), (0.6, 0.22, 0.17, 0.01, 0.2),
              (0.85, 0.185, 0.13, 0.0, 0.08), (1.0, 0.172, 0.12, 0.0, 0.03)]
    sk, sk_in = [], []
    for z in np.linspace(0.07, 1.0, 14):
        rx, ry, yo, g = table(sk_tab, z)
        low = clamp((0.85 - z) / 0.78, 0, 1) ** 1.3
        rfn = (lambda a, low=low: 1.0 + 0.055 * low * math.sin(9 * a + 1.1) + 0.02 * low * math.sin(17 * a))
        zfn = (lambda a, low=low: low * (0.03 * math.sin(a) - 0.04 * h * max(0.0, math.sin(a))))
        sk.append(ring(z * h, rx * h, ry * h, yoff=yo * h, n=40, gap=g, rfn=rfn, zfn=zfn))
        sk_in.append(ring(z * h, rx * h * 0.975, ry * h * 0.975, yoff=yo * h, n=40, gap=g, rfn=rfn, zfn=zfn))
    rig.add("Cloak", loft("coat_skirt", sk, closed=False, mat=wool))
    rig.add("Cloak", loft("coat_lining", sk_in, closed=False, mat=lining, flip=True))
    rig.add("Cloak", tube("hem", sk[0], 0.007 * h, segs=6, mat=wool, cap=False))
    for idx in (0, -1):
        rig.add("Cloak", tube(f"skirt_edge{idx}", [r[idx] for r in sk], 0.0075 * h, segs=6, mat=lining))
    # pocket flaps (hips + small chest pockets)
    for sx in (1, -1):
        for z, a_off, w, dz in ((0.84, 0.95, 0.26, 0.05), (1.24, 0.75, 0.16, 0.03)):
            tabx = sk_tab if z < 1.0 else bod_tab
            ac = -PI / 2 + sx * a_off
            pr = []
            for zz in (z, z + dz):
                rx, ry, yo = table(tabx, zz)[:3]
                pr.append([V((math.cos(a) * (rx + 0.01) * h, math.sin(a) * (ry + 0.01) * h + yo * h, zz * h))
                           for a in np.linspace(ac - w, ac + w, 6)])
            bone = "Cloak" if z < 1.0 else "Chest"
            rig.add(bone, loft(f"flap{sx}{z}", pr, closed=False, mat=wool))

    # ---- sleeves with deep crimson-lined cuffs, long pale hands
    def sleeve(side, sh, el, wr, f):
        sx = 1 if side == "L" else -1
        pts = [V((sx * 0.1 * h, 0, 1.385 * h)), sh - V((0, 0, 0.008 * h)), (sh + el) / 2, el, (el + wr) / 2, wr - f * 0.035 * h]
        rig.add(f"Arm{side}", tube(f"sleeve{side}", pts, [0.048 * h, 0.054 * h, 0.051 * h, 0.05 * h, 0.046 * h, 0.044 * h],
                                   segs=14, mat=wool, n=3),
                chain=[f"Shoulder{side}", f"Arm{side}", f"Forearm{side}"], width=0.05 * h)
        d = (wr - el).normalized()
        a, b = wr - d * 0.11 * h, wr + d * 0.005 * h
        e1 = d.cross(Z if abs(d.dot(Z)) < 0.9 else X).normalized()
        e2 = d.cross(e1)
        cr, ci = [], []
        for t, r in ((0.0, 0.052), (1.0, 0.064)):
            cen = a.lerp(b, t)
            cr.append([cen + (e1 * math.cos(q) + e2 * math.sin(q)) * r * h for q in np.linspace(0, TAU, 20, endpoint=False)])
            ci.append([cen + (e1 * math.cos(q) + e2 * math.sin(q)) * (r - 0.006) * h for q in np.linspace(0, TAU, 20, endpoint=False)])
        cuff = loft(f"cuff{side}", cr, mat=wool)
        rig.add(f"Forearm{side}", cuff)
        rig.add(f"Forearm{side}", loft(f"cuff_lining{side}", ci, mat=lining, flip=True))
        rig.add(f"Forearm{side}", tube(f"wrist{side}", [wr - d * 0.06 * h, wr + d * 0.01 * h], 0.032 * h, segs=10, mat=skin))

    sleeve("R", shR, elR, wrR, fR)
    sleeve("L", shL, elL, wrL, fL)
    hs = 1.0 * h
    make_hand(rig, "R", wrR, fR, nR, hs, skin, curl=(1.35, 1.4, 0.9), spread=0.0, thumb_curl=0.6, length=1.1)
    make_hand(rig, "L", wrL, fL, nL, hs, skin, curl=(1.0, 1.1, 0.8), spread=0.0, thumb_curl=0.5, length=1.12)

    # ---- trousers + soft felt boots
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an, toe = legs[side]
        rig.add(f"Thigh{side}", tube(f"leg{side}", [hip + V((0, 0, 0.05 * h)), hip, kn, an + V((0, 0, 0.12 * h))],
                                     [0.07 * h, 0.07 * h, 0.055 * h, 0.048 * h], segs=12, mat=dark, n=2),
                chain=["Pelvis", f"Thigh{side}", f"Shin{side}"], width=0.05 * h)
        rig.add(f"Shin{side}", tube(f"boot_shaft{side}", [an + V((0, 0, -0.04 * h)), an + V((0, 0, 0.09 * h)), an + V((0, 0.004 * h, 0.2 * h))],
                                    [0.05 * h, 0.052 * h, 0.056 * h], segs=14, mat=felt, n=2), chain=[f"Shin{side}", f"Foot{side}"],
                width=0.04 * h)
        fc = V((an.x + sx * 0.004 * h, -0.055 * h, 0.042 * h))

        def bootdef(p):
            if p.z < -0.042 * h:
                p.z = -0.042 * h
            if p.y < -0.06 * h:
                p.z *= 0.85
            return p

        rig.add(f"Foot{side}", ellipsoid(f"boot{side}", fc, (0.048 * h, 0.14 * h, 0.05 * h), segs=16, rings=10, mat=felt, deform=bootdef))

    # ---- tall hooked lamp-pole (PropR) with caged oil lantern (Lantern)
    palm_c, axes, _, _, _ = hand_joints(wrR, fR, nR, "R", hs)
    grip = wrR + fR * 0.06 * hs + nR * 0.028 * hs
    px, py = grip.x, grip.y
    top = 2.30
    pole = [V((px, py, 0.0)), V((px, py, 1.0)), V((px, py, top)), V((px - 0.02, py, top + 0.09)), V((px - 0.11, py, top + 0.14)),
            V((px - 0.2, py, top + 0.11)), V((px - 0.235, py, top + 0.04))]
    rig.add("PropR", tube("pole", pole, [0.012, 0.0135, 0.0135, 0.012, 0.011, 0.01, 0.009], segs=10, mat=silver, n=4), figure=False)
    rig.add("PropR", cylinder("pole_ferrule", V((px, py, 0.0)), V((px, py, 0.05)), 0.009, 0.016, verts=10, mat=silver), figure=False)
    for z in (1.25, 1.6, top - 0.02):
        rig.add("PropR", torus(f"pole_knot{z}", V((px, py, z)), Z, 0.016, 0.006, mat=silver, maj=14, mnr=6), figure=False)
    hook = V((px - 0.235, py, top + 0.03))
    rig.add("PropR", ellipsoid("hook_tip", hook, (0.014,) * 3, segs=10, rings=6, mat=silver), figure=False)
    lt = hook + V((0, 0, -0.05))
    lb = lt + V((0, 0, -0.22))
    rig.add("Lantern", torus("lantern_ring", hook + V((0, 0, -0.02)), X, 0.018, 0.0035, mat=silver, maj=14, mnr=5), figure=False)
    rig.add("Lantern", K.make_lathe("lantern_cap", [(0.0, 0.06), (0.02, 0.058), (0.045, 0.03), (0.06, 0.01)], segments=16,
                                    mat=silver, center=tuple(lt + V((0, 0, -0.06)))), figure=False)
    rig.add("Lantern", K.make_lathe("lantern_base", [(0.0, 0.035), (0.015, 0.055), (0.035, 0.058), (0.04, 0.05)], segments=16,
                                    mat=silver, center=tuple(lb)), figure=False)
    rig.add("Lantern", K.make_lathe("lantern_glass", [(0.0, 0.04), (0.05, 0.05), (0.11, 0.046), (0.14, 0.032)], segments=16,
                                    mat=lampglass, center=tuple(lb + V((0, 0, 0.035)))), figure=False)
    rig.add("Lantern", ellipsoid("flame", lb + V((0, 0, 0.09)), (0.014, 0.014, 0.03), segs=10, rings=8, mat=flame,
                                 deform=lambda p: V((p.x * (1 - max(0, p.z) * 18), p.y * (1 - max(0, p.z) * 18), p.z))), figure=False)
    for i in range(6):
        a = i * TAU / 6
        o = V((math.cos(a) * 0.058, math.sin(a) * 0.058, 0))
        rig.add("Lantern", tube(f"cage{i}", [lb + o + V((0, 0, 0.035)), lb + o * 1.05 + V((0, 0, 0.1)), lt + o * 0.95 + V((0, 0, -0.06))],
                                0.0035, segs=5, mat=silver, n=2), figure=False)
    # folded polishing cloth draped over the left hand
    pc = wrL + fL * 0.085 * hs + nL * 0.03 * hs
    side_ax = nL.cross(fL).normalized()
    cl = []
    for t in np.linspace(-1, 1, 11):
        dz = -0.17 * (1 - math.cos(t * PI / 2)) + 0.025
        dy = 0.035 * t
        cl.append([pc + side_ax * w * (1 - 0.15 * abs(t)) + nL * (dy + 0.009 * math.sin(w * 110 + t * 4)) + V((0, 0, dz))
                   for w in np.linspace(-0.055, 0.055, 7)])
    rig.add("PropL", loft("cloth", [list(r) for r in zip(*cl)], closed=False, mat=cloth), figure=False)

    extras = {
        "Cloak": ("Pelvis", (0, 0, 1.0 * h), (0, 0, 0.4 * h)),
        "PropR": ("HandR", tuple(grip), tuple(grip + V((0, 0, 0.3)))),
        "PropL": ("HandL", tuple(wrL + fL * 0.05 * hs), tuple(pc + V((0, 0, -0.15)))),
        "Lantern": ("PropR", tuple(hook), tuple(lb)),
    }
    return rig.finish(B, extras, bg="#1a1620", sheet_top=2.2)


# ===========================================================================
# 9. SORAYA BENALI - Geometer of the Tiled Dome (1.70 m)
# ===========================================================================

def build_soraya():
    rng = random.Random(9)
    H = 1.70
    h = H / 1.72 * 0.96
    rig = Rig("soraya", H)
    skin = M("Soraya_Skin", "#a8734f", roughness=0.45)
    mats = {
        "skin": skin,
        "eye": M("Soraya_EyeWhite", "#f3ece4", roughness=0.15),
        "iris": M("Soraya_Iris", "#3b2414", roughness=0.08, coat_weight=0.8),
        "pupil": M("Soraya_Pupil", "#0a0605", roughness=0.1),
        "brow": M("Soraya_Brow", "#1d130e", roughness=0.7),
        "lip": M("Soraya_Lip", "#8c4a3c", roughness=0.35),
        "mouth": M("Soraya_Mouth", "#4a2620", roughness=0.6),
    }
    wrap = M("Soraya_Wrap", "#0f766e", pack="soraya", uv=6, ns=0.6, roughness=0.5, double_sided=True)
    tunic = M("Soraya_Tunic", "#efe3cc", pack="vesper", uv=7, ns=0.5)
    indigo = M("Soraya_Indigo", "#1f4e79", pack="vesper", uv=6, ns=0.7)
    robe = M("Soraya_Robe", "#e8a33d", albedo_path=gen_robe("soraya_robe"), pack="soraya", uv=1.0, ns=0.35, double_sided=True)
    gold = M("Soraya_Gold", "#f2b866", pack="_shared_brass", metallic=0.9, uv=8, ns=0.4)
    brass = M("Soraya_Brass", "#c9973c", pack="_shared_brass", albedo=True, metallic=1.0, uv=8, tint=0.3)
    leather = M("Soraya_Leather", "#7a4a2a", pack="_shared_wood", uv=6, ns=0.5, roughness=0.6, double_sided=True)
    wood = M("Soraya_Wood", "#8a5a33", pack="_shared_wood", albedo=True, uv=12, tint=0.3)
    steel = M("Soraya_Steel", "#8b9096", roughness=0.35, metallic=1.0)
    chalk = M("Soraya_Chalk", "#d8c3ad", roughness=0.95)
    zellige = K.make_pbr_material("Soraya_Zellige", "#0f766e", roughness=0.08, coat_weight=1.0, emission_color="#5ff0d8",
                                  emission_strength=2.6)
    zellige_w = K.make_pbr_material("Soraya_ZelligeWhite", "#fff3dc", roughness=0.08, coat_weight=1.0,
                                    emission_color="#f2b866", emission_strength=2.0)

    B = std_bones(h)
    shR, elR = V((-0.18 * h, 0.0, 1.38 * h)), V((-0.33 * h, -0.08 * h, 1.30 * h))
    wrR = V((-0.37 * h, -0.20 * h, 1.47 * h))
    fR = V((-0.05, -0.6, 0.8)).normalized()
    nR = frame_from(fR, V((0.7, -0.2, -0.3)))[1]
    tipR = wrR + fR * 0.1 * h
    shL, elL = V((0.18 * h, 0.0, 1.38 * h)), V((0.34 * h, 0.06 * h, 1.15 * h))
    wrL = V((0.235 * h, -0.02 * h, 0.995 * h))
    fL = V((-0.35, -0.55, -0.75)).normalized()
    nL = frame_from(fL, V((-1.0, 0.1, 0.2)))[1]
    tipL = wrL + fL * 0.1 * h
    set_arm(B, "R", shR, elR, wrR, tipR, 1.38 * h)
    set_arm(B, "L", shL, elL, wrL, tipL, 1.38 * h)
    legs = {}
    for side, sx in (("L", 1), ("R", -1)):
        legs[side] = (V((sx * 0.095 * h, 0, 0.9 * h)), V((sx * 0.105 * h, -0.01 * h, 0.48 * h)),
                      V((sx * 0.115 * h, 0.01 * h, 0.085 * h)), V((sx * 0.135 * h, -0.15 * h, 0.02 * h)))
        set_leg(B, side, *legs[side])
    torso_chain = ["Pelvis", "Spine", "Chest"]

    # ---- fitted cream tunic to mid-thigh
    tun_tab = [(0.70, 0.19, 0.135, 0.01), (0.82, 0.18, 0.125, 0.01), (0.95, 0.168, 0.115, 0.008), (1.05, 0.14, 0.096, 0.0),
               (1.15, 0.148, 0.1, -0.004), (1.25, 0.162, 0.114, -0.016), (1.32, 0.164, 0.108, -0.01), (1.375, 0.166, 0.095, 0.0),
               (1.415, 0.118, 0.074, 0.004), (1.445, 0.058, 0.055, 0.006)]
    tr = []
    for z in np.linspace(0.70, 1.445, 15):
        rx, ry, yo = table(tun_tab, z)
        low = clamp((0.9 - z) / 0.2, 0, 1)
        tr.append(ring(z * h, rx * h, ry * h, yoff=yo * h, n=30, rfn=lambda a, low=low: 1 + 0.03 * low * math.sin(8 * a)))
    rig.add("Chest", loft("tunic", tr, mat=tunic, cap_start=True), chain=torso_chain, width=0.08 * h)
    rig.add("Chest", torus("tunic_neck", V((0, 0.003 * h, 1.432 * h)), Z, 0.062 * h, 0.006 * h, mat=gold, maj=24, mnr=5))
    rig.add("Chest", tube("tunic_placket", [V((0, -0.118 * h, 1.27 * h)), V((0, -0.098 * h, 1.36 * h)), V((0, -0.062 * h, 1.425 * h))],
                          0.004 * h, segs=5, mat=gold, n=2), chain=torso_chain, width=0.08 * h)
    rig.add("Pelvis", tube("tunic_hem", tr[0], 0.006 * h, segs=5, mat=gold, cap=False), chain=torso_chain, width=0.08 * h)

    # ---- head + teal head wrap
    s = 1.02 * h
    c = V((0, 0.0, 1.60 * h - 0.008 * s))
    parts = human_head(rig, c, s, mats, jaw_taper=0.72, cheek=1.1, ear=0.9, lip_scale=0.78)
    set_face(B, c, s, (0, 0, 1.42 * h))
    for sx in (1, -1):
        pts = [c + V((sx * 0.02 * s, -0.109 * s, 0.033 * s)), c + V((sx * 0.04 * s, -0.107 * s, 0.040 * s)),
               c + V((sx * 0.06 * s, -0.096 * s, 0.033 * s))]
        rig.add("Head", tube(f"strong_brow{sx}", pts, [0.0068 * s, 0.0075 * s, 0.004 * s], segs=8, mat=mats["brow"], n=2))
    for k, (x, z, w) in enumerate(((0.07, -0.034, 0.015), (0.083, -0.026, 0.009))):
        nrm = V((x / 0.106, -0.55, 0)).normalized()
        rig.add("Head", ellipsoid(f"chalk_smudge{k}", c + V((x * s, -0.088 * s + abs(x - 0.066) * 0.4 * s, z * s)),
                                  (w * s, 0.0025 * s, 0.0045 * s), axes=(nrm.cross(Z).normalized(), nrm, Z), segs=10, rings=6, mat=chalk))
    for sx in (1, -1):
        rig.add("Head", torus(f"earring{sx}", c + V((sx * 0.108 * s, -0.008 * s, -0.05 * s)), X, 0.012 * s, 0.0018 * s, mat=gold,
                              maj=16, mnr=5))
    rig.add("Neck", tube("neck", [V((0, 0.006 * h, 1.40 * h)), V((0, 0.004 * h, 1.47 * h)), c + V((0, 0.01 * s, -0.07 * s))],
                         [0.047 * h, 0.044 * h, 0.043 * h], segs=14, mat=skin), chain=["Chest", "Neck", "Head"], width=0.04 * h)

    wsc, woff = (1.13, 1.12, 1.1), (0, 0.01, 0.012)

    def wrap_line(phi):
        return 0.05 - 0.22 * (abs(phi) / PI) ** 1.6

    def wrap_shape(q):
        if q.z > 0.02 * s:
            q.z = 0.02 * s + (q.z - 0.02 * s) * 1.12
            q.y += (q.z - 0.02 * s) * 0.18
        return q

    rig.add("Head", hair_cap("wrap", c, s, wrap, wrap_line, scale=wsc, offset=woff, strands=7, amp=0.02, lumps=0.022,
                             extra=wrap_shape))
    for i, (z0, tilt) in enumerate(((0.035, 0.028), (0.072, -0.022), (0.105, 0.02))):
        path = [(ph, z0 + tilt * math.cos(ph) + 0.03 * (1 - math.cos(ph)) * 0.5, 1.03) for ph in np.linspace(-PI, PI, 21)]
        pts = [wrap_shape(cap_point(c, s, ph, z, scale=wsc, offset=woff, out=o) - c) + c for ph, z, o in path]
        rig.add("Head", tube(f"wrap_fold{i}", pts, 0.0095 * s, segs=7, mat=wrap, cap=False))
    knot = c + V((0.02 * s, 0.10 * s, 0.11 * s))
    rig.add("Head", ellipsoid("wrap_knot", knot, (0.045 * s, 0.04 * s, 0.035 * s), segs=14, rings=10, mat=wrap,
                              deform=lambda p: p * (1 + 0.15 * math.sin(math.atan2(p.y, p.x) * 3))))
    tail = [knot + V((0, 0.015 * s, -0.02 * s)), knot + V((0.01 * s, 0.05 * s, -0.12 * s)), c + V((0.03 * s, 0.12 * s, -0.25 * s)),
            c + V((0.05 * s, 0.13 * s, -0.36 * s))]
    tl = []
    for i, p in enumerate(spline(tail, 3)):
        w = (0.035 - 0.012 * i / 9) * s
        tl.append([p + V((-w, 0, 0)), p + V((0, 0.008 * s, 0)), p + V((w, 0, 0))])
    rig.add("Head", loft("wrap_tail", tl, closed=False, mat=wrap))

    # ---- wide indigo trousers + leather babouche slippers
    pel = [ring(z * h, rx * h, ry * h, yoff=0.006 * h, n=28) for z, rx, ry in
           ((0.76, 0.16, 0.12), (0.86, 0.175, 0.125), (0.98, 0.17, 0.118), (1.04, 0.15, 0.104))]
    rig.add("Pelvis", loft("trouser_hip", pel, mat=indigo, cap_start=True), chain=["Pelvis", "Spine"], width=0.08 * h)
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an, toe = legs[side]
        lrings = []
        pts = spline([hip + V((0, 0, 0.06 * h)), hip, kn, an + V((0, 0, 0.03 * h))], 3)
        rads = spline_vals([0.088, 0.095, 0.112, 0.128], 3)
        for i, (p, r) in enumerate(zip(pts, rads)):
            fold = i / (len(pts) - 1)
            lrings.append(ring(p.z, r * h, r * h * 0.92, xoff=p.x, yoff=p.y, n=20,
                               rfn=lambda a, fold=fold: 1 + 0.06 * fold * math.sin(5 * a + fold * 4)))
        lrings.reverse()
        rig.add(f"Thigh{side}", loft(f"trouser{side}", lrings, mat=indigo, cap_end=True),
                chain=["Pelvis", f"Thigh{side}", f"Shin{side}"], width=0.06 * h)
        fc = V((an.x + sx * 0.008 * h, -0.05 * h, 0.035 * h))

        def slipdef(p):
            if p.z < -0.035 * h:
                p.z = -0.035 * h
            if p.y < -0.07 * h:
                p.z = p.z * 0.7 + 0.008 * h
            return p

        rig.add(f"Foot{side}", ellipsoid(f"slipper{side}", fc, (0.046 * h, 0.14 * h, 0.042 * h), segs=16, rings=10, mat=leather,
                                         deform=slipdef))
        rig.add(f"Shin{side}", tube(f"ankle{side}", [an + V((0, 0, -0.04 * h)), an + V((0, 0, 0.05 * h))], 0.035 * h, segs=10, mat=skin))

    # ---- open saffron-and-ochre over-robe with embroidered borders
    robe_tab = [  # z, rx, ry, yoff, gap
        (0.08, 0.30, 0.24, 0.03, 0.78), (0.35, 0.26, 0.20, 0.025, 0.68), (0.65, 0.225, 0.165, 0.02, 0.6),
        (0.9, 0.205, 0.145, 0.015, 0.56), (1.05, 0.188, 0.135, 0.01, 0.5), (1.2, 0.188, 0.135, 0.0, 0.5),
        (1.32, 0.198, 0.13, -0.004, 0.52), (1.385, 0.205, 0.118, 0.0, 0.56), (1.425, 0.15, 0.092, 0.008, 0.62),
        (1.455, 0.085, 0.074, 0.012, 0.72)]
    rr = []
    for z in np.linspace(0.08, 1.455, 18):
        rx, ry, yo, g = table(robe_tab, z)
        low = clamp((1.0 - z) / 0.9, 0, 1)
        rr.append(ring(z * h, rx * h, ry * h, yoff=yo * h, n=40, gap=g,
                       rfn=lambda a, low=low: 1 + 0.05 * low * math.sin(8 * a + 0.4) + 0.015 * low * math.sin(15 * a),
                       zfn=lambda a, low=low: -0.025 * h * low * max(0.0, math.sin(a))))
    rig.add("Cloak", loft("robe", rr, closed=False, mat=robe, uv_norm=True))
    for idx in (0, -1):
        rig.add("Cloak", tube(f"robe_trim{idx}", [r[idx] for r in rr], 0.0065 * h, segs=6, mat=gold))
    rig.add("Cloak", tube("robe_hem", rr[0], 0.0065 * h, segs=6, mat=gold, cap=False))
    rig.add("Chest", tube("robe_collar", rr[-1], 0.012 * h, segs=8, mat=robe, cap=False), chain=torso_chain, width=0.08 * h)

    # ---- sleeves: fitted cream undersleeve + saffron bell over-sleeve with border at the cuff
    def sleeves(side, sh, el, wr, f):
        sx = 1 if side == "L" else -1
        d = (wr - el).normalized()
        chain = [f"Shoulder{side}", f"Arm{side}", f"Forearm{side}"]
        rig.add(f"Arm{side}", tube(f"undersleeve{side}", [V((sx * 0.11 * h, 0, 1.40 * h)), sh, el, wr - d * 0.01 * h],
                                   [0.05 * h, 0.052 * h, 0.044 * h, 0.034 * h], segs=12, mat=tunic, n=3), chain=chain, width=0.05 * h)
        pts = [V((sx * 0.13 * h, 0, 1.415 * h)), sh + V((0, 0, 0.015 * h)), (sh + el) / 2, el, el + d * 0.12 * h]
        ob = tube(f"oversleeve{side}", pts, [0.06 * h, 0.066 * h, 0.064 * h, 0.07 * h, 0.088 * h], segs=16, mat=robe, n=3, cap=False)
        uvd = ob.data.uv_layers.active.data
        umax = max(dd.uv[0] for dd in uvd) or 1.0
        vmax = max(dd.uv[1] for dd in uvd) or 1.0
        for dd in uvd:
            uu, vv = dd.uv
            dd.uv = (0.1 + 0.8 * uu / umax, (1.0 - vv / vmax) * 0.9)
        rig.add(f"Arm{side}", ob, chain=chain, width=0.05 * h)
        rig.add(f"Forearm{side}", torus(f"sleeve_cuff{side}", el + d * 0.12 * h, d, 0.088 * h, 0.006 * h, mat=gold, maj=24, mnr=5),
                chain=chain, width=0.05 * h)
        rig.add(f"Forearm{side}", tube(f"wrist{side}", [wr - d * 0.07 * h, wr + d * 0.01 * h], 0.03 * h, segs=10, mat=skin))
        rig.add(f"Forearm{side}", torus(f"bangle{side}", wr - d * 0.04 * h, d, 0.033 * h, 0.004 * h, mat=gold, maj=18, mnr=5))

    sleeves("R", shR, elR, wrR, fR)
    sleeves("L", shL, elL, wrL, fL)
    hs = 0.95 * h
    make_hand(rig, "R", wrR, fR, nR, hs, skin, curl=(1.2, 1.3, 0.8), spread=0.0, thumb_curl=0.5)
    make_hand(rig, "L", wrL, fL, nL, hs, skin, curl=(0.25, 0.3, 0.2), spread=0.06, thumb_curl=0.1)

    # ---- leather tool sash, shoulder bag, hammer, compass, chalk reel
    rig.add("Spine", loft("sash", [ring(z * h, (0.148 + dz) * h, (0.104 + dz) * h, n=30) for z, dz in ((0.985, 0.008), (1.035, 0.006))],
                          mat=leather), chain=torso_chain, width=0.08 * h)
    rig.add("Spine", box("sash_buckle", V((0.0, -0.116 * h, 1.01 * h)), (0.04 * h, 0.008 * h, 0.04 * h), bevel=0.003, mat=brass),
            chain=torso_chain, width=0.08 * h)
    # strap from left shoulder across the chest to the bag at the right hip
    strap = [V((0.13 * h, 0.07 * h, 1.43 * h)), V((0.12 * h, -0.06 * h, 1.40 * h)), V((0.03 * h, -0.13 * h, 1.24 * h)),
             V((-0.1 * h, -0.13 * h, 1.08 * h)), V((-0.19 * h, -0.07 * h, 0.95 * h))]
    sp = spline(strap, 3)
    sr = []
    for i, p in enumerate(sp):
        t = (sp[min(i + 1, len(sp) - 1)] - sp[max(i - 1, 0)]).normalized()
        out = (p - V((0, 0, p.z))).normalized()
        side_v = t.cross(out).normalized() * 0.014 * h
        sr.append([p - side_v + out * 0.006 * h, p + side_v + out * 0.006 * h])
    rig.add("Chest", loft("bag_strap", [list(x) for x in zip(*sr)], closed=False, mat=leather), chain=torso_chain, width=0.1 * h)
    bag_c = V((-0.205 * h, -0.03 * h, 0.9 * h))
    bag_ax = (V((-0.3, -0.95, 0)).normalized(), V((0.95, -0.3, 0)).normalized(), Z)
    rig.add("Pelvis", box("bag", bag_c, (0.17 * h, 0.06 * h, 0.13 * h), axes=bag_ax, bevel=0.014, mat=leather))
    rig.add("Pelvis", box("bag_flap", bag_c + V((0, 0, 0.04 * h)) - bag_ax[1] * 0.033 * h, (0.172 * h, 0.012 * h, 0.08 * h),
                          axes=bag_ax, bevel=0.008, mat=leather))
    rig.add("Pelvis", ellipsoid("bag_clasp", bag_c + V((0, 0, 0.01 * h)) - bag_ax[1] * 0.042 * h, (0.012 * h, 0.006 * h, 0.012 * h),
                                segs=10, rings=6, mat=brass))
    # tile hammer (menqash) hung at the front-left of the sash
    hh = V((0.11 * h, -0.115 * h, 0.99 * h))
    rig.add("Pelvis", tube("hammer_handle", [hh, hh + V((0.01 * h, -0.02 * h, -0.17 * h))], 0.009 * h, segs=8, mat=wood))
    hd = hh + V((0.012 * h, -0.024 * h, -0.19 * h))
    rig.add("Pelvis", cylinder("hammer_head", hd - V((0.055 * h, 0, 0)), hd + V((0.055 * h, 0, 0)), 0.012 * h, 0.012 * h, verts=8, mat=steel))
    for sx in (1, -1):
        rig.add("Pelvis", cylinder(f"hammer_point{sx}", hd + V((sx * 0.055 * h, 0, 0)), hd + V((sx * 0.08 * h, 0, 0.01 * h)),
                                   0.012 * h, 0.002 * h, verts=8, mat=steel))
    # brass compass at the front-right
    cc = V((-0.06 * h, -0.122 * h, 0.98 * h))
    rig.add("Pelvis", cylinder("compass_hinge", cc, cc + V((0, -0.012 * h, 0)), 0.013 * h, 0.013 * h, verts=12, mat=brass))
    for sx in (1, -1):
        rig.add("Pelvis", cylinder(f"compass_leg{sx}", cc + V((0, -0.006 * h, -0.006 * h)), cc + V((sx * 0.035 * h, -0.006 * h, -0.13 * h)),
                                   0.0045 * h, 0.0012 * h, verts=6, mat=brass))
    rig.add("Pelvis", cylinder("chalk_reel", V((0.045 * h, -0.12 * h, 0.965 * h)), V((0.045 * h, -0.14 * h, 0.965 * h)), 0.022 * h,
                               0.022 * h, verts=14, mat=wood))

    # ---- brass conductor's baton topped with a glowing zellige star (PropR)
    palm_c, axes, _, _, _ = hand_joints(wrR, fR, nR, "R", hs)
    grip = wrR + fR * 0.06 * hs + nR * 0.02 * hs
    bd = (V((-0.18, -0.75, 0.62))).normalized()
    b0 = grip - bd * 0.06
    b1 = grip + bd * 0.30
    rig.add("PropR", tube("baton", [b0, grip, b1], [0.006, 0.0055, 0.0032], segs=8, mat=brass), figure=False)
    rig.add("PropR", ellipsoid("baton_pommel", b0, (0.009,) * 3, segs=10, rings=6, mat=brass), figure=False)
    sax0 = bd.cross(Z).normalized()
    sax1 = sax0.cross(bd).normalized()
    star_c = b1 + bd * 0.022
    rig.add("PropR", star_prism("zellige_star", star_c, (sax0, bd, -sax1), 0.03, 0.017, 0.012, 8, mat=zellige), figure=False)
    rig.add("PropR", star_prism("zellige_core", star_c - sax1 * 0.0, (sax0, bd, -sax1), 0.012, 0.007, 0.016, 8, mat=zellige_w),
            figure=False)

    extras = {
        "Cloak": ("Chest", (0, 0, 1.40 * h), (0, 0, 0.6 * h)),
        "PropR": ("HandR", tuple(grip), tuple(b1)),
    }
    return rig.finish(B, extras, bg="#1d1433")


# ===========================================================================
# 10. DEX ARCLIGHT - Light-Show Rigger (1.74 m)
# ===========================================================================

def build_dex():
    rng = random.Random(10)
    H = 1.74
    h = H / 1.72 * 0.96
    rig = Rig("dex", H)
    skin = M("Dex_Skin", "#b07a55", roughness=0.45)
    mats = {
        "skin": skin,
        "eye": M("Dex_EyeWhite", "#f2ede8", roughness=0.15),
        "iris": M("Dex_Iris", "#2e1c12", roughness=0.08, coat_weight=0.8),
        "pupil": M("Dex_Pupil", "#080506", roughness=0.1),
        "brow": M("Dex_Brow", "#140e10", roughness=0.7),
        "lip": M("Dex_Lip", "#8a5444", roughness=0.4),
        "mouth": M("Dex_Mouth", "#4a2a24", roughness=0.6),
    }
    hair = M("Dex_Hair", "#1d1724", roughness=0.55, pack="vesper", ns=0.5, uv=14)
    stubble = M("Dex_Stubble", "#3a2a24", pack="juno", uv=30, ns=0.6, roughness=0.8)
    streak = K.make_pbr_material("Dex_Streak", "#ff2a85", roughness=0.35, emission_color="#ff2a85", emission_strength=0.8)
    holo = M("Dex_Holo", "#ff2a85", albedo_path=gen_holo("dex_holo"), pack="dex", uv=1.1, ns=0.35, metallic=0.45, coat_weight=0.8,
             coat_roughness=0.05, rough=False, roughness=0.22, double_sided=True)
    suit = M("Dex_Suit", "#16161f", pack="dex", uv=4, ns=0.8, roughness=0.42, coat_weight=0.3)
    rib = M("Dex_Rib", "#12001a", pack="vesper", uv=14, ns=1.2)
    piping = K.make_pbr_material("Dex_Piping", "#f5f5f5", roughness=0.15, metallic=0.6, emission_color="#e9f6ff", emission_strength=0.5)
    webbing = M("Dex_Webbing", "#1c1a24", pack="vesper", uv=12, ns=0.9, double_sided=True)
    metal = M("Dex_Metal", "#c9ccd2", roughness=0.2, metallic=1.0)
    visor = K.make_pbr_material("Dex_Visor", "#0b0b14", roughness=0.05, metallic=0.3, coat_weight=1.0, coat_roughness=0.02)
    cyan = glow("Dex_Cyan", "#00e5ff", 3.5)
    magenta = glow("Dex_Magenta", "#ff2a85", 3.5)
    boot = M("Dex_Boot", "#15151c", pack="dex", uv=6, ns=0.6, roughness=0.5)
    tape = M("Dex_Tape", "#6b6d75", pack="vesper", uv=10, ns=0.6)
    scar = M("Dex_Scar", "#c98a78", roughness=0.25)
    glass = K.make_pbr_material("Dex_Prism", "#9fefff", roughness=0.04, emission_color="#5fe6ff", emission_strength=1.6, alpha=0.6)

    B = std_bones(h)
    shR, elR = V((-0.195 * h, 0.0, 1.38 * h)), V((-0.315 * h, 0.03 * h, 1.15 * h))
    wrR = V((-0.27 * h, -0.17 * h, 1.24 * h))
    fR = V((0.25, -0.95, 0.15)).normalized()
    nR = frame_from(fR, V((0.0, 0.0, 1.0)))[1]
    tipR = wrR + fR * 0.1 * h
    shL, elL = V((0.195 * h, 0.0, 1.38 * h)), V((0.30 * h, 0.02 * h, 1.12 * h))
    wrL = V((0.335 * h, -0.025 * h, 0.885 * h))
    fL = V((0.04, -0.15, -1.0)).normalized()
    nL = frame_from(fL, V((-1.0, 0.0, 0.0)))[1]
    tipL = wrL + fL * 0.1 * h
    set_arm(B, "R", shR, elR, wrR, tipR, 1.38 * h)
    set_arm(B, "L", shL, elL, wrL, tipL, 1.38 * h)
    legs = {}
    for side, sx in (("L", 1), ("R", -1)):
        legs[side] = (V((sx * 0.10 * h, 0, 0.9 * h)), V((sx * 0.135 * h, -0.015 * h, 0.49 * h)),
                      V((sx * 0.165 * h, 0.01 * h, 0.115 * h)), V((sx * 0.205 * h, -0.14 * h, 0.04 * h)))
        set_leg(B, side, *legs[side])
    torso_chain = ["Pelvis", "Spine", "Chest"]

    # ---- black technical bodysuit
    st = [(0.82, 0.155, 0.11, 0.004), (0.92, 0.17, 0.115, 0.006), (1.02, 0.148, 0.098, 0.0), (1.12, 0.152, 0.1, -0.004),
          (1.24, 0.172, 0.114, -0.01), (1.32, 0.178, 0.11, -0.006), (1.38, 0.18, 0.098, 0.0), (1.415, 0.125, 0.076, 0.004),
          (1.45, 0.06, 0.056, 0.006)]
    rig.add("Chest", loft("suit_torso", [ring(z * h, rx * h, ry * h, yoff=yo * h, n=28) for z, rx, ry, yo in st], mat=suit, cap_start=True),
            chain=torso_chain, width=0.07 * h)
    rig.add("Chest", torus("suit_collar", V((0, 0.004 * h, 1.44 * h)), Z, 0.062 * h, 0.009 * h, mat=suit, maj=24, mnr=6, scale=(1, 1, 1.8)))
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an, toe = legs[side]
        pts = [hip + V((0, 0, 0.06 * h)), hip, kn, an + V((0, 0, 0.1 * h))]
        rig.add(f"Thigh{side}", tube(f"suit_leg{side}", pts, [0.08 * h, 0.082 * h, 0.06 * h, 0.05 * h], segs=16, mat=suit, n=3),
                chain=["Pelvis", f"Thigh{side}", f"Shin{side}"], width=0.05 * h)
        out = V((sx, 0, 0))
        pp = [p + out * r * 1.0 for p, r in zip(spline(pts, 3), spline_vals([0.08 * h, 0.082 * h, 0.06 * h, 0.05 * h], 3))]
        rig.add(f"Thigh{side}", tube(f"piping{side}", pp[1:], 0.0045 * h, segs=5, mat=piping),
                chain=["Pelvis", f"Thigh{side}", f"Shin{side}"], width=0.05 * h)
        # heavy platform work boots with light-strip soles
        sole_c = V((an.x + sx * 0.012 * h, -0.05 * h, 0.03 * h))
        bax = (V((1, 0, 0)), V((0, 1, 0)), Z)
        rig.add(f"Foot{side}", box(f"sole{side}", sole_c, (0.11 * h, 0.3 * h, 0.06 * h), bevel=0.012, mat=boot))
        rig.add(f"Foot{side}", box(f"sole_light{side}", sole_c + V((0, 0, 0.004 * h)), (0.114 * h, 0.304 * h, 0.012 * h), bevel=0.004, mat=cyan))
        bc = V((an.x + sx * 0.008 * h, -0.06 * h, 0.085 * h))
        rig.add(f"Foot{side}", ellipsoid(f"boot_toe{side}", bc, (0.056 * h, 0.13 * h, 0.05 * h), segs=16, rings=10, mat=boot,
                                         deform=lambda p: V((p.x, p.y, max(p.z, -0.02 * h)))))
        rig.add(f"Shin{side}", tube(f"boot_shaft{side}", [an + V((0, 0, -0.03 * h)), an + V((0, 0.0, 0.08 * h)), an + V((0, 0.0, 0.17 * h))],
                                    [0.062 * h, 0.064 * h, 0.066 * h], segs=16, mat=boot, n=2), chain=[f"Shin{side}", f"Foot{side}"], width=0.04 * h)
        rig.add(f"Shin{side}", torus(f"boot_cuff{side}", an + V((0, 0, 0.17 * h)), Z, 0.066 * h, 0.011 * h, mat=boot, maj=18, mnr=6))
        for k in range(3):
            z = 0.05 + 0.04 * k
            rig.add(f"Shin{side}", tube(f"lace{side}{k}", [an + V((-0.03 * h, -0.062 * h, z * h)), an + V((0, -0.068 * h, (z + 0.01) * h)),
                                                           an + V((0.03 * h, -0.062 * h, z * h))], 0.0035 * h, segs=5, mat=cyan, n=2))
    rig.add("Pelvis", loft("suit_hip", [ring(z * h, rx * h, ry * h, yoff=0.006 * h, n=28) for z, rx, ry in
                                        ((0.8, 0.15, 0.11), (0.88, 0.168, 0.118), (0.96, 0.168, 0.115), (1.03, 0.148, 0.1))],
                           mat=suit, cap_start=True), chain=["Pelvis", "Spine"], width=0.08 * h)

    # ---- head: strong jaw, undercut + magenta streak, missing left brow (burn scar), visor pushed up
    s = 1.0 * h
    c = V((0, 0.0, 1.60 * h - 0.008 * s))
    parts = human_head(rig, c, s, mats, jaw_taper=0.84, cheek=0.9, ear=1.0, lip_scale=0.8)
    set_face(B, c, s, (0, 0, 1.42 * h))
    delete_verts(parts["brows"], lambda p: p.x > c.x + 0.005 * s)
    rig.add("Head", ellipsoid("brow_scar", c + V((0.04 * s, -0.104 * s, 0.036 * s)), (0.02 * s, 0.006 * s, 0.008 * s),
                              axes=(V((1, -0.35, 0.1)).normalized(), V((0.35, 1, 0)).normalized(), Z), segs=12, rings=6, mat=scar,
                              deform=lambda p: p * (1 + 0.2 * math.sin(p.x * 900))))
    rig.add("Neck", tube("neck", [V((0, 0.006 * h, 1.40 * h)), V((0, 0.004 * h, 1.47 * h)), c + V((0, 0.01 * s, -0.07 * s))],
                         [0.054 * h, 0.05 * h, 0.048 * h], segs=14, mat=skin), chain=["Chest", "Neck", "Head"], width=0.04 * h)
    # undercut: shaved band on the left, long top swept over to the right (-X) past the ear
    tsc, toff = (1.1, 1.08, 1.1), (0, 0.004, 0.01)

    def stub_lo(phi):
        return -0.02 - 0.06 * smooth01((phi - 1.9) / 0.6) + 0.045 * smooth01((1.05 - phi) / 0.3)

    rig.add("Head", hair_cap("stubble", c, s, stubble, stub_lo, top=lambda ph: 0.062 - 0.012 * smooth01((1.05 - ph) / 0.3),
                             scale=(1.025, 1.02, 1.02),
                             offset=(0, 0.002, 0.003), strands=0, amp=0.0, lumps=0.0, phi_range=(0.72, 2.95), n=22, m=6,
                             tuck=False))

    def top_line(phi):
        if phi < 0:
            return 0.05 - 0.11 * smooth01((-phi - 0.55) / 0.7)
        return 0.05 - 0.10 * smooth01((phi - 2.5) / 0.55)

    def top_shape(q):
        if q.z > 0.0:
            t = q.z / (0.13 * s)
            q.z *= 1.0 + 0.2 * t
            q.x -= 0.028 * s * t
        return q

    rig.add("Head", hair_cap("hair_top", c, s, hair, top_line, scale=tsc, offset=toff, strands=22, amp=0.03, lumps=0.02,
                             extra=top_shape))
    for i, (dp, dz, mat_i, rad) in enumerate(((0.0, 0.0, streak, 0.011), (0.22, -0.014, streak, 0.009), (-0.25, 0.008, hair, 0.013),
                                             (0.45, -0.03, hair, 0.012))):
        path = [(0.7 + dp, 0.112 + dz, 0.96), (0.05 + dp, 0.124 + dz, 0.985), (-0.65 + dp, 0.098 + dz, 0.995),
                (-1.25 + dp, 0.045 + dz, 0.99), (-1.6 + dp, -0.015 + dz, 0.975)]
        pts = [top_shape(cap_point(c, s, ph, z, scale=tsc, offset=toff, out=o) - c) + c for ph, z, o in path]
        rig.add("Head", tube(f"lock{i}", pts, [rad * s * 0.4, rad * s, rad * s, rad * s * 0.8, rad * s * 0.2], segs=7, mat=mat_i, n=3))
    rig.add("Head", torus("ear_cuff", c + V((0.108 * s, -0.004 * s, 0.012 * s)), X, 0.01 * s, 0.0022 * s, mat=metal, maj=14, mnr=5))

    # chunky wraparound HUD visor pushed up onto the brow
    one = (1.0, 1.0, 1.0)
    phis = list(np.linspace(-1.8, 1.8, 28))
    rows = ((0.04, 1.13), (0.058, 1.175), (0.084, 1.18), (0.104, 1.135))
    vr = [[cap_point(c, s, ph, z, scale=one, offset=(0, 0, 0), out=o) for ph in phis] for z, o in rows]
    vr_in = [[cap_point(c, s, ph, z, scale=one, offset=(0, 0, 0), out=o - 0.07) for ph in phis] for z, o in rows]
    rig.add("Head", loft("visor", vr, closed=False, mat=visor))
    rig.add("Head", loft("visor_in", vr_in, closed=False, mat=visor, flip=True))
    for k in (0, -1):
        rig.add("Head", loft(f"visor_end{k}", [[r[k] for r in vr], [r[k] for r in vr_in]], closed=False, mat=visor))
    rig.add("Head", tube("visor_rim_lo", vr[0], 0.004 * s, segs=5, mat=webbing))
    rig.add("Head", tube("visor_rim_hi", vr[-1], 0.004 * s, segs=5, mat=webbing))
    rig.add("Head", tube("hud_strip", [cap_point(c, s, ph, 0.07, scale=one, offset=(0, 0, 0), out=1.19)
                                       for ph in np.linspace(-1.35, 1.35, 20)], 0.0034 * s, segs=6, mat=cyan))
    for i in range(6):
        ph = -0.75 + i * 0.075
        p = cap_point(c, s, ph, 0.09, scale=one, offset=(0, 0, 0), out=1.185)
        nrm = V((math.sin(ph), -math.cos(ph), 0))
        rig.add("Head", box(f"hud_bar{i}", p, (0.006 * s, 0.003 * s, (0.005 + 0.003 * (i % 3)) * s), bevel=0.0005, mat=magenta,
                            axes=(nrm.cross(Z).normalized(), nrm, Z)))
    for sx in (1, -1):
        p = cap_point(c, s, sx * 1.78, 0.07, scale=one, offset=(0, 0, 0), out=1.12)
        rig.add("Head", ellipsoid(f"visor_pod{sx}", p, (0.02 * s, 0.03 * s, 0.032 * s), segs=12, rings=8, mat=webbing))
        rig.add("Head", ellipsoid(f"pod_led{sx}", p + V((sx * 0.018 * s, -0.008 * s, 0)), (0.003 * s, 0.007 * s, 0.007 * s), segs=8,
                                  rings=6, mat=cyan if sx > 0 else magenta))

    # ---- cropped oversized holographic bomber, open front
    jk_tab = [(1.06, 0.215, 0.15, 0.006, 0.32), (1.14, 0.228, 0.158, 0.0, 0.3), (1.25, 0.232, 0.16, -0.008, 0.32),
              (1.34, 0.232, 0.148, -0.004, 0.36), (1.395, 0.214, 0.128, 0.0, 0.42), (1.43, 0.15, 0.1, 0.006, 0.52),
              (1.455, 0.09, 0.08, 0.01, 0.6)]
    jr = []
    for z in np.linspace(1.06, 1.455, 12):
        rx, ry, yo, g = table(jk_tab, z)
        jr.append(ring(z * h, rx * h, ry * h, yoff=yo * h, n=36, gap=g, rfn=lambda a: 1 + 0.022 * abs(math.sin(6 * a))))
    rig.add("Chest", loft("jacket", jr, closed=False, mat=holo), chain=torso_chain, width=0.08 * h)
    band = []
    for z, k in ((1.0, 0.92), (1.06, 0.97)):
        rx, ry, yo, g = table(jk_tab, 1.06)
        band.append(ring(z * h, rx * h * k, ry * h * k, yoff=yo * h, n=36, gap=g))
    rig.add("Spine", loft("jacket_band", band, closed=False, mat=rib), chain=torso_chain, width=0.08 * h)
    rig.add("Chest", tube("jacket_collar", [p + V((0, 0, 0.004 * h)) for p in jr[-1]], 0.017 * h, segs=8, mat=rib),
            chain=torso_chain, width=0.08 * h)
    for idx in (0, -1):
        rig.add("Chest", tube(f"zip{idx}", [r[idx] for r in band[:1] + jr], 0.0055 * h, segs=6, mat=metal), chain=torso_chain, width=0.08 * h)
    rig.add("Chest", ellipsoid("jacket_patch", V((0.13 * h, -0.135 * h, 1.3 * h)), (0.03 * h, 0.004 * h, 0.03 * h),
                               axes=(V((1, -0.6, 0)).normalized(), V((0.6, 1, 0)).normalized(), Z), segs=12, rings=6, mat=magenta))

    # puffy sleeves + ribbed cuffs, fingerless gloves
    def sleeve(side, sh, el, wr, f):
        sx = 1 if side == "L" else -1
        d = (wr - el).normalized()
        pts = [V((sx * 0.12 * h, 0, 1.40 * h)), sh + V((0, 0, 0.015 * h)), (sh + el) / 2, el, (el + wr) / 2, wr - d * 0.04 * h]
        rig.add(f"Arm{side}", tube(f"sleeve{side}", pts, [0.065 * h, 0.082 * h, 0.078 * h, 0.072 * h, 0.066 * h, 0.058 * h],
                                   segs=16, mat=holo, n=3), chain=[f"Shoulder{side}", f"Arm{side}", f"Forearm{side}"], width=0.05 * h)
        rig.add(f"Forearm{side}", tube(f"sleeve_cuff{side}", [wr - d * 0.06 * h, wr - d * 0.005 * h], [0.05 * h, 0.046 * h], segs=12, mat=rib))
        rig.add(f"Forearm{side}", tube(f"wrist{side}", [wr - d * 0.03 * h, wr + d * 0.01 * h], 0.034 * h, segs=10, mat=skin))

    sleeve("R", shR, elR, wrR, fR)
    sleeve("L", shL, elL, wrL, fL)
    hs = 1.0 * h
    make_hand(rig, "R", wrR, fR, nR, hs, skin, glove=webbing, curl=(0.35, 0.45, 0.3), spread=0.1, thumb_curl=0.25)
    make_hand(rig, "L", wrL, fL, nL, hs, skin, glove=webbing, curl=(1.25, 1.35, 0.9), spread=0.0, thumb_curl=0.6)

    # ---- rigging harness: belt, chest straps, leg loops, carabiners, gaffer tape, coiled cable
    rig.add("Pelvis", loft("harness_belt", [ring(z * h, 0.162 * h, 0.115 * h, yoff=0.004 * h, n=30) for z in (0.95, 1.0)], mat=webbing),
            chain=["Pelvis", "Spine"], width=0.08 * h)
    rig.add("Pelvis", box("belt_buckle", V((0, -0.118 * h, 0.975 * h)), (0.05 * h, 0.012 * h, 0.04 * h), bevel=0.004, mat=metal),
            chain=["Pelvis", "Spine"], width=0.08 * h)
    for sx in (1, -1):
        strap = [V((sx * 0.085 * h, -0.118 * h, 1.0 * h)), V((sx * 0.09 * h, -0.122 * h, 1.15 * h)), V((sx * 0.1 * h, -0.122 * h, 1.3 * h)),
                 V((sx * 0.115 * h, -0.08 * h, 1.42 * h)), V((sx * 0.12 * h, 0.02 * h, 1.45 * h))]
        sp = spline(strap, 3)
        sr = []
        for i, p in enumerate(sp):
            t = (sp[min(i + 1, len(sp) - 1)] - sp[max(i - 1, 0)]).normalized()
            out = V((0, -1, 0.0)) if p.z < 1.38 * h else V((0, 0, 1))
            side_v = t.cross(out).normalized() * 0.016 * h
            sr.append([p - side_v, p + side_v])
        rig.add("Chest", loft(f"chest_strap{sx}", [list(x) for x in zip(*sr)], closed=False, mat=webbing), chain=torso_chain, width=0.1 * h)
        hip, kn, an, toe = legs["L" if sx > 0 else "R"]
        lc = hip.lerp(kn, 0.28)
        rig.add(f"Thigh{'L' if sx > 0 else 'R'}", torus(f"leg_loop{sx}", lc, V((sx * 0.25, 0, 1)), 0.087 * h, 0.009 * h, mat=webbing,
                                                         maj=22, mnr=5), chain=["Pelvis", f"Thigh{'L' if sx > 0 else 'R'}"], width=0.06 * h)
    rig.add("Chest", loft("sternum_strap", [[V((x * h, -0.128 * h, z * h)) for x in (-0.1, 0.0, 0.1)] for z in (1.25, 1.272)],
                          closed=False, mat=webbing), chain=torso_chain, width=0.08 * h)
    for i, a in enumerate((-PI / 2 + 0.9, -PI / 2 + 1.25, -PI / 2 - 1.15)):
        p = V((math.cos(a) * 0.17 * h, math.sin(a) * 0.122 * h, 0.94 * h))
        rig.add("Pelvis", torus(f"carabiner{i}", p, V((-math.sin(a), math.cos(a), 0)), 0.022 * h, 0.0035 * h, mat=metal, maj=16, mnr=5,
                                scale=None))
    tape_p = V((-0.13 * h, 0.1 * h, 0.98 * h))
    rig.add("Pelvis", torus("gaffer_tape", tape_p, V((-0.6, 0.8, 0)), 0.032 * h, 0.014 * h, mat=tape, maj=20, mnr=8))
    # coiled cable clipped to the left hip, with a loop thrown over the left shoulder
    coil_c = V((0.215 * h, -0.01 * h, 0.84 * h))
    for k in range(3):
        pts = []
        for i in range(25):
            t = i / 24 * TAU
            pts.append(coil_c + V(((k - 1) * 0.011 * h, math.cos(t) * 0.085 * h * (1 + 0.04 * k), math.sin(t) * 0.09 * h)))
        rig.add("Pelvis", tube(f"cable{k}", pts, 0.0068 * h, segs=6, mat=rib if k == 1 else webbing, cap=False))
    rig.add("Pelvis", torus("cable_tie", coil_c + V((0, 0, 0.09 * h)), X, 0.012 * h, 0.006 * h, mat=magenta, maj=12, mnr=5))
    over = [V((0.215 * h, -0.02 * h, 0.93 * h)), V((0.2 * h, -0.15 * h, 1.12 * h)), V((0.16 * h, -0.165 * h, 1.33 * h)),
            V((0.15 * h, -0.07 * h, 1.47 * h)), V((0.15 * h, 0.06 * h, 1.47 * h)), V((0.17 * h, 0.15 * h, 1.3 * h)),
            V((0.2 * h, 0.14 * h, 1.12 * h)), V((0.215 * h, 0.03 * h, 0.95 * h))]
    rig.add("Chest", tube("cable_loop", over, 0.0068 * h, segs=6, mat=webbing, n=4), chain=torso_chain, width=0.1 * h)

    # ---- refractive prism floating above the open right palm, with a rainbow fan
    palm_c, axes, _, _, _ = hand_joints(wrR, fR, nR, "R", hs)
    pc = palm_c + nR * 0.075 + fR * 0.01
    pr = K.make_cylinder("prism", 0.055, 0.055, 0.075, location=tuple(pc), rotation=(1.25, 0.3, 0.5), vertices=3, mat=glass)
    bake(pr)
    K.add_bevel(pr, width=0.004, segments=2)
    rig.add("PropR", pr, figure=False)
    cols = ["#ff3b3b", "#ff9f1c", "#ffe14d", "#3dff7a", "#00e5ff", "#7a3cff"]
    for i, col in enumerate(cols):
        m = glow(f"Dex_Rainbow{i}", col, 2.5, alpha=0.75, double_sided=True)
        a = -0.35 + i * 0.12
        d = V((-0.75 + a * 0.5, -0.55, -0.25 + a * 0.6)).normalized()
        base_p = pc + V((-0.012, -0.012, 0.0))
        e = d.cross(Z).normalized() * 0.005
        e = e * 1.6
        strip = loft(f"rainbow{i}", [[base_p - e * 0.2, base_p + e * 0.2], [base_p + d * 0.2 - e, base_p + d * 0.2 + e]], closed=False, mat=m)
        rig.add("PropR", strip, figure=False)

    extras = {
        "PropR": ("HandR", tuple(palm_c), tuple(pc)),
    }
    return rig.finish(B, extras, bg="#12001a")


BUILDERS = {
    "juno": build_juno,
    "cairn": build_cairn,
    "vesper": build_vesper,
    "soraya": build_soraya,
    "dex": build_dex,
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ids = [a for a in argv if a in BUILDERS] or list(BUILDERS)
    report_path = os.path.join(REPO, "tools", "npcs", "renders", "batch_b_metrics.json")
    report = {}
    if os.path.isfile(report_path):
        try:
            with open(report_path, "r", encoding="utf-8") as fh:
                report = json.load(fh)
        except Exception:
            report = {}
    for npc_id in ids:
        K.reset_scene()
        metrics = BUILDERS[npc_id]()
        report[npc_id] = metrics
        print(f"BATCH_B {npc_id}: tris={metrics['tris']} bones={metrics['bones']} height={metrics['height']} "
              f"glb={metrics['glbBytes'] / 1048576:.2f}MiB")
    K.ensure_dir(os.path.dirname(report_path))
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)


if __name__ == "__main__":
    main()
