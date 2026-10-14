"""Drape a sewing pattern on a body with Blender cloth (the production path: no Warp, no SMPL).

Input is panels.json from pattern_to_panels.py (GarmentCode pattern, cm, Y up). Each panel is
triangulated in its own 2D plane with Blender's constrained Delaunay (mathutils.geometry), placed
in 3D by the pattern's rotation/translation, and stitches become loose "sewing" edges that Blender
cloth pulls shut (Cloth > Shape > Sewing). The body is a collision object. Gravity is off while
the seams close, then on.

Run:
  Blender -b --factory-startup --python sim_garment.py -- \
      --panels x.panels.json --body body.obj --out out_dir [--frames 120] [--sew-frames 40]
      [--self-collision] [--render]
Writes out_dir/garment_sim.obj (cm, Y up — same frame as GarmentCode/GarmentCodeData),
out_dir/garment_start.obj, out_dir/sim_stats.json and, with --render, front/side PNGs.
"""
import argparse
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import delaunay_2d_cdt

CM = 0.01  # GarmentCode units (cm) -> Blender metres
# GarmentCode is Y-up; Blender is Z-up. Same mapping as the OBJ importer (forward -Z, up Y).
Y_UP_TO_Z_UP = Matrix.Rotation(math.radians(90), 4, "X")


def args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--panels", required=True)
    ap.add_argument("--body", required=True, help=".obj or .ply, Y up, metres or cm (detected by height)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--frames", type=int, default=120)
    ap.add_argument("--sew-frames", type=int, default=40, help="frames without gravity while seams close")
    ap.add_argument("--quality", type=int, default=8, help="cloth solver steps per frame")
    ap.add_argument("--self-collision", action="store_true")
    ap.add_argument("--sew-force", type=float, default=20.0, help="max sewing force; 0 = no sewing")
    ap.add_argument("--compression", type=float, default=15.0)
    ap.add_argument("--bending", type=float, default=0.05)
    ap.add_argument("--damping", type=float, default=1.0, help="air damping")
    ap.add_argument("--render", action="store_true")
    ap.add_argument("--no-collision", action="store_true", help="debug: body does not collide")
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return ap.parse_args(argv)


def import_mesh(path):
    before = set(bpy.data.objects)
    if path.endswith(".ply"):
        bpy.ops.wm.ply_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    else:
        bpy.ops.wm.obj_import(filepath=path, forward_axis="NEGATIVE_Z", up_axis="Y")
    obj = (set(bpy.data.objects) - before).pop()
    # GarmentCode bodies come in metres (mean_all.obj is 1.72 high), dataset garments in cm.
    unit = CM if obj.dimensions.z > 3.0 else 1.0
    obj.scale = (unit, unit, unit)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj


def build_garment(data):
    """One mesh with all panels; returns (object, number of sewing edges)."""
    verts, faces, sew = [], [], []
    index = {}  # (panel, boundary idx) -> global vertex
    for name, p in data["panels"].items():
        boundary = [Vector(v) for v in p["boundary"]]
        interior = [Vector(v) for v in p["interior"]]
        nb = len(boundary)
        out = delaunay_2d_cdt(boundary + interior, [], [list(range(nb))], 1, 1e-6)
        coords, _, tris, orig_verts = out[0], out[1], out[2], out[3]
        R, t = Matrix(p["R"]), Vector(p["t"])
        base = len(verts)
        for co in coords:
            verts.append(R @ Vector((co.x, co.y, 0.0)) + t)
        faces += [[base + i for i in f] for f in tris]
        for out_i, origs in enumerate(orig_verts):
            for o in origs:
                if o < nb:
                    index[(name, o)] = base + out_i
    for (pa, ia), (pb, ib) in data["stitches"]:
        for a, b in zip(ia, ib):
            va, vb = index[(pa, a)], index[(pb, b)]
            if va != vb:
                sew.append((va, vb))

    mesh = bpy.data.meshes.new("garment")
    mesh.from_pydata([v * CM for v in verts], sew, faces)
    mesh.validate()
    obj = bpy.data.objects.new("garment", mesh)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = Y_UP_TO_Z_UP
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj, len(sew)


def setup_cloth(garment, body, a):
    if not a.no_collision:
        body.modifiers.new("Collision", "COLLISION")
        body.collision.thickness_outer = 0.003
        body.collision.cloth_friction = 5.0

    cloth = garment.modifiers.new("Cloth", "CLOTH")
    s = cloth.settings
    s.quality = a.quality
    s.mass = 0.15                      # kg/m^2-ish per vertex mass, light woven fabric
    s.tension_stiffness = 15.0
    s.compression_stiffness = a.compression
    s.shear_stiffness = 5.0
    s.bending_stiffness = a.bending
    s.air_damping = a.damping
    s.use_sewing_springs = a.sew_force > 0
    s.sewing_force_max = a.sew_force
    c = cloth.collision_settings
    c.distance_min = 0.002
    c.collision_quality = 3
    c.use_self_collision = a.self_collision
    c.self_distance_min = 0.002
    cache = cloth.point_cache
    cache.frame_start, cache.frame_end = 1, a.frames
    # gravity off while seams close, then on
    ew = s.effector_weights
    ew.gravity = 0.0
    ew.keyframe_insert("gravity", frame=1)
    ew.keyframe_insert("gravity", frame=a.sew_frames)
    ew.gravity = 1.0
    ew.keyframe_insert("gravity", frame=a.sew_frames + 10)
    return cloth


def export(obj, path, evaluated):
    dg = bpy.context.evaluated_depsgraph_get()
    src = obj.evaluated_get(dg) if evaluated else obj
    me = bpy.data.meshes.new_from_object(src, depsgraph=dg) if evaluated else src.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")  # sewing edges (their vertices stay: they belong to faces)
    bm.to_mesh(me)
    bm.free()
    tmp = bpy.data.objects.new("export", me)
    bpy.context.collection.objects.link(tmp)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    tmp.select_set(True)
    bpy.ops.wm.obj_export(filepath=str(path), export_selected_objects=True, global_scale=100.0,
                          forward_axis="NEGATIVE_Z", up_axis="Y", export_materials=False, export_uv=False)
    bpy.data.objects.remove(tmp)


def render(out, garment, body):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "OBJECT"
    garment.color = (0.35, 0.55, 0.85, 1)
    body.color = (0.85, 0.75, 0.68, 1)
    scene.render.resolution_x, scene.render.resolution_y = 600, 900
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 2.0
    for name, ang in (("front", 0), ("side", 90)):
        r = math.radians(ang)
        cam.location = (3.5 * math.sin(r), -3.5 * math.cos(r), 0.95)
        cam.rotation_euler = (math.radians(90), 0, r)
        scene.render.filepath = str(out / f"render_{name}.png")
        bpy.ops.render.render(write_still=True)


def main():
    a = args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 1, a.frames

    t0 = time.time()
    body = import_mesh(a.body)
    garment, n_sew = build_garment(json.load(open(a.panels)))
    export(garment, out / "garment_start.obj", evaluated=False)
    setup_cloth(garment, body, a)
    t_build = time.time() - t0

    t1 = time.time()
    frame_times = []
    for f in range(1, a.frames + 1):
        tf = time.time()
        scene.frame_set(f)
        frame_times.append(time.time() - tf)
    t_sim = time.time() - t1

    export(garment, out / "garment_sim.obj", evaluated=True)
    stats = {
        "panels": a.panels, "body": a.body, "frames": a.frames, "sew_frames": a.sew_frames,
        "quality": a.quality, "self_collision": a.self_collision, "sew_force": a.sew_force,
        "compression": a.compression, "bending": a.bending, "damping": a.damping,
        "vertices": len(garment.data.vertices), "triangles": len(garment.data.polygons),
        "sewing_edges": n_sew, "build_s": round(t_build, 2), "sim_s": round(t_sim, 2),
        "s_per_frame": round(t_sim / a.frames, 3), "slowest_frame_s": round(max(frame_times), 3),
        "blender": bpy.app.version_string,
    }
    if a.render:
        render(out, garment, body)
    (out / "sim_stats.json").write_text(json.dumps(stats, indent=2))
    print("SIM_STATS", json.dumps(stats))


if __name__ == "__main__":
    main()
