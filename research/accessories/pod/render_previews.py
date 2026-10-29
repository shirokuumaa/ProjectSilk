"""Three views of every GLB in a folder (front, three-quarter, side), each model normalised to a unit box.

The model is shown as the generator left it: no rotation, so the views also show how the model is
oriented (glTF +Z = front view, +Y up). Cycles on the GPU when there is one.

Run: blender -b --factory-startup --python render_previews.py -- --glbs <dir> --out <dir> [--size 384 --samples 48]
Writes <out>/<glb stem>_{front,34,side}.png.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

VIEWS = {"front": 0, "34": 40, "side": 90}


def use_gpu(scene):
    prefs = bpy.context.preferences.addons["cycles"].preferences
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
        except TypeError:
            continue
        prefs.get_devices()
        if any(d.type == kind for d in prefs.devices):
            for d in prefs.devices:
                d.use = d.type == kind
            scene.cycles.device = "GPU"
            return


def render(glb, out, size, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [o for o in scene.objects if o.type == "MESH"]
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    centre, extent = (lo + hi) / 2, max(hi - lo)

    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = extent * 1.25
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.9, 0.9, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)

    scene.render.engine = "CYCLES"
    use_gpu(scene)
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.view_settings.view_transform = "Standard"
    for name, ang in VIEWS.items():
        r = math.radians(ang)
        # glTF +Z (лицо модели) — это −Y в Blender: камера спереди стоит на −Y
        cam.location = centre + Vector((math.sin(r), -math.cos(r), 0)) * extent * 3
        cam.rotation_euler = (math.radians(90), 0, r)
        scene.render.filepath = str(out / f"{glb.stem}_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--glbs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=384)
    ap.add_argument("--samples", type=int, default=48)
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for glb in sorted(Path(a.glbs).glob("*.glb")):
        try:
            render(glb, out, a.size, a.samples)
            print("preview", glb.name, flush=True)
        except Exception as e:  # noqa: BLE001 — одна сломанная модель не останавливает остальные
            print("preview FAILED", glb.name, e, flush=True)


if __name__ == "__main__":
    main()
