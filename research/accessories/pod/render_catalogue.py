"""Catalogue picture of a printed demo garment: the size drape with its print tile on our MPFB body, front, 600x800.

Same look as the other catalogue pictures (export_demo_drapes.product_image): black background, grey body,
the frame cut around the garment. The garment GLB is the site model (metres, UVs in metres of the flat
pattern), the body is the simulation figure (runs/<run>/bodies, z shifted by zOffsetM — see export_demo_drapes.py).

Run (Blender 4.2+ / 5.x):
  blender -b --factory-startup --python render_catalogue.py -- \
      --body zara_S.obj --garment dress_S.glb --tile dress_print.png --tile-cm 4 --dz 0.04446 --out dress.png \
      [--engine CYCLES --samples 256 | --engine BLENDER_EEVEE --size 300]
"""
import argparse
import math
import sys

import bpy
from mathutils import Vector


def import_obj(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before and o.type == "MESH"]


def bbox(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def principled(name, color, roughness):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def print_material(tile, tile_cm):
    """Fabric with the seller tile: UVs are metres of the flat pattern, one repeat every tile_cm."""
    mat = principled("print", (1, 1, 1), 0.85)
    nt = mat.node_tree
    uv = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (100.0 / tile_cm, 100.0 / tile_cm, 1.0)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(tile)
    tex.interpolation = "Closest"           # чёткие края клетки
    nt.links.new(uv.outputs["UV"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    return mat


def area_light(name, location, energy, size):
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.size = size
    obj = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(obj)
    obj.location = location
    direction = Vector((0, 0, 1.0)) - Vector(location)
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return obj


def use_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        gpus = [d for d in prefs.devices if d.type == kind]
        if gpus:
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            print(f"Cycles on {kind}: {[d.name for d in gpus]}")
            return
    print("Cycles on CPU")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--body", required=True)
    ap.add_argument("--garment", required=True)
    ap.add_argument("--tile", required=True)
    ap.add_argument("--tile-cm", type=float, required=True)
    ap.add_argument("--dz", type=float, required=True, help="zOffsetM of this size in the demo manifest")
    ap.add_argument("--out", required=True)
    ap.add_argument("--engine", default="CYCLES")
    ap.add_argument("--samples", type=int, default=256)
    ap.add_argument("--size", type=int, default=600, help="width in px; height is 4/3 of it")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    body = import_obj(a.body)
    for o in body:                          # фигура симуляции → система сайта: сдвиг z (glTF) — это −Y в Blender
        s = 0.01 if o.dimensions.z > 3.0 else 1.0   # тела бывают в см (GarmentCode) и в м (MPFB)
        o.scale = (s, s, s)
        o.location.y = -a.dz
        o.data.materials.clear()
        o.data.materials.append(principled("body", (0.55, 0.55, 0.55), 0.6))
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.shade_smooth()
    garment = import_glb(a.garment)
    cloth = print_material(a.tile, a.tile_cm)
    for o in garment:
        o.data.materials.clear()
        o.data.materials.append(cloth)
    bpy.context.view_layer.update()

    lo, hi = bbox(garment)
    centre = (lo + hi) / 2
    w, h = hi.x - lo.x, hi.z - lo.z
    width, height = a.size, a.size * 4 // 3
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.sensor_fit = "VERTICAL"
    cam.data.ortho_scale = max(h * 1.16, w * 1.16 * height / width)
    cam.location = (centre.x, -4.0, centre.z)
    cam.rotation_euler = (math.radians(90), 0, 0)

    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0, 0, 0, 1)
    area_light("key", (-1.2, -2.2, 2.2), 160, 1.5)
    area_light("fill", (1.6, -2.0, 1.2), 60, 2.0)
    area_light("rim", (0.0, 2.0, 2.0), 60, 1.5)

    scene.render.engine = a.engine
    if a.engine == "CYCLES":
        use_gpu(scene)
        scene.cycles.samples = a.samples
        scene.cycles.use_denoising = True
    scene.render.resolution_x, scene.render.resolution_y = width, height
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = a.out
    bpy.ops.render.render(write_still=True)
    print("garment bbox (m):", tuple(round(v, 3) for v in lo), tuple(round(v, 3) for v in hi), "->", a.out)


if __name__ == "__main__":
    main()
