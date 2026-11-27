"""Blender 5 offline LOD preparation from normalized skin/eye arrays.

Run Blender --background --factory-startup --python this.py -- input.json assets/
Input uses the exact runtime headGeometry.loadSplitHead coordinate frame. The
full-detail source stays untouched. No textures or geometry compression.
"""
import bpy
import json
import sys
from pathlib import Path

source, destination = sys.argv[sys.argv.index('--') + 1:]
parts = json.loads(Path(source).read_text())
out = Path(destination)
out.mkdir(parents=True, exist_ok=True)
for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)

report = {}
for level, skin_ratio, eye_ratio in [('medium', 0.28, 0.3), ('far', 0.075, 0.12)]:
    objects = []
    for name, data in parts.items():
        p, ix = data['positions'], data['indices']
        # Three Y-up -> Blender Z-up, reversed by the glTF exporter.
        vertices = [(p[i], -p[i+2], p[i+1]) for i in range(0, len(p), 3)]
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata(vertices, [], [ix[i:i+3] for i in range(0, len(ix), 3)])
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        modifier = obj.modifiers.new('Distance reduction', 'DECIMATE')
        modifier.ratio = skin_ratio if name == 'skin' else eye_ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.data.calc_loop_triangles()
        report[f'{level}-{name}'] = len(obj.data.loop_triangles)
        objects.append(obj)
        obj.select_set(False)
    for obj in objects:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / f'head-{level}.glb'),
                              export_format='GLB', use_selection=True,
                              export_normals=True, export_texcoords=False,
                              export_materials='NONE', export_yup=True)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
print(json.dumps(report, indent=2))
