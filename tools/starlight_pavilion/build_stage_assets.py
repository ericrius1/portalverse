"""
Starlight Dance Pavilion - hero prop builder (Blender 4.5, headless).

    blender -b --factory-startup --python tools/starlight_pavilion/build_stage_assets.py -- \
        [--only gazebo,gramophone,totem,fountain] [--no-render] [--tile 800]

Exports four uncompressed GLBs to worlds/eric-starlight-pavilion/assets/ and renders a
2x2 EEVEE Next review sheet (Front, 3/4, Side, Top/Detail) per prop to
tools/starlight_pavilion/renders/<name>_sheet.png.

Conventions
  * Blender Z-up, base on Z = 0, centred on (0, 0), front faces -Y (glTF +Z after export_yup).
  * Every prop exports as one static multi-material mesh plus one named animated object
    (ChandelierCore / TurntablePlatter / ChimeCrystal / GeyserRing) whose origin is its pivot,
    so Three.js can `scene.getObjectByName(...)` and spin/bob it in place.
  * Materials are named Starlight_* so the room can find glow materials and pulse them
    (Starlight_Eq0..Eq6 are the seven equaliser bars on the gramophone).
  * Geometry is built procedurally with bmesh (lathes, lofts, sweeps, faceted gems) with
    hand-authored chamfers in every profile, sharp-by-angle edges and face-area weighted
    normals, so nothing is a raw primitive and the triangle counts stay controlled.
  * The only textures are tiny generated PNGs (256 px lapis + metal flecks, 512 px vinyl
    star chart), written to tools/starlight_pavilion/textures/ and embedded in the GLBs.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
ASSET_DIR = os.path.join(REPO, "worlds", "eric-starlight-pavilion", "assets")
RENDER_DIR = os.path.join(HERE, "renders")
TEX_DIR = os.path.join(HERE, "textures")
TAU = math.tau
PI = math.pi

# Palette (sRGB hex)
INDIGO = "#161b33"
BRASS = "#e2b458"
TEAL = "#2dd4bf"
MAGENTA = "#f43f96"
FROST = "#e0f2fe"
GOLD_GLOW = "#ffc45a"


# ===========================================================================
# Scene + materials
# ===========================================================================

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    s = bpy.context.scene
    s.unit_settings.system = "METRIC"
    s.unit_settings.scale_length = 1.0


def srgb_to_lin(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgba(hex_color: str, a: float = 1.0) -> tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    return (srgb_to_lin(int(h[0:2], 16) / 255), srgb_to_lin(int(h[2:4], 16) / 255),
            srgb_to_lin(int(h[4:6], 16) / 255), a)


def mix_hex(a: str, b: str, t: float) -> str:
    ca = [int(a.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    cb = [int(b.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(x + (y - x) * t):02x}" for x, y in zip(ca, cb))


def _bsdf(mat: bpy.types.Material):
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (500, 0)
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.location = (200, 0)
    nt.links.new(b.outputs["BSDF"], out.inputs["Surface"])
    return nt, b


def make_mat(name: str, color: str, *, metallic=0.0, roughness=0.5, emission: str | None = None,
             strength=0.0, coat=0.0, coat_rough=0.1, ior=1.5, specular=0.5,
             double_sided=False, base_tex: bpy.types.Image | None = None,
             mr_tex: bpy.types.Image | None = None, emit_tex: bpy.types.Image | None = None):
    """glTF-clean Principled BSDF (base colour / metal-rough / emission / clearcoat)."""
    mat = bpy.data.materials.new("Starlight_" + name)
    mat.use_backface_culling = not double_sided
    nt, b = _bsdf(mat)
    b.inputs["Base Color"].default_value = rgba(color)
    b.inputs["Metallic"].default_value = metallic
    b.inputs["Roughness"].default_value = roughness
    b.inputs["IOR"].default_value = ior
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = specular
    if coat > 0:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = coat_rough
    if base_tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = base_tex
        t.location = (-400, 200)
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    if mr_tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = mr_tex
        t.location = (-400, -100)
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        sep.location = (-100, -100)
        nt.links.new(t.outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], b.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], b.inputs["Metallic"])
    if emit_tex is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = emit_tex
        t.location = (-400, -400)
        nt.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = max(strength, 1.0)
    elif emission is not None and strength > 0:
        b.inputs["Emission Color"].default_value = rgba(emission)
        b.inputs["Emission Strength"].default_value = strength
    return mat


# ---------------------------------------------------------------------------
# Generated textures (periodic so they tile seamlessly)
# ---------------------------------------------------------------------------

def periodic_noise(n: int, feature_px: float, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.standard_normal((n, n)))
    kx = np.fft.fftfreq(n)[:, None]
    ky = np.fft.fftfreq(n)[None, :]
    k = np.sqrt(kx * kx + ky * ky)
    out = np.real(np.fft.ifft2(f * np.exp(-(k * feature_px) ** 2)))
    return (out - out.mean()) / (out.std() + 1e-8)


def save_png(name: str, arr: np.ndarray, colorspace: str) -> bpy.types.Image:
    """arr: HxWx3 float 0..1 (already in the image's encoding). Saved to TEX_DIR, packed."""
    os.makedirs(TEX_DIR, exist_ok=True)
    h, w = arr.shape[:2]
    path = os.path.join(TEX_DIR, name + ".png")
    img = bpy.data.images.new(name, width=w, height=h, alpha=False)
    rgba_arr = np.ones((h, w, 4), dtype=np.float32)
    rgba_arr[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba_arr[::-1].ravel())  # Blender rows are bottom-up
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = colorspace
    img.pack()
    return img


def lapis_textures() -> tuple[bpy.types.Image, bpy.types.Image]:
    """256 px lapis lazuli: indigo mottling, pale veins, sparse pyrite-gold metallic flecks."""
    n = 256
    low = periodic_noise(n, 18.0, 11)
    mid = periodic_noise(n, 6.0, 12)
    vein = np.exp(-(periodic_noise(n, 10.0, 13) / 0.10) ** 2)
    fine = periodic_noise(n, 1.0, 14)
    m = np.clip(0.5 + 0.22 * low + 0.12 * mid, 0, 1)[..., None]
    deep = np.array([12, 15, 34]) / 255.0
    ultra = np.array([36, 46, 96]) / 255.0
    col = deep + (ultra - deep) * m
    col = col + vein[..., None] * 0.35 * (np.array([78, 92, 150]) / 255.0 - col)
    fleck = np.clip((fine - 2.55) * 3.0, 0, 1) * np.clip(0.6 + 0.4 * mid, 0, 1)
    gold = np.array([226, 180, 88]) / 255.0
    col = col + fleck[..., None] * (gold - col)
    base = save_png("starlight_lapis_base", col, "sRGB")
    mr = np.zeros((n, n, 3))
    mr[..., 0] = 1.0
    mr[..., 1] = np.clip(0.42 + 0.06 * mid - 0.2 * fleck, 0, 1)  # roughness
    mr[..., 2] = fleck  # metallic flecks
    mrimg = save_png("starlight_lapis_mr", mr, "Non-Color")
    return base, mrimg


def star_chart_texture() -> bpy.types.Image:
    """512 px emissive star chart for the vinyl: grooves, constellations, planisphere ticks."""
    n = 512
    rng = np.random.default_rng(7)
    yy, xx = np.mgrid[0:n, 0:n]
    u = (xx + 0.5) / n * 2 - 1
    v = (yy + 0.5) / n * 2 - 1
    r = np.sqrt(u * u + v * v)
    ang = np.arctan2(v, u)
    img = np.zeros((n, n, 3))
    teal = np.array([0.16, 0.80, 0.72])
    gold = np.array([1.0, 0.78, 0.36])
    pink = np.array([0.95, 0.25, 0.58])
    groove_zone = (r > 0.36) & (r < 0.97)
    grooves = (0.5 + 0.5 * np.cos(r * 260.0)) ** 8 * groove_zone
    img += grooves[..., None] * teal * 0.10
    for rr, w, c, k in ((0.965, 0.006, gold, 0.8), (0.36, 0.006, gold, 0.8), (0.66, 0.003, teal, 0.45)):
        img += np.exp(-((r - rr) / w) ** 2)[..., None] * c * k
    ticks = (np.abs(((ang / TAU) * 72) % 1 - 0.5) > 0.44) & (r > 0.92) & (r < 0.955)
    img += ticks[..., None] * gold * 0.7
    stars = []
    while len(stars) < 120:
        p = rng.uniform(-1, 1, 2)
        if 0.40 < np.hypot(*p) < 0.90:
            stars.append(p)
    stars = np.array(stars)
    for i, (sx, sy) in enumerate(stars):
        b = rng.uniform(0.4, 1.0)
        size = 0.004 + 0.006 * b ** 3
        d2 = (u - sx) ** 2 + (v - sy) ** 2
        c = gold if i % 5 == 0 else (pink if i % 7 == 0 else np.array([0.85, 0.95, 1.0]))
        img += np.exp(-d2 / (2 * size * size))[..., None] * c * b
    # constellation lines between near neighbours
    for i in range(0, 60, 3):
        a = stars[i]
        d = np.linalg.norm(stars - a, axis=1)
        d[i] = 9
        j = int(np.argmin(d))
        if d[j] < 0.22:
            b = stars[j]
            ab = b - a
            t = np.clip(((u - a[0]) * ab[0] + (v - a[1]) * ab[1]) / (ab @ ab), 0, 1)
            dist = np.hypot(u - (a[0] + t * ab[0]), v - (a[1] + t * ab[1]))
            img += np.exp(-(dist / 0.0025) ** 2)[..., None] * teal * 0.55
    return save_png("starlight_vinyl_starchart", np.clip(img, 0, 1), "sRGB")


def build_materials(need_vinyl: bool = False) -> dict[str, bpy.types.Material]:
    lb, lmr = lapis_textures()
    M = {
        "L": make_mat("Lapis", INDIGO, roughness=0.42, coat=0.55, coat_rough=0.14, base_tex=lb, mr_tex=lmr),
        "Ld": make_mat("LapisDeep", "#0c0f22", roughness=0.5, coat=0.3),
        "B": make_mat("Brass", BRASS, metallic=0.85, roughness=0.28),
        "Bd": make_mat("BrassAntique", "#b8873c", metallic=0.85, roughness=0.36),
        "T": make_mat("TealGlow", TEAL, roughness=0.25, emission=TEAL, strength=3.2),
        "P": make_mat("MagentaGlow", MAGENTA, roughness=0.25, emission=MAGENTA, strength=3.2),
        "G": make_mat("GoldGlow", GOLD_GLOW, roughness=0.3, emission=GOLD_GLOW, strength=2.6),
        "C": make_mat("Crystal", FROST, roughness=0.08, coat=1.0, coat_rough=0.03, ior=1.6,
                      specular=0.9, emission="#bfe6ff", strength=0.55),
        "Ct": make_mat("CrystalTeal", "#a7f3e8", roughness=0.08, coat=1.0, coat_rough=0.03, ior=1.6,
                       emission=TEAL, strength=1.6),
        "Cp": make_mat("CrystalMagenta", "#fbcfe4", roughness=0.08, coat=1.0, coat_rough=0.03, ior=1.6,
                       emission=MAGENTA, strength=1.6),
        "Mi": make_mat("MirrorPrism", "#cfeaff", metallic=0.35, roughness=0.1, coat=0.3, coat_rough=0.05,
                       emission="#9fd8ff", strength=0.12),
    }
    M["Cc"] = make_mat("ChimeCore", "#9fe7f5", metallic=0.25, roughness=0.08, coat=1.0, coat_rough=0.02,
                       ior=1.6, emission=TEAL, strength=0.7)
    M["Ln"] = make_mat("StarLens", "#0d4a57", roughness=0.12, coat=1.0, coat_rough=0.03, emission="#1fb5a6",
                       strength=1.1)
    if need_vinyl:
        M["Lb"] = make_mat("RecordLabel", "#f5c86a", roughness=0.35, emission=GOLD_GLOW, strength=1.1)
        M["Ht"] = make_mat("HornThroat", "#3a0f2e", roughness=0.4, emission=MAGENTA, strength=1.0)
        M["Pv"] = make_mat("PanelGlow", "#1a1035", roughness=0.5, emission="#7c3aed", strength=0.8)
        M["V"] = make_mat("StarVinyl", "#0a0d1e", roughness=0.22, coat=1.0, coat_rough=0.06,
                          emit_tex=star_chart_texture(), strength=2.2)
    return M


# ===========================================================================
# Geometry kit (bmesh)
# ===========================================================================

class Geo:
    """One bmesh with material keys -> slots. Build many primitives into it, then .obj()."""

    def __init__(self, name: str):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.keys: list[str] = []

    def slot(self, key: str) -> int:
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, verts, key, uvs=None, smooth=True):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        f.material_index = self.slot(key)
        f.smooth = smooth
        if uvs is not None:
            for loop, uv in zip(f.loops, uvs):
                loop[self.uv].uv = uv
        return f

    def obj(self, M, *, sharp_deg=38.0, weighted=True, flat=False, recalc=False):
        bm = self.bm
        if recalc:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.normal_update()
        if flat:
            for f in bm.faces:
                f.smooth = False
        else:
            lim = math.radians(sharp_deg)
            for e in bm.edges:
                if len(e.link_faces) == 2:
                    a = e.link_faces[0].normal.angle(e.link_faces[1].normal, 0.0)
                    e.smooth = a < lim
                else:
                    e.smooth = True
            for e in bm.edges:  # material borders are crisp inlays
                if len(e.link_faces) == 2 and e.link_faces[0].material_index != e.link_faces[1].material_index:
                    e.smooth = False
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for k in self.keys:
            me.materials.append(M[k])
        o = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(o)
        if weighted and not flat:
            wn = o.modifiers.new("WN", "WEIGHTED_NORMAL")
            wn.mode = "FACE_AREA"
            wn.weight = 50
            wn.keep_sharp = True
        return o


def loft(g: Geo, rings, keys, *, closed=True, cap_start=False, cap_end=False, smooth=True,
         tile=1.0, flip=False, loop=False):
    """rings: list of lists of Vector (all the same length, or length 1 for a pole).
    keys: one material key per band (len(rings)-1, +1 if loop) or a single str.
    Winding: rings CCW about the direction of progression -> outward normals."""
    if isinstance(keys, str):
        keys = [keys] * (len(rings) + 1)
    bm = g.bm
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = max(len(r) for r in rings)
    # UVs: u along the ring (by arc length of the widest ring), v along progression
    widest = max(rings, key=len)
    seglen = [0.0]
    for i in range(1, n + (1 if closed else 0)):
        a, b = widest[(i - 1) % n], widest[i % n]
        seglen.append(seglen[-1] + (b - a).length)
    vs = [0.0]
    for j in range(1, len(rings)):
        ca = sum(rings[j - 1], Vector()) / len(rings[j - 1])
        cb = sum(rings[j], Vector()) / len(rings[j])
        ra = rings[j - 1][0] if len(rings[j - 1]) > 1 else ca
        rb = rings[j][0] if len(rings[j]) > 1 else cb
        vs.append(vs[-1] + max((rb - ra).length, (cb - ca).length, 1e-5))
    jr = list(range(len(rings) - 1)) + ([len(rings) - 1] if loop else [])
    for j in jr:
        j2 = (j + 1) % len(rings)
        A, B = vr[j], vr[j2]
        va, vb = vs[j] / tile, (vs[j2] if j2 else vs[-1] + (rings[0][0] - rings[-1][0]).length) / tile
        span = n if closed else n - 1
        for i in range(span):
            i2 = (i + 1) % n
            ua, ub = seglen[i] / tile, seglen[i + 1] / tile
            if len(A) == 1:
                quad = [A[0], B[i2], B[i]]
                uvs = [((ua + ub) / 2, va), (ub, vb), (ua, vb)]
            elif len(B) == 1:
                quad = [A[i], A[i2], B[0]]
                uvs = [(ua, va), (ub, va), ((ua + ub) / 2, vb)]
            else:
                quad = [A[i], A[i2], B[i2], B[i]]
                uvs = [(ua, va), (ub, va), (ub, vb), (ua, vb)]
            if flip:
                quad.reverse()
                uvs.reverse()
            g.face(quad, keys[j], uvs, smooth)
    for cap, ring, rev in ((cap_start, vr[0], True), (cap_end, vr[-1], False)):
        if cap and len(ring) > 2:
            vv = list(reversed(ring)) if (rev != flip) else list(ring)
            ck = cap if isinstance(cap, str) else keys[0 if rev else -1]
            g.face(vv, ck, [(p.co.x / tile, p.co.y / tile) for p in vv], smooth)
    return vr


# --- plan shapes (unit, CCW) ------------------------------------------------

def plan_circle(n: int, phase: float = 0.0):
    return [(math.cos(phase + TAU * i / n), math.sin(phase + TAU * i / n)) for i in range(n)]


def plan_ngon(sides: int, chamfer: float = 0.0, phase: float = 0.0):
    """Regular polygon with APOTHEM 1, face 0 facing +X (rotated by phase). chamfer = edge fraction."""
    R = 1.0 / math.cos(PI / sides)
    corners = [(R * math.cos(phase + (k + 0.5) * TAU / sides), R * math.sin(phase + (k + 0.5) * TAU / sides))
               for k in range(sides)]
    if chamfer <= 0:
        return corners
    out = []
    for k in range(sides):
        p, c, nx = corners[k - 1], corners[k], corners[(k + 1) % sides]
        out.append((c[0] + (p[0] - c[0]) * chamfer, c[1] + (p[1] - c[1]) * chamfer))
        out.append((c[0] + (nx[0] - c[0]) * chamfer, c[1] + (nx[1] - c[1]) * chamfer))
    return out


def plan_superellipse(n: int, a: float, b: float, e: float):
    pts = []
    for i in range(n):
        t = TAU * i / n
        c, s = math.cos(t), math.sin(t)
        pts.append((a * math.copysign(abs(c) ** (2 / e), c), b * math.copysign(abs(s) ** (2 / e), s)))
    return pts


def lathe(g: Geo, profile, *, plan=None, segs=24, phase=0.0, radial=None, closed_profile=False,
          arc=None, cap_start=False, cap_end=False, smooth=True, tile=1.0, xform=None, twist=None):
    """profile: [(r, z, key), ...] traversed CCW in the (r, z) half plane (outward normals).
    Key i colours the band from point i to i+1. r == 0 at an end makes a pole.
    plan: unit plan shape (default circle). radial(x, y, z, j) -> scale factor.
    arc=(a0, a1): partial sweep (open ring) - pass cap_start/cap_end for closed profiles.
    twist: per-profile-point angular offset (radians) for faceted gems."""
    if arc is not None:
        a0, a1 = arc
        base = [(math.cos(a0 + (a1 - a0) * i / segs), math.sin(a0 + (a1 - a0) * i / segs)) for i in range(segs + 1)]
        closed = False
    else:
        base = plan if plan is not None else plan_circle(segs, phase)
        closed = True
    rings = []
    for j, pt in enumerate(profile):
        r, z = pt[0], pt[1]
        if r < 1e-7:
            rings.append([Vector((0, 0, z))])
            continue
        tw = twist[j] if twist else 0.0
        ct, st = math.cos(tw), math.sin(tw)
        ring = []
        for (ux, uy) in base:
            x, y = ux * ct - uy * st, ux * st + uy * ct
            s = radial(x, y, z, j) if radial else 1.0
            ring.append(Vector((x * r * s, y * r * s, z)))
        rings.append(ring)
    keys = [p[2] if len(p) > 2 else "B" for p in profile]
    if arc is None:
        vr = loft(g, rings, keys, closed=closed, cap_start=cap_start, cap_end=cap_end, smooth=smooth,
                  tile=tile, loop=closed_profile)
    else:
        vr = loft(g, rings, keys, closed=False, smooth=smooth, tile=tile, loop=closed_profile)
        # end caps across the profile polygon: a CCW (r, z) polygon faces -theta at the start
        if cap_start:
            g.face([ring[0] for ring in vr], keys[0])
        if cap_end:
            g.face([ring[-1] for ring in reversed(vr)], keys[0])
    if xform is not None:
        for ring in vr:
            for v in ring:
                v.co = xform @ v.co
    return vr


def frames(path, up=(0, 0, 1)):
    """Parallel-transport frames along a polyline: list of (T, N, S) with S = N x T."""
    P = [Vector(p) for p in path]
    n = len(P)
    T = []
    for i in range(n):
        d = (P[min(i + 1, n - 1)] - P[max(i - 1, 0)])
        T.append(d.normalized() if d.length > 1e-9 else Vector((0, 0, 1)))
    N0 = Vector(up)
    N0 = (N0 - T[0] * N0.dot(T[0]))
    if N0.length < 1e-6:
        N0 = Vector((1, 0, 0)) - T[0] * T[0].x
    N = [N0.normalized()]
    for i in range(1, n):
        v = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(v.normalized() if v.length > 1e-9 else N[-1])
    return [(T[i], N[i], N[i].cross(T[i])) for i in range(n)]


def sweep(g: Geo, path, section, keys="B", *, scale=None, up=(0, 0, 1), cap_start=True, cap_end=True,
          smooth=True, tile=1.0, flip=False, closed_path=False, miter=False):
    """Sweep a closed 2D section [(a, b), ...] (CCW, a along S, b along N) along a polyline.
    keys: per-section-edge material keys (str for one material). scale: per-point s or (sa, sb).
    closed_path: the polyline is a loop. miter: widen `a` at in-plane corners so frames don't pinch."""
    P = [Vector(p) for p in path]
    if closed_path:
        fr = frames(P + [P[0]], up)[:len(P)]
        T0 = (P[1] - P[-1]).normalized()
        N0 = fr[0][1]
        N0 = (N0 - T0 * N0.dot(T0)).normalized()
        fr[0] = (T0, N0, N0.cross(T0))
    else:
        fr = frames(P, up)
    rings = []
    for i, (p, (T, N, S)) in enumerate(zip(P, fr)):
        sc = 1.0 if scale is None else scale[i]
        sa, sb = (sc, sc) if isinstance(sc, (int, float)) else sc
        if miter:
            prv = P[i - 1] if (i > 0 or closed_path) else None
            nxt = P[(i + 1) % len(P)] if (i < len(P) - 1 or closed_path) else None
            if prv is not None and nxt is not None:
                ang = (p - prv).angle(nxt - p, 0.0)
                sa = sa / max(math.cos(ang / 2), 0.35)
        if sa < 1e-7 and sb < 1e-7:
            rings.append([p.copy()])
        else:
            rings.append([p + S * (a * sa) + N * (b * sb) for (a, b) in section])
    if isinstance(keys, str):
        vr = loft(g, rings, keys, closed=True, cap_start=keys if (cap_start and not closed_path) else False,
                  cap_end=keys if (cap_end and not closed_path) else False, smooth=smooth, tile=tile, flip=flip,
                  loop=closed_path)
        return vr
    # per-section-edge keys: build band faces manually
    bm = g.bm
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    n = len(section)
    vacc = [0.0]
    for j in range(1, len(P)):
        vacc.append(vacc[-1] + (P[j] - P[j - 1]).length)
    for j in range(len(vr) - 1):
        A, B = vr[j], vr[j + 1]
        for i in range(n):
            i2 = (i + 1) % n
            if len(A) == 1:
                q = [A[0], B[i2], B[i]]
            elif len(B) == 1:
                q = [A[i], A[i2], B[0]]
            else:
                q = [A[i], A[i2], B[i2], B[i]]
            uvs = [(i / tile * 0.1, vacc[j] / tile)] * len(q)
            if flip:
                q.reverse()
            g.face(q, keys[i], uvs, smooth)
    if cap_start and len(vr[0]) > 2:
        g.face(list(reversed(vr[0])) if not flip else vr[0], keys[0])
    if cap_end and len(vr[-1]) > 2:
        g.face(vr[-1] if not flip else list(reversed(vr[-1])), keys[0])
    return vr


def gem(g: Geo, profile, *, segs=8, phase=0.0, alternate=True, xform=None, plan=None):
    """Faceted crystal: low-segment lathe, every other ring rotated half a step (brilliant facets)."""
    tw = [(PI / segs if (alternate and j % 2) else 0.0) for j in range(len(profile))]
    return lathe(g, profile, segs=segs, phase=phase, twist=tw, smooth=False, xform=xform, plan=plan)


def plate(g: Geo, outline, z_top, z_bot, key, side_key=None, *, xform=None, bottom=False, center_lift=0.0,
          bottom_key=None):
    """Extrude a CCW 2D outline. z_top / z_bot: float or f(x, y). Top is a centre fan (supports
    non-planar / conforming plates); centre_lift raises the fan centre (faceted stars)."""
    zt = z_top if callable(z_top) else (lambda x, y, _z=z_top: _z)
    zb = z_bot if callable(z_bot) else (lambda x, y, _z=z_bot: _z)
    side_key = side_key or key
    bm = g.bm
    cx = sum(p[0] for p in outline) / len(outline)
    cy = sum(p[1] for p in outline) / len(outline)
    X = xform or Matrix.Identity(4)
    top = [bm.verts.new(X @ Vector((x, y, zt(x, y)))) for x, y in outline]
    bot = [bm.verts.new(X @ Vector((x, y, zb(x, y)))) for x, y in outline]
    ct = bm.verts.new(X @ Vector((cx, cy, zt(cx, cy) + center_lift)))
    n = len(outline)
    for i in range(n):
        i2 = (i + 1) % n
        g.face([ct, top[i], top[i2]], key, smooth=False)
        g.face([bot[i], bot[i2], top[i2], top[i]], side_key)
    if bottom:
        cb = bm.verts.new(X @ Vector((cx, cy, zb(cx, cy))))
        for i in range(n):
            g.face([cb, bot[(i + 1) % n], bot[i]], bottom_key or side_key)
    return top, bot


def star_outline(points: int, r_out: float, r_in: float, phase: float = 0.0, long_short=None):
    pts = []
    for k in range(points * 2):
        a = phase + PI * k / points
        if k % 2 == 0:
            r = r_out if long_short is None else (long_short[0] if (k // 2) % 2 == 0 else long_short[1])
        else:
            r = r_in
        pts.append((r * math.cos(a), r * math.sin(a)))
    return pts


def catmull(points, samples_per_seg=4):
    P = [Vector(p) for p in points]
    out = []
    for i in range(len(P) - 1):
        p0 = P[max(i - 1, 0)]
        p1, p2 = P[i], P[i + 1]
        p3 = P[min(i + 2, len(P) - 1)]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1])
    return out


def align_z(vec) -> Matrix:
    """Rotation taking +Z onto vec."""
    return Vector(vec).normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()


def rot_z(a):
    return Matrix.Rotation(a, 4, "Z")


def place(x=0.0, y=0.0, z=0.0, rz=0.0, rx=0.0, ry=0.0):
    return (Matrix.Translation((x, y, z)) @ Matrix.Rotation(rz, 4, "Z") @ Matrix.Rotation(ry, 4, "Y")
            @ Matrix.Rotation(rx, 4, "X"))


def transform_geo(vr_lists, X):
    for vr in vr_lists:
        for ring in vr:
            for v in ring:
                v.co = X @ v.co


# ---------------------------------------------------------------------------
# Object finishing
# ---------------------------------------------------------------------------

def bake_and_join(objs, name: str) -> bpy.types.Object:
    objs = [o for o in objs if o is not None]
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.convert(target="MESH")
    if len(objs) > 1:
        bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.select_set(False)
    return o


def set_pivot(o: bpy.types.Object, pivot) -> None:
    pv = Vector(pivot)
    o.data.transform(Matrix.Translation(-pv))
    o.location = pv
    o.data.update()
    bpy.context.view_layer.update()


def tri_count(o: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in o.data.polygons)


def world_bounds(objs):
    pts = [o.matrix_world @ v.co for o in objs for v in o.data.vertices]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def export_glb(objs, path: str) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_normals=True, export_tangents=False, export_texcoords=True, export_materials="EXPORT",
        export_image_format="AUTO", export_draco_mesh_compression_enable=False, export_cameras=False,
        export_lights=False, export_animations=False, export_extras=False,
    )
    return os.path.getsize(path)


# ===========================================================================
# Studio review sheet (EEVEE Next)
# ===========================================================================

def setup_studio(lo: Vector, hi: Vector, bg="#10142a"):
    s = bpy.context.scene
    s.render.engine = "BLENDER_EEVEE_NEXT"
    ee = s.eevee
    ee.taa_render_samples = 64
    for attr, val in (("use_raytracing", True), ("use_shadows", True), ("shadow_ray_count", 2),
                      ("use_fast_gi", True)):
        try:
            setattr(ee, attr, val)
        except Exception:
            pass
    try:
        ee.ray_tracing_method = "SCREEN"
    except Exception:
        pass
    s.view_settings.view_transform = "AgX"
    try:
        s.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    # gradient world so metals have something to reflect
    w = bpy.data.worlds.new("Studio")
    s.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bgn = nt.nodes.new("ShaderNodeBackground")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    mr = nt.nodes.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value = -1.0
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    nt.links.new(sep.outputs["Z"], mr.inputs["Value"])
    nt.links.new(mr.outputs["Result"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bgn.inputs["Color"])
    nt.links.new(bgn.outputs["Background"], out.inputs["Surface"])
    el = ramp.color_ramp.elements
    el[0].position, el[0].color = 0.30, rgba("#0b0d18")
    el[1].position, el[1].color = 1.0, rgba("#c9c4d8")
    mid = el.new(0.52)
    mid.color = rgba("#2a2d47")
    bgn.inputs["Strength"].default_value = 0.9
    # floor
    size = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
    fm = make_mat("ReviewFloor", "#2a3150", roughness=0.5, metallic=0.0)
    fg = Geo("ReviewFloor")
    lathe(fg, [(0, 0, "F"), (size * 1.6, 0, "F")], segs=64)
    floor = fg.obj({"F": fm}, weighted=False)
    floor.location.z = -0.0005
    # sun lights (scale independent)
    lights = []
    for nm, d, e, col, ang in (("Key", (1.1, -1.5, 1.7), 3.6, (1.0, 0.94, 0.86), 4.0),
                               ("Fill", (-1.6, -0.6, 0.7), 0.9, (0.70, 0.82, 1.0), 12.0),
                               ("Rim", (0.4, 1.6, 1.1), 2.6, (0.75, 0.95, 1.0), 6.0)):
        ld = bpy.data.lights.new(nm, "SUN")
        ld.energy = e
        ld.color = col
        ld.angle = math.radians(ang)
        lo_ = bpy.data.objects.new(nm, ld)
        s.collection.objects.link(lo_)
        lo_.rotation_euler = (-Vector(d)).to_track_quat("-Z", "Y").to_euler()
        lights.append(lo_)
    # bloom via compositor glare
    s.use_nodes = True
    tree = s.node_tree
    tree.nodes.clear()
    rl = tree.nodes.new("CompositorNodeRLayers")
    gl = tree.nodes.new("CompositorNodeGlare")
    cp = tree.nodes.new("CompositorNodeComposite")
    for attr, val in (("glare_type", "FOG_GLOW"), ("quality", "HIGH"), ("threshold", 1.2), ("size", 7),
                      ("mix", -0.55)):
        try:
            setattr(gl, attr, val)
        except Exception:
            pass
    for nm, val in (("Threshold", 1.2), ("Strength", 0.45), ("Size", 0.5)):
        if nm in gl.inputs:
            try:
                gl.inputs[nm].default_value = val
            except Exception:
                pass
    tree.links.new(rl.outputs["Image"], gl.inputs["Image"])
    tree.links.new(gl.outputs["Image"], cp.inputs["Image"])
    return [floor, *lights]


def fit_camera(cam, target_lo: Vector, target_hi: Vector, direction, lens=50.0, margin=1.12, ortho=False):
    c = (target_lo + target_hi) * 0.5
    d = Vector(direction).normalized()
    up_hint = Vector((0, 1, 0)) if abs(d.z) > 0.97 else Vector((0, 0, 1))
    fwd = -d  # camera sits at c + d * dist looking toward the target
    right = fwd.cross(up_hint).normalized()
    up = right.cross(fwd).normalized()
    corners = [Vector((x, y, z)) for x in (target_lo.x, target_hi.x) for y in (target_lo.y, target_hi.y)
               for z in (target_lo.z, target_hi.z)]
    cam.data.lens = lens
    cam.data.sensor_fit = "HORIZONTAL"
    tan_h = (cam.data.sensor_width / 2) / lens
    res = bpy.context.scene.render
    tan_v = tan_h * res.resolution_y / res.resolution_x
    # solve for distance and recentre in the image plane
    xs = [(p - c).dot(right) for p in corners]
    ys = [(p - c).dot(up) for p in corners]
    shift = right * (max(xs) + min(xs)) / 2 + up * (max(ys) + min(ys)) / 2
    c2 = c + shift
    dist = 0.0
    for p in corners:
        q = p - c2
        x, y, z = q.dot(right), q.dot(up), q.dot(d)  # z toward camera
        dist = max(dist, z + abs(x) / (tan_h / margin), z + abs(y) / (tan_v / margin))
    cam.location = c2 + d * dist
    cam.rotation_euler = Matrix((right, up, -fwd)).transposed().to_euler()
    cam.data.clip_start = max(0.01, dist * 0.01)
    cam.data.clip_end = dist * 20 + 100


def render_sheet(name: str, objs, views, tile=800, extra=None):
    """views: list of (label, direction, lens, bounds(lo, hi) or None). 2x2 grid -> <name>_sheet.png."""
    os.makedirs(RENDER_DIR, exist_ok=True)
    s = bpy.context.scene
    lo, hi = world_bounds(objs)
    helpers = setup_studio(lo, hi)
    s.render.resolution_x = tile
    s.render.resolution_y = tile
    s.render.resolution_percentage = 100
    s.render.image_settings.file_format = "PNG"
    s.render.image_settings.color_mode = "RGBA"
    s.render.film_transparent = False
    cd = bpy.data.cameras.new("ReviewCam")
    cam = bpy.data.objects.new("ReviewCam", cd)
    s.collection.objects.link(cam)
    s.camera = cam
    pid = os.getpid()
    tiles = []
    tmp = []
    all_views = list(views) + list(extra or [])
    for k, view in enumerate(all_views):
        label, d, lens, bounds = view[:4]
        hidden = view[4] if len(view) > 4 else []
        for o in objs:
            o.hide_render = o in hidden
        if isinstance(d, dict):
            cam.data.lens = lens
            cam.data.sensor_fit = "HORIZONTAL"
            cam.location = Vector(d["pos"])
            cam.rotation_euler = (Vector(d["target"]) - Vector(d["pos"])).to_track_quat("-Z", "Y").to_euler()
            cam.data.clip_start, cam.data.clip_end = 0.05, 500
        else:
            blo, bhi = bounds if bounds else (lo, hi)
            fit_camera(cam, blo, bhi, d, lens=lens)
        p = os.path.join(RENDER_DIR, f"_tmp_{pid}_{name}_{k}_{label}.png")
        s.render.filepath = p
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(p)
        a = np.empty(tile * tile * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        tiles.append(a.reshape(tile, tile, 4))
        tmp.append(p)
    for o in objs:
        o.hide_render = False
    border = np.zeros((tile, 4, 4), dtype=np.float32)
    border[..., 3] = 1
    hb = np.zeros((4, tile * 2 + 4, 4), dtype=np.float32)
    hb[..., 3] = 1
    t = tiles
    top = np.concatenate([t[0], border, t[1]], axis=1)
    bot = np.concatenate([t[2], border, t[3]], axis=1)
    sheet = np.concatenate([bot, hb, top], axis=0)  # bottom-up row order
    out = os.path.join(RENDER_DIR, f"{name}_sheet.png")
    _write_png(out, sheet)
    for k in range(4, len(tiles)):
        _write_png(os.path.join(RENDER_DIR, f"{name}_{all_views[k][0]}.png"), tiles[k])
    for p in tmp:
        try:
            os.remove(p)
        except OSError:
            pass
    for o in helpers + [cam]:
        bpy.data.objects.remove(o, do_unlink=True)
    return out


def _write_png(path, arr):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), width=w, height=h, alpha=True)
    img.pixels.foreach_set(arr.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


# ===========================================================================
# 1. Dance gazebo
# ===========================================================================

GZ_R = 10.8          # column ring radius
GZ_CAP_TOP = 6.88    # abacus top / cornice underside
GZ_CORN_TOP = 7.48
GZ_OCULUS_R = 4.4
GZ_OCULUS_Z = 9.6
GZ_CHANDELIER = (0.0, 0.0, 7.6)
GZ_CH_SCALE = 1.4    # chandelier is modelled at 1/1.4 and scaled about its pivot
GZ_HUB_Z = 9.16


def gazebo_column(M) -> bpy.types.Object:
    """One column at the origin, its outward face toward +X."""
    g = Geo("Column")
    # stepped octagonal pedestal (apothem profile, chamfered octagon plan)
    oct_plan = plan_ngon(8, chamfer=0.12)
    lathe(g, [
        (0.68, 0.0, "L"), (0.68, 0.15, "B"), (0.63, 0.20, "L"), (0.60, 0.23, "L"), (0.60, 0.66, "B"),
        (0.64, 0.70, "B"), (0.64, 0.76, "L"), (0.50, 0.84, "L"),
    ], plan=oct_plan, tile=1.2)
    # brass diamond plaques with teal gems on the out / in / side faces of the die
    for k in range(0, 8, 2):
        a = k * TAU / 8
        # outline in local XY (x = tangent, y = up the column), extruded outward (+Z -> radial)
        Xp = rot_z(a) @ place(x=0.60, z=0.445) @ Matrix.Rotation(PI / 2, 4, "Y") @ Matrix.Rotation(PI / 2, 4, "Z")
        plate(g, [(0.0, -0.16), (0.12, 0.0), (0.0, 0.16), (-0.12, 0.0)], 0.022, -0.004, "B", xform=Xp)
        plate(g, [(0.0, -0.08), (0.055, 0.0), (0.0, 0.08), (-0.055, 0.0)], 0.032, 0.015, "T", "B",
              xform=Xp, center_lift=0.014)
    # attic base mouldings + fluted shaft + collars (round)
    lathe(g, [
        (0.50, 0.84, "B"), (0.46, 0.95, "L"), (0.35, 1.02, "B"), (0.37, 1.13, "B"),
        (0.325, 1.20, "L"),
    ], segs=12, tile=1.2)

    def flutes(x, y, z, j):
        a = math.atan2(y, x)
        return 1.0 - 0.085 * math.sqrt(abs(math.cos(4 * a)))

    lathe(g, [(0.325, 1.20, "L"), (0.312, 3.31, "L")], segs=32, radial=flutes, tile=1.2)
    lathe(g, [(0.29, 3.29, "B"), (0.338, 3.34, "B"), (0.338, 3.46, "B"), (0.29, 3.51, "B")], segs=12)
    lathe(g, [(0.312, 3.51, "L"), (0.285, 5.62, "L")], segs=32, radial=flutes, tile=1.2)
    lathe(g, [(0.26, 5.60, "B"), (0.305, 5.66, "B"), (0.29, 5.80, "B")], segs=12)
    # teal crystal accent strips sitting in four flute grooves (the mid collar covers the joint)
    for k in range(4):
        a = k * PI / 2
        u = Vector((math.cos(a), math.sin(a), 0))
        s0 = u * (0.324 * (1 - 0.085) + 0.010) + Vector((0, 0, 1.50))
        s1 = u * (0.286 * (1 - 0.085) + 0.010) + Vector((0, 0, 5.36))
        sweep(g, [s0, s0.lerp(s1, 0.02), s0.lerp(s1, 0.98), s1], [(0.015, 0), (0, 0.018), (-0.015, 0), (0, -0.018)],
              "T", scale=[0.0, 1.0, 1.0, 0.0], up=(u.x, u.y, 0))
    # lotus / star capital (eight petals flaring out)
    def petals(x, y, z, j):
        a = math.atan2(y, x)
        t = min(1.0, max(0.0, (z - 5.90) / 0.66))
        p = (0.5 + 0.5 * math.cos(8 * a)) ** 1.5
        return 1.0 + 0.26 * t * t * (p - 0.35)

    lathe(g, [
        (0.29, 5.80, "B"), (0.35, 6.00, "B"), (0.45, 6.28, "B"), (0.58, 6.48, "B"),
        (0.68, 6.56, "B"), (0.0, 6.59, "B"),
    ], segs=16, radial=petals)
    # stepped octagonal abacus
    lathe(g, [
        (0.56, 6.57, "B"), (0.72, 6.61, "L"), (0.72, 6.69, "B"), (0.77, 6.73, "B"),
        (0.77, 6.88, "B"), (0.0, 6.88, "B"),
    ], plan=oct_plan, tile=1.2)
    # glowing eight-point star medallion on the inward abacus face
    star = star_outline(8, 0.10, 0.045, phase=PI / 2, long_short=(0.10, 0.07))
    Xs = rot_z(PI) @ place(x=0.77, z=6.79) @ Matrix.Rotation(PI / 2, 4, "Y") @ Matrix.Rotation(PI / 2, 4, "Z")
    plate(g, star, 0.018, -0.004, "G", "B", xform=Xs, center_lift=0.02)
    return g.obj(M, sharp_deg=36.0)


def gazebo_structure(M):
    parts = []
    col = gazebo_column(M)
    bpy.context.view_layer.update()
    col_angles = [math.radians(22.5 + 45 * k) for k in range(8)]
    for k, a in enumerate(col_angles):
        o = col if k == 0 else col.copy()
        if k:
            o.data = col.data.copy()
            bpy.context.scene.collection.objects.link(o)
        o.matrix_world = rot_z(a) @ Matrix.Translation((GZ_R, 0, 0))
        parts.append(o)

    g = Geo("Crown")
    # ring cornice / eaves (closed profile, CCW in r-z)
    c0 = GZ_CAP_TOP
    lathe(g, [
        (10.26, c0, "L"), (11.26, c0, "L"), (11.32, c0 + 0.08, "L"), (11.32, c0 + 0.24, "T"),
        (11.32, c0 + 0.38, "B"), (11.44, c0 + 0.46, "B"), (11.44, c0 + 0.56, "B"), (11.38, c0 + 0.60, "L"),
        (10.92, c0 + 0.60, "B"), (10.88, c0 + 0.78, "B"), (10.62, c0 + 0.78, "B"), (10.58, c0 + 0.60, "L"),
        (10.30, c0 + 0.60, "B"), (10.22, c0 + 0.52, "T"), (10.22, c0 + 0.38, "L"),
    ], segs=32, closed_profile=True, tile=1.4)
    # ribs: quarter-ellipse springing from each capital to the oculus ring
    rc, zc = GZ_OCULUS_R + 0.25, GZ_CAP_TOP
    ra, rb = 10.40 - rc, GZ_OCULUS_Z - GZ_CAP_TOP
    w, d, c = 0.21, 0.33, 0.055
    sec = [(w, -d + c), (w, d - c), (w - c, d), (-w + c, d), (-w, d - c), (-w, -d + c), (-w + c, -d),
           (-0.045, -d), (0.045, -d), (w - c, -d)]
    keys = ["L", "B", "B", "B", "L", "B", "B", "T", "B", "B"]
    # section edge i runs from point i to i+1: sides lapis, chamfers + top brass, underside brass w/ teal channel
    for a in col_angles:
        path, sc = [], []
        n = 7
        for i in range(n + 1):
            t = (i / n) * (PI / 2)
            t = t * 0.985
            r = rc + ra * math.cos(t)
            z = zc + rb * math.sin(t)
            path.append((r * math.cos(a), r * math.sin(a), z))
            f = i / n
            sc.append((1.0 - 0.22 * f, 1.0 - 0.42 * f))
        path.insert(0, ((rc + ra) * math.cos(a), (rc + ra) * math.sin(a), zc - 0.02))
        sc.insert(0, sc[0])
        # end inside the oculus ring
        end = Vector(path[-1])
        path.append(end + Vector((-math.cos(a), -math.sin(a), 0)) * 0.45)
        sc.append(sc[-1])
        sweep(g, path, sec, keys, scale=sc, up=(math.cos(a), math.sin(a), 0))
    # oculus ring
    lathe(g, [
        (4.08, 9.36, "L"), (4.74, 9.36, "L"), (4.80, 9.42, "B"), (4.86, 9.68, "B"), (4.86, 9.78, "L"),
        (4.10, 9.82, "B"), (4.02, 9.76, "P"), (4.02, 9.46, "B"),
    ], segs=32, closed_profile=True, tile=1.4)
    # crown spires over each rib + sunburst rays between
    sq = plan_ngon(4, chamfer=0.2, phase=PI / 4)
    for k, a in enumerate(col_angles):
        X = rot_z(a) @ Matrix.Translation((GZ_OCULUS_R + 0.02, 0, 0))
        lathe(g, [(0.26, 9.80, "B"), (0.20, 10.02, "L"), (0.13, 10.62, "B"), (0.18, 10.72, "B"),
                  (0.0, 10.78, "B")], plan=sq, xform=X @ rot_z(PI / 4))
        gem(g, [(0.0, 10.74, "Cp" if k % 2 else "Ct"), (0.10, 10.86, "Cp" if k % 2 else "Ct"),
                (0.065, 11.0, "Cp" if k % 2 else "Ct"), (0.0, 11.22, "Cp" if k % 2 else "Ct")],
            segs=6, xform=X)
        b = a + math.radians(22.5)
        Xr = (rot_z(b) @ Matrix.Translation((GZ_OCULUS_R + 0.02, 0, 0)) @ rot_z(PI / 2)
              @ Matrix.Rotation(PI / 2, 4, "X"))
        ray = [(-0.16, 9.82), (0.16, 9.82), (0.03, 10.38), (0.0, 10.46), (-0.03, 10.38)]
        plate(g, [(x, z) for x, z in ray], 0.03, -0.03, "B", xform=Xr)
    # 16 faceted lantern finials on the cornice
    for k in range(16):
        a = k * TAU / 16
        X = rot_z(a) @ Matrix.Translation((11.12, 0, 0))
        c1 = GZ_CORN_TOP
        lathe(g, [(0.14, c1, "B"), (0.08, c1 + 0.13, "B"), (0.0, c1 + 0.13, "B")], segs=6, xform=X)
        key = "Ct" if k % 2 == 0 else "Cp"
        gem(g, [(0.0, c1 + 0.10, key), (0.13, c1 + 0.34, key), (0.09, c1 + 0.52, key), (0.0, c1 + 0.76, key)],
            segs=6, xform=X)
    # low gilded curb between columns, open along the +/-Y promenade
    span = math.radians(45) - 2 * math.asin(0.66 / GZ_R)
    for k in range(8):
        a0 = col_angles[k] + math.asin(0.66 / GZ_R)
        mid = col_angles[k] + math.radians(22.5)
        if abs(math.sin(mid)) > 0.99:  # gaps centred on +/-Y stay open
            continue
        lathe(g, [(GZ_R + 0.20, 0.0, "L"), (GZ_R + 0.20, 0.12, "B"), (GZ_R + 0.13, 0.19, "B"),
                  (GZ_R - 0.13, 0.19, "B"), (GZ_R - 0.20, 0.12, "L")],
              arc=(a0, a0 + span), segs=6, cap_start=True, cap_end=True)
    # static suspension: four brass cables from the oculus to a star hub
    hub_z = GZ_HUB_Z
    lathe(g, [(0.0, hub_z - 0.16, "B"), (0.10, hub_z - 0.10, "B"), (0.16, hub_z, "B"), (0.10, hub_z + 0.08, "B"),
              (0.0, hub_z + 0.12, "B")], segs=8)
    for k in range(4):
        a = k * PI / 2 + PI / 4
        p0 = Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, hub_z))
        p1 = Vector((math.cos(a) * 4.06, math.sin(a) * 4.06, 9.46))
        pts = [p0.lerp(p1, t) + Vector((0, 0, -0.12 * math.sin(PI * t))) for t in (0, 0.33, 0.66, 1.0)]
        sweep(g, pts, [(0.018, 0), (0, 0.018), (-0.018, 0), (0, -0.018)], "B", up=(0, 0, 1))
    parts.append(g.obj(M, sharp_deg=36.0))
    return bake_and_join(parts, "DanceGazebo")


def gazebo_chandelier(M):
    cz = GZ_CHANDELIER[2]
    g = Geo("ChandelierCore")
    # faceted mirror-prism crystal (elongated brilliant)
    gem(g, [(0.0, cz - 1.02, "Mi"), (0.20, cz - 0.70, "Mi"), (0.40, cz - 0.30, "Mi"), (0.52, cz + 0.02, "Mi"),
            (0.50, cz + 0.10, "Mi"), (0.36, cz + 0.34, "Mi"), (0.0, cz + 0.52, "Mi")], segs=8)
    # brass crown cap + suspension rod into the static hub
    lathe(g, [(0.16, cz + 0.40, "B"), (0.24, cz + 0.44, "B"), (0.20, cz + 0.52, "B"), (0.09, cz + 0.62, "B"),
              (0.05, cz + 0.70, "B"), (0.0, cz + 0.70, "B")], segs=8)
    lathe(g, [(0.025, cz + 0.68, "B"), (0.025, cz + (GZ_HUB_Z - 0.04 - cz) / GZ_CH_SCALE, "B"),
              (0.0, cz + (GZ_HUB_Z - 0.04 - cz) / GZ_CH_SCALE, "B")], segs=6)
    # two tilted interlocking armillary bands with a glowing equator line
    def band(r, h, t, glow):
        return [(r - t, h, "B"), (r - t, -h, "B"), (r + t * 0.7, -h, "B"), (r + t, -h * 0.4, glow),
                (r + t, h * 0.4, "B"), (r + t * 0.7, h, "B")]

    rings = []
    for (r, tilt_axis, ang, glow) in ((1.12, "X", math.radians(34), "T"), (1.02, "Y", math.radians(-30), "P")):
        X = Matrix.Translation((0, 0, cz)) @ Matrix.Rotation(ang, 4, tilt_axis)
        prof = [(p[0], p[1], p[2]) for p in band(r, 0.055, 0.022, glow)]
        lathe(g, prof, segs=28, closed_profile=True, xform=X)
        rings.append((r, X))
    # eight dangling star-crystal droplets hung from the lower halves of the rings
    k = 0
    for (r, X) in rings:
        for i in range(4):
            a = math.radians(200 + i * 46.7)
            p = X @ Vector((math.cos(a) * (r - 0.02), math.sin(a) * (r - 0.02), 0.0))
            if p.z > cz + 0.15:
                a = a + PI
                p = X @ Vector((math.cos(a) * (r - 0.02), math.sin(a) * (r - 0.02), 0.0))
            drop = 0.22 + 0.12 * ((k * 5) % 3)
            tip = p + Vector((0, 0, -drop))
            sweep(g, [p, tip], [(0.008, 0), (0, 0.008), (-0.008, 0), (0, -0.008)], "B", up=(1, 0, 0))
            key = "Ct" if k % 2 == 0 else "Cp"
            Xd = Matrix.Translation(tip)
            gem(g, [(0.0, 0.0, key), (0.06, -0.07, key), (0.045, -0.13, key), (0.0, -0.26, key)], segs=6,
                xform=Xd)
            k += 1
    o = bake_and_join([g.obj(M, sharp_deg=36.0)], "ChandelierCore")
    pv = Matrix.Translation(GZ_CHANDELIER)
    o.data.transform(pv @ Matrix.Scale(GZ_CH_SCALE, 4) @ pv.inverted())
    set_pivot(o, GZ_CHANDELIER)
    return o


# ===========================================================================
# 2. DJ gramophone console
# ===========================================================================

DJ_PLATTER = (0.0, -0.05, 1.06)
DJ_EXP = 3.4
DJ_DECK = 0.97
DJ_HORN_X = 0.60
DJ_HORN_Y = 0.40


def dj_level(z):
    """Body superellipse half-widths (a, b) at height z between the base band and the rim."""
    t = (z - 0.30) / (0.84 - 0.30)
    return 0.90 + 0.04 * t, 0.52 + 0.04 * t


def dj_front(x, z, off=0.0):
    """Point on the front (-Y) body surface at (x, z), pushed `off` along its outward normal."""
    a, b = dj_level(z)
    e = DJ_EXP
    u = min(abs(x) / a, 0.999)
    y = -b * (1 - u ** e) ** (1 / e)
    gx = math.copysign(u ** (e - 1) / a, x)
    gy = -((abs(y) / b) ** (e - 1)) / b
    n = Vector((gx, gy, -abs(gy) * 0.074)).normalized()
    return Vector((x, y, z)) + n * off, n


def build_gramophone(M):
    parts = []
    g = Geo("Console")
    E = DJ_EXP
    # stepped plinth + body loft (superellipse plan)
    levels = [
        (0.00, 0.99, 0.61, "L"), (0.06, 0.99, 0.61, "B"), (0.085, 0.965, 0.585, "L"), (0.085, 0.80, 0.42, "Ld"),
        (0.25, 0.80, 0.42, "Ld"), (0.25, 0.885, 0.505, "B"), (0.30, 0.90, 0.52, "L"), (0.84, 0.94, 0.56, "B"),
        (0.90, 1.0, 0.62, "B"), (0.945, 0.99, 0.61, "B"), (DJ_DECK, 0.95, 0.57, "B"),
    ]
    rings = [[Vector((x, y, z)) for (x, y) in plan_superellipse(40, a, b, E)] for (z, a, b, _) in levels]
    loft(g, rings, [lv[3] for lv in levels], cap_end="L", tile=1.0)
    # stepped deco feet at the four corners
    sq = plan_ngon(4, chamfer=0.22, phase=PI / 4)
    for sx in (-1, 1):
        for sy in (-1, 1):
            X = Matrix.Translation((sx * 0.72, sy * 0.30, 0))
            lathe(g, [(0.15, 0.085, "L"), (0.15, 0.13, "B"), (0.12, 0.16, "L"), (0.12, 0.21, "B"),
                      (0.10, 0.25, "L")], plan=sq, xform=X @ rot_z(PI / 4))
    # front panel: glowing backing, brass frame, diamond lattice
    x0, x1, z0, z1 = -0.62, 0.62, 0.36, 0.80
    nx, nz = 12, 4
    grid = [[dj_front(x0 + (x1 - x0) * i / nx, z0 + (z1 - z0) * j / nz, 0.004)[0] for i in range(nx + 1)]
            for j in range(nz + 1)]
    bm = g.bm
    gv = [[bm.verts.new(p) for p in row] for row in grid]
    for j in range(nz):
        for i in range(nx):
            g.face([gv[j][i], gv[j][i + 1], gv[j + 1][i + 1], gv[j + 1][i]], "Pv",
                   [(i / nx, j / nz), ((i + 1) / nx, j / nz), ((i + 1) / nx, (j + 1) / nz), (i / nx, (j + 1) / nz)])
    # frame (closed sweep around the panel edge, following the surface)
    loop = [dj_front(x0 + (x1 - x0) * i / nx, z0, 0.006)[0] for i in range(nx)]
    loop += [dj_front(x1, z0 + (z1 - z0) * j / nz, 0.006)[0] for j in range(nz)]
    loop += [dj_front(x1 - (x1 - x0) * i / nx, z1, 0.006)[0] for i in range(nx)]
    loop += [dj_front(x0, z1 - (z1 - z0) * j / nz, 0.006)[0] for j in range(nz)]
    sweep(g, loop, [(0.028, -0.012), (0.028, 0.018), (-0.028, 0.018), (-0.028, -0.012)], "B", up=(0, -1, 0),
          closed_path=True, miter=True)
    # diamond lattice bars (45 degree lines clipped to the frame)
    lat = [(0.012, 0), (0, 0.012), (-0.012, 0), (0, -0.006)]
    step, H = 0.19, z1 - z0
    for sgn in (1, -1):
        c = (x0 - H if sgn > 0 else x0) + step / 2
        cend = x1 if sgn > 0 else x1 + H
        while c < cend:
            if sgn > 0:
                za, zb = max(z0, z0 + (x0 - c)), min(z1, z0 + (x1 - c))
            else:
                za, zb = max(z0, z0 + (c - x1)), min(z1, z0 + (c - x0))
            if zb - za > 0.03:
                pts = [dj_front(c + sgn * (z - z0), z, 0.010)[0] for z in np.linspace(za, zb, 4)]
                sweep(g, pts, lat, "Bd", up=(0, -1, 0))
            c += step
    # brass sill + seven stepped equaliser crystal bars (cyan -> gold -> magenta)
    sill = [dj_front(x, 0.385, 0.03)[0] for x in np.linspace(-0.60, 0.60, 9)]
    sweep(g, sill, [(0.035, -0.02), (0.035, 0.012), (-0.035, 0.012), (-0.035, -0.02)], "B", up=(0, 0, 1))
    heights = [0.17, 0.25, 0.32, 0.38, 0.32, 0.25, 0.17]
    colors = [mix_hex(TEAL, GOLD_GLOW, i / 3) if i <= 3 else mix_hex(GOLD_GLOW, MAGENTA, (i - 3) / 3)
              for i in range(7)]
    for i, (h, col) in enumerate(zip(heights, colors)):
        key = f"Eq{i}"
        if key not in M:
            M[key] = make_mat(key, mix_hex(col, "#ffffff", 0.12), roughness=0.1, coat=1.0, coat_rough=0.03,
                              emission=col, strength=3.4)
        x = (i - 3) * 0.155
        base, n = dj_front(x, 0.40, 0.03)
        yaw = math.atan2(n.y, n.x) + PI / 2
        X = Matrix.Translation(base) @ rot_z(yaw)
        z0b = 0.0
        gem(g, [(0.0, z0b, key), (0.040, z0b + 0.01, key), (0.045, z0b + h - 0.06, key),
                (0.030, z0b + h - 0.025, key), (0.0, z0b + h, key)], segs=6, alternate=False, xform=X,
            plan=[(math.cos(t) * 1.0, math.sin(t) * 0.55) for t in [TAU * k / 6 for k in range(6)]])
    # recessed brass dials on the front flanks
    for sx in (-1, 1):
        p, n = dj_front(sx * 0.78, 0.58, 0.0)
        yaw = math.atan2(n.y, n.x)
        X = Matrix.Translation(p) @ rot_z(yaw) @ Matrix.Rotation(PI / 2, 4, "Y")
        lathe(g, [(0.0, 0.004, "Ld"), (0.10, 0.004, "B"), (0.11, 0.028, "B"),
                  (0.095, 0.04, "B"), (0.075, 0.03, "Ld"), (0.0, 0.03, "Ld")], segs=14, xform=X)
        lathe(g, [(0.045, 0.03, "B"), (0.045, 0.06, "B"), (0.035, 0.07, "T"), (0.0, 0.074, "T")], segs=10, xform=X)
        for k in range(5):
            a = math.radians(-120 + k * 60)
            Xt = X @ Matrix.Translation((math.cos(a) * 0.063, math.sin(a) * 0.063, 0.031))
            lathe(g, [(0.006, 0.0, "T"), (0.0, 0.004, "T")], segs=4, xform=Xt)
    # deck: platter well, knob row, and horn towers
    lathe(g, [(0.40, DJ_DECK, "B"), (0.42, DJ_DECK + 0.012, "B"), (0.40, DJ_DECK + 0.02, "Ld"),
              (0.0, DJ_DECK + 0.02, "Ld")], segs=32, xform=Matrix.Translation((DJ_PLATTER[0], DJ_PLATTER[1], 0)))
    for i, (kx, ky) in enumerate(((0.70, -0.32), (0.70, -0.14), (0.70, 0.04), (-0.70, -0.32), (-0.70, -0.14))):
        X = Matrix.Translation((kx, ky, DJ_DECK))

        def knurl(x, y, z, j):
            a = math.atan2(y, x)
            return 1.0 + (0.07 * math.cos(6 * a) if j == 1 else 0.0)

        ck = "Ct" if i % 2 else "Cp"
        lathe(g, [(0.055, 0.0, "B"), (0.05, 0.04, "B"), (0.034, 0.056, ck), (0.0, 0.064, ck)], segs=12,
              radial=knurl, xform=X)
    sq8 = plan_ngon(4, chamfer=0.25, phase=PI / 4)
    for sx in (-1, 1):
        X = Matrix.Translation((sx * DJ_HORN_X, DJ_HORN_Y, 0)) @ rot_z(PI / 4)
        lathe(g, [(0.15, DJ_DECK, "L"), (0.15, DJ_DECK + 0.03, "B"), (0.12, DJ_DECK + 0.05, "L"),
                  (0.12, DJ_DECK + 0.09, "B"), (0.095, DJ_DECK + 0.12, "B"), (0.0, DJ_DECK + 0.12, "B")],
              plan=sq8, xform=X)
    # sunburst crest at the back of the deck
    yb = 0.47
    Xc = Matrix.Translation((0, yb, DJ_DECK)) @ Matrix.Rotation(PI / 2, 4, "X")
    arc = [(math.cos(PI * i / 16) * 0.44, math.sin(PI * i / 16) * 0.44) for i in range(17)]
    plate(g, arc, 0.03, -0.03, "L", "B", xform=Xc, bottom=True, bottom_key="L")
    for i in range(1, 8):
        a = PI * i / 8
        ca, sa = math.cos(a), math.sin(a)
        px, py = -sa, ca
        ray = [(ca * 0.12 + px * 0.022, sa * 0.12 + py * 0.022), (ca * 0.12 - px * 0.022, sa * 0.12 - py * 0.022),
               (ca * 0.42, sa * 0.42)]
        plate(g, ray, 0.045, 0.03, "B", xform=Xc)
    rim = [Vector((math.cos(PI * i / 16) * 0.445, yb, DJ_DECK + math.sin(PI * i / 16) * 0.445)) for i in range(17)]
    sweep(g, rim, [(0.025, 0), (0, 0.04), (-0.025, 0), (0, -0.04)], "B", up=(0, 1, 0))
    sun = [(math.cos(PI * i / 10) * 0.11, math.sin(PI * i / 10) * 0.11) for i in range(11)]
    plate(g, sun, 0.05, 0.0, "G", "B", xform=Xc, center_lift=0.02)
    # twin S-curved gramophone horns (neck up, swan back, bell sweeping outward / forward / up)
    for sx in (-1, 1):
        ctrl = [(0.0, 0.0, 0.0), (0.0, 0.0, 0.08), (0.0, 0.07, 0.18), (0.04, 0.11, 0.27), (0.12, 0.08, 0.34),
                (0.21, 0.0, 0.38), (0.30, -0.08, 0.42)]
        base = Vector((sx * DJ_HORN_X, DJ_HORN_Y, DJ_DECK + 0.11))
        path = [base + Vector((sx * p.x, p.y, p.z)) for p in catmull(ctrl, 2)]
        n = len(path)
        fr = frames(path, up=(0, 1, 0))
        radii = [0.032 + 0.225 * (i / (n - 1)) ** 3.0 for i in range(n)]
        segs = 18
        rings, keys = [], []

        def ring_at(i, r, push=0.0):
            T, N, S = fr[i]
            t = i / (n - 1)
            out = []
            for k in range(segs):
                a = TAU * k / segs
                rr = r * (1 + 0.022 * t * t * math.cos(6 * a))  # six paneled lobes on the bell
                out.append(path[i] + T * push + (S * math.cos(a) + N * math.sin(a)) * rr)
            return out

        for i in range(n):
            rings.append(ring_at(i, radii[i]))
            keys.append("B")
        rings.append(ring_at(n - 1, radii[-1] * 1.06, 0.012))
        keys.append("B")
        rings.append(ring_at(n - 1, radii[-1] * 1.02, 0.028))
        keys.append("B")
        rings.append(ring_at(n - 1, radii[-1] * 0.95, 0.016))
        keys.append("B")
        for i in range(n - 1, int(n * 0.5), -1):
            rings.append(ring_at(i, radii[i] * 0.92, -0.004))
            keys.append("Bd" if i > n - 3 else "Ht")
        loft(g, rings, keys, cap_start=False, cap_end="Ld")
    parts.append(g.obj(M, sharp_deg=36.0))

    # stationary articulated tonearm
    t = Geo("Tonearm")
    px, py = 0.48, 0.12
    X = Matrix.Translation((px, py, DJ_DECK))
    lathe(t, [(0.075, 0.0, "B"), (0.07, 0.02, "L"), (0.06, 0.03, "B"), (0.04, 0.05, "B"), (0.03, 0.12, "B"),
              (0.042, 0.13, "B"), (0.042, 0.16, "B"), (0.0, 0.16, "B")], segs=16, xform=X)
    pivot = Vector((px, py, DJ_DECK + 0.145))
    # counterweight behind the pivot
    away = Vector((0.6, 0.8, 0)).normalized()
    cw = pivot + away * 0.09
    sweep(t, [pivot, cw], [(0.012, 0), (0, 0.012), (-0.012, 0), (0, -0.012)], "B", up=(0, 0, 1))
    lathe(t, [(0.0, -0.035, "B"), (0.035, -0.03, "B"), (0.04, 0.0, "B"), (0.035, 0.03, "B"), (0.0, 0.035, "B")],
          segs=12, xform=Matrix.Translation(cw + away * 0.03) @ align_z(away))
    rec_c = Vector((DJ_PLATTER[0], DJ_PLATTER[1], DJ_PLATTER[2]))
    head = Vector((0.16, -0.30, DJ_PLATTER[2] + 0.045))
    elbow = pivot + (head - pivot) * 0.55 + Vector((0.06, 0.0, 0.0))
    arm = catmull([pivot, elbow, head], 4)
    sweep(t, arm, [(0.011, 0), (0, 0.011), (-0.011, 0), (0, -0.011)], "B", up=(0, 0, 1))
    # headshell + crystal stylus
    d = (head - elbow).normalized()
    Xh = Matrix.Translation(head) @ rot_z(math.atan2(d.y, d.x))
    plate(t, [(-0.01, -0.025), (0.06, -0.02), (0.07, 0.0), (0.06, 0.02), (-0.01, 0.025)], 0.008, -0.012, "B",
          xform=Xh)
    gem(t, [(0.0, -0.005, "Ct"), (0.012, -0.018, "Ct"), (0.0, -0.04, "Ct")], segs=4,
        xform=Xh @ Matrix.Translation((0.045, 0, 0)))
    parts.append(t.obj(M, sharp_deg=36.0))
    static = bake_and_join(parts, "DJGramophone")

    # TurntablePlatter (animated)
    p = Geo("TurntablePlatter")
    cx, cy, cz = DJ_PLATTER
    X = Matrix.Translation((cx, cy, 0))

    def strobe(x, y, z, j):
        a = math.atan2(y, x)
        return 1.0 + (0.014 if (math.cos(20 * a) > 0 and j in (2, 3)) else 0.0)

    lathe(p, [(0.0, DJ_DECK + 0.02, "B"), (0.37, DJ_DECK + 0.02, "B"), (0.385, DJ_DECK + 0.03, "B"),
              (0.385, cz - 0.03, "B"), (0.372, cz - 0.016, "B"), (0.0, cz - 0.016, "B")], segs=40, radial=strobe,
          xform=X)
    # ribbed vinyl (concentric groove ridges) with the star-chart emissive map
    prof = [(0.0, cz - 0.016, "V"), (0.335, cz - 0.016, "V")]
    for k, r in enumerate(np.linspace(0.33, 0.115, 5)):
        prof.append((float(r), cz + (0.0035 if k % 2 else 0.0), "V"))
    prof += [(0.11, cz + 0.004, "Lb"), (0.0, cz + 0.004, "Lb")]
    lathe(p, prof, segs=40, xform=X)
    # spindle spire
    gem(p, [(0.018, cz + 0.004, "C"), (0.018, cz + 0.03, "C"), (0.012, cz + 0.07, "C"), (0.0, cz + 0.11, "C")],
        segs=6, xform=X, alternate=False)
    po = p.obj(M, sharp_deg=30.0)
    # planar UVs for the vinyl star chart
    me = po.data
    uvl = me.uv_layers.active.data
    vslot = p.keys.index("V")
    for poly in me.polygons:
        if poly.material_index == vslot:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uvl[li].uv = (0.5 + (co.x - cx) / 0.67, 0.5 + (co.y - cy) / 0.67)
    plat = bake_and_join([po], "TurntablePlatter")
    set_pivot(plat, DJ_PLATTER)
    return static, plat


# ===========================================================================
# 3. Chime totem
# ===========================================================================

CT_PIVOT = (0.0, 0.0, 3.25)


def build_totem(M):
    g = Geo("Totem")
    hexp = plan_ngon(6, chamfer=0.10)
    lathe(g, [
        (0.66, 0.0, "L"), (0.66, 0.09, "B"), (0.685, 0.11, "B"), (0.685, 0.16, "B"), (0.66, 0.18, "L"),
        (0.57, 0.23, "L"), (0.57, 0.46, "B"), (0.60, 0.48, "B"), (0.60, 0.55, "B"), (0.56, 0.58, "L"),
        (0.44, 0.64, "L"), (0.36, 0.66, "L"),
    ], plan=hexp, tile=0.8)
    # chevron inlays on the plinth faces
    for k in range(6):
        a = k * TAU / 6
        Xp = rot_z(a) @ place(x=0.57, z=0.345) @ Matrix.Rotation(PI / 2, 4, "Y") @ Matrix.Rotation(PI / 2, 4, "Z")
        key = "T" if k % 2 == 0 else "G"
        for arm in ([(-0.12, -0.03), (0.0, 0.06), (0.0, 0.12), (-0.12, 0.03)],
                    [(0.0, 0.06), (0.12, -0.03), (0.12, 0.03), (0.0, 0.12)]):
            plate(g, [(x, y - 0.045) for x, y in arm], 0.016, -0.004, key, "B", xform=Xp)
    # base moulding + fluted, gently tapering pillar
    lathe(g, [(0.36, 0.66, "B"), (0.37, 0.70, "B"), (0.35, 0.75, "B"), (0.30, 0.78, "L"), (0.285, 0.82, "B"),
              (0.30, 0.85, "B"), (0.27, 0.88, "L")], segs=24)

    def flutes(x, y, z, j):
        a = math.atan2(y, x)
        return 1.0 - 0.09 * math.sqrt(abs(math.cos(3 * a)))

    lathe(g, [(0.27, 0.88, "L"), (0.245, 1.50, "L"), (0.215, 2.30, "L")], segs=24, radial=flutes)
    # glowing rune flutes: teal strip + gold rune diamonds in every flute
    for k in range(6):
        a = k * TAU / 6
        u = Vector((math.cos(a), math.sin(a), 0))

        def rr(z):
            return (0.27 + (0.215 - 0.27) * (z - 0.88) / (2.30 - 0.88)) * (1 - 0.09) + 0.006

        z0, z1 = 0.98, 2.20
        pts = [u * rr(z) + Vector((0, 0, z)) for z in (z0, z0 + 0.03, z1 - 0.03, z1)]
        sweep(g, pts, [(0.012, 0), (0, 0.010), (-0.012, 0), (0, -0.010)], "T", scale=[0, 1, 1, 0],
              up=(u.x, u.y, 0))
        for m in range(5):
            z = 1.12 + m * 0.24 + (0.12 if k % 2 else 0.0)
            if z > 2.15:
                continue
            X = Matrix.Translation(u * (rr(z) + 0.008) + Vector((0, 0, z))) @ rot_z(a) @ Matrix.Rotation(PI / 2, 4, "Y")
            gem(g, [(0.0, -0.022, "G"), (0.026, 0.0, "G"), (0.0, 0.03, "G")], segs=4, alternate=False, xform=X)
    # lotus capital that splits into the prongs
    def petals(x, y, z, j):
        a = math.atan2(y, x)
        t = min(1.0, max(0.0, (z - 2.30) / 0.22))
        return 1.0 + 0.22 * t * ((0.5 + 0.5 * math.cos(6 * a + PI)) ** 1.5 - 0.3)

    lathe(g, [(0.205, 2.28, "B"), (0.235, 2.31, "B"), (0.235, 2.36, "B"), (0.22, 2.38, "B"), (0.27, 2.46, "B"),
              (0.33, 2.52, "B"), (0.29, 2.55, "L"), (0.0, 2.55, "L")], segs=24, radial=petals)
    lathe(g, [(0.20, 2.545, "B"), (0.17, 2.60, "B"), (0.09, 2.65, "B"), (0.05, 2.66, "Ct"), (0.0, 2.66, "Ct")],
          segs=12)
    gem(g, [(0.0, 2.64, "Ct"), (0.045, 2.68, "Ct"), (0.0, 2.75, "Ct")], segs=6)
    # twin lyre / tuning-fork prongs
    sec = [(0.046 * math.cos(TAU * k / 10), 0.072 * math.sin(TAU * k / 10)) for k in range(10)]
    for sx in (-1, 1):
        ctrl = [(0.10, 2.46), (0.22, 2.64), (0.42, 2.92), (0.535, 3.25), (0.52, 3.60), (0.43, 3.90), (0.35, 4.08),
                (0.315, 4.22)]
        path = [Vector((sx * p.x, 0.0, p.z)) for p in catmull([Vector((x, 0, z)) for x, z in ctrl], 5)]
        n = len(path)
        sc = [(1.0 - 0.35 * (i / (n - 1)), 1.0 - 0.40 * (i / (n - 1))) for i in range(n)]
        sweep(g, path, sec, "B", scale=sc, up=(0, -1, 0))
        # brass collar mid-prong and crystal finial on the tip
        T = (path[-1] - path[-2]).normalized()
        tip = path[-1]
        Xf = Matrix.Translation(tip)
        lathe(g, [(0.0, -0.02, "B"), (0.045, 0.0, "B"), (0.05, 0.03, "B"), (0.03, 0.05, "B"), (0.0, 0.05, "B")],
              segs=8, xform=Xf)
        key = "Ct"
        gem(g, [(0.0, 0.04, key), (0.045, 0.07, key), (0.0, 0.20, key)], segs=6, xform=Xf)
        mid = path[n // 2]
        Tm = (path[n // 2 + 1] - path[n // 2 - 1]).normalized()
        Xm = Matrix.Translation(mid) @ Matrix.Rotation(math.atan2(Tm.x, Tm.z), 4, "Y")
        lathe(g, [(0.050, -0.03, "B"), (0.062, -0.02, "B"), (0.062, 0.02, "B"), (0.050, 0.03, "B")], segs=10,
              xform=Xm, plan=[(math.cos(t) * 1.0, math.sin(t) * 1.7) for t in [TAU * k / 10 for k in range(10)]],
              cap_start=False)
    static = bake_and_join([g.obj(M, sharp_deg=36.0)], "ChimeTotem")

    c = Geo("ChimeCrystal")
    cz = CT_PIVOT[2]
    gem(c, [(0.0, cz - 0.56, "Cc"), (0.11, cz - 0.30, "Cc"), (0.19, cz - 0.05, "Cc"), (0.19, cz + 0.05, "Cc"),
            (0.11, cz + 0.30, "Cc"), (0.0, cz + 0.58, "Cc")], segs=8)
    # brass girdle bezel
    lathe(c, [(0.172, cz - 0.03, "B"), (0.205, cz - 0.025, "B"), (0.212, cz, "T"), (0.205, cz + 0.025, "B"),
              (0.172, cz + 0.03, "B")], segs=16, phase=PI / 16, closed_profile=True)
    for ang, axis in ((math.radians(28), "X"), (math.radians(-24), "Y")):
        X = Matrix.Translation((0, 0, cz)) @ Matrix.Rotation(ang, 4, axis)
        r = 0.36 if axis == "X" else 0.33
        lathe(c, [(r - 0.012, 0.0, "B"), (r, -0.018, "B"), (r + 0.012, 0.0, "B"), (r, 0.018, "B")], segs=36,
              closed_profile=True, xform=X)
    co = bake_and_join([c.obj(M, sharp_deg=30.0)], "ChimeCrystal")
    set_pivot(co, CT_PIVOT)
    return static, co


# ===========================================================================
# 4. Star fountain launch pad
# ===========================================================================

SF_PIVOT = (0.0, 0.0, 0.24)


def build_fountain(M):
    g = Geo("StarFountain")
    oct_plan = plan_ngon(8, chamfer=0.16)
    prof = [(1.65, 0.0, "L"), (1.645, 0.012, "L"), (1.61, 0.03, "L"), (1.285, 0.15, "B"), (1.255, 0.17, "B"),
            (1.215, 0.18, "B"), (1.165, 0.178, "B"), (1.135, 0.168, "L"), (1.112, 0.15, "B"), (1.10, 0.14, "B"),
            (1.06, 0.14, "B")]
    lathe(g, prof, plan=oct_plan, tile=0.9)

    def ramp_z(x, y):
        """Rim height under (x, y): the profile radii are apothems of the octagon."""
        ap = max(x * math.cos(k * PI / 4) + y * math.sin(k * PI / 4) for k in range(8))
        rs = [p[0] for p in prof[2:4]]
        zs = [p[1] for p in prof[2:4]]
        return float(np.interp(-min(max(ap, rs[-1]), rs[0]), [-r for r in rs], zs))

    def petal(angle, length, width, centre):
        """Pointed lotus petal outline lying along the ramp (inner end rounded, outer end a tip)."""
        ca, sa = math.cos(angle), math.sin(angle)
        side = []
        for i in range(8):
            t = -1 + 2 * i / 7
            hw = width * math.sqrt(max(0.0, 1 - t * t)) ** 0.8 * (1 - 0.35 * t)
            side.append((centre + t * length, hw))
        pts = [(r, -h) for r, h in side] + [(r, h) for r, h in reversed(side[1:-1])]
        return [(ca * r - sa * w, sa * r + ca * w) for r, w in pts]

    # lotus petal inlays: eight on the ramp facets, eight smaller on the chamfered corners
    for k in range(8):
        a = k * PI / 4
        plate(g, petal(a, 0.135, 0.085, 1.45), lambda x, y: ramp_z(x, y) + 0.008,
              lambda x, y: ramp_z(x, y) - 0.02, "B", center_lift=0.006)
        a2 = a + PI / 8
        plate(g, petal(a2, 0.10, 0.05, 1.44 / math.cos(PI / 8)), lambda x, y: ramp_z(x, y) + 0.008,
              lambda x, y: ramp_z(x, y) - 0.02, "Bd", center_lift=0.005)
        rc = 1.19 / math.cos(PI / 8) * 0.985
        X = Matrix.Translation((math.cos(a2) * rc, math.sin(a2) * rc, 0.18))
        gem(g, [(0.0, -0.01, "Ct"), (0.03, 0.006, "Ct"), (0.0, 0.026, "Ct")], segs=4, alternate=False, xform=X)
    # recessed crystal lens with a compass star
    lathe(g, [(1.06, 0.14, "Ln"), (0.0, 0.14, "Ln")], segs=48)
    plate(g, star_outline(8, 1.0, 0.30, phase=0.0, long_short=(1.0, 0.72)), 0.144, 0.13, "G", "G",
          center_lift=0.018)
    plate(g, star_outline(8, 0.62, 0.22, phase=PI / 8), 0.142, 0.13, "T", "T", center_lift=0.012)
    lathe(g, [(0.92, 0.135, "B"), (0.95, 0.135, "B"), (0.95, 0.147, "B"), (0.92, 0.147, "B")], segs=48,
          closed_profile=True)
    for k in range(16):
        a = k * TAU / 16
        X = Matrix.Translation((math.cos(a) * 1.00, math.sin(a) * 1.00, 0.14)) @ rot_z(a)
        plate(g, [(-0.035, -0.008), (0.035, -0.008), (0.035, 0.008), (-0.035, 0.008)], 0.006, -0.004, "B",
              xform=X)
    static = bake_and_join([g.obj(M, sharp_deg=34.0)], "StarFountain")

    r = Geo("GeyserRing")
    cz = SF_PIVOT[2]
    rr = 1.02
    lathe(r, [(rr - 0.05, cz - 0.03, "B"), (rr + 0.05, cz - 0.03, "B"), (rr + 0.065, cz - 0.012, "P"),
              (rr + 0.065, cz + 0.012, "B"), (rr + 0.05, cz + 0.03, "B"), (rr - 0.05, cz + 0.03, "B"),
              (rr - 0.062, cz + 0.008, "T"), (rr - 0.062, cz - 0.008, "B")], segs=48, closed_profile=True)
    lathe(r, [(0.86, cz - 0.012, "Bd"), (0.88, cz, "Bd"), (0.86, cz + 0.012, "Bd"), (0.84, cz, "Bd")], segs=32,
          closed_profile=True)
    for k in range(16):
        a = k * TAU / 16 + PI / 16
        p0 = Vector((math.cos(a) * 0.86, math.sin(a) * 0.86, cz))
        p1 = Vector((math.cos(a) * (rr - 0.05), math.sin(a) * (rr - 0.05), cz))
        sweep(r, [p0, p1], [(0.008, 0), (0, 0.008), (-0.008, 0), (0, -0.008)], "Bd", up=(0, 0, 1))
    for k in range(8):
        a = k * TAU / 8
        X = Matrix.Translation((math.cos(a) * rr, math.sin(a) * rr, cz + 0.03)) @ rot_z(a)
        plate(r, star_outline(4, 0.085, 0.028, phase=0.0), 0.012, -0.004, "B", "B", xform=X, center_lift=0.012)
        X2 = Matrix.Translation((math.cos(a + PI / 8) * rr, math.sin(a + PI / 8) * rr, cz + 0.03))
        gem(r, [(0.0, -0.004, "Cp"), (0.022, 0.006, "Cp"), (0.0, 0.03, "Cp")], segs=4, alternate=False, xform=X2)
    ro = bake_and_join([r.obj(M, sharp_deg=34.0)], "GeyserRing")
    set_pivot(ro, SF_PIVOT)
    return static, ro


# ===========================================================================
# Driver
# ===========================================================================

ASSETS = {
    "gazebo": "dance_gazebo",
    "gramophone": "dj_gramophone",
    "totem": "chime_totem",
    "fountain": "star_fountain",
}


def run_one(key: str, render: bool, tile: int) -> dict:
    reset_scene()
    M = build_materials(need_vinyl=(key == "gramophone"))
    if key == "gazebo":
        static = gazebo_structure(M)
        anim = gazebo_chandelier(M)
        views = [("front", (0, -1, 0.10), 40, None), ("q3", (0.8, -1, 0.55), 40, None),
                 ("side", (1, 0, 0.10), 40, None), ("top", (0.0, -0.02, 1), 40, None)]
        lo_c, hi_c = world_bounds([anim])
        extra = [("chandelier", (0.55, -1, 0.35), 60, (lo_c, hi_c), [static]),
                 ("interior", {"pos": (1.5, -7.5, 1.7), "target": (0.0, 0.0, 7.4)}, 16, None)]
    elif key == "gramophone":
        static, anim = build_gramophone(M)
        views = [("front", (0, -1, 0.12), 50, None), ("q3", (0.8, -1, 0.6), 50, None),
                 ("side", (1, 0, 0.12), 50, None)]
        lo_c, hi_c = world_bounds([anim])
        views.append(("detail", (0.35, -0.8, 0.9), 50, (lo_c - Vector((0.05, 0.05, 0.05)), hi_c + Vector((0.25, 0.3, 0.08)))))
        extra = [("back", (-0.6, 1, 0.5), 50, None)]
    elif key == "totem":
        static, anim = build_totem(M)
        views = [("front", (0, -1, 0.10), 50, None), ("q3", (0.8, -1, 0.45), 50, None),
                 ("side", (1, 0, 0.10), 50, None)]
        lo_c, hi_c = world_bounds([anim])
        views.append(("detail", (0.6, -1, 0.3), 60, (lo_c - Vector((0.45, 0.2, 0.25)), hi_c + Vector((0.45, 0.2, 0.25)))))
        extra = [("base", (0.6, -1, 0.5), 60, (Vector((-0.7, -0.7, 0)), Vector((0.7, 0.7, 1.6))))]
    else:
        static, anim = build_fountain(M)
        views = [("front", (0, -1, 0.18), 50, None), ("q3", (0.8, -1, 0.7), 50, None),
                 ("side", (1, 0, 0.18), 50, None), ("top", (0.0, -0.02, 1), 50, None)]
        extra = [("detail", (0.3, -1, 0.5), 60, (Vector((-0.2, -1.3, 0)), Vector((1.3, 0.1, 0.32))))]
    objs = [static, anim]
    bpy.context.view_layer.update()
    lo, hi = world_bounds(objs)
    path = os.path.join(ASSET_DIR, ASSETS[key] + ".glb")
    size = export_glb(objs, path)
    metrics = {
        "asset": ASSETS[key], "glb": os.path.relpath(path, REPO).replace("\\", "/"), "bytes": size,
        "tris": tri_count(static) + tri_count(anim), "trisStatic": tri_count(static), "trisAnimated": tri_count(anim),
        "animatedNode": anim.name, "pivot": [round(c, 4) for c in anim.location],
        "size": [round(hi.x - lo.x, 3), round(hi.y - lo.y, 3), round(hi.z - lo.z, 3)],
        "minZ": round(lo.z, 4), "center": [round((lo.x + hi.x) / 2, 3), round((lo.y + hi.y) / 2, 3)],
        "materials": sorted({m.name for o in objs for m in o.data.materials}),
    }
    if render:
        metrics["sheet"] = os.path.relpath(render_sheet(ASSETS[key], objs, views, tile=tile, extra=extra),
                                           REPO).replace("\\", "/")
    print("STARLIGHT_ASSET " + json.dumps(metrics))
    return metrics


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="gazebo,gramophone,totem,fountain")
    ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--tile", type=int, default=800)
    args = ap.parse_args(argv)
    results = []
    for key in [k.strip() for k in args.only.split(",") if k.strip()]:
        results.append(run_one(key, not args.no_render, args.tile))
    os.makedirs(RENDER_DIR, exist_ok=True)
    mpath = os.path.join(RENDER_DIR, "metrics.json")
    old = {}
    if os.path.isfile(mpath):
        try:
            old = {m["asset"]: m for m in json.load(open(mpath))}
        except Exception:
            old = {}
    for m in results:
        old[m["asset"]] = m
    json.dump(list(old.values()), open(mpath, "w"), indent=2)


if __name__ == "__main__":
    main()
