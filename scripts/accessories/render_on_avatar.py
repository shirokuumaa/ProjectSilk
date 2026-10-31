"""The prepared accessories on the avatar, as the try-on places them — a check by eye without the browser.

Placements come from the Jest test (client/src/utils/accessoryDemoModels.test.js) run with
ACCESSORY_RENDER_OUT=<placements.json>: the medium figure and every item's matrices (three.js, glTF axes),
plus the chain and belt lines. One close-up per item and one full figure with a set of items.

Run (Blender 4.2+ / 5.x, EEVEE — light):
  blender -b --factory-startup --python scripts/accessories/render_on_avatar.py -- --placements placements.json --out <dir>
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

C = Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))   # glTF (Y вверх) → Blender (Z вверх)


def gl_matrix(elements):
    m = Matrix([[elements[c * 4 + r] for c in range(4)] for r in range(4)])   # three.js хранит по столбцам
    return C @ m @ C.inverted()


def body_object(body):
    p = body["positions"]
    verts = [(p[i], -p[i + 2], p[i + 1]) for i in range(0, len(p), 3)]
    idx = body["index"]
    me = bpy.data.meshes.new("body")
    me.from_pydata(verts, [], [tuple(idx[i:i + 3]) for i in range(0, len(idx), 3)])
    obj = bpy.data.objects.new("body", me)
    bpy.context.scene.collection.objects.link(obj)
    mat = bpy.data.materials.new("skin")
    mat.diffuse_color = (0.72, 0.62, 0.56, 1)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.72, 0.62, 0.56, 1)
    me.materials.append(mat)
    for poly in me.polygons:
        poly.use_smooth = True
    return obj


def item_objects(item):
    """Модель в каждой своей точке (пара — две копии) и линия цепочки или ремня."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=item["file"])
    roots = [o for o in bpy.data.objects if o not in before and o.parent is None]
    rest = [r.matrix_world.copy() for r in roots]     # копии для следующих точек — от исходного положения
    out = []
    for k, m in enumerate(item["matrices"]):
        if k == 0:
            objs = roots
        else:
            objs = []
            for r in roots:
                dup = r.copy()
                dup.data = r.data.copy() if r.data else None
                bpy.context.scene.collection.objects.link(dup)
                objs.append(dup)
        for o, r in zip(objs, rest):
            o.matrix_world = gl_matrix(m["elements"]) @ r
        out += objs
    if item["line"]:
        pts = [Vector((x, -z, y)) for x, y, z in item["line"]]
        curve = bpy.data.curves.new("line", "CURVE")
        curve.dimensions = "3D"
        spline = curve.splines.new("POLY")
        spline.points.add(len(pts) - 1)
        for sp, v in zip(spline.points, pts):
            sp.co = (*v, 1)
        spline.use_cyclic_u = True
        curve.bevel_depth = (item["lineWidth"] or 0.0024) / 2
        if item["lineWidth"]:                        # ремень — плоская вертикальная лента
            curve.bevel_mode = "PROFILE"
            curve.bevel_depth = item["lineWidth"] / 2
            curve.bevel_resolution = 0
        obj = bpy.data.objects.new("line", curve)
        bpy.context.scene.collection.objects.link(obj)
        out.append(obj)
    return out


def frame(objs, scene, cam, pad=1.6, view="front"):
    objs = [o for o in objs if o.type in ("MESH", "CURVE")] or objs   # пустые корни glTF стоят в начале координат
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    cam.data.ortho_scale = max(hi - lo) * pad
    ang = {"front": 0, "34": 35, "side": 90}[view]
    r = math.radians(ang)
    cam.location = c + Vector((math.sin(r), -math.cos(r), 0)) * 3
    cam.rotation_euler = (math.radians(90), 0, r)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--placements", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--size", type=int, default=480)
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
    data = json.loads(Path(a.placements).read_text())
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = a.size
    scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.92, 0.92, 0.92, 1)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(45), 0, math.radians(-25))
    scene.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    body = body_object(data["body"])

    groups = {}
    for item in data["items"]:
        groups[Path(item["file"]).stem] = item_objects(item)

    def show(names):
        for name, objs in groups.items():
            for o in objs:
                o.hide_render = name not in names

    for name, objs in groups.items():                 # крупный план каждой вещи, с телом
        show({name})
        for view in ("front", "34", "side"):
            frame(objs, scene, cam, pad=2.2 if name != "06_handbag" else 1.6, view=view)
            scene.render.filepath = str(out / f"{name}_{view}.png")
            bpy.ops.render.render(write_still=True)
    show({n for n in groups if n not in ("07_sneakers", "09_hat")})
    frame([body], scene, cam, pad=1.08)
    scene.render.filepath = str(out / "figure_front.png")
    bpy.ops.render.render(write_still=True)
    show({"07_sneakers", "09_hat"})
    scene.render.filepath = str(out / "figure_front_2.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", len(groups), "items ->", out)


if __name__ == "__main__":
    main()
