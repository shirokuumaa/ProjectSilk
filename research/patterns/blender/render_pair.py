"""Render a body + a draped garment, front and side (Blender workbench, orthographic).

Run: Blender -b --factory-startup --python render_pair.py -- --body body.obj --garment garment.obj --out prefix
Body OBJ in metres or cm, garment OBJ in cm (GarmentCode output), both Y up. Writes <prefix>_front.png and
<prefix>_side.png.
"""
import argparse
import math
import sys

import bpy


def load(path):
    before = set(bpy.data.objects)
    bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    obj = (set(bpy.data.objects) - before).pop()
    s = 0.01 if obj.dimensions.z > 3.0 else 1.0
    obj.scale = (s, s, s)
    return obj


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--body", required=True)
    ap.add_argument("--garment", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, garment = load(a.body), load(a.garment)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    garment.color = (0.35, 0.55, 0.85, 1)
    body.color = (0.85, 0.75, 0.68, 1)
    scene.render.resolution_x, scene.render.resolution_y = 500, 750
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.0
    for name, ang in (("front", 0), ("side", 90)):
        r = math.radians(ang)
        cam.location = (3.5 * math.sin(r), -3.5 * math.cos(r), 0.9)
        cam.rotation_euler = (math.radians(90), 0, r)
        scene.render.filepath = f"{a.out}_{name}.png"
        bpy.ops.render.render(write_still=True)


if __name__ == "__main__":
    main()
