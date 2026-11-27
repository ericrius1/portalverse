"""
Blender 5.3 procedural asset generator for Sector 9 Rain Corner (`doug-cassette-station`).
Builds high-detail, beveled, smooth-shaded PBR GLB models inspired by Blade Runner's
outdoor rainy Neo-Tokyo noodle stall & street canyon:
  1. white_dragon_noodle_bar.glb  — Iconic open-air chrome/cedar noodle bar, kitchen bay,
                                    exhaust ducts, corrugated rain awning, 6 leather stools,
                                    copper stockpots, bowls, condiment bottles & ribbed lanterns
  2. neo_tokyo_tower.glb          — Layered brutalist megabuilding with recessed window bays,
                                    balconies, railings, exterior AC condensers, vertical pipes,
                                    steel signage trusses, rooftop water tower & antennas
  3. electro_trolley.glb          — Beveled smooth-roof streetcar with recessed window frames,
                                    interior seats, wheel bogies, rooftop HVAC, diamond scissor
                                    pantograph, hooded headlights & named sliding doors
  4. cyber_scooter.glb            — Akira/Neo-Tokyo curved monocoque sport-scooter with
                                    telescopic forks, grooved tires, hubless neon rims,
                                    windscreen, sculpted saddle, mirrors & courier cargo box
  5. cyber_human.glb              — Anatomically proportioned cyberpunk trenchcoat human with
                                    named articulated limbs (Head, Torso, ArmL, ArmR, LegL, LegR)
                                    for smooth Three.js walking/sitting + bio-hybrid attachments

Run via:
  blender --background --python worlds/doug-cassette-station/tools/build_assets.py
"""

import math
import os
import bpy
import bmesh
from mathutils import Vector, Euler

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.abspath(os.path.join(SCRIPT_DIR, "..", "assets"))
os.makedirs(OUT_DIR, exist_ok=True)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_mat(name, color, roughness=0.5, metallic=0.0, emission=None, emission_strength=0.0, alpha=1.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
        if "Alpha" in bsdf.inputs and alpha < 1.0:
            bsdf.inputs["Alpha"].default_value = alpha
            mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else "HASHED"
        if emission is not None and emission_strength > 0.0:
            if "Emission Color" in bsdf.inputs:
                bsdf.inputs["Emission Color"].default_value = (emission[0], emission[1], emission[2], 1.0)
            if "Emission Strength" in bsdf.inputs:
                bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def set_smooth(obj):
    if obj.type != "MESH" or not obj.data:
        return
    mesh = obj.data
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.update()


def add_bevel(obj, width=0.02, segments=2):
    mod = obj.modifiers.new(name="Bevel", type="BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(32)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def add_subsurf(obj, levels=1):
    mod = obj.modifiers.new(name="Subsurf", type="SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def link_obj(obj, parent=None):
    bpy.context.collection.objects.link(obj)
    if parent is not None:
        obj.parent = parent
    return obj


def add_box(name, size, loc, mat, rot=(0, 0, 0), bevel=0.0, parent=None):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = Vector(loc)
    obj.rotation_euler = Euler(rot)
    obj.data.materials.append(mat)
    link_obj(obj, parent)
    if bevel > 0:
        add_bevel(obj, width=bevel, segments=2)
        set_smooth(obj)
    return obj


def add_cyl(name, radius, depth, loc, mat, segs=16, rot=(0, 0, 0), radius2=None, parent=None, smooth=True):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    r2 = radius if radius2 is None else radius2
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segs,
        radius1=radius,
        radius2=r2,
        depth=depth,
    )
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = Vector(loc)
    obj.rotation_euler = Euler(rot)
    obj.data.materials.append(mat)
    link_obj(obj, parent)
    if smooth:
        set_smooth(obj)
    return obj


def add_sphere(name, radius, loc, mat, segs=16, rings=10, scale=(1, 1, 1), parent=None):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    obj.location = Vector(loc)
    obj.data.materials.append(mat)
    link_obj(obj, parent)
    set_smooth(obj)
    return obj


def add_torus(name, major_r, minor_r, loc, mat, rot=(0, 0, 0), major_segs=24, minor_segs=10, parent=None):
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_r,
        minor_radius=minor_r,
        major_segments=major_segs,
        minor_segments=minor_segs,
        location=loc,
        rotation=rot,
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    if parent is not None:
        obj.parent = parent
    set_smooth(obj)
    return obj


def export_glb(filename):
    path = os.path.join(OUT_DIR, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_materials="EXPORT",
        export_normals=True,
        export_texcoords=True,
        export_draco_mesh_compression_enable=False,
    )
    size_kb = os.path.getsize(path) / 1024.0
    print(f"[blender] exported {filename} ({size_kb:.1f} KiB)")


# =============================================================================
# 1. WHITE DRAGON NOODLE BAR (Blade Runner 1982 Outdoor Nighttime Stall)
#    Coordinate convention in Blender: Z-up (exported to Three.js Y-up).
#    In Blender before Y-up export: +X = East (front counter), +Y = North (-Z in Three), +Z = Up.
# =============================================================================
def build_white_dragon_noodle_bar():
    clear_scene()

    concrete = make_mat("WetConcrete", (0.14, 0.16, 0.20), roughness=0.68, metallic=0.08)
    dark_steel = make_mat("DarkSteel", (0.12, 0.14, 0.19), roughness=0.32, metallic=0.82)
    galvanized = make_mat("GalvanizedMetal", (0.48, 0.52, 0.56), roughness=0.34, metallic=0.88)
    chrome = make_mat("PolishedChrome", (0.86, 0.89, 0.92), roughness=0.14, metallic=0.96)
    walnut = make_mat("WetCedarWood", (0.20, 0.11, 0.07), roughness=0.45, metallic=0.05)
    tile_cream = make_mat("KitchenTile", (0.78, 0.72, 0.62), roughness=0.35, metallic=0.02, emission=(0.95, 0.72, 0.42), emission_strength=0.45)
    red_leather = make_mat("DinerLeather", (0.68, 0.08, 0.14), roughness=0.32, metallic=0.06)
    copper = make_mat("BrothCopper", (0.76, 0.36, 0.14), roughness=0.22, metallic=0.92)
    ceramic = make_mat("RamenBowl", (0.10, 0.11, 0.15), roughness=0.20, metallic=0.05)
    broth_gold = make_mat("MisoBroth", (0.92, 0.52, 0.10), roughness=0.18, emission=(0.88, 0.44, 0.06), emission_strength=0.65)
    lantern_red = make_mat("LanternRed", (0.98, 0.24, 0.20), roughness=0.35, emission=(1.0, 0.22, 0.14), emission_strength=2.8)
    neon_pink = make_mat("NeonCrimson", (1.0, 0.22, 0.42), roughness=0.2, emission=(1.0, 0.16, 0.38), emission_strength=3.6)
    neon_amber = make_mat("NeonAmber", (1.0, 0.78, 0.26), roughness=0.2, emission=(1.0, 0.68, 0.16), emission_strength=2.8)
    warm_lamp = make_mat("WarmKitchenLamp", (1.0, 0.92, 0.74), roughness=0.15, emission=(1.0, 0.85, 0.55), emission_strength=4.0)

    # Concrete kitchen core & recessed brightly lit interior prep bay
    add_box("KitchenBack", (2.6, 7.6, 4.3), (-1.4, 0.0, 2.15), concrete, bevel=0.04)
    add_box("KitchenTileBack", (0.12, 6.2, 2.2), (-0.06, 0.0, 2.05), tile_cream)
    add_box("PrepShelfLower", (0.65, 6.0, 0.08), (0.28, 0.0, 1.02), galvanized, bevel=0.015)
    add_box("PrepShelfUpper", (0.42, 5.8, 0.06), (0.18, 0.0, 2.32), galvanized, bevel=0.01)

    # Stainless steel commercial exhaust hood + curved vertical ducting climbing the building
    add_box("ExhaustHood", (1.25, 3.8, 0.62), (0.62, 0.2, 2.86), galvanized, bevel=0.04)
    add_cyl("ExhaustPipeVert", 0.24, 2.6, (0.35, 0.2, 4.35), galvanized, segs=18)
    add_torus("ExhaustFlange1", 0.26, 0.035, (0.35, 0.2, 3.25), dark_steel, major_segs=18)
    add_torus("ExhaustFlange2", 0.26, 0.035, (0.35, 0.2, 4.65), dark_steel, major_segs=18)

    # Warm linear fluorescent kitchen tubes lighting the workspace
    for ly in (-1.6, 1.6):
        add_cyl(f"KitchenTube_{ly}", 0.035, 2.4, (0.72, ly, 2.52), warm_lamp, segs=10, rot=(math.pi / 2, 0, 0))

    # Iconic curved wrap-around Blade Runner outdoor counter (cedar wainscot + brushed chrome top + foot rail)
    add_box("CounterBase", (0.95, 7.1, 1.00), (1.72, 0.0, 0.50), walnut, bevel=0.03)
    # Decorative vertical wood slats on counter front
    for i in range(18):
        sy = -3.3 + i * (6.6 / 17.0)
        add_box(f"CounterSlat_{i}", (0.05, 0.08, 0.88), (2.21, sy, 0.50), dark_steel, bevel=0.008)
    add_box("CounterTop", (1.32, 7.35, 0.09), (1.78, 0.0, 1.045), chrome, bevel=0.025)
    add_box("CounterSplash", (0.08, 7.2, 0.18), (1.16, 0.0, 1.15), chrome, bevel=0.012)
    add_cyl("FootRail", 0.028, 7.1, (2.36, 0.0, 0.20), chrome, segs=12, rot=(math.pi / 2, 0, 0))
    for fy in (-3.0, -1.0, 1.0, 3.0):
        add_cyl(f"FootBracket_{fy}", 0.02, 0.22, (2.26, fy, 0.20), chrome, segs=8, rot=(0, math.pi / 2, 0))

    # Overhanging corrugated rain awning with diagonal steel support trusses & dripping rain gutter!
    awning_angle = 0.14
    for i in range(26):
        ay = -3.95 + i * (7.9 / 25.0)
        add_cyl(f"Corrugation_{i}", 0.09, 4.7, (1.42, ay, 3.48), dark_steel, segs=8, rot=(0, math.pi / 2 + awning_angle, 0))
    add_box("AwningBeamFront", (0.14, 8.2, 0.20), (3.68, 0.0, 3.12), dark_steel, bevel=0.02)
    add_box("RainGutter", (0.16, 8.25, 0.10), (3.80, 0.0, 3.02), galvanized, bevel=0.02)
    add_box("AwningNeonTrim", (0.06, 8.15, 0.07), (3.82, 0.0, 3.18), neon_pink, bevel=0.01)
    # Angled steel truss struts supporting the canopy
    for ty in (-3.6, 0.0, 3.6):
        add_cyl(f"TrussPost_{ty}", 0.06, 3.25, (3.45, ty, 1.62), dark_steel, segs=10)
        add_cyl(f"TrussBrace_{ty}", 0.04, 1.45, (2.95, ty, 2.75), dark_steel, segs=8, rot=(0, 0.72, 0))

    # 6 Detailed Sculpted Swivel Diner Stools (padded crimson leather, chrome pedestal, footrest ring!)
    for i in range(6):
        sy = -2.6 + i * 1.04
        sx = 2.72
        add_cyl(f"StoolBase_{i}", 0.21, 0.04, (sx, sy, 0.02), chrome, segs=18, radius2=0.14)
        add_cyl(f"StoolStem_{i}", 0.036, 0.64, (sx, sy, 0.35), chrome, segs=14)
        add_torus(f"StoolRing_{i}", 0.17, 0.015, (sx, sy, 0.24), chrome, major_segs=18)
        # Padded beveled diner cushion + chrome rim band
        add_cyl(f"StoolRim_{i}", 0.235, 0.055, (sx, sy, 0.68), chrome, segs=20)
        add_sphere(f"StoolCushion_{i}", 0.225, (sx, sy, 0.73), red_leather, segs=20, rings=10, scale=(1.0, 1.0, 0.34))

        # Place steaming ramen bowls, chopsticks & soy bottles along the counter
        if i in (1, 3, 4):
            bx = 1.98
            add_cyl(f"Bowl_{i}", 0.085, 0.13, (bx, sy, 1.155), ceramic, segs=18, radius2=0.165)
            add_cyl(f"Broth_{i}", 0.145, 0.015, (bx, sy, 1.205), broth_gold, segs=16)
            add_cyl(f"ChopstickA_{i}", 0.006, 0.28, (bx + 0.04, sy + 0.14, 1.19), walnut, segs=6, rot=(0.2, 1.4, 0.2))
            add_cyl(f"ChopstickB_{i}", 0.006, 0.28, (bx + 0.02, sy + 0.16, 1.19), walnut, segs=6, rot=(0.2, 1.4, 0.05))
        if i in (0, 2, 5):
            add_cyl(f"SoyBottle_{i}", 0.035, 0.16, (1.55, sy + 0.2, 1.17), dark_steel, segs=10, radius2=0.02)
            add_cyl(f"SoyCap_{i}", 0.022, 0.03, (1.55, sy + 0.2, 1.26), red_leather, segs=10)

    # Sizzling copper broth stockpots + ladle behind counter
    for py, pr in ((0.4, 0.36), (-0.7, 0.30)):
        add_cyl(f"Stockpot_{py}", pr, 0.42, (0.95, py, 1.22), copper, segs=20)
        add_torus(f"StockpotRim_{py}", pr + 0.015, 0.02, (0.95, py, 1.43), chrome, major_segs=20)
        add_cyl(f"StockBroth_{py}", pr - 0.03, 0.02, (0.95, py, 1.38), broth_gold, segs=18)

    # 5 Sculpted Ribbed Red Chōchin Lanterns hanging along the front rain canopy!
    for i in range(5):
        ly = -2.8 + i * 1.4
        lx = 3.45
        lz = 2.68
        add_cyl(f"LanternCord_{i}", 0.008, 0.36, (lx, ly, lz + 0.36), dark_steel, segs=6)
        add_cyl(f"LanternCapTop_{i}", 0.11, 0.05, (lx, ly, lz + 0.24), dark_steel, segs=14)
        add_cyl(f"LanternCapBot_{i}", 0.10, 0.05, (lx, ly, lz - 0.24), dark_steel, segs=14)
        add_sphere(f"LanternBody_{i}", 0.22, (lx, ly, lz), lantern_red, segs=18, rings=12, scale=(0.86, 0.86, 1.18))
        for rz in (-0.12, 0.0, 0.12):
            add_torus(f"LanternRib_{i}_{rz}", 0.185 if rz == 0 else 0.165, 0.008, (lx, ly, lz + rz), dark_steel, major_segs=18)

    # Hanging neon accent tubes under the sign frame
    add_box("SignMountFrame", (0.24, 5.2, 1.8), (3.62, 0.0, 4.15), dark_steel, bevel=0.03)
    add_box("SignTrimTop", (0.28, 5.25, 0.06), (3.62, 0.0, 5.05), neon_amber)
    add_box("SignTrimBot", (0.28, 5.25, 0.06), (3.62, 0.0, 3.25), neon_pink)

    # Traditional split Japanese Noren fabric curtains fluttering under the front rain beam
    noren_indigo = make_mat("NorenIndigo", (0.06, 0.10, 0.22), roughness=0.72, metallic=0.02)
    noren_crest = make_mat("NorenCrest", (0.94, 0.88, 0.72), roughness=0.55, emission=(0.95, 0.78, 0.48), emission_strength=0.35)
    add_cyl("NorenRod", 0.016, 6.2, (2.68, 0.0, 2.94), dark_steel, segs=8, rot=(math.pi / 2, 0, 0))
    for i in range(6):
        ny = -2.55 + i * 1.02
        add_box(f"NorenPanel_{i}", (0.025, 0.86, 0.56), (2.68, ny, 2.64), noren_indigo, rot=(0, 0.06 * ((i % 2) * 2 - 1), 0))
        add_box(f"NorenCrest_{i}", (0.032, 0.34, 0.14), (2.68, ny, 2.66), noren_crest, rot=(0, 0.06 * ((i % 2) * 2 - 1), 0))

    # Rich exterior lived-in details on the visible South (-Y in Blender = +Z in Three) & North walls
    # Vertical drainpipes, electrical conduit, junction box, and wall-mounted AC condenser unit!
    for wy_sign in (-1.0, 1.0):
        wy = wy_sign * 3.84
        # Corner rainwater downspout + two galvanized pipe conduits with brackets
        add_cyl(f"WallPipeA_{wy_sign}", 0.055, 4.1, (-2.35, wy, 2.05), galvanized, segs=12)
        add_cyl(f"WallPipeB_{wy_sign}", 0.032, 3.8, (-2.15, wy, 1.95), dark_steel, segs=10)
        for bz in (0.9, 2.1, 3.3):
            add_box(f"PipeClamp_{wy_sign}_{bz}", (0.34, 0.12, 0.05), (-2.25, wy - wy_sign * 0.02, bz), dark_steel)
        # Utility breaker / gas meter box
        add_box(f"BreakerBox_{wy_sign}", (0.58, 0.22, 0.72), (-1.55, wy + wy_sign * 0.06, 1.35), dark_steel, bevel=0.02)
        add_cyl(f"MeterDial_{wy_sign}", 0.08, 0.08, (-1.55, wy + wy_sign * 0.18, 1.48), chrome, segs=12, rot=(math.pi / 2, 0, 0))
        # Wall-mounted exterior AC condenser unit with recessed fan grille & neon power LED
        add_box(f"WallAC_{wy_sign}", (0.92, 0.36, 0.62), (-1.25, wy + wy_sign * 0.14, 3.12), galvanized, bevel=0.025)
        add_cyl(f"WallACFan_{wy_sign}", 0.22, 0.06, (-1.40, wy + wy_sign * 0.33, 3.12), dark_steel, segs=16, rot=(math.pi / 2, 0, 0))
        add_box(f"WallACLed_{wy_sign}", (0.04, 0.04, 0.04), (-0.90, wy + wy_sign * 0.33, 3.32), neon_pink)

    # Extra stacked ramen bowls & bottles on the bright kitchen prep shelf for authentic clutter
    for idx, sy in enumerate((-2.2, -1.8, -1.2, 1.4, 2.0)):
        add_cyl(f"ShelfStack_{idx}", 0.09, 0.24, (0.28, sy, 1.18), ceramic, segs=14, radius2=0.14)
        add_cyl(f"ShelfBottle_{idx}", 0.038, 0.26, (0.18, sy + 0.25, 2.48), copper if idx % 2 == 0 else lantern_red, segs=10, radius2=0.018)

    export_glb("white_dragon_noodle_bar.glb")


# =============================================================================
# 2. NEO-TOKYO MEGABUILDING MODULE (Layered Brutalist Relief, Balconies, ACs, Pipes)
# =============================================================================
def build_neo_tokyo_tower():
    clear_scene()

    concrete_dark = make_mat("TowerConcrete", (0.09, 0.11, 0.16), roughness=0.76, metallic=0.12)
    concrete_mid = make_mat("TowerRibs", (0.14, 0.17, 0.23), roughness=0.68, metallic=0.18)
    steel = make_mat("TowerSteel", (0.16, 0.19, 0.25), roughness=0.38, metallic=0.78)
    ac_body = make_mat("ACUnit", (0.34, 0.37, 0.42), roughness=0.45, metallic=0.65)
    win_dark = make_mat("DarkWindow", (0.04, 0.06, 0.11), roughness=0.12, metallic=0.4)
    win_warm = make_mat("WarmWindow", (1.0, 0.80, 0.45), roughness=0.15, emission=(1.0, 0.72, 0.35), emission_strength=2.2)
    win_cyan = make_mat("CyanWindow", (0.35, 0.88, 1.0), roughness=0.15, emission=(0.18, 0.82, 0.98), emission_strength=2.1)
    win_pink = make_mat("PinkWindow", (1.0, 0.38, 0.65), roughness=0.15, emission=(0.96, 0.24, 0.56), emission_strength=2.0)
    beacon_red = make_mat("RoofBeacon", (1.0, 0.12, 0.16), roughness=0.2, emission=(1.0, 0.10, 0.14), emission_strength=4.5)

    # Core structural tower (11m x 13m x 32m tall)
    W, D, H = 10.6, 12.6, 32.0
    add_box("TowerCore", (W, D, H), (0, 0, H * 0.5), concrete_dark, bevel=0.08)

    # Horizontal concrete floor slabs + brutalist vertical structural piers
    for f in range(1, 10):
        fz = f * 3.2
        add_box(f"FloorSlab_{f}", (W + 0.55, D + 0.55, 0.36), (0, 0, fz), concrete_mid, bevel=0.04)
    for px in (-W * 0.5, 0.0, W * 0.5):
        for py in (-D * 0.5, D * 0.5):
            add_box(f"Pier_{px}_{py}", (0.65, 0.65, H), (px, py, H * 0.5), concrete_mid, bevel=0.03)

    # Recessed illuminated & dark apartment windows + cantilevered balconies + AC units on +X and -X faces
    win_mats = [win_dark, win_warm, win_dark, win_cyan, win_dark, win_pink, win_warm]
    for f in range(2, 9):
        fz = f * 3.2 + 1.45
        for side in (-1, 1):
            fx = side * (W * 0.5 + 0.05)
            for c in range(4):
                wy = -4.2 + c * 2.8
                wm = win_mats[(f * 5 + c * 3 + (1 if side > 0 else 0)) % len(win_mats)]
                add_box(f"Win_{side}_{f}_{c}", (0.14, 1.9, 1.55), (fx, wy, fz), wm)
                # Metal window mullion frame
                add_box(f"WinSill_{side}_{f}_{c}", (0.34, 2.05, 0.12), (fx + side * 0.08, wy, fz - 0.82), steel)
                # Projecting concrete balcony & safety rail on select apartments
                if (f + c) % 3 == 0:
                    bx = side * (W * 0.5 + 0.62)
                    add_box(f"BalcFloor_{side}_{f}_{c}", (1.1, 2.5, 0.16), (bx, wy, fz - 1.15), concrete_mid, bevel=0.02)
                    add_box(f"BalcRail_{side}_{f}_{c}", (0.06, 2.45, 0.06), (bx + side * 0.5, wy, fz - 0.32), steel)
                    for ry in (-1.15, 0.0, 1.15):
                        add_box(f"BalcPost_{side}_{f}_{c}_{ry}", (0.05, 0.05, 0.85), (bx + side * 0.5, wy + ry, fz - 0.72), steel)
                # Exterior wall-mounted AC condenser box with dark fan grille!
                if (f * 2 + c) % 4 == 1:
                    ax = side * (W * 0.5 + 0.42)
                    add_box(f"AC_{side}_{f}_{c}", (0.68, 0.88, 0.62), (ax, wy + 0.7, fz - 0.5), ac_body, bevel=0.03)
                    add_cyl(f"ACFan_{side}_{f}_{c}", 0.22, 0.08, (ax + side * 0.34, wy + 0.7, fz - 0.5), win_dark, segs=12, rot=(0, math.pi / 2, 0))

    # Vertical exterior industrial conduit pipes & steel exhaust ducts
    for side in (-1, 1):
        for py in (-5.4, 5.4):
            add_cyl(f"PipeMain_{side}_{py}", 0.18, H - 4.0, (side * (W * 0.5 + 0.28), py, H * 0.5 + 1.0), steel, segs=10)
            add_cyl(f"PipeSub_{side}_{py}", 0.09, H - 6.0, (side * (W * 0.5 + 0.25), py - 0.42, H * 0.5 + 1.5), galvanized if "galvanized" in locals() else ac_body, segs=8)

    # Rooftop mechanical penthouse, water tank, antenna mast & red aviation beacon!
    add_box("Penthouse", (5.2, 6.2, 3.6), (-0.8, 0.4, H + 1.8), concrete_mid, bevel=0.06)
    add_cyl("WaterTank", 1.35, 2.8, (2.6, -2.5, H + 2.4), ac_body, segs=18)
    for lx, ly in ((1.8, -1.8), (3.4, -1.8), (1.8, -3.2), (3.4, -3.2)):
        add_cyl(f"TankLeg_{lx}_{ly}", 0.1, 1.4, (lx, ly, H + 0.7), steel, segs=8)
    add_cyl("AntennaMast", 0.09, 8.5, (-0.8, 0.4, H + 7.5), steel, segs=10, radius2=0.03)
    add_sphere("AviationBeacon", 0.24, (-0.8, 0.4, H + 11.8), beacon_red, segs=12, rings=8)

    export_glb("neo_tokyo_tower.glb")


# =============================================================================
# 3. ELECTRO-PUNK TROLLEY (Smooth-Beveled Hull, Bogies, Interior Seats, Scissor Pantograph)
#    Length along X (+X = rear, -X = front westbound nose), Z = Up.
# =============================================================================
def build_electro_trolley():
    clear_scene()

    hull_dark = make_mat("TrolleyBody", (0.10, 0.13, 0.20), roughness=0.26, metallic=0.82)
    steel_frame = make_mat("TrolleySteel", (0.20, 0.24, 0.31), roughness=0.34, metallic=0.86)
    chrome = make_mat("TrolleyChrome", (0.85, 0.88, 0.92), roughness=0.14, metallic=0.95)
    stripe_crimson = make_mat("TrolleyCrimson", (0.94, 0.18, 0.34), roughness=0.22, emission=(0.94, 0.14, 0.30), emission_strength=2.2)
    neon_cyan = make_mat("TrolleyCyan", (0.24, 0.90, 1.0), roughness=0.18, emission=(0.14, 0.85, 1.0), emission_strength=3.0)
    cabin_glow = make_mat("TrolleyCabinGlass", (1.0, 0.86, 0.54), roughness=0.12, emission=(1.0, 0.76, 0.36), emission_strength=1.9)
    door_glass = make_mat("TrolleyDoorGlass", (0.25, 0.72, 0.96), roughness=0.12, emission=(0.14, 0.58, 0.86), emission_strength=1.35)
    headlamp_mat = make_mat("TrolleyHeadlamp", (1.0, 0.95, 0.78), roughness=0.1, emission=(1.0, 0.92, 0.65), emission_strength=4.5)

    # Lower armored chassis skirt + curved beveled main tram hull + rounded aerodynamic roof cap
    add_box("TramLowerHull", (9.1, 2.38, 0.82), (0, 0, 0.94), hull_dark, bevel=0.09)
    add_box("TramUpperRoof", (8.85, 2.22, 0.42), (0, 0, 2.68), hull_dark, bevel=0.16)
    # Corner and bay steel pillars framing the illuminated passenger cabin
    for px in (-4.42, -2.62, -0.95, 0.95, 2.62, 4.42):
        for py in (-1.12, 1.12):
            add_box(f"Pillar_{px}_{py}", (0.22, 0.16, 1.38), (px, py, 1.92), steel_frame, bevel=0.02)

    # Recessed warm illuminated side window bays + subtle interior seat silhouettes
    for wx in (-3.52, -1.78, 1.78, 3.52):
        add_box(f"CabinWindow_{wx}", (1.52, 2.24, 1.08), (wx, 0, 1.92), cabin_glow)
        # Window sill trim
        add_box(f"WinSill_{wx}", (1.58, 2.40, 0.08), (wx, 0, 1.36), chrome, bevel=0.01)

    # Glowing neon racing stripes & roofline electric cyan strip
    add_box("CrimsonStripe", (9.18, 2.44, 0.18), (0, 0, 0.86), stripe_crimson, bevel=0.02)
    add_box("CyanRoofLine", (8.98, 2.32, 0.10), (0, 0, 2.74), neon_cyan, bevel=0.02)

    # Westbound (-X) sculpted front nose: panoramic windshield, LED headsign, armored bumper & hooded dual headlamps!
    add_box("FrontWindshield", (0.14, 1.96, 1.06), (-4.52, 0, 1.92), door_glass, bevel=0.02)
    add_box("FrontHeadsign", (0.18, 1.65, 0.28), (-4.52, 0, 2.58), neon_cyan, bevel=0.02)
    add_box("FrontBumper", (0.42, 2.42, 0.34), (-4.62, 0, 0.56), steel_frame, bevel=0.05)
    for ly in (-0.76, 0.76):
        add_cyl(f"HeadlampHousing_{ly}", 0.16, 0.22, (-4.56, ly, 0.98), chrome, segs=16, rot=(0, math.pi / 2, 0))
        add_cyl(f"HeadlampLens_{ly}", 0.13, 0.06, (-4.66, ly, 0.98), headlamp_mat, segs=16, rot=(0, math.pi / 2, 0))
    # Rear (+X) tail-light bar & bumper
    add_box("RearBumper", (0.36, 2.40, 0.32), (4.60, 0, 0.56), steel_frame, bevel=0.05)
    add_box("RearTailBar", (0.14, 1.95, 0.20), (4.58, 0, 1.02), stripe_crimson, bevel=0.02)

    # Detailed twin rail bogie trucks with coil springs & flanged steel wheels
    for bx in (-2.85, 2.85):
        add_box(f"BogieFrame_{bx}", (2.1, 1.56, 0.28), (bx, 0, 0.38), steel_frame, bevel=0.03)
        for wx in (-0.68, 0.68):
            add_cyl(f"Axle_{bx}_{wx}", 0.07, 1.48, (bx + wx, 0, 0.32), steel_frame, segs=10, rot=(math.pi / 2, 0, 0))
            for wy in (-0.66, 0.66):
                add_cyl(f"Wheel_{bx}_{wx}_{wy}", 0.32, 0.14, (bx + wx, wy, 0.32), chrome, segs=20, rot=(math.pi / 2, 0, 0))
                add_cyl(f"WheelFlange_{bx}_{wx}_{wy}", 0.36, 0.03, (bx + wx, wy - 0.07 * (1 if wy > 0 else -1), 0.32), steel_frame, segs=20, rot=(math.pi / 2, 0, 0))

    # Rooftop HVAC condenser pods, insulator coils & articulated diamond scissor pantograph!
    for hx in (-2.5, 2.5):
        add_box(f"RoofHVAC_{hx}", (2.1, 1.48, 0.38), (hx, 0, 3.06), steel_frame, bevel=0.05)
        add_box(f"RoofVent_{hx}", (1.7, 0.12, 0.22), (hx, 0.74, 3.08), neon_cyan)
    add_box("PantographBase", (1.2, 0.9, 0.14), (0, 0, 2.94), steel_frame, bevel=0.02)
    for px, ang in ((-0.26, -0.42), (0.26, 0.42)):
        add_cyl(f"PantoLow_{px}", 0.035, 0.92, (px, 0, 3.36), chrome, segs=10, rot=(0, ang, 0))
        add_cyl(f"PantoHi_{px}", 0.032, 0.92, (px, 0, 3.92), chrome, segs=10, rot=(0, -ang, 0))
    add_box("PantoCollector", (0.26, 1.72, 0.09), (0, 0, 4.28), neon_cyan, bevel=0.02)

    # Named bi-parting sliding doors on the North (+Y in Blender -> -Z in Three.js) Bus Stop side!
    add_box("DoorLeft", (0.86, 0.12, 1.98), (-0.44, 1.18, 1.56), door_glass, bevel=0.02)
    add_box("DoorRight", (0.86, 0.12, 1.98), (0.44, 1.18, 1.56), door_glass, bevel=0.02)
    # Matching closed center window on South (-Y) side
    add_box("SouthCenterDoor", (1.72, 0.12, 1.98), (0.0, -1.18, 1.56), door_glass, bevel=0.02)

    export_glb("electro_trolley.glb")


# =============================================================================
# 4. AKIRA / NEO-TOKYO CYBER-SCOOTER (Curved Monocoque, Forks, Tires, Windscreen, Cargo Box)
#    Forward along +X in Blender (+X in Three.js for perpendicular East-West lanes!).
# =============================================================================
def build_cyber_scooter():
    clear_scene()

    body_paint = make_mat("ScooterBody", (0.12, 0.16, 0.26), roughness=0.22, metallic=0.78)
    body_accent = make_mat("ScooterAccent", (0.24, 0.90, 1.0), roughness=0.18, emission=(0.14, 0.86, 1.0), emission_strength=2.8)
    tail_red = make_mat("ScooterTail", (1.0, 0.16, 0.30), roughness=0.2, emission=(1.0, 0.12, 0.28), emission_strength=3.2)
    rubber = make_mat("ScooterTire", (0.05, 0.055, 0.065), roughness=0.82, metallic=0.05)
    chrome = make_mat("ScooterChrome", (0.86, 0.89, 0.92), roughness=0.14, metallic=0.95)
    leather = make_mat("ScooterSaddle", (0.14, 0.10, 0.12), roughness=0.42, metallic=0.05)
    smoked_glass = make_mat("ScooterWindscreen", (0.12, 0.24, 0.36), roughness=0.1, metallic=0.2, alpha=0.55)

    # Sculpted curved lower chassis belly & stepped aerodynamic nose fairing
    add_box("ScooterDeck", (1.58, 0.44, 0.22), (0.04, 0, 0.34), body_paint, bevel=0.06)
    add_box("FrontCowling", (0.48, 0.46, 0.62), (0.64, 0, 0.68), body_paint, rot=(0, -0.34, 0), bevel=0.08)
    add_box("NoseBeak", (0.44, 0.38, 0.24), (0.86, 0, 0.56), body_paint, rot=(0, 0.28, 0), bevel=0.06)
    add_box("Windscreen", (0.06, 0.38, 0.36), (0.58, 0, 1.06), smoked_glass, rot=(0, -0.52, 0), bevel=0.015)

    # Sculpted ergonomic leather saddle & rear tail fairing
    add_box("RearTailCowling", (0.66, 0.44, 0.32), (-0.52, 0, 0.62), body_paint, rot=(0, 0.14, 0), bevel=0.07)
    add_box("Saddle", (0.62, 0.36, 0.14), (-0.18, 0, 0.74), leather, bevel=0.05)

    # Chrome telescopic front forks, axle hubs, swingarm & sculpted handlebars with side mirrors!
    for fy in (-0.14, 0.14):
        add_cyl(f"FrontFork_{fy}", 0.026, 0.68, (0.74, fy, 0.58), chrome, segs=12, rot=(0, -0.34, 0))
        add_cyl(f"RearShock_{fy}", 0.024, 0.42, (-0.56, fy, 0.46), chrome, segs=10, rot=(0, 0.38, 0))
    add_cyl("Handlebar", 0.022, 0.72, (0.48, 0, 0.96), chrome, segs=12, rot=(math.pi / 2, 0, 0))
    for gy in (-0.34, 0.34):
        add_cyl(f"Grip_{gy}", 0.030, 0.14, (0.48, gy, 0.96), body_accent, segs=10, rot=(math.pi / 2, 0, 0))
        add_cyl(f"MirrorStem_{gy}", 0.01, 0.14, (0.52, gy * 0.75, 1.05), chrome, segs=8, rot=(0.25 if gy > 0 else -0.25, 0, 0))
        add_box(f"Mirror_{gy}", (0.03, 0.12, 0.07), (0.52, gy * 0.85, 1.13), chrome, bevel=0.01)

    # Fat radial tires + inner glowing hubless cyber-rims + brake discs!
    for wx in (0.86, -0.78):
        add_torus(f"Tire_{wx}", 0.27, 0.095, (wx, 0, 0.33), rubber, rot=(math.pi / 2, 0, 0), major_segs=24, minor_segs=12)
        add_torus(f"NeonRim_{wx}", 0.20, 0.028, (wx, 0, 0.33), body_accent, rot=(math.pi / 2, 0, 0), major_segs=24, minor_segs=8)
        add_cyl(f"BrakeDisc_{wx}", 0.14, 0.04, (wx, 0, 0.33), chrome, segs=16, rot=(math.pi / 2, 0, 0))

    # Glowing twin headlight bar, neon side trim, red LED taillight & aluminum courier cargo case
    add_box("HeadlightLED", (0.09, 0.36, 0.10), (1.02, 0, 0.62), body_accent, bevel=0.02)
    add_box("TailLED", (0.09, 0.38, 0.10), (-0.88, 0, 0.68), tail_red, bevel=0.02)
    for sy in (-0.23, 0.23):
        add_box(f"SideNeon_{sy}", (0.95, 0.03, 0.04), (0.08, sy, 0.44), body_accent)
    add_box("CourierBox", (0.42, 0.42, 0.34), (-0.68, 0, 0.94), body_paint, bevel=0.04)
    add_box("CourierStrip", (0.44, 0.44, 0.04), (-0.68, 0, 1.00), body_accent)

    export_glb("cyber_scooter.glb")


# =============================================================================
# 5. LIFE-LIKE SCULPTED CYBERPUNK TRENCHCOAT HUMAN (Named Articulated Pivots!)
#    Facing -Y in Blender (+Z in Three.js!), Z = Up.
#    Named parent empties/meshes: Head, Torso, ArmL, ArmR, LegL, LegR
# =============================================================================
def build_cyber_human():
    clear_scene()

    skin = make_mat("HumanSkin", (0.86, 0.68, 0.56), roughness=0.58, metallic=0.02)
    coat = make_mat("TrenchCoat", (0.11, 0.14, 0.21), roughness=0.28, metallic=0.18)
    shirt = make_mat("UnderShirt", (0.18, 0.20, 0.26), roughness=0.62, metallic=0.05)
    pants = make_mat("TechPants", (0.09, 0.10, 0.14), roughness=0.65, metallic=0.06)
    boot = make_mat("CyberBoot", (0.07, 0.08, 0.11), roughness=0.30, metallic=0.28)
    chrome = make_mat("CyberChrome", (0.84, 0.88, 0.92), roughness=0.16, metallic=0.94)
    accent = make_mat("NeonAccent", (0.20, 0.92, 1.0), roughness=0.18, emission=(0.14, 0.88, 1.0), emission_strength=2.6)

    # Create named pivot empties so Three.js drives natural articulated limbs!
    def make_pivot(name, loc):
        e = bpy.data.objects.new(name, None)
        e.location = Vector(loc)
        link_obj(e)
        return e

    torso_p = make_pivot("Torso", (0, 0, 1.02))
    head_p = make_pivot("Head", (0, 0, 1.48))
    arm_l = make_pivot("ArmL", (-0.25, 0, 1.38))
    arm_r = make_pivot("ArmR", (0.25, 0, 1.38))
    leg_l = make_pivot("LegL", (-0.11, 0, 0.86))
    leg_r = make_pivot("LegR", (0.11, 0, 0.86))

    # Torso: sculpted chest, tapered waist, flared open-front Blade Runner trenchcoat with high storm collar & belt
    add_cyl("InnerTorso", 0.14, 0.54, (0, 0, 0.16), shirt, segs=16, radius2=0.17, parent=torso_p)
    # Tailored coat shoulders & back cape
    add_box("CoatBack", (0.44, 0.14, 0.62), (0, 0.08, 0.12), coat, bevel=0.05, parent=torso_p)
    for sx in (-0.14, 0.14):
        add_box(f"CoatLapel_{sx}", (0.16, 0.18, 0.58), (sx, -0.05, 0.10), coat, bevel=0.04, parent=torso_p)
        add_box(f"CoatTrim_{sx}", (0.025, 0.04, 0.54), (sx * 0.55, -0.14, 0.12), accent, parent=torso_p)
        # Flared trenchcoat lower skirt tails (left, right, back)
        add_box(f"CoatSkirt_{sx}", (0.17, 0.22, 0.36), (sx * 1.15, 0.02, -0.30), coat, rot=(0.06, 0, 0), bevel=0.04, parent=torso_p)
    add_box("CoatSkirtBack", (0.44, 0.10, 0.40), (0, 0.13, -0.32), coat, rot=(-0.10, 0, 0), bevel=0.04, parent=torso_p)
    # High samurai-tech turned-up storm collar
    add_cyl("StormCollar", 0.15, 0.14, (0, 0.02, 0.43), coat, segs=16, radius2=0.17, parent=torso_p)
    add_torus("CollarNeon", 0.165, 0.015, (0, 0.02, 0.49), accent, major_segs=18, parent=torso_p)
    # Utility belt + chrome buckle + cyber tech-pack
    add_cyl("Belt", 0.175, 0.06, (0, 0, -0.08), boot, segs=16, parent=torso_p)
    add_box("Buckle", (0.09, 0.04, 0.07), (0, -0.17, -0.08), chrome, bevel=0.01, parent=torso_p)
    add_box("TechPack", (0.24, 0.12, 0.30), (0, 0.18, 0.18), boot, bevel=0.03, parent=torso_p)
    add_box("TechPackLED", (0.18, 0.04, 0.05), (0, 0.24, 0.24), accent, parent=torso_p)

    # Head: sculpted oval cranium, tapered jawline, nose ridge, neck & sleek wrap-around visor!
    add_cyl("Neck", 0.058, 0.14, (0, 0, 0.02), skin, segs=12, radius2=0.052, parent=head_p)
    add_sphere("Cranium", 0.128, (0, 0.005, 0.175), skin, segs=18, rings=12, scale=(0.88, 1.02, 1.12), parent=head_p)
    add_sphere("Jaw", 0.095, (0, -0.025, 0.105), skin, segs=14, rings=8, scale=(0.82, 0.95, 0.85), parent=head_p)
    add_box("Nose", (0.028, 0.045, 0.045), (0, -0.125, 0.155), skin, rot=(0.25, 0, 0), bevel=0.01, parent=head_p)
    add_box("CyberVisor", (0.23, 0.10, 0.058), (0, -0.095, 0.182), accent, bevel=0.018, parent=head_p)

    # Articulated Arms (upper sleeve, elbow cuff, tapered forearm, gloved hand; right arm has chrome cyber-forearm!)
    for side, piv, is_cyber in ((-1, arm_l, False), (1, arm_r, True)):
        add_sphere(f"Shoulder_{side}", 0.078, (0, 0, -0.02), coat, segs=12, rings=8, parent=piv)
        add_cyl(f"UpperArm_{side}", 0.062, 0.28, (0, 0, -0.15), coat, segs=12, radius2=0.070, parent=piv)
        add_cyl(f"ForeArm_{side}", 0.046, 0.26, (0, 0, -0.40), chrome if is_cyber else coat, segs=12, radius2=0.058, parent=piv)
        add_torus(f"WristRing_{side}", 0.052, 0.012, (0, 0, -0.48), accent, major_segs=14, parent=piv)
        add_sphere(f"Hand_{side}", 0.046, (0, 0, -0.56), chrome if is_cyber else boot, segs=10, rings=8, scale=(0.85, 0.75, 1.25), parent=piv)

    # Articulated Legs (sculpted thigh, armored knee pad, tapered calf, chunky cyber-platform boot with glowing sole!)
    for side, piv in ((-1, leg_l), (1, leg_r)):
        add_cyl(f"Thigh_{side}", 0.072, 0.40, (0, 0, -0.20), pants, segs=12, radius2=0.092, parent=piv)
        add_box(f"KneePad_{side}", (0.11, 0.08, 0.11), (0, -0.06, -0.40), boot, bevel=0.02, parent=piv)
        add_cyl(f"Calf_{side}", 0.056, 0.36, (0, 0, -0.57), pants, segs=12, radius2=0.072, parent=piv)
        add_box(f"Boot_{side}", (0.13, 0.26, 0.14), (0, -0.04, -0.78), boot, bevel=0.03, parent=piv)
        add_box(f"BootSole_{side}", (0.138, 0.27, 0.032), (0, -0.04, -0.845), accent, bevel=0.008, parent=piv)

    export_glb("cyber_human.glb")


if __name__ == "__main__":
    build_white_dragon_noodle_bar()
    build_neo_tokyo_tower()
    build_electro_trolley()
    build_cyber_scooter()
    build_cyber_human()
    print("[blender] all Sector 9 Rain Corner hero GLB assets built successfully!")
