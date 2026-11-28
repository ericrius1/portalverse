"""
Portalverse AA NPCs, Batch C (Keepers 11-15):
  ermelin  - Ermelin, Lantern Warden of the Snow Run        (1.48 m)
  myrrow   - Myrrow, Warden Who Listens Underground          (2.15 m)
  halcyon  - Halcyon Vey, Cartographer of the Sky            (1.62 m)
  dre      - Dre Honeycutt, Block Beekeeper                  (1.88 m)
  lulu     - Lulu Static, Tea-Stall Keeper and Ex-Pirate DJ  (1.55 m)

Run headless (all five, or a subset by id):
  blender.exe -b --factory-startup -P tools/npcs/build_batch_c.py
  blender.exe -b --factory-startup -P tools/npcs/build_batch_c.py -- ermelin lulu

Outputs:
  public/assets/npcs/<id>/model.glb        (uncompressed, skinned, embedded PBR)
  tools/npcs/renders/<id>_sheet.png         (4-view review sheet)
  tools/npcs/renders/batch_c_metrics.json   (tris / bones / height / bytes)

Conventions follow tools/npcs/blender_kit.py: feet on Z = 0, facing -Y (glTF +Z),
standard humanoid bones from `create_humanoid_armature` (re-fitted to each
keeper's anatomy so Head/Jaw/Eye pivots sit where the geometry is), parts
joined + weighted through `bind_parts_to_bones`. Limbs, torsos, tails and
skirts that span several bones are then re-weighted with a smooth
distance-to-bone falloff so breathing, head turns and gestures bend softly.
"""

from __future__ import annotations

import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import blender_kit as K  # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
TEX = os.path.join(HERE, "textures")
TAU = math.tau


# ---------------------------------------------------------------------------
# Small maths helpers
# ---------------------------------------------------------------------------

def V(*a) -> Vector:
    if len(a) == 1:
        return Vector(a[0])
    return Vector(a)


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def mirror(p):
    return (-p[0], p[1], p[2])


def catmull(points, samples=4):
    """Densify a polyline with a Catmull-Rom spline (keeps the end points)."""
    pts = [V(p) for p in points]
    if len(pts) < 3:
        return [tuple(p) for p in pts]
    out = []
    ext = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(q))
    out.append(tuple(pts[-1]))
    return out


def resample(values, n):
    """Linearly resample a list of floats to n entries."""
    if len(values) == n:
        return list(values)
    out = []
    for i in range(n):
        t = i / max(1, n - 1) * (len(values) - 1)
        k = min(int(t), len(values) - 2)
        out.append(lerp(values[k], values[k + 1], t - k))
    return out


# ---------------------------------------------------------------------------
# Object helpers
# ---------------------------------------------------------------------------

def bake(obj):
    """Apply loc/rot/scale so vertex coordinates are world coordinates."""
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def deform(obj, fn):
    bake(obj)
    me = obj.data
    for v in me.vertices:
        v.co = V(fn(v.co.copy()))
    me.update()
    return obj


def recalc(obj, inside=False):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if inside:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def flip(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def cut(obj, keep):
    """Delete vertices for which keep(co) is False (world space)."""
    bake(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    dead = [v for v in bm.verts if not keep(v.co)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def solidify(obj, thickness=0.01, offset=-1.0):
    mod = obj.modifiers.new("Solid", "SOLIDIFY")
    mod.thickness = thickness
    mod.offset = offset
    mod.use_even_offset = True
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    K.set_smooth(obj)
    return obj


def subsurf(obj, levels=1):
    return K.add_subsurf(obj, levels=levels, apply_mod=True)


def decimate(obj, ratio):
    mod = obj.modifiers.new("Dec", "DECIMATE")
    mod.ratio = ratio
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    K.set_smooth(obj)
    return obj


def dup(obj, name):
    o = obj.copy()
    o.data = obj.data.copy()
    o.name = name
    bpy.context.collection.objects.link(o)
    return o


def mirror_obj(obj, name):
    o = dup(obj, name)
    bake(o)
    for v in o.data.vertices:
        v.co.x = -v.co.x
    flip(o)
    return o


def tri_count(objs):
    n = 0
    for o in objs:
        if o and o.type == "MESH":
            n += sum(max(1, len(p.vertices) - 2) for p in o.data.polygons)
    return n


def stripe_materials(obj, mats, axis_fn, period, duty=0.5):
    """Assign alternating materials per face using a scalar function of the face centre."""
    bake(obj)
    me = obj.data
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        s = axis_fn(p.center)
        p.material_index = 0 if (s / period) % 1.0 < duty else 1
    return obj


# ---------------------------------------------------------------------------
# Loft / ring builders (bespoke garments, bodies, caps)
# ---------------------------------------------------------------------------

def ring(z, rx, ryf, ryb=None, *, n=24, x0=0.0, y0=0.0, a0=None, a1=None, sq=2.0, rfn=None):
    """
    Super-elliptical ring at height z. Front is -Y, so `ryf` is the front depth and
    `ryb` the back depth. Closed by default; give a0/a1 (radians, CCW from +X) for an
    open arc that includes both end points. `rfn(a, z)` scales the radius (quilting,
    pleats, bark furrows).
    """
    ryb = ryf if ryb is None else ryb
    pts = []
    closed = a0 is None
    if closed:
        angles = [i / n * TAU for i in range(n)]
    else:
        angles = [lerp(a0, a1, i / (n - 1)) for i in range(n)]
    e = 2.0 / sq
    for a in angles:
        c, s = math.cos(a), math.sin(a)
        cx = math.copysign(abs(c) ** e, c)
        sy = math.copysign(abs(s) ** e, s)
        ry = ryf if s < 0 else ryb
        k = rfn(a, z) if rfn else 1.0
        pts.append((x0 + rx * cx * k, y0 + ry * sy * k, z))
    return pts


def loft(name, rings, *, closed=True, cap_start=False, cap_end=False, mat=None, u_scale=1.0, v_scale=1.0):
    """Skin a list of equal-length point rings (ordered bottom->top, CCW) into quads with UVs."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    vr = [[bm.verts.new(p) for p in r] for r in rings]
    n = len(rings[0])
    m = n if closed else n - 1
    # arc-length v coordinate
    vs = [0.0]
    for i in range(1, len(rings)):
        ca = sum((V(p) for p in rings[i]), Vector()) / n
        cb = sum((V(p) for p in rings[i - 1]), Vector()) / n
        vs.append(vs[-1] + (ca - cb).length + 1e-4)
    for i in range(len(rings) - 1):
        for j in range(m):
            jn = (j + 1) % n
            try:
                f = bm.faces.new((vr[i][j], vr[i][jn], vr[i + 1][jn], vr[i + 1][j]))
            except ValueError:
                continue
            f.smooth = True
            u0, u1 = j / m * u_scale, (j + 1) / m * u_scale
            f.loops[0][uvl].uv = (u0, vs[i] * v_scale)
            f.loops[1][uvl].uv = (u1, vs[i] * v_scale)
            f.loops[2][uvl].uv = (u1, vs[i + 1] * v_scale)
            f.loops[3][uvl].uv = (u0, vs[i + 1] * v_scale)
    for cap, rr, rev in ((cap_start, vr[0], True), (cap_end, vr[-1], False)):
        if cap:
            c = bm.verts.new(sum((v.co for v in rr), Vector()) / len(rr))
            for j in range(m):
                jn = (j + 1) % n
                try:
                    tri = (c, rr[jn], rr[j]) if rev else (c, rr[j], rr[jn])
                    bm.faces.new(tri).smooth = True
                except ValueError:
                    pass
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    if mat:
        K.assign_material(obj, mat)
    K.set_smooth(obj)
    return obj


def etube(name, points, rx, ry=None, *, hint=(0, 0, 1), segments=12, mat=None, cap=True, samples=0, twist=None):
    """
    Tube with an elliptical cross-section (rx along `hint` projected off the tangent,
    ry across). Good for scarves, straps, fingers, roots, ribbons and towels.
    """
    pts = catmull(points, samples) if samples else [tuple(p) for p in points]
    n = len(pts)
    rxs = resample(list(rx) if isinstance(rx, (list, tuple)) else [rx, rx], n)
    ry = rx if ry is None else ry
    rys = resample(list(ry) if isinstance(ry, (list, tuple)) else [ry, ry], n)
    tw = resample(list(twist), n) if twist else [0.0] * n
    P = [V(p) for p in pts]
    rings = []
    h = V(hint).normalized()
    for i in range(n):
        if i == 0:
            t = P[1] - P[0]
        elif i == n - 1:
            t = P[-1] - P[-2]
        else:
            t = P[i + 1] - P[i - 1]
        t.normalize()
        a = h - t * h.dot(t)
        if a.length < 1e-4:
            a = V(1, 0, 0) - t * t.x
        a.normalize()
        b = t.cross(a).normalized()
        if tw[i]:
            ca, sa = math.cos(tw[i]), math.sin(tw[i])
            a, b = a * ca + b * sa, b * ca - a * sa
        r = []
        for s in range(segments):
            ang = s / segments * TAU
            r.append(tuple(P[i] + a * (math.cos(ang) * rxs[i]) + b * (math.sin(ang) * rys[i])))
        rings.append(r)
    obj = loft(name, rings, closed=True, cap_start=cap, cap_end=cap, mat=mat)
    recalc(obj)
    return obj


def tube(name, points, radii, *, segments=12, mat=None, samples=3, cap=True):
    pts = catmull(points, samples) if samples else points
    rr = resample(list(radii) if isinstance(radii, (list, tuple)) else [radii, radii], len(pts))
    return K.make_tube(name, pts, rr, segments=segments, mat=mat, cap_ends=cap)


def lathe(name, profile, *, segments=24, mat=None, cap_bottom=True, cap_top=True, rfn=None, center=(0, 0, 0)):
    """Kit lathe with an optional radius modulation applied afterwards."""
    obj = K.make_lathe(name, profile, segments=segments, mat=mat, cap_bottom=cap_bottom, cap_top=cap_top, center=center)
    if rfn:
        def f(co):
            a = math.atan2(co.y - center[1], co.x - center[0])
            k = rfn(a, co.z)
            return (center[0] + (co.x - center[0]) * k, center[1] + (co.y - center[1]) * k, co.z)
        deform(obj, f)
    return obj


def sphere(name, r, loc, *, seg=20, rings=14, mat=None, rot=(0, 0, 0)):
    return K.make_sphere(name, r, location=loc, rotation=rot, segments=seg, rings=rings, mat=mat)


def metaball_mesh(name, balls, *, resolution=0.03, threshold=0.6, mat=None, max_tris=None):
    """
    Blobby organic surface from metaballs (cloud hair, beards, moss, fur ruffs).
    balls: list of (x, y, z, radius[, (sx, sy, sz)]).
    """
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = threshold
    for b in balls:
        el = mb.elements.new()
        el.co = (b[0], b[1], b[2])
        el.radius = b[3]
        if len(b) > 4:
            el.type = "ELLIPSOID"
            el.size_x, el.size_y, el.size_z = b[4]
    obj = bpy.data.objects.new(name + "_mb", mb)
    bpy.context.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.context.view_layer.update()
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.active_object
    mesh_obj.name = name
    mesh_obj.select_set(False)
    if max_tris:
        t = tri_count([mesh_obj])
        if t > max_tris:
            decimate(mesh_obj, max_tris / t)
    if mat:
        K.assign_material(mesh_obj, mat)
    K.set_smooth(mesh_obj)
    return mesh_obj


def frame_transform(obj, origin, xaxis, yaxis, zaxis):
    """Map local (x, y, z) -> origin + x*X + y*Y + z*Z (handles mirrored frames)."""
    bake(obj)
    X, Y, Z, O = V(xaxis), V(yaxis), V(zaxis), V(origin)
    for v in obj.data.vertices:
        c = v.co.copy()
        v.co = O + X * c.x + Y * c.y + Z * c.z
    obj.data.update()
    det = X.cross(Y).dot(Z)
    if det < 0:
        flip(obj)
    return obj


# ---------------------------------------------------------------------------
# Anatomy builders
# ---------------------------------------------------------------------------

def make_hand(name, wrist, fwd, thumb, side, *, scale=1.0, curl=0.35, mat=None, mitten=False,
              fingers=4, finger_len=1.0, finger_r=1.0, knuckle_mat=None, splay=1.0):
    """
    Stylized hand. Local frame: x = thumb side, y = finger direction, z = back of hand.
    `curl` 0 = flat open hand, 1 = closed fist around an axis along local x.
    """
    s = scale
    F = V(fwd).normalized()
    T = (V(thumb) - F * V(thumb).dot(F)).normalized()
    B = T.cross(F) if side == "L" else -T.cross(F)
    parts = []
    palm = sphere(f"{name}_palm", (0.040 * s, 0.050 * s, 0.017 * s), (0, 0.045 * s, 0), seg=16, rings=10, mat=mat)
    deform(palm, lambda c: (c.x * (1 + 0.15 * c.y / (0.05 * s)), c.y, c.z + 0.004 * s * (1 - (c.x / (0.04 * s)) ** 2)))
    parts.append(palm)
    if mitten:
        # One soft mitten mass + thumb (felted)
        pts = []
        for k in range(5):
            a = k / 4 * (1.0 + curl * 1.6)
            pts.append((0, 0.06 * s + math.sin(a) * 0.045 * s, -(1 - math.cos(a)) * 0.045 * s))
        m = etube(f"{name}_mitt", pts, [0.036 * s, 0.040 * s, 0.038 * s, 0.032 * s, 0.016 * s],
                  [0.020 * s, 0.022 * s, 0.022 * s, 0.020 * s, 0.012 * s], hint=(1, 0, 0), segments=12, mat=mat, samples=2)
        parts.append(m)
        th = tube(f"{name}_mthumb", [(0.03 * s, 0.03 * s, -0.004 * s), (0.05 * s, 0.06 * s, -0.012 * s), (0.048 * s, 0.085 * s, -0.022 * s)],
                  [0.016 * s, 0.015 * s, 0.011 * s], segments=10, mat=mat, samples=2)
        parts.append(th)
    else:
        xs = [-0.027, -0.009, 0.009, 0.027][:fingers] if fingers == 4 else [-0.022, 0.0, 0.022][:fingers]
        lens = [0.030, 0.036, 0.040, 0.037] if fingers == 4 else [0.034, 0.040, 0.036]
        for i, x in enumerate(xs):
            L = lens[len(lens) - 1 - i] * finger_len * s if fingers == 4 else lens[i] * finger_len * s
            r = 0.0085 * s * finger_r
            pts = [(x * s * splay, 0.085 * s, 0.002 * s)]
            ang = 0.0
            p = V(pts[0])
            for k in range(3):
                ang += curl * (0.55 + 0.25 * k)
                seg = L * (0.42, 0.33, 0.25)[k]
                p = p + V(0, math.cos(ang), -math.sin(ang)) * seg
                pts.append(tuple(p))
            parts.append(tube(f"{name}_f{i}", pts, [r, r * 0.95, r * 0.85, r * 0.72], segments=7, mat=mat, samples=1))
        # thumb
        tc = curl * 0.9
        tp = [(0.030 * s, 0.022 * s, -0.006 * s)]
        d = V(0.55, 0.75, -0.35 - tc * 0.4).normalized()
        p = V(tp[0])
        for k in range(3):
            d = (d + V(-0.25 * tc, 0.1, -0.25 * tc)).normalized()
            p = p + d * 0.022 * s * finger_len
            tp.append(tuple(p))
        parts.append(tube(f"{name}_thumb", tp, [0.011 * s, 0.010 * s, 0.009 * s, 0.0075 * s], segments=7, mat=mat, samples=1))
    hand = K.join_objects(parts, name)
    frame_transform(hand, wrist, T, F, B)
    recalc(hand)
    return hand


def make_shoe(name, ankle, *, length, width, height, mat, sole_mat=None, toe_lift=0.01, sole_h=0.018,
              toe_round=1.0, heel_back=0.25, seg=24, rings=16):
    """Rounded shoe/boot foot shape with a flat sole at Z = 0, toe toward -Y."""
    ax, ay = ankle[0], ankle[1]
    cy = ay - length * (0.5 - heel_back)
    upper = sphere(f"{name}_up", (width * 0.5, length * 0.5, height), (ax, cy, sole_h), seg=seg, rings=rings, mat=mat)

    def f(c):
        x, y, z = c.x, c.y, c.z
        t = (cy - y) / (length * 0.5)  # +1 at toe
        # flatten the instep/heel, raise the toe a touch
        z = max(z, sole_h)
        if t > 0.2:
            z = z - (z - sole_h) * 0.35 * smooth(0.2, 1.0, t)
        if t > 0.7:
            z += toe_lift * smooth(0.7, 1.0, t)
        # wider forefoot, narrower heel
        x = ax + (x - ax) * (0.88 + 0.18 * smooth(-0.6, 0.4, t))
        return (x, y, z)

    deform(upper, f)
    parts = [upper]
    if sole_mat is not None:
        sole = lathe(f"{name}_sole", [(0.0, width * 0.52, length * 0.52, 0.0), (sole_h * 0.5, width * 0.54, length * 0.53, 0.0),
                                      (sole_h, width * 0.52, length * 0.515, 0.0)], segments=28, mat=sole_mat)
        deform(sole, lambda c: (ax + c.x * (0.9 + 0.16 * smooth(-0.3, 0.3, -c.y / (length * 0.5))), cy + c.y, c.z))
        parts.append(sole)
    return parts


def make_eyelid(name, eye_center, r, *, open_amt=0.6, mat, tilt=0.0, lower=False, side=1.0):
    """Upper (or lower) eyelid shell sitting just outside the eyeball."""
    lid = sphere(name, r * 1.12, (0, 0, 0), seg=16, rings=10, mat=mat)
    # keep upper cap above the cut plane; cut plane rotates down with open_amt
    cut_z = lerp(-0.2, 0.75, open_amt) * r * 1.12
    if lower:
        cut(lid, lambda c: c.z < -cut_z and c.y < 0.25 * r)
    else:
        cut(lid, lambda c: c.z > cut_z - 0.35 * max(0.0, -c.y) * 0.0 and c.y < 0.35 * r)
    rot = Matrix.Rotation(tilt * side, 4, "Y")
    for v in lid.data.vertices:
        v.co = rot @ v.co + V(eye_center)
    lid.data.update()
    solidify(lid, 0.0025 * (r / 0.0185), 1.0)
    return lid


# ---------------------------------------------------------------------------
# Rig fitting + smooth chain weights
# ---------------------------------------------------------------------------

def build_rig(npc_id, height, J, extras):
    """
    Kit armature, then re-fit every standard bone to the keeper's joints (J) so the
    runtime pivots match the sculpt. J holds both sides explicitly.
    """
    arm = K.create_humanoid_armature(npc_id, height=height, extra_bones=extras)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    def setb(n, h, t):
        b = eb[n]
        b.head = V(h)
        b.tail = V(t)
        b.roll = 0.0

    setb("Pelvis", J["pelvis"], J["spine"])
    setb("Spine", J["spine"], J["chest"])
    setb("Chest", J["chest"], J["neck"])
    setb("Neck", J["neck"], J["head"])
    setb("Head", J["head"], J["head_top"])
    setb("Jaw", J["jaw"], J["chin"])
    for s in ("L", "R"):
        e = V(J["eye" + s])
        setb("Eye" + s, e, e + V(0, -0.035, 0))
        setb("Shoulder" + s, J["clav" + s], J["sh" + s])
        setb("Arm" + s, J["sh" + s], J["el" + s])
        setb("Forearm" + s, J["el" + s], J["wr" + s])
        setb("Hand" + s, J["wr" + s], J["hd" + s])
        setb("Thigh" + s, J["hip" + s], J["kn" + s])
        setb("Shin" + s, J["kn" + s], J["an" + s])
        setb("Foot" + s, J["an" + s], J["toe" + s])
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.select_set(False)
    return arm


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(1e-9, ab.length_squared)))
    return (a + ab * t - p).length


def bind(arm, parts, mesh_name, *, power=6.0, max_inf=3):
    """
    parts: list of (obj, bone) or (obj, [bone, bone, ...]).
    Single-bone parts stay rigid (kit behaviour). Multi-bone parts get smooth
    distance-to-bone-segment weights across their listed chain.
    """
    bone_map = {}
    chains = []
    for obj, b in parts:
        bake(obj)
        if isinstance(b, (list, tuple)):
            chains.append(list(b))
            cid = len(chains)
            first = b[0]
        else:
            cid = 0
            first = b
        attr = obj.data.attributes.get("chain_id") or obj.data.attributes.new("chain_id", "INT", "POINT")
        attr.data.foreach_set("value", [cid] * len(obj.data.vertices))
        bone_map.setdefault(first, []).append(obj)

    if os.environ.get("NPC_PART_TRIS"):
        rows = sorted(((tri_count([o]), o.name) for o, _ in parts), reverse=True)
        print("PART_TRIS total=%d" % sum(r[0] for r in rows))
        for t, n in rows[:40]:
            print("   %6d  %s" % (t, n))
    merged = K.bind_parts_to_bones(arm, bone_map, mesh_name=mesh_name, smooth_weights=False)

    segs = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in arm.data.bones}
    cid_attr = merged.data.attributes["chain_id"]
    cids = [0] * len(merged.data.vertices)
    cid_attr.data.foreach_get("value", cids)
    groups = {vg.name: vg for vg in merged.vertex_groups}
    for vi, cid in enumerate(cids):
        if cid == 0:
            continue
        chain = chains[cid - 1]
        p = merged.data.vertices[vi].co
        ws = []
        for bn in chain:
            d = _seg_dist(p, *segs[bn])
            ws.append((1.0 / (d + 0.01) ** power, bn))
        ws.sort(reverse=True)
        ws = ws[:max_inf]
        tot = sum(w for w, _ in ws)
        for vg in merged.vertex_groups:
            vg.remove([vi])
        for w, bn in ws:
            if w / tot > 0.01:
                groups[bn].add([vi], w / tot, "REPLACE")
    merged.data.attributes.remove(merged.data.attributes["chain_id"])
    return merged


# ---------------------------------------------------------------------------
# Materials
# ---------------------------------------------------------------------------

def texset(tid, *maps):
    d = os.path.join(TEX, tid)
    keys = maps or ("albedo", "normal", "roughness")
    return {f"{m}_path": os.path.join(d, f"{m}.png") for m in keys}


def mat(name, color, **kw):
    return K.make_pbr_material(name, color, **kw)


def skin_set(prefix, skin, *, lip, brow, iris, sclera="#f4efe8", rough=0.5):
    return {
        "skin": mat(f"{prefix}_Skin", skin, roughness=rough),
        "white": mat(f"{prefix}_EyeWhite", sclera, roughness=0.18),
        "iris": mat(f"{prefix}_Iris", iris, roughness=0.12, coat_weight=0.6),
        "pupil": mat(f"{prefix}_Pupil", "#08080a", roughness=0.05, coat_weight=1.0),
        "brow": mat(f"{prefix}_Brow", brow, roughness=0.8),
        "lip": mat(f"{prefix}_Lip", lip, roughness=0.42),
    }


# ---------------------------------------------------------------------------
# Character registry (filled below)
# ---------------------------------------------------------------------------

BUILDERS = {}


def builder(npc_id, height, bg):
    def deco(fn):
        BUILDERS[npc_id] = (fn, height, bg)
        return fn
    return deco


# ---------------------------------------------------------------------------
# Surface detail helpers
# ---------------------------------------------------------------------------

def furry(obj, amp=0.006, freq=18.0, seed=0.0):
    """Displace along vertex normals with 3D noise: fur clumps, bark lumps, knit bulk."""
    bake(obj)
    me = obj.data
    off = V(seed * 7.1, seed * 3.3, seed * 1.7)
    for v in me.vertices:
        n = noise.noise(v.co * freq + off)
        v.co = v.co + v.normal * (amp * n)
    me.update()
    return obj


def grain(obj, amp=0.01, fxy=28.0, fz=3.0, seed=0.0):
    """Anisotropic noise along normals: long vertical bark grain / root fibres."""
    bake(obj)
    me = obj.data
    for v in me.vertices:
        c = v.co
        n = noise.noise(V(c.x * fxy + seed, c.y * fxy - seed, c.z * fz))
        v.co = c + v.normal * (amp * n)
    me.update()
    return obj


def profile_rings(profile, *, dz=0.015, n=24, sq=2.0, rfn=None, a0=None, a1=None):
    """
    Interpolate a sparse (z, rx, ryf, ryb[, y0[, x0]]) profile into dense rings so radius
    modulations (quilting, pleats, furrows) have vertices to live on.
    """
    zs = [p[0] for p in profile]
    rings = []
    z = zs[0]
    zz = []
    while z < zs[-1] - 1e-6:
        zz.append(z)
        z += dz
    zz.append(zs[-1])
    for z in zz:
        k = 0
        while k < len(zs) - 2 and z > zs[k + 1]:
            k += 1
        t = (z - zs[k]) / max(1e-6, zs[k + 1] - zs[k])
        t = t * t * (3 - 2 * t) * 0.5 + t * 0.5
        a, b = profile[k], profile[k + 1]
        vals = [lerp(a[i], b[i], t) for i in range(1, len(a))]
        rx, ryf, ryb = vals[0], vals[1], vals[2]
        y0 = vals[3] if len(vals) > 3 else 0.0
        x0 = vals[4] if len(vals) > 4 else 0.0
        rings.append(ring(z, rx, ryf, ryb, n=n, y0=y0, x0=x0, sq=sq, rfn=rfn, a0=a0, a1=a1))
    return rings


def quilt_fn(z0, period, amp, *, vseams=0, vamp=0.0):
    def f(a, z):
        t = ((z - z0) / period) % 1.0
        k = 1.0 + amp * (math.sin(math.pi * t) ** 0.6)
        if vseams:
            k *= 1.0 - vamp * (abs(math.cos(a * vseams * 0.5)) ** 12)
        return k
    return f


def puff_radii(n, base, bumps, amp):
    out = []
    rb = resample(base, n)
    for i in range(n):
        t = i / max(1, n - 1)
        out.append(rb[i] * (1.0 + amp * abs(math.sin(math.pi * t * bumps)) ** 0.6))
    return out


def edelweiss(name, center, normal, size, petal_mat, heart_mat):
    """Tiny woven edelweiss star (6 felted petals + a gold heart)."""
    parts = []
    for i in range(6):
        a = i / 6 * TAU
        p = sphere(f"{name}_p{i}", (size * 0.55, size * 0.2, size * 0.12), (math.cos(a) * size * 0.5, math.sin(a) * size * 0.5, 0),
                   seg=8, rings=6, mat=petal_mat, rot=(0, 0, a))
        parts.append(p)
    parts.append(sphere(f"{name}_h", size * 0.22, (0, 0, size * 0.05), seg=8, rings=6, mat=heart_mat))
    flower = K.join_objects(parts, name)
    N = V(normal).normalized()
    X = V(0, 0, 1).cross(N)
    if X.length < 1e-3:
        X = V(1, 0, 0)
    X.normalize()
    Y = N.cross(X)
    frame_transform(flower, center, X, Y, N)
    return flower


def orient(obj, pivot, direction, up_axis="Z"):
    """Rotate an object built around `pivot` with its local +Z so that +Z points along `direction`."""
    bake(obj)
    q = V(direction).normalized().to_track_quat(up_axis, "Y")
    M = q.to_matrix().to_4x4()
    pv = V(pivot)
    for v in obj.data.vertices:
        v.co = M @ (v.co - pv) + pv
    obj.data.update()
    return obj


# ---------------------------------------------------------------------------
# 11. Ermelin, Lantern Warden of the Snow Run (1.48 m)
# ---------------------------------------------------------------------------

@builder("ermelin", 1.48, "#1b2140")
def build_ermelin():
    H = 1.48
    fur = mat("Erm_Fur", "#f3f5ff", roughness=0.86)
    fur_dark = mat("Erm_FurTip", "#16131a", roughness=0.7)
    pink = mat("Erm_Pink", "#f2a0b4", roughness=0.45, coat_weight=0.3)
    eye_dark = mat("Erm_EyeGloss", "#0b0709", roughness=0.04, coat_weight=1.0)
    eye_iris = mat("Erm_EyeIris", "#2a1712", roughness=0.08, coat_weight=1.0)
    catch = mat("Erm_Catchlight", "#ffffff", roughness=0.1, emission_color="#ffffff", emission_strength=2.5)
    jacket = mat("Erm_Jacket", "#8d97f6", roughness=0.36, coat_weight=0.35, coat_roughness=0.25,
                 **texset("ermelin", "normal"), uv_scale=3.0, normal_strength=0.35)
    jacket_dk = mat("Erm_JacketTrim", "#5d64c9", roughness=0.42, coat_weight=0.2)
    scarf_red = mat("Erm_ScarfRed", "#b91c1c", roughness=0.92, **texset("ermelin", "normal"), uv_scale=6.0, normal_strength=1.1)
    scarf_cream = mat("Erm_ScarfCream", "#f6ecd6", roughness=0.92, **texset("ermelin", "normal"), uv_scale=6.0, normal_strength=1.1)
    wood = mat("Erm_Ash", "#c9a476", roughness=0.62, **texset("_shared_wood", "albedo", "roughness"), uv_scale=1.5, tint_strength=0.55)
    brass = mat("Erm_Brass", "#c9973a", roughness=0.32, metallic=1.0, **texset("_shared_brass", "albedo", "roughness"),
                tint_strength=0.3)
    glow = mat("Erm_LanternGlow", "#ffcf6a", roughness=0.15, emission_color="#f59e0b", emission_strength=6.0)
    leather = mat("Erm_Leather", "#5a3a22", roughness=0.7)
    navy = mat("Erm_Navy", "#1e1b4b", roughness=0.6)

    P = []  # (obj, bone or chain)

    # --- Skeleton -----------------------------------------------------------
    HC = V(0, -0.005, 1.215)  # head centre
    J = {
        "pelvis": (0, 0.02, 0.48), "spine": (0, 0.02, 0.62), "chest": (0, 0.02, 0.78), "neck": (0, 0.01, 0.97),
        "head": (0, 0.0, 1.09), "head_top": (0, 0.0, 1.36), "jaw": (0, -0.04, 1.15), "chin": (0, -0.16, 1.125),
        "eyeL": (0.063, -0.094, 1.238), "eyeR": (-0.063, -0.094, 1.238),
        "clavL": (0.05, 0.02, 0.92), "shL": (0.19, 0.02, 0.90), "elL": (0.255, 0.0, 0.69), "wrL": (0.265, -0.06, 0.52), "hdL": (0.27, -0.09, 0.44),
        "clavR": (-0.05, 0.02, 0.92), "shR": (-0.19, 0.02, 0.90), "elR": (-0.29, 0.06, 0.72), "wrR": (-0.335, -0.065, 0.81), "hdR": (-0.335, -0.17, 0.81),
        "hipL": (0.09, 0.02, 0.48), "knL": (0.105, -0.035, 0.28), "anL": (0.11, 0.02, 0.09), "toeL": (0.115, -0.12, 0.035),
        "hipR": (-0.09, 0.02, 0.48), "knR": (-0.105, -0.035, 0.28), "anR": (-0.11, 0.02, 0.09), "toeR": (-0.115, -0.12, 0.035),
    }
    grip = V(-0.31, -0.16, 0.81)
    hook_end = V(-0.53, -0.16, 1.40)
    extras = {
        "EarL": ("Head", (0.075, 0.01, 1.30), (0.10, 0.01, 1.43)),
        "EarR": ("Head", (-0.075, 0.01, 1.30), (-0.10, 0.01, 1.43)),
        "Tail1": ("Pelvis", (0.0, 0.14, 0.45), (0.20, 0.46, 0.17)),
        "Tail2": ("Tail1", (0.20, 0.46, 0.17), (0.41, 0.22, 0.61)),
        "Cloak": ("Chest", (-0.08, 0.10, 0.99), (-0.07, 0.27, 0.55)),
        "PropR": ("HandR", tuple(grip), tuple(grip + V(0, 0, 0.3))),
        "Lantern": ("PropR", tuple(hook_end), tuple(hook_end - V(0, 0, 0.16))),
    }

    # --- Head: bespoke stoat sculpt ----------------------------------------
    head = sphere("Erm_head", (0.122, 0.118, 0.112), tuple(HC), seg=30, rings=22, mat=fur)

    def head_fn(c):
        q = c - HC
        x, y, z = q.x, q.y, q.z
        # broad flat-topped skull, fuller cheeks low
        if z > 0.03:
            z = 0.03 + (z - 0.03) * 0.9
        if z < 0:
            x *= 1.0 + 0.10 * smooth(0.0, -0.08, z) * smooth(-0.12, -0.02, y + 0.06)
        # triangular snout pulled forward from the lower front of the face
        m = math.exp(-((x / 0.058) ** 2 + ((z + 0.040) / 0.052) ** 2))
        front = max(0.0, -y / 0.118) ** 1.5
        w = m * front
        y -= 0.125 * w
        x *= 1.0 - 0.42 * w
        z += 0.010 * w * (1 if z > -0.04 else -0.6)
        # eye sockets
        for sx in (-1, 1):
            d = ((x - sx * 0.063) / 0.032) ** 2 + ((z - 0.024) / 0.028) ** 2
            if y < -0.04:
                y += 0.016 * math.exp(-d * 1.2)
        # soft brow over the eyes
        if y < -0.05:
            y -= 0.006 * math.exp(-((x / 0.09) ** 2 + ((z - 0.06) / 0.02) ** 2))
        return (HC.x + x, HC.y + y, HC.z + z)

    deform(head, head_fn)
    furry(head, 0.0035, 22.0, 1.0)
    tip = min((v.co.copy() for v in head.data.vertices), key=lambda c: c.y)
    P.append((head, "Head"))

    # cheek fluff tufts + crown tuft (stylised fur cards)
    tufts = []
    for sx in (-1, 1):
        for i, (dz, ang, ln) in enumerate(((-0.035, -0.35, 0.050), (-0.065, -0.75, 0.048))):
            base = HC + V(sx * 0.100, -0.030, dz)
            d = V(sx * math.cos(ang), 0.25, math.sin(ang)).normalized()
            tufts.append(tube(f"Erm_tuft{sx}{i}", [tuple(base), tuple(base + d * ln * 0.5 + V(0, 0, -0.006)), tuple(base + d * ln + V(0, 0, -0.016))],
                              [0.030, 0.020, 0.005], segments=8, mat=fur, samples=2))
    cow = HC + V(0.0, -0.035, 0.088)
    tufts.append(tube("Erm_cowlick", [tuple(cow), tuple(cow + V(0.01, -0.025, 0.022)), tuple(cow + V(0.028, -0.045, 0.018))],
                      [0.022, 0.012, 0.004], segments=8, mat=fur, samples=2))
    P.append((K.join_objects(tufts, "Erm_tufts"), "Head"))

    # nose (soft inverted triangle) at the snout tip
    nose_c = V(0, tip.y - 0.002, tip.z + 0.012)
    nose = sphere("Erm_nose", (0.024, 0.016, 0.015), tuple(nose_c), seg=16, rings=10, mat=pink)
    deform(nose, lambda c: (c.x * (0.65 + 0.55 * smooth(-0.015, 0.015, c.z - nose_c.z)), c.y, c.z))
    P.append((nose, "Head"))
    # philtrum + smile ("w" mouth) and whiskers
    m1 = tube("Erm_philtrum", [(0, nose_c.y + 0.006, nose_c.z - 0.012), (0, nose_c.y + 0.012, nose_c.z - 0.030)], [0.0025, 0.0025], segments=6, mat=navy, samples=0)
    mouth = []
    for sx in (-1, 1):
        mouth.append(tube(f"Erm_smile{sx}", [(0, nose_c.y + 0.012, nose_c.z - 0.030), (sx * 0.014, nose_c.y + 0.016, nose_c.z - 0.038),
                                             (sx * 0.028, nose_c.y + 0.026, nose_c.z - 0.033)], [0.0026, 0.0026, 0.002], segments=6, mat=navy, samples=3))
    wh = []
    for sx in (-1, 1):
        for k, (dz, spread) in enumerate(((0.0, 0.02), (-0.010, -0.005), (-0.018, -0.03))):
            o = V(sx * 0.026, nose_c.y + 0.03, nose_c.z - 0.018 + dz)
            wh.append(tube(f"Erm_wh{sx}{k}", [tuple(o), tuple(o + V(sx * 0.06, 0.012, spread * 0.5)), tuple(o + V(sx * 0.115, 0.03, spread))],
                           [0.0016, 0.0012, 0.0005], segments=5, mat=fur_dark, samples=2))
    P.append((K.join_objects([m1] + mouth + wh, "Erm_mouth_whiskers"), "Head"))
    # lower jaw / chin (Jaw bone) + dark mouth interior behind it
    chin = sphere("Erm_chin", (0.034, 0.040, 0.019), (0, nose_c.y + 0.052, nose_c.z - 0.058), seg=16, rings=10, mat=fur)
    P.append((chin, "Jaw"))
    mouth_in = sphere("Erm_mouthIn", (0.028, 0.03, 0.014), (0, nose_c.y + 0.05, nose_c.z - 0.046), seg=12, rings=8, mat=navy)
    P.append((mouth_in, "Head"))

    # big glossy eyes (sclera dark, iris deep brown, pupil) + catchlights + lids
    for s, sx in (("L", 1), ("R", -1)):
        ec = V(J["eye" + s])
        ball = sphere(f"Erm_eye{s}", 0.031, tuple(ec), seg=14, rings=10, mat=eye_dark)
        iris = sphere(f"Erm_iris{s}", (0.022, 0.012, 0.024), tuple(ec + V(0, -0.022, 0)), seg=14, rings=8, mat=eye_iris)
        pupil = sphere(f"Erm_pupil{s}", (0.013, 0.008, 0.015), tuple(ec + V(0, -0.028, 0)), seg=10, rings=6, mat=eye_dark)
        P.append((K.join_objects([ball, iris, pupil], f"Erm_eyeball{s}"), "Eye" + s))
        cl = sphere(f"Erm_catch{s}", 0.0062, tuple(ec + V(sx * 0.010 - 0.004, -0.029, 0.012)), seg=8, rings=6, mat=catch)
        cl2 = sphere(f"Erm_catchb{s}", 0.003, tuple(ec + V(sx * -0.008, -0.031, -0.009)), seg=6, rings=5, mat=catch)
        lid = make_eyelid(f"Erm_lid{s}", tuple(ec), 0.031, open_amt=0.62, mat=fur, tilt=0.18, side=sx)
        P.append((K.join_objects([cl, cl2, lid], f"Erm_eyefx{s}"), "Head"))
        lashes = []
        for k in range(3):
            a = 0.35 + k * 0.32
            base = ec + V(sx * math.cos(a) * 0.033, -0.012, math.sin(a) * 0.030)
            lashes.append(tube(f"Erm_lash{s}{k}", [tuple(base), tuple(base + V(sx * 0.012, -0.008, 0.010))], [0.0022, 0.0006],
                               segments=5, mat=fur_dark, samples=0))
        P.append((K.join_objects(lashes, f"Erm_lashes{s}"), "Head"))

    # round upright ears (fur outer cup + pink inner)
    for s, sx in (("L", 1), ("R", -1)):
        ec = V(sx * 0.104, 0.022, 1.300)
        outer = sphere(f"Erm_ear{s}", (0.046, 0.022, 0.040), tuple(ec), seg=16, rings=10, mat=fur)
        deform(outer, lambda c, ec=ec: (c.x, c.y + 0.012 * max(0.0, 1 - ((c.x - ec.x) / 0.047) ** 2 - ((c.z - ec.z) / 0.04) ** 2) * (1.0 if c.y < ec.y else 0.0), c.z))
        inner = sphere(f"Erm_earIn{s}", (0.030, 0.010, 0.025), tuple(ec + V(0, -0.012, -0.006)), seg=12, rings=8, mat=pink)
        ear = K.join_objects([outer, inner], f"Erm_earJ{s}")
        bake(ear)
        rot = Matrix.Rotation(sx * 0.55, 4, "Y") @ Matrix.Rotation(sx * -0.35, 4, "Z")
        for v in ear.data.vertices:
            v.co = rot @ (v.co - ec) + ec
        P.append((ear, "Ear" + s))

    neck = lathe("Erm_neck", [(0.93, 0.10, 0.095, -0.005), (1.02, 0.098, 0.092, -0.01), (1.10, 0.102, 0.098, -0.012), (1.15, 0.085, 0.08, -0.01)], segments=24, mat=fur)
    furry(neck, 0.006, 24.0, 5.0)
    P.append((neck, ["Chest", "Neck", "Head"]))

    # --- Puffy quilted periwinkle jacket ------------------------------------
    jprof = [
        (0.335, 0.212, 0.196, 0.196), (0.40, 0.226, 0.206, 0.203), (0.52, 0.232, 0.212, 0.205),
        (0.64, 0.230, 0.208, 0.198), (0.76, 0.222, 0.196, 0.186), (0.85, 0.205, 0.172, 0.168),
        (0.915, 0.165, 0.130, 0.130), (0.955, 0.105, 0.092, 0.092),
    ]
    jrings = profile_rings(jprof, dz=0.0165, n=24, sq=2.15, rfn=quilt_fn(0.335, 0.088, 0.055, vseams=2, vamp=0.035))
    jk = loft("Erm_jacket", jrings, mat=jacket, cap_start=True, cap_end=True, u_scale=2.0, v_scale=2.0)
    recalc(jk)
    P.append((jk, ["Pelvis", "Spine", "Chest"]))
    hem = K.make_torus("Erm_hem", 1.0, 0.028, major_segments=30, minor_segments=8, location=(0, 0, 0.345), mat=jacket_dk)
    hem.scale = (0.212, 0.198, 1.0)
    bake(hem)
    P.append((hem, "Pelvis"))
    collar = K.make_torus("Erm_collar", 1.0, 0.03, major_segments=26, minor_segments=8, location=(0, 0.0, 0.95), mat=jacket)
    collar.scale = (0.105, 0.095, 1.0)
    bake(collar)
    P.append((collar, "Chest"))

    def jacket_front(z):
        best = min(jprof, key=lambda p: abs(p[0] - z))
        return -best[2] * 1.05

    plk_pts = [(0.0, jacket_front(z) - 0.004, z) for z in (0.35, 0.5, 0.62, 0.74, 0.84, 0.91)]
    plk = etube("Erm_placket", plk_pts, 0.018, 0.008, hint=(1, 0, 0), segments=10, mat=jacket_dk, samples=3)
    P.append((plk, ["Pelvis", "Spine", "Chest"]))
    for i, z in enumerate((0.50, 0.64, 0.78)):
        y = jacket_front(z) - 0.022
        bone = "Spine" if z < 0.7 else "Chest"
        tg = K.make_cylinder(f"Erm_toggle{i}", 0.009, 0.009, 0.06, location=(0.0, y, z), rotation=(0, math.pi / 2, 0.12), vertices=12, mat=wood)
        loop = K.make_torus(f"Erm_tloop{i}", 0.017, 0.0035, location=(0.012, y + 0.006, z), rotation=(math.pi / 2, 0, 0), major_segments=16, minor_segments=6, mat=navy)
        P.append((K.join_objects([tg, loop], f"Erm_toggleJ{i}"), bone))

    # sleeves (puffy quilted tubes) + cuffs + mittens
    for s, sx in (("L", 1), ("R", -1)):
        sh, el, wr = V(J["sh" + s]), V(J["el" + s]), V(J["wr" + s])
        cuff_end = wr + (el - wr).normalized() * 0.03
        pts = catmull([tuple(sh + V(-sx * 0.02, 0, 0.01)), tuple(sh.lerp(el, 0.5) + V(sx * 0.012, 0, 0)), tuple(el), tuple(el.lerp(cuff_end, 0.5)), tuple(cuff_end)], 4)
        rads = puff_radii(len(pts), [0.088, 0.08, 0.074, 0.07, 0.068], 4.0, 0.12)
        sl = etube(f"Erm_sleeve{s}", pts, rads, hint=(0, 1, 0), segments=15, mat=jacket)
        P.append((sl, ["Shoulder" + s, "Arm" + s, "Forearm" + s]))
        cuff = K.make_torus(f"Erm_cuff{s}", 0.058, 0.016, location=(0, 0, 0), major_segments=16, minor_segments=7, mat=jacket_dk)
        orient(cuff, (0, 0, 0), wr - el)
        deform(cuff, lambda c, o=cuff_end: (c.x + o.x, c.y + o.y, c.z + o.z))
        P.append((cuff, "Forearm" + s))
        shoulder_puff = sphere(f"Erm_shpuff{s}", (0.09, 0.085, 0.08), tuple(sh + V(-sx * 0.02, 0, 0.0)), seg=14, rings=10, mat=jacket)
        P.append((shoulder_puff, ["Chest", "Shoulder" + s, "Arm" + s]))
    mitt_red = mat("Erm_Mitten", "#a3191f", roughness=0.95, **texset("ermelin", "normal"), uv_scale=5.0, normal_strength=0.8)
    mL = make_hand("Erm_mittL", J["wrL"], V(J["hdL"]) - V(J["wrL"]), (0, -1, 0.1), "L", scale=1.15, curl=0.25, mat=mitt_red, mitten=True)
    P.append((mL, "HandL"))
    mR = make_hand("Erm_mittR", J["wrR"], V(0, -1, 0), (0, 0, 1), "R", scale=1.15, curl=0.95, mat=mitt_red, mitten=True)
    P.append((mR, "HandR"))
    string = tube("Erm_mitstring", [tuple(V(J["wrL"]) + V(0.03, 0.03, 0.02)), (0.25, 0.10, 0.70), (0.16, 0.16, 0.90), (0.0, 0.13, 0.985),
                                    (-0.16, 0.16, 0.90), (-0.27, 0.12, 0.72), tuple(V(J["wrR"]) + V(-0.03, 0.05, -0.01))],
                  0.0032, segments=5, mat=scarf_cream, samples=3)
    P.append((string, ["Chest", "ForearmL", "ForearmR"]))

    # --- Legs, paws, snowshoes, tail ---------------------------------------
    for s, sx in (("L", 1), ("R", -1)):
        hip, kn, an = V(J["hip" + s]), V(J["kn" + s]), V(J["an" + s])
        leg = tube(f"Erm_leg{s}", [tuple(hip + V(0, 0.01, 0.02)), tuple(hip.lerp(kn, 0.5) + V(0, -0.01, 0)), tuple(kn), tuple(kn.lerp(an, 0.5)), tuple(an + V(0, 0, 0.01))],
                   [0.088, 0.082, 0.064, 0.052, 0.047], segments=16, mat=fur, samples=3)
        furry(leg, 0.007, 24.0, sx)
        P.append((leg, ["Pelvis", "Thigh" + s, "Shin" + s, "Foot" + s]))
        paw = make_shoe(f"Erm_paw{s}", (an.x, an.y + 0.01), length=0.15, width=0.085, height=0.06, mat=fur, toe_lift=0.0, sole_h=0.026, seg=18, rings=12)
        P.append((K.join_objects(paw, f"Erm_pawJ{s}"), "Foot" + s))
        cx, cy = an.x + sx * 0.008, an.y - 0.04
        frame_pts = []
        for k in range(28):
            a = k / 28 * TAU
            yv = math.sin(a)
            wx = 0.085 * (0.55 + 0.45 * smooth(0.9, -0.6, yv))
            ly = 0.20 if yv < 0 else 0.17
            zz = 0.010 + 0.018 * max(0.0, -yv) ** 4
            frame_pts.append((cx + math.cos(a) * wx, cy + yv * ly, zz))
        frame_pts.append(frame_pts[0])
        frame = etube(f"Erm_shoe{s}", frame_pts, 0.0095, 0.0075, hint=(0, 0, 1), segments=6, mat=wood)
        lacing = []
        for k, yy in enumerate((-0.12, -0.06, 0.0, 0.06, 0.11)):
            hw = 0.085 * (0.55 + 0.45 * smooth(0.9, -0.6, yy / 0.19)) * 0.95
            lacing.append(tube(f"Erm_lace{s}{k}", [(cx - hw, cy + yy, 0.012), (cx + hw, cy + yy, 0.012)], 0.0028, segments=5, mat=leather, samples=0))
        for k, xx in enumerate((-0.03, 0.03)):
            lacing.append(tube(f"Erm_laceL{s}{k}", [(cx + xx, cy - 0.17, 0.014), (cx + xx * 0.5, cy, 0.012), (cx + xx, cy + 0.15, 0.012)], 0.0025, segments=5, mat=leather, samples=2))
        strap = K.make_torus(f"Erm_strap{s}", 1.0, 0.25, location=(an.x, an.y - 0.055, 0.045), major_segments=12, minor_segments=5, mat=leather)
        strap.scale = (0.05, 0.03, 0.03)
        strap.rotation_euler = (0.2, 0, 0)
        bake(strap)
        P.append((K.join_objects([frame] + lacing + [strap], f"Erm_snowshoe{s}"), "Foot" + s))

    tail_pts = [(0.0, 0.13, 0.46), (0.03, 0.27, 0.36), (0.10, 0.40, 0.24), (0.20, 0.46, 0.17), (0.31, 0.45, 0.20),
                (0.40, 0.38, 0.29), (0.45, 0.30, 0.42), (0.44, 0.24, 0.54), (0.41, 0.22, 0.61)]
    dense = catmull(tail_pts, 4)
    nt = len(dense)
    k_black = int(nt * 0.80)
    rads = [0.040 + 0.024 * math.sin(math.pi * min(1.0, i / (nt * 0.85))) ** 0.7 for i in range(nt)]
    for i in range(nt):
        if i > nt * 0.86:
            rads[i] *= max(0.06, 1.0 - (i - nt * 0.86) / (nt * 0.14)) ** 0.6
    tail_w = etube("Erm_tail", dense[: k_black + 1], rads[: k_black + 1], hint=(0, 0, 1), segments=12, mat=fur, cap=True)
    tail_b = etube("Erm_tailTip", dense[k_black - 1:], [r * 1.06 for r in rads[k_black - 1:]], hint=(0, 0, 1), segments=12, mat=fur_dark, cap=True)
    furry(tail_w, 0.004, 20.0, 3.0)
    furry(tail_b, 0.004, 20.0, 3.0)
    P.append((tail_w, ["Pelvis", "Tail1", "Tail2"]))
    P.append((tail_b, ["Tail1", "Tail2"]))

    # --- Scarf: crimson/cream alpine knit, wrapped twice, two tails ---------
    scarf_parts = []
    for k, (zc, r, tilt) in enumerate(((1.005, 0.112, 0.05), (0.975, 0.128, -0.04))):
        pts = []
        for i in range(29):
            a = i / 28 * TAU
            pts.append((math.cos(a) * r * 1.05, math.sin(a) * r * 0.98 - 0.008, zc + tilt * math.sin(a) + 0.008 * math.sin(3 * a)))
        sc = etube(f"Erm_wrap{k}", pts, 0.034, 0.022, hint=(0, 0, 1), segments=10, mat=scarf_red)
        stripe_materials(sc, [scarf_red, scarf_cream], lambda c: math.atan2(c.y, c.x) + math.pi, 0.75, 0.8)
        scarf_parts.append(sc)
    P.append((K.join_objects(scarf_parts, "Erm_scarfWrap"), ["Chest", "Neck"]))
    knot = sphere("Erm_knot", (0.042, 0.032, 0.036), (0.065, -0.118, 0.965), seg=14, rings=10, mat=scarf_red)
    furry(knot, 0.004, 40, 2.0)
    P.append((knot, "Chest"))
    front_tail_pts = [(0.068, -0.13, 0.95), (0.085, -0.19, 0.86), (0.098, -0.228, 0.74), (0.104, -0.238, 0.62), (0.11, -0.236, 0.52), (0.118, -0.234, 0.43)]
    ft = etube("Erm_scarfFront", front_tail_pts, [0.045, 0.05, 0.055, 0.056, 0.056, 0.056], 0.010, hint=(1, 0, 0), segments=8, mat=scarf_red, samples=6)
    stripe_materials(ft, [scarf_cream, scarf_red], lambda c: c.z, 0.06, 0.35)
    fringe = [tube(f"Erm_fringe{i}", [(0.118 + (i - 3) * 0.015, -0.234, 0.432), (0.12 + (i - 3) * 0.017, -0.236, 0.39)], [0.004, 0.003],
                   segments=5, mat=scarf_cream, samples=0) for i in range(7)]
    flower = edelweiss("Erm_edelweiss", (0.108, -0.248, 0.575), (0, -1, 0), 0.026, scarf_cream, brass)
    P.append((K.join_objects([ft, flower] + fringe, "Erm_scarfFrontJ"), ["Chest", "Spine"]))
    back_pts = [(-0.10, 0.05, 1.0), (-0.12, 0.15, 0.95), (-0.11, 0.215, 0.84), (-0.095, 0.245, 0.72), (-0.085, 0.27, 0.62), (-0.075, 0.305, 0.54)]
    bt = etube("Erm_scarfBack", back_pts, [0.045, 0.05, 0.055, 0.056, 0.056, 0.055], 0.010, hint=(1, 0, 0), segments=8, mat=scarf_red, samples=6,
               twist=[0.0, 0.25, 0.35, 0.3, 0.2, 0.1])
    stripe_materials(bt, [scarf_cream, scarf_red], lambda c: c.z, 0.06, 0.35)
    fringe_b = [tube(f"Erm_fringeB{i}", [(-0.075 + (i - 3) * 0.015, 0.305, 0.542), (-0.072 + (i - 3) * 0.017, 0.33, 0.505)], [0.004, 0.003],
                     segments=5, mat=scarf_cream, samples=0) for i in range(7)]
    P.append((K.join_objects([bt] + fringe_b, "Erm_scarfBackJ"), "Cloak"))

    # --- Lantern pole (ash) with crook, wick-lighter hook, hooded brass lantern ---
    pole_pts = [(grip.x, grip.y, 0.0), (grip.x, grip.y, 0.6), (grip.x, grip.y, 1.2), (grip.x - 0.01, grip.y, 1.38),
                (grip.x - 0.06, grip.y, 1.455), (grip.x - 0.14, grip.y, 1.47), (hook_end.x + 0.012, grip.y, 1.455), (hook_end.x, grip.y, 1.42)]
    pole = tube("Erm_pole", pole_pts, [0.017, 0.017, 0.016, 0.015, 0.014, 0.013, 0.012, 0.011], segments=8, mat=wood, samples=3)
    ferrule = K.make_cylinder("Erm_ferrule", 0.019, 0.017, 0.05, location=(grip.x, grip.y, 0.026), vertices=12, mat=brass)
    wick = tube("Erm_wickHook", [(grip.x + 0.01, grip.y, 1.30), (grip.x + 0.045, grip.y, 1.34), (grip.x + 0.05, grip.y, 1.39), (grip.x + 0.035, grip.y, 1.405)],
                0.0045, segments=6, mat=brass, samples=3)
    wrap = K.make_cylinder("Erm_gripWrap", 0.0205, 0.0205, 0.13, location=(grip.x, grip.y, grip.z), vertices=12, mat=leather)
    P.append((K.join_objects([pole, ferrule, wick, wrap], "Erm_poleJ"), "PropR"))
    lz = hook_end.z - 0.03
    lan = [K.make_torus("Erm_lring", 0.016, 0.004, location=(hook_end.x, hook_end.y, lz + 0.006), rotation=(math.pi / 2, 0, 0),
                        major_segments=14, minor_segments=6, mat=brass)]
    hood = lathe("Erm_hood", [(lz - 0.075, 0.072), (lz - 0.062, 0.078), (lz - 0.050, 0.058), (lz - 0.030, 0.032), (lz - 0.014, 0.012), (lz - 0.008, 0.004)],
                 segments=14, mat=brass, center=(hook_end.x, hook_end.y, 0))
    lan.append(hood)
    gz0, gz1 = lz - 0.185, lz - 0.078
    glass = lathe("Erm_glass", [(gz0, 0.040), (gz0 + 0.03, 0.050), (gz1 - 0.03, 0.052), (gz1, 0.044)], segments=14, mat=glow, center=(hook_end.x, hook_end.y, 0))
    lan.append(glass)
    for k in range(4):
        a = k / 4 * TAU + math.pi / 4
        x, y = hook_end.x + math.cos(a) * 0.053, hook_end.y + math.sin(a) * 0.053
        lan.append(tube(f"Erm_bar{k}", [(x, y, gz0 - 0.005), (x + math.cos(a) * 0.005, y + math.sin(a) * 0.005, (gz0 + gz1) * 0.5), (x, y, gz1 + 0.004)],
                        0.0042, segments=5, mat=brass, samples=1))
    for zr, rr in ((gz1, 0.054), (gz0, 0.046)):
        lan.append(K.make_torus(f"Erm_lband{zr:.3f}", rr, 0.0055, location=(hook_end.x, hook_end.y, zr), major_segments=14, minor_segments=5, mat=brass))
    lan.append(lathe("Erm_lbase", [(gz0 - 0.03, 0.03), (gz0 - 0.022, 0.05), (gz0 - 0.004, 0.05), (gz0, 0.042)], segments=14, mat=brass,
                     center=(hook_end.x, hook_end.y, 0)))
    lan.append(sphere("Erm_lfinial", 0.012, (hook_end.x, hook_end.y, gz0 - 0.038), seg=10, rings=8, mat=brass))
    P.append((K.join_objects(lan, "Erm_lantern"), "Lantern"))

    arm = build_rig("ermelin", H, J, extras)
    mesh = bind(arm, P, "Ermelin_Body")
    return arm, mesh


# ---------------------------------------------------------------------------
# 12. Myrrow, Warden Who Listens Underground (2.15 m)
# ---------------------------------------------------------------------------

def surface_probe(objs):
    """
    BVH over baked meshes; returns front_y(x, z, default) = Y of the first surface hit by a
    ray fired from the front (-Y) toward +Y. Used to seat face carvings and drape beards.
    """
    from mathutils.bvhtree import BVHTree
    verts, polys = [], []
    for o in objs:
        bake(o)
        base = len(verts)
        verts += [v.co.copy() for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)

    def front_y(x, z, default=None):
        hit = tree.ray_cast(V(x, -3.0, z), V(0, 1, 0))
        return hit[0].y if hit[0] is not None else default
    return front_y


def bark_fn(ridges=9, depth=0.11, seed=0.0):
    """Deep vertical redwood furrows (radius modulation by angle, wandering with height)."""
    def f(a, z):
        w = a * ridges + 2.2 * noise.noise(V(z * 3.0, seed, 0.3)) + 0.8 * math.sin(z * 7.0 + seed)
        k = 1.0 - depth * (abs(math.sin(w * 0.5)) ** 3)
        return k * (1.0 + 0.03 * noise.noise(V(math.cos(a) * 2, math.sin(a) * 2, z * 6 + seed)))
    return f


@builder("myrrow", 2.15, "#071a12")
def build_myrrow():
    H = 2.15
    bark = mat("Myr_Bark", "#6b3524", roughness=0.9, **texset("myrrow", "normal", "roughness"), uv_scale=2.0, normal_strength=1.4)
    bark_dark = mat("Myr_BarkDeep", "#3a1a10", roughness=0.95, **texset("myrrow", "normal"), uv_scale=2.5, normal_strength=1.2)
    living = mat("Myr_LivingBark", "#5b2c1d", roughness=0.85, **texset("myrrow", "albedo", "normal", "emissive"), uv_scale=1.5,
                 emission_strength=1.6, normal_strength=1.0)
    moss = mat("Myr_Moss", "#2f5d3a", roughness=0.97, **texset("myrrow", "normal"), uv_scale=5.0, normal_strength=1.6)
    moss_lt = mat("Myr_MossLight", "#8fa889", roughness=0.95)
    cap_top = mat("Myr_CapTop", "#1f6b4e", roughness=0.42, coat_weight=0.5, coat_roughness=0.3,
                  emission_color="#34d399", emission_strength=0.35, **texset("myrrow", "normal"), uv_scale=3.0, normal_strength=0.6)
    gills = mat("Myr_Gills", "#a7f3d0", roughness=0.4, emission_color="#6ee7b7", emission_strength=3.2)
    spot = mat("Myr_CapSpot", "#c9fbe6", roughness=0.5, emission_color="#a7f3d0", emission_strength=1.6)
    shelf = mat("Myr_ShelfFungus", "#c8935a", roughness=0.7, coat_weight=0.2)
    shelf_rim = mat("Myr_ShelfRim", "#f1dcb4", roughness=0.6, emission_color="#a7f3d0", emission_strength=0.25)
    eye_glow = mat("Myr_EyeGlow", "#e0a53c", roughness=0.15, emission_color="#f2b544", emission_strength=2.6)
    hollow = mat("Myr_Hollow", "#0a0604", roughness=1.0)
    mouth_m = mat("Myr_MouthShade", "#24100a", roughness=1.0)
    # soft seafoam bioluminescence: a mossy-green body with a gentle glow, never stark white
    tendril = mat("Myr_Mycelium", "#5f9c84", roughness=0.6, emission_color="#4fd1a8", emission_strength=0.55)

    P = []
    # hunched skeleton: chest/neck pitched forward, cap head well ahead of the pelvis
    J = {
        "pelvis": (0, 0.08, 0.96), "spine": (0, 0.06, 1.16), "chest": (0, -0.02, 1.38), "neck": (0, -0.22, 1.55),
        "head": (0, -0.36, 1.60), "head_top": (0, -0.39, 1.98), "jaw": (0, -0.40, 1.60), "chin": (0, -0.48, 1.54),
        "eyeL": (0.074, -0.50, 1.692), "eyeR": (-0.074, -0.50, 1.692),
        "clavL": (0.08, -0.08, 1.50), "shL": (0.37, -0.07, 1.50), "elL": (0.48, -0.17, 1.05), "wrL": (0.49, -0.27, 0.57), "hdL": (0.49, -0.31, 0.32),
        "clavR": (-0.08, -0.08, 1.50), "shR": (-0.37, -0.07, 1.50), "elR": (-0.49, -0.13, 1.05), "wrR": (-0.48, -0.21, 0.57), "hdR": (-0.48, -0.24, 0.32),
        "hipL": (0.16, 0.08, 0.96), "knL": (0.19, 0.0, 0.53), "anL": (0.20, 0.06, 0.12), "toeL": (0.22, -0.18, 0.04),
        "hipR": (-0.16, 0.08, 0.96), "knR": (-0.19, 0.0, 0.53), "anR": (-0.20, 0.06, 0.12), "toeR": (-0.22, -0.18, 0.04),
    }
    CAPC = V(0, -0.39, 1.85)  # cap centre (where stem meets cap underside)
    extras = {
        "Hat": ("Head", tuple(CAPC), tuple(CAPC + V(0, 0, 0.25))),
        "Cloak": ("Chest", (0, 0.14, 1.50), (0, 0.32, 1.25)),
        "Tentacle1": ("Pelvis", (0.0, -0.18, 0.92), (0.0, -0.24, 0.40)),
        "Tentacle2": ("Pelvis", (0.27, 0.06, 0.92), (0.33, 0.06, 0.40)),
        "Tentacle3": ("Pelvis", (0.0, 0.32, 0.92), (0.0, 0.38, 0.40)),
        "Tentacle4": ("Pelvis", (-0.27, 0.06, 0.92), (-0.33, 0.06, 0.40)),
    }

    # --- Torso: furrowed redwood trunk bent forward -----------------------
    # Rings follow a curved spine (pelvis -> chest -> neck): each profile entry carries a y offset.
    tprof = [
        (0.82, 0.27, 0.23, 0.25, 0.10), (0.95, 0.30, 0.25, 0.28, 0.10), (1.08, 0.29, 0.24, 0.29, 0.08),
        (1.22, 0.31, 0.24, 0.32, 0.04), (1.36, 0.36, 0.25, 0.36, -0.02), (1.47, 0.39, 0.25, 0.37, -0.09),
        (1.55, 0.37, 0.22, 0.33, -0.15), (1.61, 0.27, 0.17, 0.24, -0.23), (1.655, 0.15, 0.12, 0.13, -0.31),
    ]
    trunk = loft("Myr_trunk", profile_rings(tprof, dz=0.022, n=30, sq=2.0, rfn=bark_fn(11, 0.13, 1.0)), mat=bark,
                 cap_start=True, cap_end=True, u_scale=3.0, v_scale=1.5)
    recalc(trunk)
    furry(trunk, 0.012, 9.0, 2.0)
    P.append((trunk, ["Pelvis", "Spine", "Chest", "Neck"]))

    def trunk_pt(a, z, inset=0.97):
        k = 0
        while k < len(tprof) - 2 and z > tprof[k + 1][0]:
            k += 1
        t = (z - tprof[k][0]) / (tprof[k + 1][0] - tprof[k][0])
        rx, ryf, ryb, y0 = [lerp(tprof[k][i], tprof[k + 1][i], t) for i in (1, 2, 3, 4)]
        return V(math.cos(a) * rx * inset, math.sin(a) * (ryf if math.sin(a) < 0 else ryb) * inset + y0, z)

    # living mycelium veins threading up the bark furrows (few, thin, softly glowing)
    veins = []
    rnd = random.Random(21)
    for i in range(4):
        a0 = -math.pi / 2 + (i - 1.5) * 0.62 + rnd.uniform(-0.1, 0.1)
        z0 = 1.0 + rnd.uniform(0, 0.05)
        pts = []
        a = a0
        ph = rnd.uniform(0, TAU)
        for k in range(6):
            z = z0 + k * 0.075
            a = a0 + 0.09 * math.sin(k * 0.8 + ph)
            pts.append(tuple(trunk_pt(a, min(z, 1.42), 0.985)))
        veins.append(tube(f"Myr_vein{i}", pts, [0.0045, 0.004, 0.0034, 0.0026, 0.0018, 0.0008], segments=4, mat=tendril, samples=2))
    P.append((K.join_objects(veins, "Myr_veins"), ["Pelvis", "Spine", "Chest"]))

    # --- Head: a long carved-bark elder face under a broad glowing cap -----
    FC = V(0, -0.385, 1.67)
    face = sphere("Myr_face", (0.168, 0.16, 0.178), tuple(FC), seg=26, rings=18, mat=bark)
    # denser lattice over the front so brows, cheeks and furrows have vertices to live on
    bm = bmesh.new()
    bm.from_mesh(face.data)
    front_edges = [e for e in bm.edges if all((v.co.y < -0.045 and -0.15 < v.co.z < 0.10) for v in e.verts)]
    bmesh.ops.subdivide_edges(bm, edges=front_edges, cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bm.to_mesh(face.data)
    bm.free()
    face.data.update()

    def face_fn(c):
        q = c - FC
        fw = smooth(-0.02, -0.09, q.y)  # 0 behind, 1 on the face
        # flatten the front into a face plane, narrowing toward a long chin
        if q.y < -0.06:
            q.y = -0.06 + (q.y + 0.06) * 0.72
        q.x *= 1.0 - 0.2 * smooth(-0.03, -0.18, q.z) * fw
        dy = 0.0
        for sx in (-1, 1):
            # knot-hole sockets, set back under the brow
            d = ((q.x - sx * 0.074) / 0.042) ** 2 + ((q.z - 0.020) / 0.032) ** 2
            dy += 0.030 * math.exp(-d * 1.3)
            # sculpted brow ridge arching over each eye (outer ends droop: a kind, weathered look)
            bx = q.x - sx * 0.072
            zc = 0.064 - 3.5 * max(0.0, bx * sx) ** 2 + 1.5 * min(0.0, bx * sx) ** 2
            dy -= 0.020 * math.exp(-((bx / 0.06) ** 2 + ((q.z - zc) / 0.022) ** 2))
            # cheekbones and the heavy fold under each eye
            dy -= 0.012 * math.exp(-(((q.x - sx * 0.08) / 0.042) ** 2 + ((q.z + 0.022) / 0.03) ** 2))
            dy += 0.004 * math.exp(-(((q.x - sx * 0.07) / 0.03) ** 2 + ((q.z + 0.004 + 0.3 * (q.x - sx * 0.07) ** 2) / 0.006) ** 2))
            # nasolabial folds running from the nose wings down past the mouth corners
            t = max(0.0, min(1.0, (0.0 - q.z) / 0.11))
            fx = sx * (0.032 + 0.03 * t)
            dy += 0.006 * math.exp(-((q.x - fx) / 0.007) ** 2) * smooth(0.01, -0.02, q.z) * smooth(-0.13, -0.1, q.z)
        # glabella: two vertical frown creases between the brows
        dy += 0.006 * math.exp(-((abs(q.x) - 0.016) / 0.006) ** 2 - ((q.z - 0.064) / 0.026) ** 2)
        # broad carved nose bridge (the separate nose piece adds the crisp ridge and tip)
        nw = 0.024 + 0.012 * smooth(0.05, -0.03, q.z)
        dy -= (0.008 + 0.012 * smooth(0.06, -0.03, q.z)) * math.exp(-(q.x / nw) ** 2) * smooth(0.085, 0.05, q.z) * smooth(-0.07, -0.04, q.z)
        # a warm, gently upturned mouth seam set into the bark
        zc = -0.080 + 3.0 * q.x * q.x
        dy += 0.009 * math.exp(-((q.x / 0.05) ** 4) - ((q.z - zc) / 0.010) ** 2)
        # long vertical bark furrows, eased off around the eyes, nose and mouth
        w = q.x * 62 + 1.6 * noise.noise(V(q.z * 7.0, 0.5, 2.0))
        calm = 1.0 - 0.75 * math.exp(-((q.x / 0.11) ** 2 + ((q.z + 0.02) / 0.09) ** 2))
        dy += 0.0075 * abs(math.sin(w * 0.5)) ** 3 * calm
        q.y += dy * fw
        # bark grain all round the back
        q.y += 0.005 * math.sin(math.atan2(q.y, q.x) * 18) * (1 - fw) * (1 if q.y < 0 else 0) * smooth(0.09, 0.02, q.z)
        return tuple(q + FC)

    deform(face, face_fn)
    furry(face, 0.004, 22.0, 6.0)
    P.append((face, "Head"))
    face_y = surface_probe([face])

    def on_face(x, z, out=0.0):
        """Point on the carved face surface at (x, z), pushed `out` metres forward."""
        return V(x, face_y(FC.x + x, FC.z + z, FC.y - 0.12) - out, FC.z + z)

    carved = []
    # heavy carved brows overhanging the eyes (inner ends lifted, outer ends drooping)
    for sx in (-1, 1):
        pts = [on_face(sx * x, z, o) for x, z, o in ((0.018, 0.064, 0.004), (0.052, 0.074, 0.010), (0.088, 0.070, 0.010),
                                                       (0.118, 0.050, 0.006), (0.135, 0.028, 0.0))]
        br = etube(f"Myr_brow{sx}", [tuple(p) for p in pts], [0.010, 0.016, 0.016, 0.012, 0.006], [0.008, 0.013, 0.013, 0.010, 0.005],
                   hint=(0, 0, 1), segments=6, mat=bark, samples=2)
        grain(br, 0.003, 90.0, 6.0, sx)
        carved.append(br)
    # long carved nose: bridge from the brow knot down to a rounded, slightly hooked tip
    npts = [on_face(0.0, z, o) for z, o in ((0.056, -0.002), (0.030, 0.001), (0.0, 0.004), (-0.026, 0.009), (-0.044, 0.0))]
    nose = etube("Myr_nose", [tuple(p) for p in npts], [0.010, 0.011, 0.013, 0.017, 0.012], [0.007, 0.008, 0.010, 0.013, 0.008],
                 hint=(1, 0, 0), segments=7, mat=bark, samples=2)
    grain(nose, 0.0025, 90.0, 5.0, 3.0)
    carved.append(nose)
    for sx in (-1, 1):  # nostril wings
        carved.append(sphere(f"Myr_nostril{sx}", (0.012, 0.010, 0.010), tuple(on_face(sx * 0.018, -0.038, 0.001)), seg=7, rings=5, mat=bark))
    P.append((K.join_objects(carved, "Myr_faceCarving"), "Head"))

    # knot-hole eyes: carved rims, deep hollows, warm amber glow under heavy bark lids
    for s, sx in (("L", 1), ("R", -1)):
        ec = V(J["eye" + s])
        rim = K.make_torus(f"Myr_rim{s}", 0.032, 0.008, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0),
                           major_segments=14, minor_segments=4, mat=bark_dark)
        deform(rim, lambda c, ec=ec, sx=sx: (ec.x + c.x * 1.05, ec.y + 0.016 + c.y, ec.z + c.z * 0.8 + sx * c.x * 0.15))
        furry(rim, 0.003, 40.0, 3 + sx)
        P.append((rim, "Head"))
        hole = sphere(f"Myr_hole{s}", (0.031, 0.02, 0.025), tuple(ec + V(0, 0.022, 0)), seg=10, rings=7, mat=hollow)
        P.append((hole, "Head"))
        glow = sphere(f"Myr_eye{s}", (0.016, 0.009, 0.013), tuple(ec + V(0, 0.0, -0.003)), seg=10, rings=7, mat=eye_glow)
        P.append((glow, "Eye" + s))
        lid = sphere(f"Myr_lid{s}", (0.035, 0.019, 0.030), (0, 0, 0), seg=12, rings=8, mat=bark)
        cut(lid, lambda c, sx=sx: c.z > -0.0015 - 0.22 * sx * c.x and c.y < 0.006)
        solidify(lid, 0.004, 1.0)
        deform(lid, lambda c, ec=ec: (c.x + ec.x, c.y + ec.y + 0.008, c.z + ec.z))
        P.append((lid, "Head"))

    # mouth: a shadowed seam (Head) above a carved lower lip that rides the Jaw
    mpts = [on_face(x, -0.080 + 3.0 * x * x, -0.004) for x in (-0.048, -0.024, 0.0, 0.024, 0.048)]
    seam = etube("Myr_mouthSeam", [tuple(p) for p in mpts], [0.0025, 0.0045, 0.005, 0.0045, 0.0025], [0.004, 0.006, 0.006, 0.006, 0.004],
                 hint=(0, 0, 1), segments=6, mat=mouth_m, samples=2)
    cavity = sphere("Myr_mouthCavity", (0.046, 0.016, 0.022), tuple(on_face(0.0, -0.092, -0.018)), seg=10, rings=6, mat=mouth_m)
    P.append((K.join_objects([seam, cavity], "Myr_mouth"), "Head"))
    lpts = [on_face(x, -0.090 + 2.6 * x * x, 0.003) for x in (-0.042, -0.02, 0.0, 0.02, 0.042)]
    lip = etube("Myr_lowerLip", [tuple(p) for p in lpts], [0.003, 0.0065, 0.0075, 0.0065, 0.003], [0.003, 0.0065, 0.007, 0.0065, 0.003],
                hint=(0, 0, 1), segments=6, mat=bark, samples=2)
    P.append((lip, "Jaw"))

    # --- Cap: broad translucent dome, sculpted gills glowing underneath ---
    cap_r = 0.52
    cprof = [(-0.05, cap_r * 0.97), (-0.03, cap_r * 1.00), (0.01, cap_r * 0.98), (0.07, cap_r * 0.90), (0.14, cap_r * 0.75),
             (0.21, cap_r * 0.52), (0.26, cap_r * 0.28), (0.295, cap_r * 0.06)]

    def cap_wave(a, z):
        return 1.0 + 0.035 * math.sin(a * 5 + 0.6) * smooth(0.12, 0.0, z) + 0.02 * math.sin(a * 9)

    cap = lathe("Myr_cap", cprof, segments=40, mat=cap_top, cap_bottom=False, cap_top=True, rfn=cap_wave)
    deform(cap, lambda c: (c.x + CAPC.x, c.y + CAPC.y + 0.04 * (c.z / 0.3), c.z + CAPC.z - 0.25 * max(0.0, (c.x ** 2 + c.y ** 2) ** 0.5 - 0.32) ** 1.5))
    P.append((cap, "Hat"))
    # underside: a shallow cone of radial gills (each gill a thin fin)
    under = lathe("Myr_under", [(-0.07, 0.07), (-0.05, 0.2), (-0.035, 0.33), (-0.045, cap_r * 0.96)], segments=40, mat=gills,
                  cap_bottom=True, cap_top=False, rfn=cap_wave)
    deform(under, lambda c: (c.x + CAPC.x, c.y + CAPC.y, c.z + CAPC.z - 0.25 * max(0.0, (c.x ** 2 + c.y ** 2) ** 0.5 - 0.32) ** 1.5))
    P.append((under, "Hat"))
    fins = []
    for i in range(24):
        a = i / 24 * TAU
        r0, r1 = 0.09, cap_r * 0.94 * cap_wave(a, 0.0)
        d = V(math.cos(a), math.sin(a), 0)
        dr = lambda r: -0.25 * max(0.0, r - 0.32) ** 1.5
        pts = [CAPC + d * r0 + V(0, 0, -0.07), CAPC + d * lerp(r0, r1, 0.5) + V(0, 0, -0.062 + dr(lerp(r0, r1, 0.5))), CAPC + d * r1 + V(0, 0, -0.05 + dr(r1))]
        fins.append(etube(f"Myr_gill{i}", [tuple(p) for p in pts], [0.012, 0.02, 0.008], [0.003, 0.0035, 0.002], hint=(0, 0, 1),
                          segments=4, mat=gills, cap=True, samples=0))
    P.append((K.join_objects(fins, "Myr_gillFins"), "Hat"))
    # pale glowing spots on the cap
    spots = []
    rnd = random.Random(12)
    for i in range(14):
        a = rnd.uniform(0, TAU)
        t = rnd.uniform(0.15, 0.85)
        r = cap_r * (1 - t) ** 0.7 * 0.95
        z = CAPC.z + 0.295 * (1 - (1 - t) ** 1.6) - 0.012 - 0.25 * max(0.0, r - 0.32) ** 1.5
        n = V(math.cos(a) * 0.9, math.sin(a) * 0.9, 1.0).normalized()
        sp = sphere(f"Myr_spot{i}", (rnd.uniform(0.022, 0.042), rnd.uniform(0.02, 0.036), 0.008), (0, 0, 0), seg=8, rings=4, mat=spot)
        orient(sp, (0, 0, 0), n)
        p = CAPC + V(math.cos(a) * r, math.sin(a) * r + 0.03 * t, z - CAPC.z)
        deform(sp, lambda c, p=p: (c.x + p.x, c.y + p.y, c.z + p.z))
        spots.append(sp)
    P.append((K.join_objects(spots, "Myr_spots"), "Hat"))
    # stem collar joining face to cap
    stem = lathe("Myr_stem", [(1.775, 0.15), (1.80, 0.13), (1.81, 0.10)], segments=20, mat=gills, center=(0, CAPC.y, 0))
    ring_frill = K.make_torus("Myr_annulus", 0.15, 0.014, location=(0, CAPC.y, 1.785), major_segments=24, minor_segments=6, mat=spot)
    P.append((K.join_objects([stem, ring_frill], "Myr_stemJ"), "Head"))

    # --- Moss mantle over the shoulders (lumpy, wet) ------------------------
    balls = []
    rnd = random.Random(3)
    for i in range(26):
        a = i / 26 * TAU
        front = max(0.0, -math.sin(a))
        x = math.cos(a) * 0.36
        y = math.sin(a) * (0.25 if math.sin(a) < 0 else 0.33) - 0.11
        z = 1.55 + rnd.uniform(-0.03, 0.04) - 0.08 * front + 0.04 * abs(math.cos(a))
        balls.append((x, y, z, rnd.uniform(0.10, 0.14)))
    for sx in (-1, 1):
        balls.append((sx * 0.37, -0.08, 1.58, 0.17))
        balls.append((sx * 0.43, -0.09, 1.47, 0.12))
        balls.append((sx * 0.30, 0.10, 1.44, 0.14))
        balls.append((sx * 0.20, -0.34, 1.42, 0.10))
        balls.append((sx * 0.26, -0.30, 1.33, 0.07))
    for i in range(7):
        x = (i - 3) * 0.09
        balls.append((x, 0.25 + 0.02 * (i % 2), 1.42 - 0.05 * (i % 3), 0.12))
        balls.append((x * 0.8, 0.26, 1.28 - 0.06 * ((i * 3) % 2), 0.09))
    moss_mesh = metaball_mesh("Myr_moss", balls, resolution=0.04, threshold=0.6, mat=moss, max_tris=1850)
    furry(moss_mesh, 0.012, 22.0, 9.0)
    P.append((moss_mesh, ["Chest", "ShoulderL", "ShoulderR", "Neck", "Cloak"]))
    # lichen dangles from the mantle front (the beard covers the middle)
    dangles = []
    rnd = random.Random(5)
    for i in range(16):
        a = -math.pi / 2 + (i - 7.5) * 0.17
        L = rnd.uniform(0.06, 0.16)
        w = V(rnd.uniform(-0.015, 0.015), -0.006, 0)
        if abs(i - 7.5) < 3:
            continue
        base = V(math.cos(a) * 0.33, math.sin(a) * 0.25 - 0.10, 1.44 + 0.03 * abs(math.cos(a)))
        dangles.append(tube(f"Myr_lichen{i}", [tuple(base), tuple(base + w + V(0, 0, -L * 0.5)), tuple(base - w + V(0, -0.004, -L))],
                            [0.007, 0.005, 0.0015], segments=4, mat=moss_lt, samples=2))
    P.append((K.join_objects(dangles, "Myr_lichen"), "Chest"))

    # --- Carved bark beard + moss wisps flowing from the jaw into the collar --
    body_y = surface_probe([face, moss_mesh, trunk])

    def beard_wisp(name, u, *, length, width, thick, off, m, z_top=None, seed=0.0):
        """One tapering ribbon of bark/moss: rooted on the jawline at u in [-1, 1], draped over the body."""
        z_root = -0.106 + 0.09 * abs(u) ** 1.5 if z_top is None else z_top
        root = on_face(u * 0.128, z_root, -0.006)
        tip_z = root.z - length
        tip_x = root.x * 0.45 + 0.012 * math.sin(seed * 3.1)
        pts = []
        for k in range(6):
            t = k / 5
            x = lerp(root.x, tip_x, t ** 0.8) + 0.006 * math.sin(t * 5 + seed)
            z = lerp(root.z, tip_z, t)
            yb = body_y(x, z, root.y + 0.2)
            target = body_y(tip_x, tip_z, root.y + 0.2) - off
            y_line = lerp(root.y - 0.012, min(target, root.y + 0.08), t * t) - 0.016 * math.sin(math.pi * t)
            y = min(y_line, yb - off) if k else root.y
            pts.append((x, y, z))
        w = [width * f for f in (0.75, 1.0, 0.92, 0.72, 0.42, 0.08)]
        th = [thick * f for f in (0.8, 1.0, 0.9, 0.7, 0.45, 0.12)]
        rb = etube(name, pts, w, th, hint=(1, 0, 0), segments=5, mat=m, samples=2, twist=[0, 0.05 * u, 0.1 * u, 0.12 * u, 0.1 * u, 0.0])
        grain(rb, 0.0022, 110.0, 5.0, seed)
        return rb

    beard_jaw, beard_head = [], []
    # under-layer: dark heartwood in the middle, hanging moss at the sides flowing into the mossy collar
    for i, u in enumerate((-0.7, 0.0, 0.7)):
        side = u != 0.0
        beard_head.append(beard_wisp(f"Myr_beardUnder{i}", u, length=0.19 if side else 0.25, width=0.03 if side else 0.046,
                                     thick=0.018 if side else 0.014, off=0.010, m=moss if side else bark_dark,
                                     z_top=-0.135 if side else None, seed=i * 1.7))
    # front layer: long carved bark wisps converging to a point (centre ones ride the Jaw)
    for i, u in enumerate((-0.92, -0.6, -0.3, 0.0, 0.3, 0.6, 0.92)):
        wsp = beard_wisp(f"Myr_beard{i}", u, length=0.30 - 0.13 * abs(u) ** 1.3, width=0.026 - 0.006 * abs(u), thick=0.010, off=0.020,
                         m=bark, seed=i * 2.3 + 0.5)
        (beard_jaw if abs(u) < 0.45 else beard_head).append(wsp)
    # moustache sweeping from under the nose down past the mouth corners into the beard
    for sx in (-1, 1):
        mp = [on_face(sx * x, z, o) for x, z, o in ((0.010, -0.050, 0.010), (0.040, -0.064, 0.008), (0.064, -0.088, 0.008),
                                                     (0.076, -0.118, 0.012), (0.080, -0.150, 0.018))]
        mo = etube(f"Myr_moustache{sx}", [tuple(p) for p in mp], [0.008, 0.012, 0.011, 0.008, 0.002], [0.006, 0.008, 0.008, 0.006, 0.0015],
                   hint=(sx, 0, 1), segments=5, mat=bark, samples=2)
        grain(mo, 0.002, 110.0, 5.0, sx * 2)
        beard_head.append(mo)
    P.append((K.join_objects(beard_head, "Myr_beardHead"), "Head"))
    P.append((K.join_objects(beard_jaw, "Myr_beardJaw"), "Jaw"))

    # --- Shelf-fungus epaulettes stacked up the left shoulder -------------
    shelves = []
    for i, (p, r, tilt) in enumerate((((0.47, -0.10, 1.62), 0.13, 0.1), ((0.51, -0.03, 1.52), 0.11, 0.15), ((0.43, -0.13, 1.71), 0.09, 0.05),
                                      ((0.38, 0.13, 1.38), 0.09, 0.12), ((0.39, 0.09, 1.27), 0.07, 0.2))):
        prof = [(0.0, r * 0.15), (0.004, r * 0.85), (0.012, r), (0.022, r * 0.92), (0.035, r * 0.55), (0.042, r * 0.1)]
        sh = lathe(f"Myr_shelf{i}", prof, segments=14, mat=shelf, rfn=lambda a, z: 1.0 + 0.06 * math.sin(a * 4))
        # half-disc: squash the inner half into the body
        deform(sh, lambda c, r=r: (c.x * (1.0 if c.x > 0 else 0.35), c.y * 0.9, c.z))
        rim = K.make_torus(f"Myr_shelfRim{i}", r * 0.97, 0.006, location=(0, 0, 0.012), major_segments=14, minor_segments=4, mat=shelf_rim)
        deform(rim, lambda c: (c.x * (1.0 if c.x > 0 else 0.35), c.y * 0.9, c.z))
        sj = K.join_objects([sh, rim], f"Myr_shelfJ{i}")
        bake(sj)
        M = Matrix.Translation(V(p)) @ Matrix.Rotation(math.atan2(p[1], p[0]), 4, "Z") @ Matrix.Rotation(-tilt, 4, "Y")
        for v in sj.data.vertices:
            v.co = M @ v.co
        shelves.append(sj)
    P.append((K.join_objects(shelves[:3], "Myr_epauletteHi"), "ShoulderL"))
    P.append((K.join_objects(shelves[3:], "Myr_epauletteLo"), "Chest"))

    # --- Long reaching arms: twisted bark limbs, root-fingers --------------
    for s, sx in (("L", 1), ("R", -1)):
        sh, el, wr, hd = V(J["sh" + s]), V(J["el" + s]), V(J["wr" + s]), V(J["hd" + s])
        pts = [sh + V(-sx * 0.04, 0, 0.02), sh.lerp(el, 0.5) + V(sx * 0.02, 0, 0), el, el.lerp(wr, 0.5) + V(sx * 0.01, -0.01, 0), wr]
        arm_t = etube(f"Myr_arm{s}", [tuple(p) for p in pts], [0.145, 0.11, 0.088, 0.075, 0.06], [0.13, 0.10, 0.078, 0.066, 0.052],
                      hint=(0, 1, 0), segments=14, mat=bark, samples=4, twist=[0, 0.5, 1.0, 1.5, 2.0])
        grain(arm_t, 0.018, 30.0, 2.5, sx * 3)
        furry(arm_t, 0.008, 9.0, sx * 3)
        P.append((arm_t, ["Shoulder" + s, "Arm" + s, "Forearm" + s, "Hand" + s]))
        # elbow burl + moss tuft
        burl = sphere(f"Myr_burl{s}", (0.07, 0.065, 0.06), tuple(el + V(sx * 0.01, 0.03, 0)), seg=12, rings=8, mat=bark_dark)
        furry(burl, 0.012, 14.0, 2 + sx)
        P.append((burl, ["Arm" + s, "Forearm" + s]))
        # hand: knobbly palm + four long root fingers + thumb, drooping toward the moss
        F = (hd - wr).normalized()
        side = V(sx, 0, 0)
        fwd = V(0, -1, 0)
        palm = sphere(f"Myr_palm{s}", (0.07, 0.055, 0.085), tuple(wr + F * 0.06), seg=14, rings=10, mat=bark)
        furry(palm, 0.008, 15.0, 4 + sx)
        fingers = [palm]
        for k in range(4):
            off = (k - 1.5) * 0.034
            base = wr + F * 0.10 + fwd * (off * 0.9) + side * 0.01
            curl = 0.6 + 0.15 * k
            ln = 0.30 - abs(k - 1.5) * 0.03
            p1 = base + F * ln * 0.35 + fwd * off * 0.4
            p2 = p1 + F * ln * 0.35 + side * 0.03 * curl - fwd * 0.03
            p3 = p2 + F * ln * 0.2 + side * 0.05 * curl - fwd * 0.05 + V(0, 0, 0.01)
            fingers.append(tube(f"Myr_finger{s}{k}", [tuple(base), tuple(p1), tuple(p2), tuple(p3)], [0.024, 0.02, 0.014, 0.005],
                                segments=7, mat=bark, samples=2))
        th = wr + F * 0.07 - fwd * -0.05
        fingers.append(tube(f"Myr_thumb{s}", [tuple(th), tuple(th + V(0, -0.06, -0.06)), tuple(th + V(-sx * 0.02, -0.1, -0.11))],
                            [0.022, 0.016, 0.005], segments=7, mat=bark, samples=2))
        hand = K.join_objects(fingers, f"Myr_hand{s}")
        P.append((hand, "Hand" + s))

    # --- Legs: stout root-trunks splaying into root feet --------------------
    for s, sx in (("L", 1), ("R", -1)):
        hip, kn, an = V(J["hip" + s]), V(J["kn" + s]), V(J["an" + s])
        leg = etube(f"Myr_leg{s}", [tuple(hip + V(0, 0, 0.05)), tuple(hip.lerp(kn, 0.5)), tuple(kn), tuple(kn.lerp(an, 0.5)), tuple(an + V(0, 0, 0.0)), (an.x, an.y, 0.03)],
                    [0.15, 0.135, 0.115, 0.105, 0.115, 0.16], [0.14, 0.125, 0.105, 0.095, 0.105, 0.14], hint=(0, 1, 0), segments=14, mat=bark, samples=3)
        grain(leg, 0.02, 26.0, 2.0, sx * 5)
        furry(leg, 0.01, 8.0, sx * 5)
        cut(leg, lambda c: c.z >= -0.001)
        deform(leg, lambda c: (c.x, c.y, max(0.0, c.z)))
        P.append((leg, ["Pelvis", "Thigh" + s, "Shin" + s]))
        roots = []
        for k, ang in enumerate((-1.75, -1.25, -0.6, 0.2, 1.3, 2.6)):
            a = ang if sx > 0 else math.pi - ang
            d = V(math.cos(a), math.sin(a), 0)
            base = V(an.x, an.y, 0.10) + d * 0.08
            ln = 0.16 + 0.07 * ((k * 5) % 3)
            pts = [base, base + d * ln * 0.4 + V(0, 0, -0.05), base + d * ln * 0.8 + V(0, 0, -0.075), base + d * ln + V(0, 0, -0.085)]
            roots.append(tube(f"Myr_root{s}{k}", [tuple(p) for p in pts], [0.05, 0.035, 0.02, 0.008], segments=6, mat=bark_dark, samples=2))
        rj = K.join_objects(roots, f"Myr_roots{s}")
        deform(rj, lambda c: (c.x, c.y, max(0.0, c.z)))
        P.append((rj, "Foot" + s))

    # --- Mycelial root-skirt: mossy roots draping from a moss waist band ----
    # band of moss knitting the skirt to the trunk, so every root grows out of moss, not bare bark
    band = []
    rnd = random.Random(17)
    for i in range(24):
        a = i / 24 * TAU + rnd.uniform(-0.06, 0.06)
        z = 0.95 + 0.035 * math.sin(a * 3 + 0.4) + rnd.uniform(-0.02, 0.02)
        p = trunk_pt(a, z, 0.99)
        band.append((p.x, p.y, p.z, rnd.uniform(0.05, 0.09)))
        if i % 3 == 0:  # moss tongues sagging below the band
            q = trunk_pt(a + 0.08, z - rnd.uniform(0.05, 0.08), 1.0)
            band.append((q.x, q.y, q.z, rnd.uniform(0.045, 0.06)))
    band_mesh = metaball_mesh("Myr_waistMoss", band, resolution=0.032, threshold=0.6, mat=moss, max_tris=600)
    furry(band_mesh, 0.014, 30.0, 4.0)
    P.append((band_mesh, ["Pelvis", "Spine"]))

    rnd = random.Random(7)
    groups = {"Tentacle1": [], "Tentacle2": [], "Tentacle3": [], "Tentacle4": []}

    def hang(a, z0, ln, sway):
        """Control points for a root that arcs out over the moss band, then droops and drifts like a hanging vine."""
        out = V(math.cos(a), math.sin(a), 0)
        side = V(-math.sin(a), math.cos(a), 0)
        base = trunk_pt(a, z0 - 0.03, 1.0)
        return [base, base + out * 0.018 + side * sway * 0.15 + V(0, 0, -ln * 0.24), base + out * 0.032 + side * sway * 0.5 + V(0, 0, -ln * 0.5),
                base + out * 0.04 + side * sway * 0.25 + V(0, 0, -ln * 0.76), base + out * 0.044 - side * sway * 0.2 + V(0, 0, -ln)]

    kinds = ["glow"] * 12 + ["mossroot"] * 7 + ["aerial"] * 5 + ["wisp"] * 7
    rnd.shuffle(kinds)
    for i, kind in enumerate(kinds):
        a = i / len(kinds) * TAU + rnd.uniform(-0.05, 0.05)
        front_short = 0.75 if math.sin(a) < -0.6 else 1.0
        z0 = 0.93 + rnd.uniform(-0.02, 0.03)
        sway = rnd.choice((-1, 1)) * rnd.uniform(0.025, 0.06)
        if kind == "glow":
            pts = hang(a, z0, rnd.uniform(0.24, 0.46) * front_short, sway)
            t = tube(f"Myr_strand{i}", [tuple(p) for p in pts], [0.0075, 0.0058, 0.0042, 0.0026, 0.0007], segments=4, mat=tendril, samples=2)
        elif kind == "mossroot":
            pts = hang(a, z0, rnd.uniform(0.28, 0.48) * front_short, sway)
            t = tube(f"Myr_mossRoot{i}", [tuple(p) for p in pts], [0.016, 0.012, 0.009, 0.0055, 0.0015], segments=5, mat=moss, samples=2)
            furry(t, 0.003, 60.0, i)
        elif kind == "aerial":
            pts = hang(a, z0, rnd.uniform(0.36, 0.56) * front_short, sway * 1.4)
            t = tube(f"Myr_aerial{i}", [tuple(p) for p in pts], [0.015, 0.011, 0.008, 0.005, 0.0015], segments=5, mat=bark_dark, samples=2)
            grain(t, 0.002, 80.0, 6.0, i)
        else:
            pts = hang(a, z0 + 0.02, rnd.uniform(0.16, 0.30) * front_short, sway)
            t = etube(f"Myr_mossWisp{i}", [tuple(p) for p in pts], [0.013, 0.012, 0.009, 0.006, 0.0015], [0.0035, 0.003, 0.0025, 0.002, 0.001],
                      hint=(-math.sin(a), math.cos(a), 0), segments=4, mat=moss_lt, samples=2)
        # which quadrant tentacle bone sways this strand (q0 front -Y, q1 +X, q2 back, q3 -X)
        q = int(((a + math.pi / 4 + math.pi / 2) % TAU) / (math.pi / 2)) % 4
        groups[("Tentacle1", "Tentacle2", "Tentacle3", "Tentacle4")[q]].append(t)
    for bn, objs in groups.items():
        if objs:
            P.append((K.join_objects(objs, f"Myr_{bn}"), bn))
    # mycelial threads trailing from the feet into the moss
    trails = []
    for s, sx in (("L", 1), ("R", -1)):
        an = V(J["an" + s])
        for k in range(3):
            a = (-0.9 - 0.5 * k) if sx > 0 else (math.pi + 0.9 + 0.5 * k)
            d = V(math.cos(a), math.sin(a), 0)
            base = V(an.x, an.y, 0.004) + d * 0.18
            pts = [base, base + d * 0.12 + V(0.02, 0, 0), base + d * 0.24 + V(-0.02, 0.01, 0)]
            trails.append(tube(f"Myr_trail{s}{k}", [tuple(p) for p in pts], [0.006, 0.004, 0.0015], segments=5, mat=tendril, samples=2))
    tj = K.join_objects(trails, "Myr_trails")
    deform(tj, lambda c: (c.x, c.y, max(0.0, c.z)))
    P.append((tj, "Root"))

    # small mushrooms sprouting from the shoulders and back (silhouette accents)
    sprouts = []
    for i, (p, h, r) in enumerate((((-0.33, 0.04, 1.66), 0.10, 0.05), ((-0.24, 0.15, 1.60), 0.065, 0.032), ((0.14, 0.25, 1.52), 0.075, 0.038),
                                   ((-0.42, -0.06, 1.66), 0.055, 0.03), ((0.05, 0.33, 1.42), 0.05, 0.026))):
        p = V(p)
        st = tube(f"Myr_sprStem{i}", [tuple(p), tuple(p + V(0, 0.01, h))], [r * 0.3, r * 0.25], segments=6, mat=spot, samples=0)
        cp = lathe(f"Myr_sprCap{i}", [(0, r), (r * 0.4, r * 0.85), (r * 0.75, r * 0.45), (r * 0.9, 0.0)], segments=10, mat=cap_top,
                   center=(p.x, p.y + 0.01, 0))
        deform(cp, lambda c, p=p, h=h: (c.x, c.y, c.z + p.z + h))
        gl = lathe(f"Myr_sprGill{i}", [(-0.004, r * 0.25), (0.0, r * 0.95)], segments=10, mat=gills, cap_bottom=True, cap_top=False,
                   center=(p.x, p.y + 0.01, 0))
        deform(gl, lambda c, p=p, h=h: (c.x, c.y, c.z + p.z + h))
        sprouts += [st, cp, gl]
    P.append((K.join_objects(sprouts, "Myr_sprouts"), "Chest"))

    arm = build_rig("myrrow", H, J, extras)
    mesh = bind(arm, P, "Myrrow_Body")
    return arm, mesh


# ---------------------------------------------------------------------------
# Shared human helpers (Batch C)
# ---------------------------------------------------------------------------

def open_coat(name, profile, gap_fn, *, n=28, dz=0.03, mat=None, thickness=0.012, rfn=None):
    """
    Open-front garment (coat, jacket, cardigan, poncho): super-elliptical rings whose
    arc leaves a front opening of half-angle gap_fn(z) around -Y, solidified for thickness.
    """
    zs = [p[0] for p in profile]
    rings = []
    z = zs[0]
    zz = []
    while z < zs[-1] - 1e-6:
        zz.append(z)
        z += dz
    zz.append(zs[-1])
    for z in zz:
        k = 0
        while k < len(zs) - 2 and z > zs[k + 1]:
            k += 1
        t = (z - zs[k]) / max(1e-6, zs[k + 1] - zs[k])
        t = t * t * (3 - 2 * t) * 0.5 + t * 0.5
        a, b = profile[k], profile[k + 1]
        vals = [lerp(a[i], b[i], t) for i in range(1, len(a))]
        g = gap_fn(z)
        rings.append(ring(z, vals[0], vals[1], vals[2], n=n, y0=vals[3] if len(vals) > 3 else 0.0,
                          a0=-math.pi / 2 + g, a1=1.5 * math.pi - g, rfn=rfn))
    obj = loft(name, rings, closed=False, mat=mat, u_scale=2.0, v_scale=2.0)
    solidify(obj, thickness, -1.0)
    recalc(obj)
    return obj, rings


def make_specs(name, center, *, rim_r, spread, mat, glass=None, pitch=0.0, temple_back=0.11, temple_x=0.10, rim_minor=0.0022):
    """Round brass spectacles centred at `center` (between the lenses), facing -Y."""
    c = V(center)
    parts = []
    for sx in (-1, 1):
        rc = c + V(sx * spread, 0, 0)
        rim = K.make_torus(f"{name}_rim{sx}", rim_r, rim_minor, location=tuple(rc), rotation=(math.pi / 2, 0, 0),
                           major_segments=14, minor_segments=4, mat=mat)
        parts.append(rim)
        if glass is not None:
            parts.append(sphere(f"{name}_lens{sx}", (rim_r * 0.98, 0.0025, rim_r * 0.98), tuple(rc), seg=12, rings=6, mat=glass))
        parts.append(tube(f"{name}_temple{sx}", [tuple(rc + V(sx * rim_r, 0, 0)), tuple(c + V(sx * temple_x, temple_back * 0.5, 0.004)),
                                                 tuple(c + V(sx * temple_x, temple_back, -0.006))], rim_minor * 0.9, segments=4, mat=mat, samples=1))
    parts.append(tube(f"{name}_bridge", [tuple(c + V(-spread + rim_r, 0, 0.004)), tuple(c + V(0, -0.004, 0.009)),
                                          tuple(c + V(spread - rim_r, 0, 0.004))], rim_minor, segments=4, mat=mat, samples=2))
    specs = K.join_objects(parts, name)
    bake(specs)
    if pitch:
        M = Matrix.Translation(c) @ Matrix.Rotation(pitch, 4, "X") @ Matrix.Translation(-c)
        for v in specs.data.vertices:
            v.co = M @ v.co
        specs.data.update()
    return specs


def human_face(prefix, HC, s, mats, *, jaw_taper=0.74, cheek=1.0, ear=1.0, lid_open=0.62, lid_tilt=0.1,
               nose=None, blush=None, P=None, eye_lod=0.6, lip_scale=None):
    """
    Kit head sculpt + Batch C extras (eyelids, smile line, optional bulbous nose / blush).
    Binds pieces into P with the right bones and returns key positions.
    """
    h = K.sculpt_stylized_head(prefix, center=tuple(HC), scale=s, skin_mat=mats["skin"], eye_white_mat=mats["white"],
                               iris_mat=mats["iris"], pupil_mat=mats["pupil"], brow_mat=mats["brow"], lip_mat=mats["lip"],
                               jaw_taper=jaw_taper, cheek_fullness=cheek, ear_scale=ear)
    if lip_scale:
        lip = h["jaw"]
        bake(lip)
        lc = sum((v.co for v in lip.data.vertices), Vector()) / len(lip.data.vertices)
        for v in lip.data.vertices:
            d = v.co - lc
            v.co = lc + V(d.x * lip_scale[0], d.y * lip_scale[1], d.z * lip_scale[2])
        lip.data.update()
    if eye_lod < 0.999:
        # the kit eyeballs are dense and mostly hidden by lids: lighten them
        decimate(h["eye_l"], eye_lod)
        decimate(h["eye_r"], eye_lod)
    P.append((h["head"], "Head"))
    P.append((h["jaw"], "Jaw"))
    P.append((h["eye_l"], "EyeL"))
    P.append((h["eye_r"], "EyeR"))
    P.append((h["brows"], "Head"))
    if "ears" in h:
        P.append((h["ears"], "Head"))
    eyes = {}
    extra = []
    for side, sx in (("L", 1), ("R", -1)):
        ec = V((HC.x + sx * 0.037 * s, HC.y - 0.097 * s, HC.z + 0.008 * s))
        eyes[side] = ec
        extra.append(make_eyelid(f"{prefix}_lid{side}", tuple(ec), 0.0185 * s, open_amt=lid_open, mat=mats["skin"], tilt=lid_tilt, side=sx))
        extra.append(make_eyelid(f"{prefix}_llid{side}", tuple(ec), 0.0185 * s, open_amt=0.75, mat=mats["skin"], lower=True))
    if nose:
        nz, nr = nose
        nb = sphere(f"{prefix}_noseBulb", (nr[0] * s, nr[1] * s, nr[2] * s), (HC.x, HC.y - (0.118 + nz[1]) * s, HC.z + nz[0] * s), seg=14, rings=9, mat=mats["skin"])
        extra.append(nb)
        for sx in (-1, 1):
            extra.append(sphere(f"{prefix}_nostril{sx}", (0.011 * s, 0.012 * s, 0.009 * s),
                                (HC.x + sx * 0.016 * s, HC.y - (0.110 + nz[1] * 0.6) * s, HC.z + (nz[0] - 0.008) * s), seg=10, rings=6, mat=mats["skin"]))
    if blush:
        for sx in (-1, 1):
            extra.append(sphere(f"{prefix}_blush{sx}", (0.024 * s, 0.01 * s, 0.017 * s),
                                (HC.x + sx * 0.056 * s, HC.y - 0.096 * s, HC.z - 0.026 * s), seg=10, rings=6, mat=blush, rot=(0, 0, -sx * 0.5)))
    P.append((K.join_objects(extra, f"{prefix}_faceExtras"), "Head"))
    return {"eyes": eyes, "mouth": V((HC.x, HC.y - 0.104 * s, HC.z - 0.058 * s)), "head": h}


def smile_line(name, mouth, s, mat, *, width=0.032, curve=0.006, r=0.0022):
    pts = []
    for i in range(7):
        t = (i / 6) * 2 - 1
        pts.append((mouth.x + t * width * s, mouth.y - 0.004 * s + abs(t) ** 2 * 0.012 * s, mouth.z + 0.012 * s + (t * t) * curve * s))
    return tube(name, pts, [r * s * 0.6, r * s, r * s, r * s, r * s, r * s, r * s * 0.6], segments=5, mat=mat, samples=1)


def human_neck_rig(J, HC, s):
    """Keep Head / Jaw / Eye bones on the kit head sculpt."""
    J["eyeL"] = (HC.x + 0.037 * s, HC.y - 0.097 * s, HC.z + 0.008 * s)
    J["eyeR"] = (HC.x - 0.037 * s, HC.y - 0.097 * s, HC.z + 0.008 * s)
    J["jaw"] = (HC.x, HC.y - 0.03 * s, HC.z - 0.03 * s)
    J["chin"] = (HC.x, HC.y - 0.11 * s, HC.z - 0.085 * s)
    J["head"] = (HC.x, HC.y + 0.01 * s, HC.z - 0.09 * s)
    J["head_top"] = (HC.x, HC.y, HC.z + 0.135 * s)


# ---------------------------------------------------------------------------
# 13. Halcyon Vey, Cartographer of the Sky (1.62 m)
# ---------------------------------------------------------------------------

@builder("halcyon", 1.62, "#1a1f3a")
def build_halcyon():
    H = 1.62
    s = 1.06
    HC = V(0, -0.10, 1.43)
    mats = skin_set("Hal", "#f0c2a8", lip="#c97f74", brow="#f7f1e6", iris="#5f87b0", rough=0.48)
    hair = mat("Hal_Hair", "#fbf6ee", roughness=0.78, coat_weight=0.1)
    navy = mat("Hal_Coat", "#1e2a5a", roughness=0.72, **texset("halcyon", "normal"), uv_scale=3.0, normal_strength=0.5)
    lining = mat("Hal_CoatLining", "#7a2230", roughness=0.55)
    brocade = mat("Hal_Brocade", "#2a3570", roughness=0.5, metallic=0.15, **texset("halcyon", "albedo", "normal", "roughness", "emissive"),
                  uv_scale=5.0, emission_strength=0.6)
    brass = mat("Hal_Brass", "#c18a2c", roughness=0.28, metallic=1.0, **texset("_shared_brass", "albedo", "roughness"), tint_strength=0.25)
    cream = mat("Hal_Shirt", "#f6ecd8", roughness=0.7)
    stock_a = mat("Hal_StockingCream", "#f3e6cc", roughness=0.8)
    stock_b = mat("Hal_StockingRed", "#8c2f39", roughness=0.8)
    slipper = mat("Hal_Slipper", "#5b1f2c", roughness=0.6, coat_weight=0.2)
    vellum = mat("Hal_StarChart", "#1b2552", roughness=0.6, **texset("halcyon", "normal"), uv_scale=1.0, normal_strength=0.4)
    vellum_back = mat("Hal_Vellum", "#f6e7c1", roughness=0.7)
    glass = mat("Hal_Lens", "#dfefff", roughness=0.05, alpha=0.22)
    gold_glow = mat("Hal_GoldInk", "#f59e0b", roughness=0.3, emission_color="#f59e0b", emission_strength=3.0)
    blush = mat("Hal_Blush", "#e58f86", roughness=0.5)
    line = mat("Hal_Line", "#b77d6c", roughness=0.6)

    P = []
    J = {
        "pelvis": (0, 0.04, 0.86), "spine": (0, 0.05, 1.01), "chest": (0, 0.03, 1.15), "neck": (0, -0.03, 1.29),
        "clavL": (0.04, 0.0, 1.25), "shL": (0.165, 0.02, 1.235), "elL": (0.215, 0.05, 1.00), "wrL": (0.16, -0.15, 0.93), "hdL": (0.11, -0.23, 0.93),
        "clavR": (-0.04, 0.0, 1.25), "shR": (-0.165, 0.02, 1.235), "elR": (-0.225, 0.03, 1.01), "wrR": (-0.19, -0.17, 1.08), "hdR": (-0.155, -0.24, 1.12),
        "hipL": (0.085, 0.04, 0.86), "knL": (0.095, -0.03, 0.47), "anL": (0.10, 0.03, 0.08), "toeL": (0.11, -0.13, 0.025),
        "hipR": (-0.085, 0.04, 0.86), "knR": (-0.095, -0.03, 0.47), "anR": (-0.10, 0.03, 0.08), "toeR": (-0.11, -0.13, 0.025),
    }
    human_neck_rig(J, HC, s)
    chart_c = V(0.07, -0.26, 0.94)
    astro_c = V(-0.15, -0.275, 1.17)
    extras = {
        "Cloak": ("Pelvis", (0, 0.10, 0.86), (0, 0.17, 0.40)),
        "PropL": ("HandL", tuple(chart_c), tuple(chart_c + V(0.2, 0, 0))),
        "PropR": ("HandR", tuple(astro_c), tuple(astro_c + V(0, 0, 0.1))),
        "Hat": ("Head", tuple(HC + V(0, -0.04, 0.10)), tuple(HC + V(0, -0.04, 0.20))),
    }

    # --- Head, face, wrinkles ----------------------------------------------
    face = human_face("Hal", HC, s, mats, jaw_taper=0.78, cheek=1.3, ear=1.2, lid_open=0.55, lid_tilt=0.22,
                      nose=((-0.02, 0.022), (0.026, 0.026, 0.028)), blush=blush, P=P)
    lines = []
    for i, dz in enumerate((0.052, 0.066, 0.080)):
        pts = [(HC.x + t * 0.05 * s, HC.y - (0.112 - 0.012 * abs(t) ** 2) * s, HC.z + (dz + 0.004 * math.cos(t * 3)) * s) for t in (-1, -0.5, 0, 0.5, 1)]
        lines.append(tube(f"Hal_brow_line{i}", pts, 0.0018 * s, segments=4, mat=line, samples=2))
    for sx in (-1, 1):
        ec = face["eyes"]["L" if sx > 0 else "R"]
        for k in range(3):
            a = -0.5 + k * 0.45
            p0 = ec + V(sx * 0.026 * s, 0.006 * s, 0)
            lines.append(tube(f"Hal_crow{sx}{k}", [tuple(p0 + V(0, 0, a * 0.01)), tuple(p0 + V(sx * 0.016 * s, 0.006 * s, a * 0.02 * s))],
                              [0.0016 * s, 0.0008 * s], segments=4, mat=line, samples=0))
        # nasolabial fold
        lines.append(tube(f"Hal_fold{sx}", [(HC.x + sx * 0.03 * s, HC.y - 0.112 * s, HC.z - 0.02 * s), (HC.x + sx * 0.044 * s, HC.y - 0.104 * s, HC.z - 0.05 * s),
                                             (HC.x + sx * 0.044 * s, HC.y - 0.096 * s, HC.z - 0.07 * s)], 0.0022 * s, segments=4, mat=line, samples=2))
    P.append((K.join_objects(lines, "Hal_wrinkles"), "Head"))
    P.append((smile_line("Hal_smile", face["mouth"], s, line, width=0.026, curve=0.008), "Head"))

    # --- Cloud hair & beard (metaballs), mustache, bushy brows -------------
    balls = []
    rnd = random.Random(4)
    for i in range(70):
        az = rnd.uniform(-0.55, math.pi + 0.55)          # sides + back (front is the face)
        el = rnd.uniform(-0.45, 1.05)
        if el > 0.75 and abs(math.cos(az)) < 0.5:
            continue                                      # thinning crown
        dist = 0.118 * s * (1.0 + rnd.uniform(0.05, 0.32) * (0.6 + 0.6 * abs(math.cos(az))))
        d = V(math.cos(az) * math.cos(el), math.sin(az) * math.cos(el) * 0.95, math.sin(el))
        p = HC + V(0, 0.02, 0) + d * dist
        balls.append((p.x, p.y, p.z, rnd.uniform(0.045, 0.07)))
    for i in range(6):  # wispy fluff over the bald crown
        balls.append((HC.x + rnd.uniform(-0.05, 0.05), HC.y + rnd.uniform(-0.03, 0.06), HC.z + 0.125 * s + rnd.uniform(0, 0.02), 0.04))
    hair_mesh = metaball_mesh("Hal_hair", balls, resolution=0.034, threshold=0.6, mat=hair, max_tris=3000)
    cut(hair_mesh, lambda c: not (c.y < HC.y - 0.06 and c.z < HC.z + 0.11 * s and abs(c.x - HC.x) < 0.095))
    furry(hair_mesh, 0.006, 26.0, 2.0)
    P.append((hair_mesh, "Head"))
    wisps = []
    for i, (a, z, ln) in enumerate(((0.15, 0.06, 0.09), (2.95, 0.08, 0.10), (1.3, 0.13, 0.08), (0.55, 0.12, 0.07), (2.5, 0.13, 0.075), (-0.25, -0.02, 0.07), (3.4, 0.0, 0.07))):
        b = HC + V(math.cos(a) * 0.15, 0.02 + math.sin(a) * 0.12, z)
        d = V(math.cos(a), math.sin(a) * 0.6, 0.35).normalized()
        side = V(-d.y, d.x, 0) * 0.02
        wisps.append(tube(f"Hal_wisp{i}", [tuple(b), tuple(b + d * ln * 0.45 + side + V(0, 0, 0.01)), tuple(b + d * ln * 0.8 - side * 0.3 + V(0, 0, -0.004)),
                                           tuple(b + d * ln * 0.85 - side * 1.2 + V(0, 0, -0.018))],
                          [0.02, 0.014, 0.008, 0.003], segments=7, mat=hair, samples=2))
    P.append((K.join_objects(wisps, "Hal_wisps"), "Head"))
    beard_balls = []
    rnd = random.Random(9)
    for i in range(15):
        t = i / 14 * 2 - 1  # -1 .. 1 across the jaw
        a = -math.pi / 2 + t * 1.25
        x = HC.x + math.cos(a) * 0.095 * s
        y = HC.y + math.sin(a) * 0.100 * s + 0.012
        zc = HC.z - (0.035 + 0.075 * (1 - abs(t)) ** 1.5) * s
        beard_balls.append((x, y, zc, 0.048 + 0.012 * (1 - abs(t))))
    for i in range(9):  # the cloud spilling down over the cravat
        t = (i / 8) * 2 - 1
        beard_balls.append((HC.x + t * 0.06, HC.y - 0.10 - 0.02 * (1 - abs(t)), HC.z - 0.16 - 0.03 * (1 - abs(t)) + rnd.uniform(-0.01, 0.01), 0.062))
    beard_balls.append((HC.x, HC.y - 0.09, HC.z - 0.235, 0.05))
    beard = metaball_mesh("Hal_beard", beard_balls, resolution=0.032, threshold=0.6, mat=hair, max_tris=2400)
    m = face["mouth"]
    furry(beard, 0.006, 26.0, 5.0)
    P.append((beard, ["Head", "Jaw"]))
    stache = []
    for sx in (-1, 1):
        stache.append(tube(f"Hal_stache{sx}", [(m.x, m.y - 0.008, m.z + 0.024 * s), (m.x + sx * 0.024 * s, m.y - 0.004, m.z + 0.016 * s),
                                                (m.x + sx * 0.045 * s, m.y + 0.008, m.z + 0.002 * s), (m.x + sx * 0.058 * s, m.y + 0.018, m.z - 0.012 * s)],
                           [0.012 * s, 0.014 * s, 0.010 * s, 0.004 * s], segments=8, mat=hair, samples=2))
    for sx in (-1, 1):  # bushy brow tufts over the kit brows
        e0 = face["eyes"]["L" if sx > 0 else "R"]
        stache.append(tube(f"Hal_bushybrow{sx}", [tuple(e0 + V(-sx * 0.016 * s, -0.012 * s, 0.026 * s)), tuple(e0 + V(sx * 0.006 * s, -0.012 * s, 0.034 * s)),
                                                  tuple(e0 + V(sx * 0.030 * s, -0.002 * s, 0.032 * s))], [0.006 * s, 0.009 * s, 0.004 * s], segments=6, mat=hair, samples=2))
    P.append((K.join_objects(stache, "Hal_stache"), "Head"))

    # --- Spectacles: one pair on the nose, two pushed up on the forehead ---
    ey = face["eyes"]["L"].y
    nose_specs = make_specs("Hal_specsNose", (HC.x, ey - 0.032, face["eyes"]["L"].z - 0.004), rim_r=0.024 * s, spread=0.039 * s,
                            mat=brass, glass=glass, temple_back=0.12, temple_x=0.106 * s)
    P.append((nose_specs, "Head"))
    fore1 = make_specs("Hal_specsFore1", (HC.x, HC.y - 0.118 * s, HC.z + 0.072 * s), rim_r=0.022 * s, spread=0.037 * s, mat=brass,
                       glass=None, pitch=-0.55, temple_back=0.12, temple_x=0.11 * s)
    fore2 = make_specs("Hal_specsFore2", (HC.x + 0.004, HC.y - 0.100 * s, HC.z + 0.108 * s), rim_r=0.019 * s, spread=0.034 * s, mat=brass,
                       glass=None, pitch=-0.95, temple_back=0.11, temple_x=0.105 * s, rim_minor=0.0026)
    P.append((K.join_objects([fore1, fore2], "Hal_specsFore"), "Hat"))

    # --- Neck, shirt collar, cravat ----------------------------------------
    neck = lathe("Hal_neck", [(1.24, 0.052), (1.31, 0.048), (1.37, 0.05)], segments=16, mat=mats["skin"], center=(0, -0.05, 0))
    collar = lathe("Hal_collar", [(1.26, 0.07, 0.068, 0.0), (1.31, 0.066, 0.064, 0.0), (1.33, 0.07, 0.07, 0.0)], segments=20, mat=cream,
                   cap_bottom=False, cap_top=False, center=(0, -0.045, 0))
    P.append((K.join_objects([neck], "Hal_neckJ"), ["Chest", "Neck"]))
    P.append((collar, ["Chest", "Neck"]))
    cravat = [sphere("Hal_cravatKnot", (0.03, 0.022, 0.026), (0, -0.128, 1.255), seg=12, rings=8, mat=cream)]
    for k, (dx, ln) in enumerate(((-0.018, 0.11), (0.02, 0.095))):
        cravat.append(etube(f"Hal_cravatTail{k}", [(dx * 0.4, -0.13, 1.245), (dx, -0.145, 1.20), (dx * 1.3, -0.148, 1.15 - (0.11 - ln))],
                            [0.022, 0.03, 0.026], 0.006, hint=(1, 0, 0), segments=8, mat=cream, samples=3))
    P.append((K.join_objects(cravat, "Hal_cravat"), "Chest"))

    # --- Brocade waistcoat (constellation embroidery) + brass buttons ------
    wprof = [(0.80, 0.165, 0.150, 0.150, 0.045), (0.88, 0.172, 0.150, 0.155, 0.04), (1.00, 0.168, 0.140, 0.150, 0.04),
             (1.12, 0.178, 0.140, 0.160, 0.03), (1.20, 0.172, 0.128, 0.155, 0.015), (1.25, 0.13, 0.10, 0.12, 0.0), (1.28, 0.08, 0.075, 0.08, -0.02)]
    vest = loft("Hal_waistcoat", profile_rings(wprof, dz=0.03, n=24), mat=brocade, cap_start=True, cap_end=True, u_scale=2.0, v_scale=2.0)
    recalc(vest)
    P.append((vest, ["Pelvis", "Spine", "Chest"]))
    btns = []
    for i, z in enumerate((0.86, 0.94, 1.02, 1.10)):
        btns.append(sphere(f"Hal_vbtn{i}", (0.011, 0.006, 0.011), (0.0, -0.188 + 0.012 * (z - 0.86), z), seg=10, rings=6, mat=brass))
    # watch chain swag
    btns.append(tube("Hal_chain", [(0.0, -0.188, 0.98), (0.05, -0.18, 0.95), (0.10, -0.165, 0.965)], 0.0028, segments=4, mat=brass, samples=3))
    P.append((K.join_objects(btns, "Hal_vbuttons"), "Spine"))

    # --- Long navy scholar's coat (open front, lining, rolled lapels) ------
    cprof = [(0.36, 0.25, 0.20, 0.25, 0.07), (0.50, 0.225, 0.185, 0.225, 0.06), (0.70, 0.20, 0.17, 0.205, 0.05),
             (0.86, 0.19, 0.165, 0.195, 0.045), (1.00, 0.188, 0.155, 0.195, 0.045), (1.12, 0.20, 0.155, 0.205, 0.035),
             (1.21, 0.205, 0.145, 0.20, 0.02), (1.27, 0.17, 0.12, 0.17, 0.0), (1.31, 0.085, 0.08, 0.10, -0.025)]
    gap = lambda z: 0.62 - 0.30 * smooth(0.5, 0.92, z) + 0.28 * smooth(1.02, 1.26, z)
    coat, coat_rings = open_coat("Hal_coat", cprof, gap, n=24, dz=0.04, mat=navy, thickness=0.012)
    # lining colour on the inner shell: faces whose normal points toward the body axis
    coat.data.materials.append(lining)
    for p in coat.data.polygons:
        c = p.center
        radial = V(c.x, c.y - 0.04, 0)
        if radial.length > 1e-4 and p.normal.dot(radial.normalized()) < -0.3:
            p.material_index = 1
    P.append((coat, ["Pelvis", "Spine", "Chest", "Cloak"]))
    # rolled lapels / front edges
    edges = []
    for side in (0, -1):
        pts = [tuple(V(r[side]) + V(0, -0.004, 0)) for r in coat_rings[::2]]
        edges.append(tube(f"Hal_lapel{side}", pts, [0.012] * (len(pts) - 3) + [0.016, 0.02, 0.018], segments=6, mat=navy, samples=1))
    P.append((K.join_objects(edges, "Hal_lapels"), ["Pelvis", "Spine", "Chest"]))
    # high turned-up collar at the back of the neck
    back_collar = etube("Hal_backCollar", [(-0.10, -0.02, 1.28), (-0.07, 0.05, 1.33), (0.0, 0.075, 1.35), (0.07, 0.05, 1.33), (0.10, -0.02, 1.28)],
                        0.04, 0.01, hint=(0, 0, 1), segments=8, mat=navy, samples=3)
    P.append((back_collar, "Chest"))
    # brass-rimmed pockets + spyglass poking out of the right one
    pockets = []
    for sx in (-1, 1):
        px, py, pz = sx * 0.19, -0.055, 0.70
        flap = etube(f"Hal_pocket{sx}", [(px - sx * 0.07, py - 0.10, pz), (px, py - 0.035, pz + 0.004), (px + sx * 0.015, py + 0.03, pz)],
                     0.028, 0.006, hint=(0, 0, 1), segments=6, mat=navy, samples=2)
        rim = tube(f"Hal_pocketRim{sx}", [(px - sx * 0.07, py - 0.103, pz - 0.026), (px, py - 0.04, pz - 0.022), (px + sx * 0.016, py + 0.03, pz - 0.026)],
                   0.0045, segments=5, mat=brass, samples=2)
        pockets += [flap, rim]
    pockets.append(tube("Hal_spyglass", [(-0.20, -0.10, 0.66), (-0.215, -0.10, 0.76), (-0.225, -0.10, 0.84)], [0.018, 0.016, 0.013], segments=10, mat=brass, samples=0))
    pockets.append(K.make_torus("Hal_spyRing", 0.016, 0.004, location=(-0.218, -0.10, 0.78), major_segments=12, minor_segments=4, mat=brass))
    pockets.append(sphere("Hal_spyLens", (0.012, 0.012, 0.004), (-0.225, -0.10, 0.842), seg=10, rings=6, mat=glass))
    P.append((K.join_objects(pockets, "Hal_pockets"), "Pelvis"))

    # --- Sleeves, cuffs, hands ---------------------------------------------
    for side, sx in (("L", 1), ("R", -1)):
        sh, el, wr = V(J["sh" + side]), V(J["el" + side]), V(J["wr" + side])
        cuff_p = wr + (el - wr).normalized() * 0.035
        pts = [sh + V(-sx * 0.025, 0, 0.02), sh.lerp(el, 0.5), el, el.lerp(cuff_p, 0.5), cuff_p]
        sl = tube(f"Hal_sleeve{side}", [tuple(p) for p in pts], [0.062, 0.056, 0.050, 0.050, 0.054], segments=14, mat=navy, samples=3)
        P.append((sl, ["Shoulder" + side, "Arm" + side, "Forearm" + side]))
        cuff = lathe(f"Hal_cuff{side}", [(0.0, 0.058), (0.012, 0.062), (0.05, 0.06), (0.06, 0.054)], segments=14, mat=navy, cap_bottom=False, cap_top=False)
        orient(cuff, (0, 0, 0), el - wr)
        deform(cuff, lambda c, o=cuff_p + (wr - el).normalized() * 0.03: (c.x + o.x, c.y + o.y, c.z + o.z))
        cb = sphere(f"Hal_cuffBtn{side}", 0.008, tuple(cuff_p + V(sx * 0.055, 0, 0.0)), seg=8, rings=6, mat=brass)
        ruffle = K.make_torus(f"Hal_ruffle{side}", 0.04, 0.008, major_segments=14, minor_segments=5, mat=cream)
        orient(ruffle, (0, 0, 0), wr - el)
        deform(ruffle, lambda c, o=wr + (el - wr).normalized() * 0.008: (c.x + o.x, c.y + o.y, c.z + o.z))
        P.append((K.join_objects([cuff, cb, ruffle], f"Hal_cuffJ{side}"), "Forearm" + side))
        shp = sphere(f"Hal_shoulder{side}", (0.07, 0.07, 0.06), tuple(sh + V(-sx * 0.015, 0, 0.0)), seg=12, rings=8, mat=navy)
        P.append((shp, ["Chest", "Shoulder" + side, "Arm" + side]))
    hL = make_hand("Hal_handL", J["wrL"], V(J["hdL"]) - V(J["wrL"]), (0, 0, 1), "L", scale=0.92, curl=0.9, mat=mats["skin"])
    P.append((hL, "HandL"))
    hR = make_hand("Hal_handR", J["wrR"], V(J["hdR"]) - V(J["wrR"]), (0.3, 0.0, 1.0), "R", scale=0.92, curl=0.45, mat=mats["skin"])
    P.append((hR, "HandR"))

    # --- Knee breeches, striped stockings, slippers ------------------------
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an = V(J["hip" + side]), V(J["kn" + side]), V(J["an" + side])
        br = tube(f"Hal_breeches{side}", [tuple(hip + V(-sx * 0.01, 0, 0.04)), tuple(hip.lerp(kn, 0.5)), tuple(kn + V(0, 0, 0.03))],
                  [0.085, 0.078, 0.06], segments=14, mat=navy, samples=3)
        P.append((br, ["Pelvis", "Thigh" + side, "Shin" + side]))
        band = K.make_torus(f"Hal_kneeBand{side}", 0.056, 0.008, location=tuple(kn + V(0, 0, 0.02)), major_segments=14, minor_segments=5, mat=navy)
        kb = sphere(f"Hal_kneeBtn{side}", 0.007, tuple(kn + V(sx * 0.055, -0.005, 0.03)), seg=8, rings=6, mat=brass)
        P.append((K.join_objects([band, kb], f"Hal_kneeJ{side}"), "Shin" + side))
        stock = tube(f"Hal_stocking{side}", [tuple(kn + V(0, 0, 0.03)), tuple(kn.lerp(an, 0.35) + V(0, 0.01, 0)), tuple(kn.lerp(an, 0.75)), tuple(an + V(0, 0, 0.0))],
                     [0.05, 0.052, 0.036, 0.034], segments=10, mat=stock_a, samples=9)
        stripe_materials(stock, [stock_a, stock_b], lambda c: c.z, 0.045, 0.5)
        P.append((stock, ["Thigh" + side, "Shin" + side, "Foot" + side]))
        sl = make_shoe(f"Hal_slipper{side}", (an.x, an.y + 0.005), length=0.24, width=0.085, height=0.055, mat=slipper, sole_mat=vellum_back,
                       toe_lift=0.02, sole_h=0.012, seg=18, rings=12)
        tip = sphere(f"Hal_slipperPom{side}", 0.012, (an.x, an.y - 0.165, 0.05), seg=8, rings=6, mat=gold_glow)
        P.append((K.join_objects(sl + [tip], f"Hal_slipperJ{side}"), "Foot" + side))

    # --- Rolled star chart (left hand): roll + half-unrolled sheet ---------
    ax = V(1.0, 0.25, -0.12).normalized()
    roll = tube("Hal_roll", [tuple(chart_c - ax * 0.17), tuple(chart_c + ax * 0.15)], 0.03, segments=14, mat=vellum_back, samples=0)
    caps = []
    for sgn in (-1, 1):
        caps.append(K.make_torus(f"Hal_rollEdge{sgn}", 0.03, 0.004, major_segments=12, minor_segments=3, mat=gold_glow))
        orient(caps[-1], (0, 0, 0), ax)
        o = chart_c + ax * (0.15 if sgn > 0 else -0.17)
        deform(caps[-1], lambda c, o=o: (c.x + o.x, c.y + o.y, c.z + o.z))
    # unrolled sheet hanging forward/down from the roll, star-knot side facing out
    sheet_rings = []
    for k in range(7):
        t = k / 6
        drop = V(0, -0.03 - 0.07 * t, -0.03 - 0.20 * t + 0.03 * t * t)
        row = []
        for j in range(9):
            u = j / 8
            row.append(tuple(chart_c + ax * lerp(-0.07, 0.15, u) + drop + V(0, -0.01 * math.sin(u * math.pi), 0)))
        sheet_rings.append(row)
    sheet = loft("Hal_sheet", sheet_rings[::-1], closed=False, mat=vellum, u_scale=1.0, v_scale=2.6)
    solidify(sheet, 0.004, 0.0)
    recalc(sheet)
    sheet.data.materials.append(vellum_back)
    for p in sheet.data.polygons:
        if p.normal.y > 0.2:
            p.material_index = 1
    # fifteen gold stars joined into a knot (trefoil drawn flat), slightly proud of the outer face
    ink = []
    def sheet_pt(u, t):
        drop = V(0, -0.03 - 0.07 * t, -0.03 - 0.20 * t + 0.03 * t * t)
        return chart_c + ax * lerp(-0.07, 0.15, u) + drop + V(0, -0.01 * math.sin(u * math.pi), 0) + V(0, -0.0045, 0.001)
    knot = []
    for k in range(15):
        th = k / 15 * TAU
        kx = math.sin(th) + 2 * math.sin(2 * th)
        ky = math.cos(th) - 2 * math.cos(2 * th)
        knot.append(sheet_pt(0.5 + kx * 0.13, 0.52 + ky * 0.12))
    for k in range(15):
        ink.append(sphere(f"Hal_star{k}", 0.0055 if k % 3 else 0.0075, tuple(knot[k]), seg=5, rings=4, mat=gold_glow))
        ink.append(tube(f"Hal_inkLine{k}", [tuple(knot[k]), tuple(knot[(k + 1) % 15])], 0.0014, segments=3, mat=gold_glow, samples=0))
    P.append((K.join_objects([roll, sheet] + caps + ink, "Hal_chart"), "PropL"))

    # --- Brass pocket astrolabe (right hand) -------------------------------
    nrm = V(0.0, -1.0, 0.25).normalized()
    astro = []
    disc = K.make_cylinder("Hal_mater", 0.055, 0.055, 0.008, vertices=24, mat=brass)
    astro.append(disc)
    astro.append(K.make_torus("Hal_limb", 0.056, 0.006, major_segments=24, minor_segments=5, mat=brass))
    rete = K.make_torus("Hal_rete", 0.036, 0.003, location=(0.008, 0, 0.006), major_segments=18, minor_segments=4, mat=gold_glow)
    astro.append(rete)
    for k in range(6):
        a = k / 6 * TAU
        astro.append(tube(f"Hal_reteSpoke{k}", [(0, 0, 0.006), (math.cos(a) * 0.05, math.sin(a) * 0.05, 0.006)], 0.0022, segments=4, mat=brass, samples=0))
    astro.append(tube("Hal_alidade", [(-0.06, -0.01, 0.009), (0.06, 0.01, 0.009)], 0.004, segments=5, mat=brass, samples=0))
    astro.append(K.make_torus("Hal_throne", 0.012, 0.004, location=(0, 0.064, 0), rotation=(0, math.pi / 2, 0), major_segments=10, minor_segments=4, mat=brass))
    aj = K.join_objects(astro, "Hal_astrolabeJ")
    orient(aj, (0, 0, 0), nrm)
    deform(aj, lambda c: (c.x + astro_c.x, c.y + astro_c.y, c.z + astro_c.z))
    P.append((aj, "PropR"))

    arm = build_rig("halcyon", H, J, extras)
    mesh = bind(arm, P, "Halcyon_Body")
    return arm, mesh


# ---------------------------------------------------------------------------
# 14. Dre Honeycutt, Block Beekeeper (1.88 m)
# ---------------------------------------------------------------------------

def shell_from(src, name, keep, offset, mat, amp=0.0, freq=30.0, seed=0.0):
    """Copy a sculpted head, keep a region and push it out along normals (beards, fades, hair caps)."""
    o = dup(src, name)
    cut(o, keep)
    me = o.data
    for v in me.vertices:
        n = noise.noise(v.co * freq + V(seed, seed, seed)) if amp else 0.0
        v.co = v.co + v.normal * (offset + amp * n)
    me.update()
    K.assign_material(o, mat)
    return o


def mask_shell(src, name, mask_fn, mat, *, depth=0.005, sink=-0.003, amp=0.0, freq=60.0):
    """
    Hair/beard shell with a smooth outline: every vertex of the head copy is pushed out
    by lerp(sink, depth, mask). Where the mask is 0 the shell sits under the skin, so the
    visible edge is the smooth iso-contour of the mask rather than a jagged vertex cut.
    """
    o = dup(src, name)
    bake(o)
    me = o.data
    keep = []
    for v in me.vertices:
        mk = max(0.0, min(1.0, mask_fn(v.co)))
        n = noise.noise(v.co * freq) * amp if amp else 0.0
        v.co = v.co + v.normal * (lerp(sink, depth, mk) + n * mk)
        keep.append(mk > 0.001)
    me.update()
    # drop fully-hidden vertices far from the contour to save triangles
    flags = keep
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    dead = [v for v in bm.verts if not flags[v.index] and all(not flags[e.other_vert(v).index] for e in v.link_edges)]
    bmesh.ops.delete(bm, geom=dead, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    K.assign_material(o, mat)
    return o


def grin(prefix, mouth, s, *, lip, teeth, width=0.03, P=None):
    """Upper lip arc + visible teeth band for an easy grin (Head), the kit lip blob stays on Jaw."""
    parts = []
    up, tt = [], []
    for i in range(9):
        t = (i / 8) * 2 - 1
        curve = (t * t) * 0.013 * s
        up.append((mouth.x + t * width * s, mouth.y - 0.004 * s + abs(t) ** 2 * 0.010 * s, mouth.z + 0.017 * s + curve))
        tt.append((mouth.x + t * width * 0.86 * s, mouth.y - 0.002 * s + abs(t) ** 2 * 0.009 * s, mouth.z + 0.009 * s + curve * 0.8))
    parts.append(etube(f"{prefix}_upperLip", up, [0.003 * s] + [0.0065 * s] * 7 + [0.003 * s], [0.002 * s] + [0.0045 * s] * 7 + [0.002 * s],
                       hint=(0, 0, 1), segments=8, mat=lip, samples=1))
    parts.append(etube(f"{prefix}_teeth", tt, [0.002 * s] + [0.0062 * s] * 7 + [0.002 * s], [0.0015 * s] + [0.0035 * s] * 7 + [0.0015 * s],
                       hint=(0, 0, 1), segments=8, mat=teeth, samples=1))
    return K.join_objects(parts, f"{prefix}_grin")


@builder("dre", 1.88, "#2a1d0a")
def build_dre():
    H = 1.88
    s = 1.12
    HC = V(0, -0.02, 1.684)
    mats = skin_set("Dre", "#5b3a26", lip="#4a2a20", brow="#140d0a", iris="#3a2416", sclera="#efe6da", rough=0.45)
    hairc = mat("Dre_Hair", "#140d0a", roughness=0.9)
    teeth = mat("Dre_Teeth", "#f4efe6", roughness=0.25)
    tee = mat("Dre_Tee", "#f7f7f4", roughness=0.75)
    jacket = mat("Dre_Jacket", "#f2ad1c", roughness=0.5, coat_weight=0.25, **texset("dre", "normal", "roughness"), uv_scale=4.0,
                 normal_strength=0.3)
    cobalt = mat("Dre_Cobalt", "#2f6fe4", roughness=0.45, coat_weight=0.2)
    denim = mat("Dre_Denim", "#34486e", roughness=0.85, **texset("dre", "normal"), uv_scale=4.0, normal_strength=0.3)
    honey = mat("Dre_Honey", "#f2a516", roughness=0.08, coat_weight=1.0, coat_roughness=0.05, emission_color="#fbbf24", emission_strength=0.25)
    gold = mat("Dre_Gold", "#e8b84a", roughness=0.22, metallic=1.0)
    brass = mat("Dre_Brass", "#b98a3a", roughness=0.35, metallic=1.0, **texset("_shared_brass", "albedo", "roughness"), tint_strength=0.2)
    leather = mat("Dre_Leather", "#6b3d1f", roughness=0.6)
    wood = mat("Dre_Wood", "#c08a4c", roughness=0.55, **texset("_shared_wood", "albedo"), uv_scale=1.0, tint_strength=0.4)
    sneaker = mat("Dre_Sneaker", "#f5f5f4", roughness=0.4, coat_weight=0.3)
    sole = mat("Dre_Sole", "#ececea", roughness=0.6)
    veil = mat("Dre_Veil", "#cfc8b4", roughness=0.7, alpha=0.5, double_sided=True)
    hatm = mat("Dre_Hat", "#f1ddb0", roughness=0.8, **texset("dre", "normal"), uv_scale=3.0, normal_strength=0.3)
    bee_y = mat("Dre_BeeYellow", "#f6c21a", roughness=0.6)
    bee_k = mat("Dre_BeeBlack", "#1a1510", roughness=0.6)
    wing = mat("Dre_Wing", "#e9f2ff", roughness=0.1, alpha=0.35, double_sided=True)
    smoke = mat("Dre_SmokerTip", "#3a3530", roughness=0.8)

    P = []
    J = {
        "pelvis": (0, 0.02, 0.98), "spine": (0, 0.02, 1.16), "chest": (0, 0.015, 1.35), "neck": (0, -0.005, 1.52),
        "clavL": (0.05, 0.0, 1.48), "shL": (0.215, 0.02, 1.465), "elL": (0.285, 0.04, 1.18), "wrL": (0.30, -0.06, 0.96), "hdL": (0.305, -0.11, 0.88),
        "clavR": (-0.05, 0.0, 1.48), "shR": (-0.215, 0.02, 1.465), "elR": (-0.275, 0.05, 1.19), "wrR": (-0.245, -0.18, 1.08), "hdR": (-0.235, -0.27, 1.07),
        "hipL": (0.10, 0.02, 0.97), "knL": (0.12, -0.02, 0.53), "anL": (0.125, 0.03, 0.10), "toeL": (0.135, -0.15, 0.03),
        "hipR": (-0.10, 0.02, 0.97), "knR": (-0.12, -0.02, 0.53), "anR": (-0.125, 0.03, 0.10), "toeR": (-0.135, -0.15, 0.03),
    }
    human_neck_rig(J, HC, s)
    smoker_c = V(-0.215, -0.30, 1.10)
    dipper_c = V(0.305, -0.15, 0.90)
    HATC = HC + V(0, 0.035, 0.068 * s)
    extras = {
        "Hat": ("Head", tuple(HATC), tuple(HATC + V(0, 0.02, 0.12))),
        "PropR": ("HandR", tuple(smoker_c), tuple(smoker_c + V(0, 0, 0.12))),
        "PropL": ("HandL", tuple(dipper_c), tuple(dipper_c + V(0, -0.12, 0.05))),
    }

    # --- Head, face, beard, fade ---------------------------------------------
    face = human_face("Dre", HC, s, mats, jaw_taper=0.80, cheek=1.1, ear=1.05, lid_open=0.44, lid_tilt=0.05, P=P,
                      nose=((-0.024, 0.006), (0.028, 0.018, 0.02)))
    head_obj = face["head"]["head"]
    m = face["mouth"]
    P.append((grin("Dre", m + V(0, -0.009, -0.002), s, lip=mats["lip"], teeth=teeth, width=0.034), "Head"))
    def beard_mask(c):
        q = (c - HC) / s
        ax_ = abs(q.x)
        zb = lerp(-0.050, -0.002, smooth(0.035, 0.098, ax_))       # cheek line: mouth corner -> sideburn
        m1 = smooth(zb + 0.012, zb - 0.022, q.z)
        m2 = 1.0 - math.exp(-((q.x / 0.040) ** 2 + ((q.z + 0.056) / 0.019) ** 2)) * smooth(-0.04, -0.08, q.y)
        m3 = smooth(0.05, 0.0, q.y)
        fade = 0.55 + 0.45 * smooth(-0.01, -0.06, q.z)             # faded higher up the cheeks
        return m1 * m2 * m3 * fade

    beard = mask_shell(head_obj, "Dre_beard", beard_mask, hairc, depth=0.006, sink=-0.003, amp=0.0012)
    P.append((beard, ["Head", "Jaw"]))
    stache = etube("Dre_stache", [(m.x - 0.040 * s, m.y + 0.002, m.z + 0.020 * s), (m.x, m.y - 0.008, m.z + 0.034 * s), (m.x + 0.040 * s, m.y + 0.002, m.z + 0.020 * s)],
                   [0.003, 0.0055, 0.003], [0.0025, 0.0035, 0.0025], hint=(0, 0, 1), segments=6, mat=hairc, samples=3)
    P.append((stache, "Head"))
    def fade_mask(c):
        q = (c - HC) / s
        front = smooth(-0.07, -0.10, q.y)
        zl = lerp(lerp(-0.045, 0.02, smooth(0.0, -0.06, q.y)), 0.078, front)  # nape -> temples -> forehead hairline
        return smooth(zl - 0.012, zl + 0.022, q.z) * (1.0 - smooth(0.08, 0.115, abs(q.x)) * smooth(0.04, -0.04, q.z))

    fade = mask_shell(head_obj, "Dre_fade", fade_mask, hairc, depth=0.004, sink=-0.003, amp=0.0008)
    P.append((fade, "Head"))
    # heavy, warm brows
    brows = []
    for sx in (-1, 1):
        e0 = face["eyes"]["L" if sx > 0 else "R"]
        brows.append(etube(f"Dre_brow{sx}", [tuple(e0 + V(-sx * 0.018 * s, -0.016 * s, 0.025 * s)), tuple(e0 + V(sx * 0.004 * s, -0.017 * s, 0.031 * s)),
                                             tuple(e0 + V(sx * 0.026 * s, -0.008 * s, 0.028 * s))], [0.006, 0.007, 0.004], [0.003, 0.0035, 0.002],
                           hint=(0, 0, 1), segments=6, mat=hairc, samples=2))
    P.append((K.join_objects(brows, "Dre_browsHeavy"), "Head"))
    neck = lathe("Dre_neck", [(1.44, 0.064), (1.53, 0.060), (1.60, 0.062)], segments=16, mat=mats["skin"], center=(0, -0.01, 0))
    P.append((neck, ["Chest", "Neck"]))

    # --- Bucket hat pushed back + mesh bee veil draped behind ---------------
    hp = [(-0.035, 0.205), (-0.03, 0.212), (-0.022, 0.205), (-0.008, 0.17), (0.0, 0.142), (0.03, 0.140), (0.07, 0.134), (0.092, 0.118), (0.103, 0.06), (0.106, 0.0)]
    hat = lathe("Dre_hat", hp, segments=28, mat=hatm, cap_bottom=False, cap_top=True)
    band = K.make_torus("Dre_hatBand", 0.141, 0.009, location=(0, 0, 0.012), major_segments=28, minor_segments=5, mat=cobalt)
    hat_j = K.join_objects([hat, band], "Dre_hatJ")
    bake(hat_j)
    M = Matrix.Translation(HATC) @ Matrix.Rotation(-0.30, 4, "X")
    for v in hat_j.data.vertices:
        v.co = M @ v.co
    hat_j.data.update()
    P.append((hat_j, "Hat"))
    vrings = []
    for k in range(5):
        t = k / 4
        rr = 0.20 + 0.035 * t
        row = []
        for j in range(15):
            a = lerp(0.45, math.pi - 0.45, j / 14)  # back only, bunched
            p = V(math.cos(a) * rr * (1 - 0.12 * t), math.sin(a) * rr, -0.03 - 0.13 * t)
            p.z += 0.025 * math.sin(a * 9) * t   # soft gathered folds
            p.y += 0.012 * math.cos(a * 9) * t
            row.append(tuple(M @ p))
        vrings.append(row)
    vl = loft("Dre_veil", vrings[::-1], closed=False, mat=veil, u_scale=4.0, v_scale=4.0)
    trim = tube("Dre_veilHem", vrings[-1], 0.004, segments=4, mat=cobalt, samples=1)
    P.append((K.join_objects([vl, trim], "Dre_veilJ"), ["Hat", "Neck"]))

    # --- White tee, gold chain + hex pendant -------------------------------
    tprof = [(0.93, 0.18, 0.13, 0.135), (1.05, 0.185, 0.135, 0.14), (1.20, 0.195, 0.14, 0.15), (1.33, 0.21, 0.145, 0.15),
             (1.43, 0.205, 0.13, 0.14), (1.49, 0.155, 0.10, 0.11), (1.53, 0.08, 0.072, 0.072)]
    tshirt = loft("Dre_tee", profile_rings(tprof, dz=0.04, n=22), mat=tee, cap_start=True, cap_end=True)
    recalc(tshirt)
    P.append((tshirt, ["Pelvis", "Spine", "Chest"]))
    collar = K.make_torus("Dre_teeCollar", 0.074, 0.007, location=(0, -0.008, 1.522), rotation=(0.18, 0, 0), major_segments=18, minor_segments=4, mat=tee)
    P.append((collar, "Chest"))
    chain_pts = []
    for i in range(17):
        a = -math.pi / 2 + (i / 16 - 0.5) * 2 * 2.3
        r = 0.085
        drop = max(0.0, math.cos((a + math.pi / 2) * 0.68)) ** 2
        chain_pts.append((math.cos(a) * r * 1.05, math.sin(a) * r * 0.95 - 0.01 - 0.06 * drop, 1.525 - 0.15 * drop))
    chain = tube("Dre_chain", chain_pts, 0.0042, segments=5, mat=gold, samples=2)
    pend = K.make_cylinder("Dre_hexPendant", 0.026, 0.026, 0.007, location=(0, -0.152, 1.365), rotation=(math.pi / 2 - 0.25, 0, math.pi / 6), vertices=6, mat=gold)
    pend_in = K.make_cylinder("Dre_hexInlay", 0.017, 0.017, 0.008, location=(0, -0.153, 1.365), rotation=(math.pi / 2 - 0.25, 0, math.pi / 6), vertices=6, mat=honey)
    bail = K.make_torus("Dre_bail", 0.007, 0.0022, location=(0, -0.146, 1.394), rotation=(0, math.pi / 2, 0), major_segments=8, minor_segments=4, mat=gold)
    P.append((K.join_objects([chain, pend, pend_in, bail], "Dre_chainJ"), "Chest"))

    # --- Cropped open honey-gold zip jacket with cobalt trim ---------------
    jprof = [(1.03, 0.222, 0.168, 0.18, 0.0), (1.10, 0.226, 0.168, 0.182, 0.0), (1.22, 0.23, 0.168, 0.185, 0.0), (1.35, 0.24, 0.163, 0.18, 0.0),
             (1.44, 0.232, 0.15, 0.17, 0.0), (1.50, 0.18, 0.12, 0.135, 0.0), (1.545, 0.09, 0.083, 0.092, -0.005)]
    gap = lambda z: 0.55 - 0.12 * smooth(1.05, 1.3, z) + 0.25 * smooth(1.38, 1.53, z)
    jk, jrings = open_coat("Dre_jacket", jprof, gap, n=26, dz=0.04, mat=jacket, thickness=0.013)
    P.append((jk, ["Pelvis", "Spine", "Chest"]))
    hem_prof = [(0.975, 0.215, 0.163, 0.175, 0.0), (1.035, 0.224, 0.169, 0.181, 0.0)]
    hem, _ = open_coat("Dre_hemRib", hem_prof, lambda z: 0.55, n=26, dz=0.03, mat=cobalt, thickness=0.016)
    P.append((hem, "Pelvis"))
    zips = []
    for side in (0, -1):
        pts = [tuple(V(r[side]) + V(0, -0.003, 0)) for r in jrings]
        zips.append(tube(f"Dre_zip{side}", [(pts[0][0], pts[0][1], 0.98)] + pts, 0.0085, segments=6, mat=cobalt, samples=1))
        zips.append(tube(f"Dre_zipTeeth{side}", [(pts[0][0], pts[0][1] - 0.006, 0.98)] + [(p[0], p[1] - 0.006, p[2]) for p in pts[:-1]],
                         0.003, segments=4, mat=gold, samples=1))
    zips.append(sphere("Dre_zipPull", (0.008, 0.004, 0.016), tuple(V(jrings[0][0]) + V(0, -0.012, -0.05)), seg=8, rings=6, mat=gold))
    P.append((K.join_objects(zips, "Dre_zips"), ["Pelvis", "Spine", "Chest"]))
    collar_j = etube("Dre_jacketCollar", [tuple(V(jrings[-2][0]) + V(0.0, -0.01, 0.0)), (0.075, 0.05, 1.575), (0.0, 0.085, 1.585), (-0.075, 0.05, 1.575),
                                         tuple(V(jrings[-2][-1]) + V(0.0, -0.01, 0.0))], 0.028, 0.009, hint=(0, 0, 1), segments=8, mat=cobalt, samples=3)
    P.append((collar_j, ["Chest", "Neck"]))
    # back patch: hexagon with a bee silhouette in cobalt
    patch = K.make_cylinder("Dre_backPatch", 0.075, 0.075, 0.006, location=(0, 0.188, 1.30), rotation=(-math.pi / 2, 0, 0), vertices=6, mat=cobalt)
    P.append((patch, "Chest"))

    for side, sx in (("L", 1), ("R", -1)):
        sh, el, wr = V(J["sh" + side]), V(J["el" + side]), V(J["wr" + side])
        cuff_p = wr + (el - wr).normalized() * 0.04
        pts = [sh + V(-sx * 0.03, 0, 0.02), sh.lerp(el, 0.5), el, el.lerp(cuff_p, 0.5), cuff_p]
        sl = tube(f"Dre_sleeve{side}", [tuple(p) for p in pts], [0.075, 0.068, 0.062, 0.056, 0.052], segments=14, mat=jacket, samples=3)
        P.append((sl, ["Shoulder" + side, "Arm" + side, "Forearm" + side]))
        stripe = tube(f"Dre_sleeveStripe{side}", [tuple(p + V(sx * 0.0, 0, 0)) for p in pts[:3]], 0.071, segments=14, mat=cobalt, samples=0)
        cut(stripe, lambda c, sh=sh, el=el: abs((c - sh.lerp(el, 0.55)).dot((el - sh).normalized())) < 0.022)
        P.append((stripe, "Arm" + side))
        cuff = lathe(f"Dre_cuff{side}", [(0.0, 0.05), (0.004, 0.054), (0.036, 0.054), (0.04, 0.05)], segments=14, mat=cobalt, cap_bottom=False, cap_top=False)
        orient(cuff, (0, 0, 0), wr - el)
        deform(cuff, lambda c, o=cuff_p: (c.x + o.x, c.y + o.y, c.z + o.z))
        P.append((cuff, "Forearm" + side))
        shp = sphere(f"Dre_shoulder{side}", (0.072, 0.074, 0.06), tuple(sh + V(-sx * 0.03, 0, -0.008)), seg=12, rings=8, mat=jacket)
        P.append((shp, ["Chest", "Shoulder" + side, "Arm" + side]))
    hR = make_hand("Dre_handR", J["wrR"], V(J["hdR"]) - V(J["wrR"]), (0, 0, 1), "R", scale=1.1, curl=0.85, mat=mats["skin"])
    P.append((hR, "HandR"))
    hL = make_hand("Dre_handL", J["wrL"], V(J["hdL"]) - V(J["wrL"]), (0.1, -1, 0), "L", scale=1.1, curl=0.55, mat=mats["skin"])
    P.append((hL, "HandL"))

    # --- Carpenter jeans with honey drips; white high-tops -----------------
    waist = lathe("Dre_jeansWaist", [(0.88, 0.19, 0.15, 0.03), (0.95, 0.19, 0.145, 0.03), (1.0, 0.185, 0.14, 0.025)], segments=22, mat=denim)
    belt = K.make_torus("Dre_belt", 1.0, 0.014, location=(0, 0.025, 0.985), major_segments=24, minor_segments=4, mat=leather)
    belt.scale = (0.188, 0.145, 1.0)
    bake(belt)
    P.append((K.join_objects([waist, belt], "Dre_waistJ"), "Pelvis"))
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an = V(J["hip" + side]), V(J["kn" + side]), V(J["an" + side])
        lg = tube(f"Dre_jeans{side}", [tuple(hip + V(-sx * 0.01, 0, 0.04)), tuple(hip.lerp(kn, 0.5)), tuple(kn), tuple(kn.lerp(an, 0.5)), tuple(an + V(0, 0, 0.1))],
                  [0.10, 0.092, 0.083, 0.082, 0.078], segments=14, mat=denim, samples=3)
        P.append((lg, ["Pelvis", "Thigh" + side, "Shin" + side]))
        stack = []
        for k in range(3):  # stacked hem folds over the sneakers
            stack.append(K.make_torus(f"Dre_stack{side}{k}", 0.074 + 0.004 * (k % 2), 0.012, location=(an.x, an.y + 0.005 * k, an.z + 0.10 + 0.025 * k),
                                      rotation=(0.08 * (k - 1), 0.05 * k * sx, 0), major_segments=16, minor_segments=5, mat=denim))
        loop = etube(f"Dre_hammerLoop{side}", [tuple(hip.lerp(kn, 0.35) + V(sx * 0.098, 0.0, 0.0)), tuple(hip.lerp(kn, 0.55) + V(sx * 0.093, -0.0, 0.0))],
                     0.016, 0.004, hint=(0, 1, 0), segments=6, mat=denim, samples=0)
        P.append((K.join_objects(stack, f"Dre_stackJ{side}"), "Shin" + side))
        P.append((loop, "Thigh" + side))
        # sneakers: chunky white high-tops with cobalt accent, laces and collar
        sk = make_shoe(f"Dre_sneaker{side}", (an.x, an.y + 0.01), length=0.30, width=0.115, height=0.075, mat=sneaker, sole_mat=sole,
                       toe_lift=0.008, sole_h=0.03, seg=20, rings=12)
        collar_hi = lathe(f"Dre_hiTop{side}", [(0.05, 0.062, 0.07, 0.008), (0.11, 0.06, 0.064, 0.008), (0.16, 0.062, 0.064, 0.008)], segments=16, mat=sneaker,
                          center=(an.x, an.y, 0), cap_bottom=False)
        swoosh = etube(f"Dre_accent{side}", [(an.x + sx * 0.059, an.y + 0.06, 0.07), (an.x + sx * 0.062, an.y - 0.02, 0.06), (an.x + sx * 0.05, an.y - 0.11, 0.05)],
                       [0.004, 0.012, 0.003], 0.003, hint=(0, 0, 1), segments=6, mat=cobalt, samples=2)
        laces = []
        for k in range(4):
            y = an.y - 0.03 - k * 0.03
            z = 0.115 - k * 0.012
            laces.append(tube(f"Dre_lace{side}{k}", [(an.x - 0.03, y, z), (an.x, y - 0.006, z + 0.006), (an.x + 0.03, y, z)], 0.0035, segments=4, mat=sole, samples=1))
        P.append((K.join_objects(sk + [collar_hi, swoosh] + laces, f"Dre_sneakerJ{side}"), "Foot" + side))
    drips = {1: [], -1: []}
    rnd = random.Random(14)
    for i, (sx, z, a) in enumerate(((1, 0.84, -1.75), (-1, 0.78, -1.45), (1, 0.50, -1.25), (-1, 0.58, -1.95))):
        hipj = V(J["hip" + ("L" if sx > 0 else "R")])
        knj = V(J["kn" + ("L" if sx > 0 else "R")])
        t = (hipj.z - z) / (hipj.z - knj.z)
        cen = hipj.lerp(knj, max(0.0, min(1.0, t)))
        r = 0.096 if z > 0.55 else 0.085
        p = V(cen.x + math.cos(a) * r, cen.y + math.sin(a) * r, z)
        out = V(math.cos(a), math.sin(a), 0)
        tang = V(-math.sin(a), math.cos(a), 0)
        splat = sphere(f"Dre_dripTop{i}", (0.034, 0.007, 0.02), (0, 0, 0), seg=12, rings=6, mat=honey)
        deform(splat, lambda c: (c.x * (1 + 0.25 * math.sin(c.x * 160)), c.y, c.z * (1 + 0.3 * math.cos(c.x * 120))))
        frame_transform(splat, p, tang, out, V(0, 0, 1))
        drips[sx].append(splat)
        for k, (dx, ln, w) in enumerate(((-0.018, rnd.uniform(0.05, 0.08), 0.0065), (0.006, rnd.uniform(0.09, 0.14), 0.0075), (0.022, rnd.uniform(0.03, 0.05), 0.0055))):
            q0 = p + tang * dx + V(0, 0, -0.008)
            run = [q0, q0 + V(0, 0, -ln * 0.5) + out * 0.001, q0 + V(0, 0, -ln) + out * 0.002]
            drips[sx].append(tube(f"Dre_drip{i}{k}", [tuple(r) for r in run], [w, w * 0.75, w * 0.85], segments=6, mat=honey, samples=1))
            drips[sx].append(sphere(f"Dre_dripBead{i}{k}", w * 1.25, tuple(run[-1] + V(0, 0, -0.002)), seg=8, rings=6, mat=honey))
    P.append((K.join_objects(drips[1], "Dre_dripsL"), ["ThighL", "ShinL"]))
    P.append((K.join_objects(drips[-1], "Dre_dripsR"), ["ThighR", "ShinR"]))

    # --- Bee smoker (right hand) and honey dipper (left hand) -------------
    sm = []
    body = lathe("Dre_smokerCan", [(0.0, 0.045), (0.004, 0.05), (0.13, 0.05), (0.135, 0.046)], segments=18, mat=brass)
    sm.append(body)
    lid = lathe("Dre_smokerLid", [(0.135, 0.05), (0.15, 0.048), (0.18, 0.03), (0.20, 0.014), (0.215, 0.012)], segments=18, mat=brass, cap_bottom=False)
    sm.append(lid)
    sm.append(K.make_torus("Dre_smokerBand", 0.051, 0.004, location=(0, 0, 0.07), major_segments=18, minor_segments=4, mat=brass))
    sm.append(lathe("Dre_nozzle", [(0.205, 0.012), (0.225, 0.009)], segments=10, mat=smoke))
    guard = []
    for k in range(6):
        a = k / 6 * TAU
        guard.append(tube(f"Dre_guard{k}", [(math.cos(a) * 0.056, math.sin(a) * 0.056, 0.012), (math.cos(a) * 0.056, math.sin(a) * 0.056, 0.12)], 0.0028, segments=4, mat=brass, samples=0))
    sm += guard
    bellows = lathe("Dre_bellows", [(-0.06, 0.004, 0.030, 0.0), (-0.045, 0.012, 0.032, 0.0), (0.04, 0.012, 0.035, 0.0), (0.055, 0.004, 0.03, 0.0)], segments=8, mat=leather)
    deform(bellows, lambda c: (c.x - 0.075, c.y, c.z + 0.07))
    boards = [K.make_box(f"Dre_board{k}", (0.006, 0.07, 0.12), location=(-0.062 - 0.026 * k, 0, 0.07), bevel=0.002, mat=wood) for k in range(2)]
    sm.append(bellows)
    sm += boards
    smj = K.join_objects(sm, "Dre_smoker")
    bake(smj)
    Ms = Matrix.Translation(smoker_c + V(0.0, 0.0, -0.06)) @ Matrix.Rotation(0.25, 4, "Y") @ Matrix.Rotation(-0.2, 4, "X")
    for v in smj.data.vertices:
        v.co = Ms @ v.co
    smj.data.update()
    P.append((smj, "PropR"))
    dp = []
    dd = V(0.05, -0.9, 0.42).normalized()
    dp.append(tube("Dre_dipperHandle", [tuple(dipper_c - dd * 0.06), tuple(dipper_c + dd * 0.13)], [0.0065, 0.0055], segments=8, mat=wood, samples=0))
    head_c = dipper_c + dd * 0.165
    dh = lathe("Dre_dipperHead", [(-0.035, 0.008), (-0.03, 0.019), (-0.02, 0.012), (-0.012, 0.020), (-0.004, 0.013), (0.004, 0.020), (0.012, 0.013),
                                   (0.02, 0.019), (0.03, 0.011), (0.036, 0.004)], segments=12, mat=wood)
    orient(dh, (0, 0, 0), dd)
    deform(dh, lambda c: (c.x + head_c.x, c.y + head_c.y, c.z + head_c.z))
    dp.append(dh)
    glaze = sphere("Dre_dipperHoney", (0.021, 0.021, 0.03), tuple(head_c + V(0, 0, -0.008)), seg=12, rings=8, mat=honey)
    dp.append(glaze)
    dp.append(tube("Dre_dipperDrip", [tuple(head_c + V(0, 0, -0.03)), tuple(head_c + V(0.002, 0, -0.07)), tuple(head_c + V(0, 0, -0.10))], [0.006, 0.0035, 0.005], segments=6, mat=honey, samples=1))
    dp.append(sphere("Dre_dipperBead", 0.0065, tuple(head_c + V(0, 0, -0.103)), seg=8, rings=6, mat=honey))
    P.append((K.join_objects(dp, "Dre_dipper"), "PropL"))

    # --- one of "my girls" resting on his shoulder ------------------------
    bc = V(0.17, -0.05, 1.53)
    bee = [sphere("Dre_beeBody", (0.012, 0.02, 0.012), tuple(bc), seg=10, rings=8, mat=bee_y),
           sphere("Dre_beeHead", 0.008, tuple(bc + V(0, -0.022, 0.002)), seg=8, rings=6, mat=bee_k)]
    for k in range(2):
        bee.append(K.make_torus(f"Dre_beeStripe{k}", 0.0115, 0.0025, location=tuple(bc + V(0, 0.002 + 0.009 * k, 0)), rotation=(math.pi / 2, 0, 0),
                                major_segments=10, minor_segments=4, mat=bee_k))
    for sx in (-1, 1):
        bee.append(sphere(f"Dre_beeWing{sx}", (0.012, 0.007, 0.0015), tuple(bc + V(sx * 0.013, 0.004, 0.012)), seg=8, rings=4, mat=wing, rot=(0.3, sx * 0.4, sx * 0.3)))
    P.append((K.join_objects(bee, "Dre_bee"), "ShoulderL"))

    arm = build_rig("dre", H, J, extras)
    mesh = bind(arm, P, "Dre_Body")
    return arm, mesh


# ---------------------------------------------------------------------------
# 15. Lulu Static, Tea-Stall Keeper and Ex-Pirate DJ (1.55 m)
# ---------------------------------------------------------------------------

@builder("lulu", 1.55, "#0b1a2e")
def build_lulu():
    H = 1.55
    s = 1.0
    HC = V(0, -0.045, 1.392)
    mats = skin_set("Lulu", "#e9bb9b", lip="#c9776d", brow="#9aa3ae", iris="#2b1d16", sclera="#f3ede4", rough=0.5)
    hair = mat("Lulu_Hair", "#c9d2de", roughness=0.42, coat_weight=0.25, **texset("_shared_wood", "normal"), uv_scale=3.0, normal_strength=0.45)
    cardigan = mat("Lulu_Cardigan", "#d4a72c", roughness=0.92, **texset("ermelin", "normal"), uv_scale=5.0, normal_strength=1.2)
    tee = mat("Lulu_BandTee", "#e64b3c", roughness=0.8)
    print_m = mat("Lulu_TeePrint", "#f6ecd6", roughness=0.7)
    skirt_m = mat("Lulu_Skirt", "#24304f", roughness=0.75)
    tights = mat("Lulu_Tights", "#3a2a33", roughness=0.8)
    poncho = mat("Lulu_Poncho", "#3cc6b4", roughness=0.08, coat_weight=1.0, coat_roughness=0.05, alpha=0.42, double_sided=True)
    drop_m = mat("Lulu_RainBead", "#dffaf6", roughness=0.02, coat_weight=1.0, alpha=0.6)
    boot = mat("Lulu_Boots", "#f5c518", roughness=0.18, coat_weight=0.8, coat_roughness=0.1)
    boot_sole = mat("Lulu_BootSole", "#3b3326", roughness=0.7)
    towel = mat("Lulu_TeaTowel", "#f4f1ea", roughness=0.85)
    towel_red = mat("Lulu_TeaTowelStripe", "#c2413a", roughness=0.85)
    phones = mat("Lulu_Headphones", "#2d3340", roughness=0.35, metallic=0.4)
    foam = mat("Lulu_Foam", "#e8742a", roughness=0.95)
    walkman = mat("Lulu_Walkman", "#9fb4c8", roughness=0.3, metallic=0.6)
    cass = mat("Lulu_Cassette", "#1b2233", roughness=0.25, coat_weight=0.6)
    cass_glow = mat("Lulu_TapeWindow", "#5eead4", roughness=0.1, **texset("lulu", "emissive"), uv_scale=1.0, emission_strength=3.0)
    label = mat("Lulu_Label", "#f6ecd6", roughness=0.7)
    clay = mat("Lulu_Clay", "#8a4632", roughness=0.55, coat_weight=0.35, **texset("_shared_stone", "normal"), uv_scale=2.0, normal_strength=0.3)
    wood = mat("Lulu_Button", "#6b4a2e", roughness=0.5)
    line = mat("Lulu_Line", "#c99079", roughness=0.6)
    blush = mat("Lulu_Blush", "#e7978a", roughness=0.55)

    P = []
    J = {
        "pelvis": (0, 0.02, 0.80), "spine": (0, 0.035, 0.95), "chest": (0, 0.03, 1.10), "neck": (0, -0.01, 1.24),
        "clavL": (0.04, 0.0, 1.205), "shL": (0.158, 0.02, 1.185), "elL": (0.205, 0.04, 0.97), "wrL": (0.15, -0.13, 1.03), "hdL": (0.12, -0.20, 1.075),
        "clavR": (-0.04, 0.0, 1.205), "shR": (-0.158, 0.02, 1.185), "elR": (-0.20, 0.03, 0.96), "wrR": (-0.165, -0.15, 0.885), "hdR": (-0.15, -0.23, 0.885),
        "hipL": (0.08, 0.02, 0.80), "knL": (0.09, -0.01, 0.44), "anL": (0.095, 0.02, 0.08), "toeL": (0.10, -0.13, 0.025),
        "hipR": (-0.08, 0.02, 0.80), "knR": (-0.09, -0.01, 0.44), "anR": (-0.095, 0.02, 0.08), "toeR": (-0.10, -0.13, 0.025),
    }
    human_neck_rig(J, HC, s)
    cass_c = V(0.105, -0.245, 1.10)
    pot_c = V(-0.088, -0.267, 0.885)
    extras = {
        "Cloak": ("Chest", (0, 0.10, 1.22), (0, 0.22, 0.70)),
        "PropL": ("HandL", tuple(cass_c), tuple(cass_c + V(0, 0, 0.08))),
        "PropR": ("HandR", tuple(pot_c), tuple(pot_c + V(0, 0, 0.1))),
    }

    # --- Face: round cheeks, smiling closed-ish eyes, wry half-smile ------
    face = human_face("Lulu", HC, s, mats, jaw_taper=0.82, cheek=1.6, ear=1.0, lid_open=0.36, lid_tilt=-0.12, blush=blush, P=P,
                      nose=((-0.026, 0.002), (0.017, 0.013, 0.014)), lip_scale=(0.82, 0.55, 0.62))
    m = face["mouth"]
    lines = []
    for sx in (-1, 1):
        ec = face["eyes"]["L" if sx > 0 else "R"]
        for k in range(2):
            a = -0.25 + k * 0.5
            p0 = ec + V(sx * 0.024, 0.008, 0)
            lines.append(tube(f"Lulu_crow{sx}{k}", [tuple(p0 + V(0, 0, a * 0.006)), tuple(p0 + V(sx * 0.010, 0.005, a * 0.012))], [0.0011, 0.0005], segments=4, mat=line, samples=0))
        lines.append(tube(f"Lulu_fold{sx}", [(HC.x + sx * 0.028, HC.y - 0.113, HC.z - 0.026), (HC.x + sx * 0.038, HC.y - 0.106, HC.z - 0.052)], 0.0018, segments=4, mat=line, samples=0))
    # wry half-smile: one corner lifted
    pts = []
    for i in range(7):
        t = (i / 6) * 2 - 1
        lift = (0.012 if t > 0 else 0.004) * t * t
        pts.append((m.x + t * 0.027, m.y - 0.004 + abs(t) ** 2 * 0.011, m.z + 0.012 + lift))
    lines.append(tube("Lulu_smile", pts, [0.0012, 0.002, 0.0022, 0.0022, 0.0022, 0.002, 0.0012], segments=5, mat=line, samples=1))
    P.append((K.join_objects(lines, "Lulu_faceLines"), "Head"))

    # --- Silver bob with a soft, feathered fringe ---------------------------
    bob_prof = [(-0.08, 0.128, 0.122, 0.138, 0.0), (-0.06, 0.140, 0.132, 0.150, 0.0), (-0.02, 0.146, 0.136, 0.154, 0.0), (0.03, 0.144, 0.134, 0.150, 0.0),
                (0.075, 0.132, 0.128, 0.138, 0.0), (0.108, 0.110, 0.11, 0.117, 0.0), (0.132, 0.074, 0.074, 0.08, 0.0), (0.150, 0.0, 0.0, 0.0, 0.0)]
    strands = lambda a, z: 1.0 + 0.014 * math.sin(a * 38) + 0.008 * math.sin(a * 17 + 1.3) + 0.02 * smooth(HC.z + 0.0, HC.z - 0.07, z) * (0.5 + 0.5 * math.sin(a * 5))
    rings = profile_rings([(p[0] + HC.z,) + p[1:] for p in bob_prof], dz=0.015, n=32, sq=2.1, rfn=strands)
    rings = [[(x, y + HC.y + 0.008, z) for (x, y, z) in r] for r in rings]
    bob = loft("Lulu_bob", rings, mat=hair, cap_start=False, cap_end=False, u_scale=1.0, v_scale=3.0)
    fringe_cut = HC.z + 0.09   # the fringe sheet covers the bob's front from here down
    front_open = 0.95          # half-angle of the face opening (radians either side of -Y)

    def front_off(c):
        return abs(math.atan2(c.y - HC.y - 0.008, c.x - HC.x) + math.pi / 2)

    cut(bob, lambda c: not (front_off(c) < front_open and c.z < fringe_cut))
    solidify(bob, 0.014, -1.0)
    recalc(bob)

    def hug(c):
        # blunt-cut tuck at the ends, and side curtains drawn in to frame the cheeks (no gap at the temples)
        k = 1 - 0.06 * smooth(HC.z - 0.04, HC.z - 0.08, c.z)
        k *= 1 - 0.16 * smooth(1.6, front_open, front_off(c)) * smooth(HC.z + 0.10, HC.z + 0.05, c.z)
        return (HC.x + (c.x - HC.x) * k, HC.y + 0.008 + (c.y - HC.y - 0.008) * k, c.z)

    deform(bob, hug)
    P.append((bob, "Head"))

    # silver under-layer over the scalp and temples: anything seen past the fringe or curtains is hair, not shadow
    under = sphere("Lulu_hairUnder", (0.109 * s, 0.1215 * s, 0.132 * s), tuple(HC), seg=22, rings=12, mat=hair)
    cut(under, lambda c: (c.z - HC.z > 0.055) or (front_off(c) > 0.9 and c.z - HC.z > -0.075 and front_off(c) < 2.1))
    P.append((under, "Head"))

    # fringe: one smooth sheet flowing out of the crown and lying on the forehead, tips softly feathered
    from mathutils.bvhtree import BVHTree
    hd = [face["head"]["head"], face["head"]["brows"]]
    hv, hp = [], []
    for o in hd:
        bake(o)
        b0 = len(hv)
        hv += [v.co.copy() for v in o.data.vertices]
        hp += [[b0 + i for i in p.vertices] for p in o.data.polygons]
    head_tree = BVHTree.FromPolygons(hv, hp)
    pz = [(p[0] + HC.z,) + p[1:] for p in bob_prof]

    def bob_pt(a, z, extra):
        k = 0
        while k < len(pz) - 2 and z > pz[k + 1][0]:
            k += 1
        t = (z - pz[k][0]) / (pz[k + 1][0] - pz[k][0])
        t = t * t * (3 - 2 * t) * 0.5 + t * 0.5
        rx, ryf = lerp(pz[k][1], pz[k + 1][1], t), lerp(pz[k][2], pz[k + 1][2], t)
        c, sn = math.cos(a), math.sin(a)
        e = 2.0 / 2.1
        kk = strands(a, z)
        return V(HC.x + (rx * kk + extra) * math.copysign(abs(c) ** e, c), HC.y + 0.008 + (ryf * kk + extra) * math.copysign(abs(sn) ** e, sn), z)

    def head_pt(a, z, extra):
        d = V(math.cos(a), math.sin(a), 0)
        o = V(HC.x, HC.y, z) + d * 0.4
        hit = head_tree.ray_cast(o, -d)
        p = hit[0] if hit[0] is not None else V(HC.x, HC.y, z) + d * 0.11
        return p + d * extra

    cols = 17
    frows = []
    fringe_pts = []
    for i, t in enumerate((None, None, 0.0, 0.28, 0.55, 0.8, 1.0)):
        row = []
        for j in range(cols):
            u = j / (cols - 1) * 2 - 1
            a = -math.pi / 2 + u * (front_open + 0.08)
            if i == 0:
                row.append(tuple(bob_pt(a, HC.z + 0.128, -0.008)))   # starts inside the crown: no seam lip
                continue
            if i == 1:
                row.append(tuple(bob_pt(a, HC.z + 0.108, 0.0025)))
                continue
            z_bot = HC.z + 0.049 - 0.007 * u * u - (0.0045 if j % 2 else 0.0) * (1 - 0.5 * abs(u))
            z = lerp(HC.z + 0.095, z_bot, t)
            w = smooth(0.0, 1.0, t) ** 0.75
            p = bob_pt(a, z, 0.0025).lerp(head_pt(a, z, 0.0055 + 0.0015 * (j % 2)), w)
            # soft strand clumping across the fringe
            p += V(math.cos(a), math.sin(a), 0) * (0.0012 * (1 if j % 2 else -1) * t)
            row.append(tuple(p))
            if i == 4 and j % 3 == 1:
                fringe_pts.append((p, V(math.cos(a), math.sin(a), 0)))
        frows.append(row)
    fringe = loft("Lulu_fringe", frows, closed=False, mat=hair, u_scale=1.0, v_scale=3.0)
    solidify(fringe, 0.005, 1.0)
    recalc(fringe)
    P.append((fringe, "Head"))
    beads = []
    rnd = random.Random(31)
    for i, (p, n) in enumerate(fringe_pts[:6]):  # rain beads caught in the fringe
        beads.append(sphere(f"Lulu_hairBead{i}", 0.0042, tuple(p + n * 0.006 + V(0, 0, rnd.uniform(-0.006, 0.006))), seg=6, rings=4, mat=drop_m))
    P.append((K.join_objects(beads, "Lulu_hairBeads"), "Head"))

    neck = lathe("Lulu_neck", [(1.17, 0.05), (1.24, 0.046), (1.30, 0.05)], segments=16, mat=mats["skin"], center=(0, -0.025, 0))
    P.append((neck, ["Chest", "Neck"]))

    # --- Band tee + mustard cardigan (open, chunky knit, wooden buttons) ---
    tprof = [(0.78, 0.165, 0.14, 0.14, 0.02), (0.90, 0.17, 0.145, 0.145, 0.025), (1.02, 0.175, 0.14, 0.15, 0.03), (1.12, 0.178, 0.13, 0.155, 0.03),
             (1.19, 0.16, 0.115, 0.15, 0.02), (1.235, 0.10, 0.08, 0.10, 0.0), (1.255, 0.06, 0.058, 0.06, -0.01)]
    tshirt = loft("Lulu_tee", profile_rings(tprof, dz=0.04, n=22), mat=tee, cap_start=True, cap_end=True)
    recalc(tshirt)
    P.append((tshirt, ["Pelvis", "Spine", "Chest"]))
    logo = [K.make_cylinder("Lulu_logoDisc", 0.03, 0.03, 0.004, location=(0, -0.152, 1.06), rotation=(math.pi / 2, 0, 0), vertices=16, mat=print_m)]
    logo.append(tube("Lulu_logoBolt", [(-0.012, -0.156, 1.08), (0.006, -0.157, 1.062), (-0.006, -0.157, 1.058), (0.012, -0.156, 1.04)], 0.0035, segments=4, mat=tee, samples=0))
    P.append((K.join_objects(logo, "Lulu_teeLogo"), "Spine"))
    cprof = [(0.74, 0.192, 0.165, 0.17, 0.02), (0.86, 0.192, 0.162, 0.17, 0.025), (1.0, 0.195, 0.158, 0.175, 0.03), (1.10, 0.198, 0.15, 0.18, 0.03),
             (1.17, 0.185, 0.135, 0.175, 0.02), (1.215, 0.13, 0.10, 0.13, 0.0), (1.25, 0.075, 0.07, 0.08, -0.01)]
    gapc = lambda z: 0.42 + 0.1 * smooth(1.0, 1.24, z)
    card, crings = open_coat("Lulu_cardigan", cprof, gapc, n=24, dz=0.04, mat=cardigan, thickness=0.014)
    furry(card, 0.003, 40.0, 4.0)
    P.append((card, ["Pelvis", "Spine", "Chest"]))
    bands = []
    for side in (0, -1):
        pts = [tuple(V(r[side]) + V(0, -0.004, 0)) for r in crings]
        bands.append(etube(f"Lulu_cardBand{side}", pts, 0.016, 0.008, hint=(1, 0, 0), segments=6, mat=cardigan, samples=1))
    for i, z in enumerate((0.84, 0.94, 1.04, 1.13)):
        r = min(crings, key=lambda rr: abs(rr[0][2] - z))
        p = V(r[-1]) + V(0.006, -0.01, 0)
        bands.append(K.make_cylinder(f"Lulu_btn{i}", 0.009, 0.009, 0.006, location=tuple(p), rotation=(math.pi / 2, 0, 0), vertices=10, mat=wood))
    P.append((K.join_objects(bands, "Lulu_cardBands"), ["Pelvis", "Spine", "Chest"]))
    # cardigan sleeves (chunky, slightly pushed up) + rib cuffs
    for side, sx in (("L", 1), ("R", -1)):
        sh, el, wr = V(J["sh" + side]), V(J["el" + side]), V(J["wr" + side])
        cuff_p = wr + (el - wr).normalized() * 0.03
        pts = [sh + V(-sx * 0.02, 0, 0.015), sh.lerp(el, 0.5), el, el.lerp(cuff_p, 0.5), cuff_p]
        sl = tube(f"Lulu_sleeve{side}", [tuple(p) for p in pts], [0.06, 0.056, 0.052, 0.05, 0.047], segments=12, mat=cardigan, samples=3)
        furry(sl, 0.003, 40.0, sx)
        P.append((sl, ["Shoulder" + side, "Arm" + side, "Forearm" + side]))
        cuff = lathe(f"Lulu_cuff{side}", [(0.0, 0.044), (0.004, 0.048), (0.04, 0.046), (0.044, 0.042)], segments=12, mat=cardigan, cap_bottom=False, cap_top=False,
                     rfn=lambda a, z: 1.0 + 0.05 * abs(math.sin(a * 8)))
        orient(cuff, (0, 0, 0), wr - el)
        deform(cuff, lambda c, o=cuff_p: (c.x + o.x, c.y + o.y, c.z + o.z))
        P.append((cuff, "Forearm" + side))
        shp = sphere(f"Lulu_shoulder{side}", (0.065, 0.066, 0.058), tuple(sh + V(-sx * 0.02, 0.0, -0.005)), seg=12, rings=8, mat=cardigan)
        P.append((shp, ["Chest", "Shoulder" + side, "Arm" + side]))
    hL = make_hand("Lulu_handL", J["wrL"], V(J["hdL"]) - V(J["wrL"]), (0.2, 0, 1), "L", scale=0.88, curl=0.5, mat=mats["skin"])
    P.append((hL, "HandL"))
    hR = make_hand("Lulu_handR", J["wrR"], V(J["hdR"]) - V(J["wrR"]), (0, 0, 1), "R", scale=0.88, curl=0.85, mat=mats["skin"])
    P.append((hR, "HandR"))

    # --- Long pleated skirt, tights, yellow rain boots --------------------
    sprof = [(0.36, 0.25, 0.23, 0.25, 0.03), (0.50, 0.235, 0.215, 0.235, 0.03), (0.65, 0.21, 0.19, 0.21, 0.025), (0.76, 0.185, 0.16, 0.17, 0.02), (0.82, 0.172, 0.148, 0.155, 0.02)]
    pleat = lambda a, z: 1.0 + 0.085 * (1.0 - abs(math.sin(a * 9))) ** 1.5 * smooth(0.80, 0.52, z)
    skirt = loft("Lulu_skirt", profile_rings(sprof, dz=0.045, n=36, rfn=pleat), mat=skirt_m, cap_start=False, cap_end=True)
    solidify(skirt, 0.008, -1.0)
    recalc(skirt)
    P.append((skirt, ["Pelvis", "ThighL", "ThighR"]))
    waistband = K.make_torus("Lulu_waistband", 1.0, 0.012, location=(0, 0.02, 0.815), major_segments=24, minor_segments=4, mat=skirt_m)
    waistband.scale = (0.175, 0.152, 1.0)
    bake(waistband)
    P.append((waistband, "Pelvis"))
    for side, sx in (("L", 1), ("R", -1)):
        hip, kn, an = V(J["hip" + side]), V(J["kn" + side]), V(J["an" + side])
        lg = tube(f"Lulu_leg{side}", [tuple(kn + V(0, 0, 0.06)), tuple(kn.lerp(an, 0.5)), tuple(an + V(0, 0, 0.02))], [0.046, 0.042, 0.036], segments=10, mat=tights, samples=2)
        P.append((lg, ["Thigh" + side, "Shin" + side, "Foot" + side]))
        shaft = lathe(f"Lulu_bootShaft{side}", [(0.05, 0.058, 0.064, 0.012), (0.14, 0.056, 0.058, 0.008), (0.25, 0.062, 0.062, 0.004), (0.31, 0.068, 0.068, 0.0),
                                                 (0.315, 0.062, 0.062, 0.0)], segments=12, mat=boot, center=(an.x, an.y, 0), cap_bottom=False, cap_top=False)
        rim = K.make_torus(f"Lulu_bootRim{side}", 0.066, 0.006, location=(an.x, an.y, 0.31), major_segments=16, minor_segments=4, mat=boot)
        tab = etube(f"Lulu_bootTab{side}", [(an.x, an.y + 0.065, 0.29), (an.x, an.y + 0.072, 0.335), (an.x, an.y + 0.064, 0.345)], 0.012, 0.003, hint=(1, 0, 0),
                    segments=6, mat=boot, samples=1)
        foot = make_shoe(f"Lulu_boot{side}", (an.x, an.y + 0.01), length=0.235, width=0.098, height=0.07, mat=boot, sole_mat=boot_sole, toe_lift=0.012,
                         sole_h=0.022, seg=18, rings=12)
        P.append((K.join_objects([shaft, rim, tab] + foot, f"Lulu_bootJ{side}"), ["Shin" + side, "Foot" + side]))

    # --- Translucent teal rain poncho (open front, hood down) + rain beads -
    pprof = [(0.60, 0.40, 0.33, 0.37, 0.04), (0.75, 0.355, 0.29, 0.33, 0.035), (0.92, 0.30, 0.235, 0.28, 0.03), (1.06, 0.255, 0.19, 0.235, 0.03),
             (1.15, 0.22, 0.16, 0.205, 0.025), (1.21, 0.165, 0.125, 0.16, 0.01), (1.255, 0.085, 0.078, 0.092, -0.01)]
    gapp = lambda z: 0.98 - 0.70 * smooth(0.65, 1.18, z)
    wave = lambda a, z: 1.0 + 0.035 * math.sin(a * 7 + 0.5) * smooth(0.95, 0.62, z)
    pon, prings = open_coat("Lulu_poncho", pprof, gapp, n=28, dz=0.045, mat=poncho, thickness=0.006, rfn=wave)
    P.append((pon, ["Chest", "Cloak", "Spine"]))
    hem = []
    for side in (0, -1):
        hem.append(tube(f"Lulu_ponchoEdge{side}", [tuple(V(r[side]) + V(0, -0.003, 0)) for r in prings], 0.0045, segments=4, mat=poncho, samples=1))
    hem.append(tube("Lulu_ponchoHem", [tuple(V(p) + V(0, 0, -0.002)) for p in prings[0]], 0.006, segments=4, mat=poncho, samples=0))
    P.append((K.join_objects(hem, "Lulu_ponchoTrim"), ["Chest", "Cloak", "Spine"]))
    hood = sphere("Lulu_hood", (0.13, 0.075, 0.07), (0, 0.135, 1.245), seg=16, rings=10, mat=poncho, rot=(0.35, 0, 0))
    deform(hood, lambda c: (c.x, c.y, c.z + 0.02 * math.sin(c.x * 40)))
    P.append((hood, "Chest"))
    beads = []
    rnd = random.Random(8)
    for i in range(15):
        r = prings[rnd.randrange(1, len(prings) - 1)]
        j = rnd.randrange(1, len(r) - 1)
        p = V(r[j])
        out = (V(p.x, p.y - 0.03, 0)).normalized()
        beads.append(sphere(f"Lulu_drop{i}", rnd.uniform(0.0045, 0.008), tuple(p + out * 0.003), seg=6, rings=4, mat=drop_m))
    P.append((K.join_objects(beads, "Lulu_ponchoBeads"), ["Chest", "Cloak", "Spine"]))

    # --- Headphones round the neck, Walkman on the belt, tea-towel --------
    hp = []
    for sx in (-1, 1):
        c = V(sx * 0.098, -0.055, 1.205)
        cup = K.make_cylinder(f"Lulu_cup{sx}", 0.042, 0.04, 0.03, location=(0, 0, 0), vertices=14, mat=phones)
        pad = K.make_torus(f"Lulu_pad{sx}", 0.032, 0.013, location=(0, 0, -0.018), major_segments=12, minor_segments=5, mat=foam)
        cj = K.join_objects([cup, pad], f"Lulu_cupJ{sx}")
        orient(cj, (0, 0, 0), V(-sx * 0.6, -0.55, 0.6))
        deform(cj, lambda q, c=c: (q.x + c.x, q.y + c.y, q.z + c.z))
        hp.append(cj)
    band_pts = [(0.115, -0.03, 1.215), (0.10, 0.04, 1.225), (0.0, 0.085, 1.235), (-0.10, 0.04, 1.225), (-0.115, -0.03, 1.215)]
    hp.append(etube("Lulu_hpBand", band_pts, 0.012, 0.006, hint=(0, 0, 1), segments=6, mat=phones, samples=3))
    hp.append(tube("Lulu_hpWire", [(0.11, -0.07, 1.18), (0.16, -0.12, 1.05), (0.17, -0.15, 0.90), (0.16, -0.155, 0.84)], 0.0022, segments=4, mat=phones, samples=3))
    P.append((K.join_objects(hp, "Lulu_headphones"), "Chest"))
    wk = [K.make_box("Lulu_walkman", (0.032, 0.085, 0.11), location=(0.0, 0.0, 0.0), bevel=0.006, mat=walkman)]
    wk.append(K.make_box("Lulu_walkWin", (0.004, 0.06, 0.04), location=(0.016, 0.0, 0.01), bevel=0.002, mat=cass_glow))
    for k in range(3):
        wk.append(K.make_box(f"Lulu_walkBtn{k}", (0.012, 0.014, 0.008), location=(0.0, -0.025 + 0.022 * k, 0.059), bevel=0.002, mat=phones))
    wkj = K.join_objects(wk, "Lulu_walkmanJ")
    bake(wkj)
    Mw = Matrix.Translation(V(0.185, -0.085, 0.80)) @ Matrix.Rotation(-0.45, 4, "Z")
    for v in wkj.data.vertices:
        v.co = Mw @ v.co
    wkj.data.update()
    P.append((wkj, "Pelvis"))
    tw_pts = [(-0.10, -0.135, 1.04), (-0.11, -0.125, 1.13), (-0.12, -0.08, 1.20), (-0.13, 0.0, 1.235), (-0.135, 0.08, 1.21), (-0.13, 0.13, 1.12), (-0.125, 0.145, 1.02)]
    tw = etube("Lulu_teaTowel", tw_pts, 0.055, 0.006, hint=(1, 0, 0), segments=8, mat=towel, samples=3)
    stripe_materials(tw, [towel, towel_red], lambda c: c.x + 0.5, 0.05, 0.75)
    P.append((tw, ["Chest", "ShoulderR"]))

    # --- Cassette "SIDE B" (left hand) and clay teapot (right hand) --------
    cs = [K.make_box("Lulu_tapeShell", (0.10, 0.012, 0.064), location=(0, 0, 0), bevel=0.003, mat=cass)]
    cs.append(K.make_box("Lulu_tapeLabel", (0.086, 0.003, 0.026), location=(0, -0.0065, 0.014), bevel=0.0, mat=label))
    cs.append(K.make_box("Lulu_tapeStripe", (0.086, 0.0032, 0.004), location=(0, -0.0068, 0.004), bevel=0.0, mat=tee))
    cs.append(K.make_box("Lulu_tapeWin", (0.05, 0.003, 0.016), location=(0, -0.0068, -0.012), bevel=0.0, mat=cass_glow))
    for sx in (-1, 1):
        cs.append(K.make_cylinder(f"Lulu_spool{sx}", 0.009, 0.009, 0.004, location=(sx * 0.02, -0.0082, -0.012), rotation=(math.pi / 2, 0, 0), vertices=10, mat=label))
    csj = K.join_objects(cs, "Lulu_cassette")
    bake(csj)
    Mc = Matrix.Translation(cass_c) @ Matrix.Rotation(0.2, 4, "Z") @ Matrix.Rotation(-0.15, 4, "Y")
    for v in csj.data.vertices:
        v.co = Mc @ v.co
    csj.data.update()
    P.append((csj, "PropL"))
    pot = []
    body = lathe("Lulu_potBody", [(-0.055, 0.0), (-0.055, 0.035), (-0.045, 0.058), (-0.015, 0.068), (0.015, 0.064), (0.035, 0.05), (0.045, 0.034), (0.048, 0.028)],
                 segments=20, mat=clay)
    pot.append(body)
    pot.append(lathe("Lulu_potLid", [(0.046, 0.032), (0.055, 0.03), (0.062, 0.018), (0.066, 0.01)], segments=16, mat=clay, cap_bottom=False))
    pot.append(sphere("Lulu_potKnob", (0.011, 0.011, 0.009), (0, 0, 0.074), seg=10, rings=6, mat=clay))
    pot.append(tube("Lulu_potSpout", [(0.0, -0.05, -0.01), (0.0, -0.085, 0.01), (0.0, -0.105, 0.04), (0.0, -0.112, 0.052)], [0.016, 0.011, 0.008, 0.007], segments=10, mat=clay, samples=2))
    pot.append(tube("Lulu_potHandle", [(0.0, 0.052, 0.025), (0.0, 0.092, 0.03), (0.0, 0.098, -0.005), (0.0, 0.085, -0.03), (0.0, 0.055, -0.035)], 0.008, segments=8, mat=clay, samples=2))
    potj = K.join_objects(pot, "Lulu_teapot")
    bake(potj)
    Mp = Matrix.Translation(pot_c) @ Matrix.Rotation(1.2, 4, "Z")
    for v in potj.data.vertices:
        v.co = Mp @ v.co
    potj.data.update()
    P.append((potj, "PropR"))

    arm = build_rig("lulu", H, J, extras)
    mesh = bind(arm, P, "Lulu_Body")
    return arm, mesh


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

ORDER = ["ermelin", "myrrow", "halcyon", "dre", "lulu"]


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ids = [a for a in argv if a in BUILDERS] or ORDER
    no_render = "--no-render" in argv
    metrics_path = os.path.join(HERE, "renders", "batch_c_metrics.json")
    all_metrics = {}
    if os.path.isfile(metrics_path):
        try:
            with open(metrics_path, "r", encoding="utf-8") as fh:
                all_metrics = json.load(fh)
        except Exception:
            all_metrics = {}
    for npc_id in ids:
        fn, height, bg = BUILDERS[npc_id]
        K.reset_scene()
        arm, mesh = fn()
        m = K.finalize_and_export(npc_id, arm, mesh, repo_root=REPO, bg_hex=bg, render_sheet=not no_render)
        m["targetHeight"] = height
        m["heightError"] = round(m["height"] - height, 3)
        m["glbMiB"] = round(m["glbBytes"] / (1024 * 1024), 3)
        m["materials"] = len(mesh.data.materials)
        all_metrics[npc_id] = m
        print(f"BATCH_C {npc_id}: tris={m['tris']} bones={m['bones']} height={m['height']} (target {height}) "
              f"glb={m['glbMiB']} MiB materials={m['materials']}")
    K.ensure_dir(os.path.dirname(metrics_path))
    with open(metrics_path, "w", encoding="utf-8") as fh:
        json.dump(all_metrics, fh, indent=2)


if __name__ == "__main__":
    main()
