"""
Shared Blender 4.5+ AA Character Modeling, Rigging, PBR Material & Turnaround Kit
for Portalverse NPCs.

Conventions (critical for Three.js WebGPU + @ericrius1/cast):
- Blender space: character stands on Z = 0 (feet soles at Z = 0), facing -Y (front)
  so glTF export (`export_yup=True`) outputs Y = 0 feet, facing +Z forward!
- Standardized Armature bones driven at runtime by `NpcRig` + `@ericrius1/cast`:
    Root -> Pelvis -> Spine -> Chest -> Neck -> Head -> (Jaw, EyeL, EyeR)
    Chest -> ShoulderL -> ArmL -> ForearmL -> HandL
    Chest -> ShoulderR -> ArmR -> ForearmR -> HandR
    Pelvis -> ThighL -> ShinL -> FootL
    Pelvis -> ThighR -> ShinR -> FootR
  Optional extra bones automatically animated if present:
    Cloak, Tail1, Tail2, WingL, WingR, Hat, EarL, EarR, PropR, PropL,
    Tentacle1..Tentacle4, Halo, Lantern
- Exports strictly UNCOMPRESSED GLB (`export_draco_mesh_compression_enable=False`)
  with embedded PBR textures (<= 1024px) and vertex AO.
"""

from __future__ import annotations

import json
import math
import os
import sys
from typing import Any, Iterable, Sequence

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


# ---------------------------------------------------------------------------
# Scene Reset & Collection Setup
# ---------------------------------------------------------------------------

def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


# ---------------------------------------------------------------------------
# Material & PBR Texture Helpers (Principled BSDF -> glTF 2.0 WebGPU)
# ---------------------------------------------------------------------------

def _srgb_to_linear_channel(c: float) -> float:
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = "".join(ch * 2 for ch in h)
    r = _srgb_to_linear_channel(int(h[0:2], 16) / 255.0)
    g = _srgb_to_linear_channel(int(h[2:4], 16) / 255.0)
    b = _srgb_to_linear_channel(int(h[4:6], 16) / 255.0)
    return (r, g, b, alpha)


def load_image_cached(path: str, colorspace: str = "sRGB") -> bpy.types.Image | None:
    if not path or not os.path.isfile(path):
        return None
    abs_path = os.path.abspath(path)
    for img in bpy.data.images:
        if os.path.abspath(bpy.path.abspath(img.filepath)) == abs_path:
            return img
    img = bpy.data.images.load(abs_path)
    try:
        img.colorspace_settings.name = colorspace
    except Exception:
        pass
    try:
        img.pack()
    except Exception:
        pass
    return img


def make_pbr_material(
    name: str,
    base_color: str | tuple[float, float, float, float] = "#d8d8d8",
    *,
    roughness: float = 0.55,
    metallic: float = 0.0,
    emission_color: str | tuple[float, float, float, float] | None = None,
    emission_strength: float = 0.0,
    coat_weight: float = 0.0,
    coat_roughness: float = 0.2,
    alpha: float = 1.0,
    double_sided: bool = False,
    albedo_path: str | None = None,
    normal_path: str | None = None,
    roughness_path: str | None = None,
    emissive_path: str | None = None,
    uv_scale: float = 1.0,
    normal_strength: float = 0.75,
    tint_strength: float = 0.0,
) -> bpy.types.Material:
    """Create a glTF-clean Principled BSDF material with optional packed PBR maps + vertex AO."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    mat.use_backface_culling = not double_sided
    nt = mat.node_tree
    nt.nodes.clear()

    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (650, 0)

    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (320, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    rgba = hex_rgba(base_color, alpha) if isinstance(base_color, str) else base_color
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if "Coat Weight" in bsdf.inputs:
        bsdf.inputs["Coat Weight"].default_value = coat_weight
    if "Coat Roughness" in bsdf.inputs:
        bsdf.inputs["Coat Roughness"].default_value = coat_roughness
    if alpha < 0.999:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"

    # Shared UV mapping node if any image textures are provided
    uv_node = None
    mapping = None
    if any([albedo_path, normal_path, roughness_path, emissive_path]):
        uv_node = nt.nodes.new("ShaderNodeTexCoord")
        uv_node.location = (-700, 0)
        mapping = nt.nodes.new("ShaderNodeMapping")
        mapping.location = (-500, 0)
        mapping.inputs["Scale"].default_value = (uv_scale, uv_scale, uv_scale)
        nt.links.new(uv_node.outputs["UV"], mapping.inputs["Vector"])

    # Albedo texture (optionally tinted)
    color_source = None
    albedo_img = load_image_cached(albedo_path, "sRGB") if albedo_path else None
    if albedo_img and mapping:
        tex_a = nt.nodes.new("ShaderNodeTexImage")
        tex_a.location = (-240, 260)
        tex_a.image = albedo_img
        nt.links.new(mapping.outputs["Vector"], tex_a.inputs["Vector"])
        if tint_strength > 0.001:
            mix_tint = nt.nodes.new("ShaderNodeMix")
            mix_tint.data_type = "RGBA"
            mix_tint.blend_type = "MULTIPLY"
            mix_tint.location = (40, 260)
            mix_tint.inputs["Factor"].default_value = tint_strength
            mix_tint.inputs["B"].default_value = rgba
            nt.links.new(tex_a.outputs["Color"], mix_tint.inputs["A"])
            color_source = mix_tint.outputs["Result"]
        else:
            color_source = tex_a.outputs["Color"]

    if color_source is not None:
        nt.links.new(color_source, bsdf.inputs["Base Color"])

    # Roughness texture
    rough_img = load_image_cached(roughness_path, "Non-Color") if roughness_path else None
    if rough_img and mapping:
        tex_r = nt.nodes.new("ShaderNodeTexImage")
        tex_r.location = (-240, -20)
        tex_r.image = rough_img
        nt.links.new(mapping.outputs["Vector"], tex_r.inputs["Vector"])
        nt.links.new(tex_r.outputs["Color"], bsdf.inputs["Roughness"])

    # Normal texture
    norm_img = load_image_cached(normal_path, "Non-Color") if normal_path else None
    if norm_img and mapping:
        tex_n = nt.nodes.new("ShaderNodeTexImage")
        tex_n.location = (-240, -300)
        tex_n.image = norm_img
        nt.links.new(mapping.outputs["Vector"], tex_n.inputs["Vector"])
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.location = (60, -300)
        nmap.inputs["Strength"].default_value = normal_strength
        nt.links.new(tex_n.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])

    # Emissive texture or color
    emis_img = load_image_cached(emissive_path, "sRGB") if emissive_path else None
    if emis_img and mapping:
        tex_e = nt.nodes.new("ShaderNodeTexImage")
        tex_e.location = (-240, -560)
        tex_e.image = emis_img
        nt.links.new(mapping.outputs["Vector"], tex_e.inputs["Vector"])
        nt.links.new(tex_e.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = max(emission_strength, 1.0)
    elif emission_color is not None and emission_strength > 0:
        ec = hex_rgba(emission_color, 1.0) if isinstance(emission_color, str) else emission_color
        bsdf.inputs["Emission Color"].default_value = ec
        bsdf.inputs["Emission Strength"].default_value = emission_strength

    return mat


# ---------------------------------------------------------------------------
# Organic Sculpting & Geometry Primitives (AA smooth silhouettes)
# ---------------------------------------------------------------------------

def set_smooth(obj: bpy.types.Object) -> None:
    if obj.type != "MESH" or not obj.data:
        return
    mesh = obj.data
    if hasattr(mesh, "polygons"):
        mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()


def assign_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    if obj.type != "MESH":
        return
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def add_subsurf(obj: bpy.types.Object, levels: int = 1, apply_mod: bool = True) -> bpy.types.Object:
    mod = obj.modifiers.new(name="Subsurf", type="SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    if apply_mod:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
    set_smooth(obj)
    return obj


def add_bevel(obj: bpy.types.Object, width: float = 0.012, segments: int = 2, apply_mod: bool = True) -> bpy.types.Object:
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(32)
    if apply_mod:
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)
        obj.select_set(False)
    set_smooth(obj)
    return obj


def make_lathe(
    name: str,
    profile: Sequence[tuple[float, float]] | Sequence[tuple[float, float, float, float]],
    *,
    segments: int = 24,
    mat: bpy.types.Material | None = None,
    cap_bottom: bool = True,
    cap_top: bool = True,
    center: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rot: tuple[float, float, float] = (0.0, 0.0, 0.0),
) -> bpy.types.Object:
    """
    Create a smooth organic lofted/lathed mesh from vertical cross-section rings.
    Each profile entry can be:
      - (z, r)                     -> circular ring of radius r at height z
      - (z, rx, ry, y_offset)      -> elliptical ring (rx width, ry depth, shifted in y)
    Generates clean cylindrical UVs automatically!
    """
    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    rings: list[list[bmesh.types.BMVert]] = []
    zs = [p[0] for p in profile]
    z_min, z_max = min(zs), max(zs)
    z_span = max(1e-5, z_max - z_min)

    for entry in profile:
        if len(entry) == 2:
            z, rx = entry
            ry, y_off = rx, 0.0
        else:
            z, rx, ry, y_off = entry
        ring = []
        for i in range(segments):
            a = (i / segments) * math.tau
            x = math.cos(a) * rx
            y = math.sin(a) * ry + y_off
            ring.append(bm.verts.new((x, y, z)))
        rings.append(ring)

    bm.verts.ensure_lookup_table()
    for ri in range(len(rings) - 1):
        r0 = rings[ri]
        r1 = rings[ri + 1]
        v0 = (zs[ri] - z_min) / z_span
        v1 = (zs[ri + 1] - z_min) / z_span
        for i in range(segments):
            ni = (i + 1) % segments
            u0 = i / segments
            u1 = (i + 1) / segments
            try:
                f = bm.faces.new((r0[i], r0[ni], r1[ni], r1[i]))
                f.smooth = True
                f.loops[0][uv_layer].uv = (u0, v0)
                f.loops[1][uv_layer].uv = (u1, v0)
                f.loops[2][uv_layer].uv = (u1, v1)
                f.loops[3][uv_layer].uv = (u0, v1)
            except ValueError:
                pass

    if cap_bottom and len(rings) > 0:
        b0 = rings[0]
        bc = bm.verts.new((0.0, profile[0][3] if len(profile[0]) == 4 else 0.0, zs[0]))
        for i in range(segments):
            ni = (i + 1) % segments
            try:
                f = bm.faces.new((bc, b0[ni], b0[i]))
                f.smooth = True
            except ValueError:
                pass

    if cap_top and len(rings) > 0:
        t0 = rings[-1]
        tc = bm.verts.new((0.0, profile[-1][3] if len(profile[-1]) == 4 else 0.0, zs[-1]))
        for i in range(segments):
            ni = (i + 1) % segments
            try:
                f = bm.faces.new((tc, t0[i], t0[ni]))
                f.smooth = True
            except ValueError:
                pass

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.location = center
    obj.rotation_euler = rot
    if mat:
        assign_material(obj, mat)
    set_smooth(obj)
    return obj


def make_tube(
    name: str,
    points: Sequence[tuple[float, float, float]],
    radii: float | Sequence[float],
    *,
    segments: int = 16,
    mat: bpy.types.Material | None = None,
    cap_ends: bool = True,
) -> bpy.types.Object:
    """Create a smooth organic tapered tube along a 3D polyline with clean UVs (arms, legs, tendrils, staffs, scarves)."""
    pts = [Vector(p) for p in points]
    n = len(pts)
    if isinstance(radii, (int, float)):
        r_list = [float(radii)] * n
    else:
        r_list = [float(r) for r in radii]

    bm = bmesh.new()
    uv_layer = bm.loops.layers.uv.new("UVMap")

    rings: list[list[bmesh.types.BMVert]] = []
    prev_up = Vector((0.0, 0.0, 1.0))

    for idx, (pt, rad) in enumerate(zip(pts, r_list)):
        if idx == 0:
            tangent = (pts[1] - pts[0]).normalized()
        elif idx == n - 1:
            tangent = (pts[-1] - pts[-2]).normalized()
        else:
            tangent = (pts[idx + 1] - pts[idx - 1]).normalized()
        if tangent.length < 1e-6:
            tangent = Vector((0.0, 0.0, 1.0))

        # Parallel-transport frame to avoid twist artifacts
        if abs(tangent.dot(prev_up)) > 0.96:
            ref = Vector((1.0, 0.0, 0.0))
        else:
            ref = prev_up
        side = tangent.cross(ref).normalized()
        up = side.cross(tangent).normalized()
        prev_up = up

        ring = []
        for s in range(segments):
            a = (s / segments) * math.tau
            offset = (side * math.cos(a) + up * math.sin(a)) * rad
            ring.append(bm.verts.new(pt + offset))
        rings.append(ring)

    for ri in range(n - 1):
        r0, r1 = rings[ri], rings[ri + 1]
        v0 = ri / max(1, n - 1)
        v1 = (ri + 1) / max(1, n - 1)
        for s in range(segments):
            ns = (s + 1) % segments
            u0 = s / segments
            u1 = (s + 1) / segments
            try:
                f = bm.faces.new((r0[s], r0[ns], r1[ns], r1[s]))
                f.smooth = True
                f.loops[0][uv_layer].uv = (u0, v0)
                f.loops[1][uv_layer].uv = (u1, v0)
                f.loops[2][uv_layer].uv = (u1, v1)
                f.loops[3][uv_layer].uv = (u0, v1)
            except ValueError:
                pass

    if cap_ends:
        c0 = bm.verts.new(pts[0])
        c1 = bm.verts.new(pts[-1])
        for s in range(segments):
            ns = (s + 1) % segments
            try:
                bm.faces.new((c0, rings[0][ns], rings[0][s])).smooth = True
                bm.faces.new((c1, rings[-1][s], rings[-1][ns])).smooth = True
            except ValueError:
                pass

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()

    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    if mat:
        assign_material(obj, mat)
    set_smooth(obj)
    return obj


def make_sphere(
    name: str,
    radius: float | tuple[float, float, float] = 0.1,
    *,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    segments: int = 24,
    rings: int = 16,
    mat: bpy.types.Material | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(
        segments=segments, ring_count=rings, radius=1.0, location=location, rotation=rotation
    )
    obj = bpy.context.active_object
    obj.name = name
    if isinstance(radius, (int, float)):
        obj.scale = (radius, radius, radius)
    else:
        obj.scale = radius
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        assign_material(obj, mat)
    set_smooth(obj)
    return obj


def make_box(
    name: str,
    size: tuple[float, float, float] = (0.2, 0.2, 0.2),
    *,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    bevel: float = 0.012,
    mat: bpy.types.Material | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        add_bevel(obj, width=bevel, segments=2, apply_mod=True)
    ensure_box_uv(obj)
    if mat:
        assign_material(obj, mat)
    set_smooth(obj)
    return obj


def make_cylinder(
    name: str,
    radius1: float,
    radius2: float,
    depth: float,
    *,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    vertices: int = 24,
    mat: bpy.types.Material | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=depth,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    obj.name = name
    if mat:
        assign_material(obj, mat)
    set_smooth(obj)
    return obj


def make_torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    *,
    location: tuple[float, float, float] = (0.0, 0.0, 0.0),
    rotation: tuple[float, float, float] = (0.0, 0.0, 0.0),
    major_segments: int = 32,
    minor_segments: int = 14,
    mat: bpy.types.Material | None = None,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius,
        minor_radius=minor_radius,
        major_segments=major_segments,
        minor_segments=minor_segments,
        location=location,
        rotation=rotation,
    )
    obj = bpy.context.active_object
    obj.name = name
    if mat:
        assign_material(obj, mat)
    set_smooth(obj)
    return obj


def ensure_box_uv(obj: bpy.types.Object, scale: float = 2.0, *, force: bool = False) -> None:
    """Fast deterministic tri-planar/box UV projection for any mesh lacking UVs (preserves authored UVs)."""
    if obj.type != "MESH" or not obj.data:
        return
    mesh = obj.data
    if mesh.uv_layers and not force:
        return
    if not mesh.uv_layers:
        mesh.uv_layers.new(name="UVMap")
    uv_layer = mesh.uv_layers.active.data
    verts = mesh.vertices
    for poly in mesh.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            co = verts[mesh.loops[li].vertex_index].co
            if az >= ax and az >= ay:
                u, v = co.x * scale, co.y * scale
            elif ax >= ay:
                u, v = co.y * scale, co.z * scale
            else:
                u, v = co.x * scale, co.z * scale
            uv_layer[li].uv = (u + 0.5, v + 0.5)


def sculpt_stylized_head(
    name: str,
    *,
    center: tuple[float, float, float],
    scale: float = 1.0,
    skin_mat: bpy.types.Material,
    eye_white_mat: bpy.types.Material,
    iris_mat: bpy.types.Material,
    pupil_mat: bpy.types.Material,
    brow_mat: bpy.types.Material,
    lip_mat: bpy.types.Material | None = None,
    jaw_taper: float = 0.72,
    cheek_fullness: float = 1.0,
    ear_scale: float = 1.0,
) -> dict[str, bpy.types.Object]:
    """
    Sculpt a stylized AA human/humanoid head facing -Y (glTF +Z) with brow ridge,
    cheekbones, sculpted nose bridge, chin, ears, glossy eyes (sclera + iris + pupil),
    brows, and articulated lower jaw/lips so `@ericrius1/cast` lip-sync looks alive!
    Returns dict with keys: head, jaw, eye_l, eye_r, ears, brows.
    """
    cx, cy, cz = center
    s = scale

    # Sculpted cranium + tapered jaw via smooth elliptical lathe + facial deformation
    head = make_sphere(
        f"{name}_head",
        radius=(0.106 * s, 0.118 * s, 0.128 * s),
        location=(cx, cy, cz),
        segments=32,
        rings=24,
        mat=skin_mat,
    )
    bm = bmesh.new()
    bm.from_mesh(head.data)
    for v in bm.verts:
        x, y, z = v.co.x / s, v.co.y / s, v.co.z / s
        # Taper lower face into graceful chin/jawline (-Y is front!)
        if z < 0.0:
            t = min(1.0, abs(z) / 0.128)
            width_scale = 1.0 - (1.0 - jaw_taper) * (t ** 1.35)
            x *= width_scale
            if y < 0:
                # Subtle chin protrusion forward (-Y)
                chin_bump = math.exp(-((z + 0.095) / 0.032) ** 2) * math.exp(-(x / 0.036) ** 2)
                y -= 0.012 * chin_bump
        # Gentle eye socket recesses
        if y < -0.05:
            for side in (-1.0, 1.0):
                d_eye = math.hypot((x - side * 0.038) / 0.025, (z - 0.008) / 0.018)
                if d_eye < 1.3:
                    recess = math.exp(-(d_eye ** 2) * 1.4)
                    y += 0.013 * recess
                # Cheekbones below eyes
                d_cheek = math.hypot((x - side * 0.052) / 0.032, (z + 0.024) / 0.024)
                if d_cheek < 1.3:
                    y -= 0.008 * cheek_fullness * math.exp(-(d_cheek ** 2) * 1.3)
            # Brow ridge
            d_brow = math.hypot(x / 0.068, (z - 0.034) / 0.016)
            if d_brow < 1.2:
                y -= 0.007 * math.exp(-(d_brow ** 2) * 1.6)
            # Sculpted stylized nose bridge & tip
            d_nose = math.hypot(x / 0.015, (z + 0.015) / 0.028)
            if d_nose < 1.3:
                nose_tip = math.exp(-((z + 0.026) / 0.018) ** 2) * math.exp(-(x / 0.014) ** 2)
                nose_bridge = math.exp(-((z + 0.004) / 0.022) ** 2) * math.exp(-(x / 0.011) ** 2)
                y -= (0.024 * nose_tip + 0.012 * nose_bridge)
        v.co = Vector((x * s, y * s, z * s))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(head.data)
    bm.free()
    set_smooth(head)

    # Stylized lips / jaw accent (bound to Jaw bone for live lip-sync!)
    jaw = make_sphere(
        f"{name}_jaw_lip",
        radius=(0.027 * s, 0.016 * s, 0.010 * s),
        location=(cx, cy - 0.104 * s, cz - 0.058 * s),
        segments=18,
        rings=12,
        mat=lip_mat or skin_mat,
    )

    # Eyes (sclera + iris + pupil joined per side so EyeL / EyeR bones rotate cleanly)
    eye_objs: dict[str, bpy.types.Object] = {}
    for side_name, sx in (("eye_l", 1.0), ("eye_r", -1.0)):
        ex = cx + sx * 0.037 * s
        ey = cy - 0.097 * s
        ez = cz + 0.008 * s
        sclera = make_sphere(f"{name}_{side_name}_sclera", 0.0185 * s, location=(ex, ey, ez), segments=18, rings=14, mat=eye_white_mat)
        iris = make_sphere(
            f"{name}_{side_name}_iris",
            (0.012 * s, 0.007 * s, 0.012 * s),
            location=(ex, ey - 0.0145 * s, ez),
            segments=16,
            rings=12,
            mat=iris_mat,
        )
        pupil = make_sphere(
            f"{name}_{side_name}_pupil",
            (0.0068 * s, 0.0045 * s, 0.0068 * s),
            location=(ex, ey - 0.0185 * s, ez),
            segments=14,
            rings=10,
            mat=pupil_mat,
        )
        eye_objs[side_name] = join_objects([sclera, iris, pupil], f"{name}_{side_name}")

    # Brows
    brow_parts = []
    for sx in (-1.0, 1.0):
        brow = make_tube(
            f"{name}_brow_{'l' if sx > 0 else 'r'}",
            [
                (cx + sx * 0.018 * s, cy - 0.107 * s, cz + 0.032 * s),
                (cx + sx * 0.039 * s, cy - 0.105 * s, cz + 0.038 * s),
                (cx + sx * 0.058 * s, cy - 0.094 * s, cz + 0.031 * s),
            ],
            [0.0055 * s, 0.0068 * s, 0.004 * s],
            segments=10,
            mat=brow_mat,
        )
        brow_parts.append(brow)
    brows = join_objects(brow_parts, f"{name}_brows")

    # Ears
    ear_parts = []
    if ear_scale > 0.05:
        for sx in (-1.0, 1.0):
            ear = make_sphere(
                f"{name}_ear_{'l' if sx > 0 else 'r'}",
                (0.014 * s * ear_scale, 0.022 * s * ear_scale, 0.030 * s * ear_scale),
                location=(cx + sx * 0.103 * s, cy - 0.004 * s, cz - 0.004 * s),
                rotation=(0.0, sx * 0.18, sx * -0.22),
                segments=14,
                rings=10,
                mat=skin_mat,
            )
            ear_parts.append(ear)
    ears = join_objects(ear_parts, f"{name}_ears") if ear_parts else None

    result: dict[str, bpy.types.Object] = {
        "head": head,
        "jaw": jaw,
        "eye_l": eye_objs["eye_l"],
        "eye_r": eye_objs["eye_r"],
        "brows": brows,
    }
    if ears:
        result["ears"] = ears
    return result


# ---------------------------------------------------------------------------
# Joining, Rigging & Skinning
# ---------------------------------------------------------------------------

def join_objects(objs: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    valid = [o for o in objs if o is not None and o.type == "MESH"]
    if not valid:
        raise ValueError(f"join_objects({name}): no mesh objects provided")
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in valid:
        ensure_box_uv(o)
        o.select_set(True)
    bpy.context.view_layer.objects.active = valid[0]
    if len(valid) > 1:
        bpy.ops.object.join()
    joined = bpy.context.active_object
    joined.name = name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    set_smooth(joined)
    joined.select_set(False)
    return joined


def create_humanoid_armature(
    name: str,
    *,
    height: float = 1.72,
    extra_bones: dict[str, tuple[str, tuple[float, float, float], tuple[float, float, float]]] | None = None,
) -> bpy.types.Object:
    """
    Create standardized Portalverse humanoid Armature (Z-up in Blender, facing -Y).
    Every bone matches `packages/core/src/npc/npcRig.ts`.
    `extra_bones`: { bone_name: (parent_name, head_xyz, tail_xyz) }
    """
    h = height / 1.72
    arm_data = bpy.data.armatures.new(f"{name}_Armature")
    arm_obj = bpy.data.objects.new(f"{name}_Rig", arm_data)
    bpy.context.collection.objects.link(arm_obj)
    bpy.context.view_layer.objects.active = arm_obj
    arm_obj.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    eb = arm_data.edit_bones

    def add_bone(bname: str, head: tuple[float, float, float], tail: tuple[float, float, float], parent: str | None) -> None:
        b = eb.new(bname)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent and parent in eb:
            b.parent = eb[parent]

    add_bone("Root", (0, 0, 0), (0, 0, 0.14 * h), None)
    add_bone("Pelvis", (0, 0, 0.88 * h), (0, 0, 1.02 * h), "Root")
    add_bone("Spine", (0, 0, 1.02 * h), (0, 0, 1.22 * h), "Pelvis")
    add_bone("Chest", (0, 0, 1.22 * h), (0, 0, 1.42 * h), "Spine")
    add_bone("Neck", (0, 0, 1.42 * h), (0, 0, 1.50 * h), "Chest")
    add_bone("Head", (0, 0, 1.50 * h), (0, 0, 1.72 * h), "Neck")
    add_bone("Jaw", (0, -0.02 * h, 1.52 * h), (0, -0.11 * h, 1.50 * h), "Head")
    add_bone("EyeL", (0.037 * h, -0.095 * h, 1.60 * h), (0.037 * h, -0.13 * h, 1.60 * h), "Head")
    add_bone("EyeR", (-0.037 * h, -0.095 * h, 1.60 * h), (-0.037 * h, -0.13 * h, 1.60 * h), "Head")

    for side, sx in (("L", 1.0), ("R", -1.0)):
        add_bone(f"Shoulder{side}", (sx * 0.06 * h, 0, 1.38 * h), (sx * 0.19 * h, 0, 1.38 * h), "Chest")
        add_bone(f"Arm{side}", (sx * 0.19 * h, 0, 1.38 * h), (sx * 0.28 * h, 0, 1.12 * h), f"Shoulder{side}")
        add_bone(f"Forearm{side}", (sx * 0.28 * h, 0, 1.12 * h), (sx * 0.31 * h, -0.04 * h, 0.88 * h), f"Arm{side}")
        add_bone(f"Hand{side}", (sx * 0.31 * h, -0.04 * h, 0.88 * h), (sx * 0.32 * h, -0.07 * h, 0.78 * h), f"Forearm{side}")

        add_bone(f"Thigh{side}", (sx * 0.10 * h, 0, 0.88 * h), (sx * 0.10 * h, 0, 0.48 * h), "Pelvis")
        add_bone(f"Shin{side}", (sx * 0.10 * h, 0, 0.48 * h), (sx * 0.10 * h, 0.01 * h, 0.09 * h), f"Thigh{side}")
        add_bone(f"Foot{side}", (sx * 0.10 * h, 0.01 * h, 0.09 * h), (sx * 0.10 * h, -0.14 * h, 0.02 * h), f"Shin{side}")

    if extra_bones:
        for bname, (parent, head, tail) in extra_bones.items():
            add_bone(bname, head, tail, parent)

    bpy.ops.object.mode_set(mode="OBJECT")
    arm_obj.select_set(False)
    return arm_obj


def bind_parts_to_bones(
    armature: bpy.types.Object,
    bone_part_map: dict[str, Sequence[bpy.types.Object]],
    *,
    mesh_name: str,
    smooth_weights: bool = True,
) -> bpy.types.Object:
    """
    Assign crisp deterministic vertex weights per named bone part (with optional
    soft joint falloff smoothing) and join into a single clean SkinnedMesh!
    Never fails like `AUTOMATIC_WEIGHTS` on stylized/multi-shell props & garments.
    """
    all_parts: list[bpy.types.Object] = []
    for bone_name, parts in bone_part_map.items():
        for obj in parts:
            if obj is None or obj.type != "MESH":
                continue
            ensure_box_uv(obj)
            # Clear existing groups and assign 1.0 to target bone
            obj.vertex_groups.clear()
            vg = obj.vertex_groups.new(name=bone_name)
            vg.add(list(range(len(obj.data.vertices))), 1.0, "REPLACE")
            all_parts.append(obj)

    merged = join_objects(all_parts, mesh_name)

    # Ensure every bone has a vertex group so glTF skinning indices stay clean
    for b in armature.data.bones:
        if b.name not in merged.vertex_groups:
            merged.vertex_groups.new(name=b.name)

    # Parent to armature with Armature modifier
    merged.parent = armature
    mod = merged.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = armature

    if smooth_weights:
        try:
            bpy.context.view_layer.objects.active = merged
            merged.select_set(True)
            bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
            bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.35, repeat=2)
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
            bpy.ops.object.mode_set(mode="OBJECT")
            merged.select_set(False)
        except Exception:
            pass

    return merged


def ground_armature_and_mesh(armature: bpy.types.Object, mesh_obj: bpy.types.Object) -> dict[str, Any]:
    """Shift armature + mesh so lowest vertex sits cleanly at Z = 0 and return geometry metrics."""
    bpy.context.view_layer.update()
    world_verts = [mesh_obj.matrix_world @ v.co for v in mesh_obj.data.vertices]
    min_z = min(v.z for v in world_verts)
    max_z = max(v.z for v in world_verts)
    min_x = min(v.x for v in world_verts)
    max_x = max(v.x for v in world_verts)
    min_y = min(v.y for v in world_verts)
    max_y = max(v.y for v in world_verts)

    if abs(min_z) > 1e-4:
        armature.location.z -= min_z
        bpy.context.view_layer.update()
        max_z -= min_z
        min_z = 0.0

    tri_count = sum(max(1, len(p.vertices) - 2) for p in mesh_obj.data.polygons)
    return {
        "verts": len(mesh_obj.data.vertices),
        "tris": tri_count,
        "bones": len(armature.data.bones),
        "height": round(max_z - min_z, 3),
        "width": round(max_x - min_x, 3),
        "depth": round(max_y - min_y, 3),
        "minZ": round(min_z, 4),
    }


# ---------------------------------------------------------------------------
# Uncompressed GLB Export + 4-View AA Review Sheet Renderer
# ---------------------------------------------------------------------------

def export_glb(armature: bpy.types.Object, mesh_obj: bpy.types.Object, out_path: str) -> int:
    ensure_dir(os.path.dirname(os.path.abspath(out_path)))
    for o in bpy.context.selected_objects:
        o.select_set(False)
    armature.select_set(True)
    mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = armature

    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(out_path),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_all_influences=False,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_draco_mesh_compression_enable=False,
    )
    return os.path.getsize(out_path)


def render_turnaround_sheet(
    armature: bpy.types.Object,
    mesh_obj: bpy.types.Object,
    out_sheet_path: str,
    *,
    bg_hex: str = "#162033",
    tile_w: int = 384,
    tile_h: int = 512,
) -> str:
    """
    Render a crisp 4-panel AA review turnaround sheet (Front, 3/4 Front, Side, Head Closeup)
    using Blender EEVEE Next with 3-point studio lighting + floor pedestal, stitched horizontally.
    """
    import numpy as np

    ensure_dir(os.path.dirname(os.path.abspath(out_sheet_path)))
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = tile_w
    scene.render.resolution_y = tile_h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 24

    # Studio background
    world = bpy.data.worlds.new("ReviewWorld")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs[0].default_value = hex_rgba(bg_hex, 1.0)
        bg_node.inputs[1].default_value = 0.85

    # Compute bounds
    bpy.context.view_layer.update()
    pts = [mesh_obj.matrix_world @ v.co for v in mesh_obj.data.vertices]
    min_z = min(p.z for p in pts)
    max_z = max(p.z for p in pts)
    h = max(0.5, max_z - min_z)
    mid_z = min_z + h * 0.52
    head_z = min_z + h * 0.84

    # Subtle floor disc so grounding is obvious in review renders
    floor_mat = make_pbr_material("ReviewFloor", "#26344a", roughness=0.75, metallic=0.05)
    floor = make_cylinder("ReviewFloor", 0.72, 0.72, 0.02, location=(0, 0, -0.01), vertices=32, mat=floor_mat)

    # 3-point studio lights
    lights = []
    light_specs = [
        ("KeyLight", "AREA", (2.4, -2.8, h * 1.45), 140.0, (1.0, 0.96, 0.90), 1.6),
        ("FillLight", "AREA", (-2.6, -2.0, h * 0.95), 65.0, (0.78, 0.88, 1.0), 2.2),
        ("RimLight", "AREA", (0.5, 2.8, h * 1.40), 115.0, (0.75, 0.92, 1.0), 1.4),
    ]
    for lname, ltype, loc, energy, col, size in light_specs:
        ldata = bpy.data.lights.new(lname, type=ltype)
        ldata.energy = energy
        ldata.color = col
        ldata.size = size
        lobj = bpy.data.objects.new(lname, ldata)
        bpy.context.collection.objects.link(lobj)
        lobj.location = loc
        direction = Vector((0, 0, mid_z)) - Vector(loc)
        lobj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        lights.append(lobj)

    cam_data = bpy.data.cameras.new("ReviewCam")
    cam_data.lens = 52
    cam_obj = bpy.data.objects.new("ReviewCam", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    dist_full = h * 1.85
    views = [
        ("front", (0.0, -dist_full, mid_z + 0.05), (0.0, 0.0, mid_z), 50),
        ("q3", (dist_full * 0.62, -dist_full * 0.78, mid_z + 0.14), (0.0, 0.0, mid_z), 50),
        ("side", (dist_full, 0.0, mid_z + 0.05), (0.0, 0.0, mid_z), 50),
        ("head", (h * 0.16, -h * 0.72, head_z + 0.02), (0.0, 0.0, head_z - 0.02), 68),
    ]

    tmp_paths: list[str] = []
    tiles: list[np.ndarray] = []
    base_dir = os.path.dirname(os.path.abspath(out_sheet_path))
    sheet_stem = os.path.splitext(os.path.basename(out_sheet_path))[0]
    pid = os.getpid()

    for tag, pos, target, lens in views:
        cam_data.lens = lens
        cam_obj.location = pos
        cam_obj.rotation_euler = (Vector(target) - Vector(pos)).to_track_quat("-Z", "Y").to_euler()
        tmp_p = os.path.join(base_dir, f"_tmp_{pid}_{sheet_stem}_{tag}.png")
        scene.render.filepath = tmp_p
        bpy.ops.render.render(write_still=True)
        tmp_paths.append(tmp_p)
        img = bpy.data.images.load(tmp_p)
        px = np.array(img.pixels[:], dtype=np.float32).reshape((tile_h, tile_w, 4))
        tiles.append(px)
        bpy.data.images.remove(img)

    # Stitch horizontally into one review sheet
    sheet_px = np.concatenate(tiles, axis=1)
    sheet_w = tile_w * len(tiles)
    sheet_img = bpy.data.images.new("TurnaroundSheet", width=sheet_w, height=tile_h, alpha=True)
    sheet_img.pixels = sheet_px.ravel().tolist()
    sheet_img.filepath_raw = os.path.abspath(out_sheet_path)
    sheet_img.file_format = "PNG"
    sheet_img.save()
    bpy.data.images.remove(sheet_img)

    # Clean up temp tiles & studio helpers
    for tp in tmp_paths:
        try:
            os.remove(tp)
        except OSError:
            pass
    for obj in [floor, cam_obj, *lights]:
        bpy.data.objects.remove(obj, do_unlink=True)

    return out_sheet_path


def finalize_and_export(
    npc_id: str,
    armature: bpy.types.Object,
    mesh_obj: bpy.types.Object,
    *,
    repo_root: str,
    bg_hex: str = "#162033",
    render_sheet: bool = True,
) -> dict[str, Any]:
    """Ground, export uncompressed GLB to public/assets/npcs/<id>/model.glb, and render 4-view sheet."""
    metrics = ground_armature_and_mesh(armature, mesh_obj)
    glb_path = os.path.join(repo_root, "public", "assets", "npcs", npc_id, "model.glb")
    glb_bytes = export_glb(armature, mesh_obj, glb_path)
    metrics["glbPath"] = glb_path
    metrics["glbBytes"] = glb_bytes

    if render_sheet:
        sheet_path = os.path.join(repo_root, "tools", "npcs", "renders", f"{npc_id}_sheet.png")
        render_turnaround_sheet(armature, mesh_obj, sheet_path, bg_hex=bg_hex)
        metrics["sheetPath"] = sheet_path

    print(f"NPC_EXPORT_OK {npc_id} " + json.dumps(metrics))
    return metrics
