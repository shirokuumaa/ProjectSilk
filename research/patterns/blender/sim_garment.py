"""Drape a sewing pattern on a body with Blender cloth (the production path: no Warp, no SMPL).

Input is panels.json from pattern_to_panels.py (GarmentCode pattern, cm, Y up). Each panel is
triangulated in its own 2D plane with Blender's constrained Delaunay (mathutils.geometry), placed
in 3D by the pattern's rotation/translation, and stitches become loose "sewing" edges that Blender
cloth pulls shut (Cloth > Shape > Sewing). The body is a collision object. Gravity is off while
the seams close, then on.

--presew (week 2, day 8) — NOT WORKING (17.10.2026), kept as is; see README "Неделя 2, дни 8–9": no sewing springs. The panels are wrapped around the body, stitched points
welded into one vertex and the mesh relaxed to the flat pattern's edge lengths outside the body
(presew.py); Blender starts from that sewn, unstrained shape and gravity grows from 0 to 1 over
--gravity-ramp frames. Needs --body-seg (segmentation json, ggg_body_segmentation.json scheme).

Run:
  Blender -b --factory-startup --python sim_garment.py -- \
      --panels x.panels.json --body body.obj --out out_dir [--frames 120] [--sew-frames 40]
      [--self-collision] [--render] [--presew --body-seg seg.json --gravity-ramp 30]
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
    ap.add_argument("--coll-distance", type=float, default=0.002, help="cloth-object collision distance, m")
    ap.add_argument("--coll-quality", type=int, default=3)
    ap.add_argument("--body-thickness", type=float, default=0.003, help="body collision outer thickness, m")
    ap.add_argument("--friction", type=float, default=5.0, help="body friction for cloth")
    ap.add_argument("--trace", action="store_true", help="print the garment height range every 10 frames")
    ap.add_argument("--presew", action="store_true", help="wrap + weld + relax before the simulation")
    ap.add_argument("--body-seg", help="body segmentation json (for --presew)")
    ap.add_argument("--relax-iters", type=int, default=400)
    ap.add_argument("--weld", action="store_true", help="--presew: weld seams + relax (else: wrap only, "
                    "flat rest shape key, sewing springs close the remaining gaps)")
    ap.add_argument("--gravity-ramp", type=int, default=30, help="--presew: frames for gravity 0 -> 1")
    ap.add_argument("--clearance", type=float, default=0.6, help="--presew: cloth-body gap after relax, cm")
    ap.add_argument("--close-flat", action="store_true", help="--presew: flat panels moved along z next to the body")
    ap.add_argument("--no-wrap", action="store_true", help="--presew: start from GarmentCode's flat placement")
    ap.add_argument("--pin-sewing", action="store_true", help="pin anchor vertices while sewing (stage 1)")
    ap.add_argument("--weld-after", action="store_true", help="--presew without --weld: sew without gravity for "
                    "--sew-frames, then weld the closed seams and simulate --frames more with gravity")
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


def read_obj(path):
    """Vertices and triangles of an OBJ (fan-triangulated), as stored (no unit change)."""
    V, F = [], []
    for line in open(path):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            idx = [int(t.split("/")[0]) - 1 for t in line.split()[1:]]
            F += [[idx[0], idx[k], idx[k + 1]] for k in range(1, len(idx) - 1)]
    return V, F


def build_presewn(data, body_path, seg_path, a):
    """Flat panels -> wrapped, welded, relaxed mesh (GarmentCode cm, Y up) -> Blender object."""
    import numpy as np
    from mathutils.bvhtree import BVHTree
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import presew

    verts, faces, panel_of, index = [], [], [], {}
    names = list(data["panels"])
    for pid, name in enumerate(names):
        p = data["panels"][name]
        boundary = [Vector(v) for v in p["boundary"]]
        interior = [Vector(v) for v in p["interior"]]
        nb = len(boundary)
        out = delaunay_2d_cdt(boundary + interior, [], [list(range(nb))], 1, 1e-6)
        coords, tris, orig_verts = out[0], out[2], out[3]
        R, t = Matrix(p["R"]), Vector(p["t"])
        base = len(verts)
        for co in coords:
            verts.append(list(R @ Vector((co.x, co.y, 0.0)) + t))
            panel_of.append(pid)
        faces += [[base + i for i in f] for f in tris]
        for out_i, origs in enumerate(orig_verts):
            for o in origs:
                if o < nb:
                    index[(name, o)] = base + out_i
    pairs = [(index[(pa, ia_)], index[(pb, ib_)]) for (pa, ia), (pb, ib) in data["stitches"] for ia_, ib_ in zip(ia, ib)]
    flat, faces, panel_of = np.array(verts), np.array(faces), np.array(panel_of)

    bV, bF = read_obj(body_path)
    bV = np.array(bV)
    if np.ptp(bV[:, 1]) < 3.0:
        bV = bV * 100.0                                   # metres -> cm
    seg = {k: np.array(v, int) for k, v in json.load(open(seg_path)).items()}
    panels = {i: {"name": n, "front": data["panels"][n]["t"][2] > 0, "nz": abs(data["panels"][n]["R"][2][2])}
              for i, n in enumerate(names)}
    if a.close_flat:
        wrapped = presew.close_flat(flat, panel_of, panels, bV, seg)
    else:
        wrapped = flat.copy() if a.no_wrap else presew.wrap(flat, panel_of, panels, bV, seg, pairs)

    new, n = presew.weld(len(flat), faces, pairs)
    X0 = np.zeros((n, 3))
    np.add.at(X0, new, wrapped)
    X0 /= np.bincount(new, minlength=n)[:, None]
    E, L = presew.edges_with_rest(flat, faces, new)
    F = new[faces]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]

    bvh = BVHTree.FromPolygons([Vector(v) for v in bV], bF)
    top = Vector((0.0, float(bV[:, 1].max()) + 10.0, 0.0))
    loc, nrm, _, _ = bvh.find_nearest(top)
    flip = -1.0 if (top - loc).dot(nrm) < 0 else 1.0       # make normals point out of the body

    def push(X):
        for i in range(len(X)):
            p = Vector(X[i])
            loc, nrm, _, _ = bvh.find_nearest(p, 30.0)
            if loc is None:
                continue
            nrm = nrm * flip
            if (p - loc).dot(nrm) < a.clearance:
                X[i] = loc + nrm * a.clearance
        return X

    if not a.weld:
        pins = presew.anchors(flat, panel_of, panels, pairs, bV, seg) if a.pin_sewing else []
        return _wrapped_with_rest_key(flat, wrapped, faces, pairs, panel_of, a, push, pins)

    t0 = time.time()
    s0 = presew.strain(X0, E, L)
    X = presew.relax(push(X0.copy()), E, L, iters=a.relax_iters, push=push)
    info = {"welded_vertices": int(n), "flat_vertices": len(flat), "stitch_pairs": len(pairs), "edges": len(E),
            "strain_wrapped": s0, "strain_relaxed": presew.strain(X, E, L), "relax_s": round(time.time() - t0, 1)}

    mesh = bpy.data.meshes.new("garment")
    mesh.from_pydata([Vector(v) * CM for v in X], [], F.tolist())
    mesh.validate()
    obj = bpy.data.objects.new("garment", mesh)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = Y_UP_TO_Z_UP
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    return obj, info, (E, L)


def _wrapped_with_rest_key(flat, wrapped, faces, pairs, panel_of, a, push, pins=()):
    """Unwelded panels at their wrapped positions (pushed out of the body); rest shape key = flat pattern
    (exact rest lengths); stitches become sewing edges."""
    import numpy as np
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import presew
    X = push(wrapped.copy())
    E = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    E = np.unique(np.sort(E, 1), axis=0)
    L = np.linalg.norm(flat[E[:, 0]] - flat[E[:, 1]], axis=1)
    gaps = np.array([np.linalg.norm(X[i] - X[j]) for i, j in pairs])
    info = {"flat_vertices": len(flat), "stitch_pairs": len(pairs), "strain_wrapped": presew.strain(X, E, L),
            "seam_gap_start_cm": {"median": float(np.median(gaps)), "p95": float(np.percentile(gaps, 95)),
                                  "max": float(gaps.max())}}
    mesh = bpy.data.meshes.new("garment")
    mesh.from_pydata([Vector(v) * CM for v in X], [tuple(p) for p in pairs], faces.tolist())
    mesh.validate()
    obj = bpy.data.objects.new("garment", mesh)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = Y_UP_TO_Z_UP
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    obj.select_set(False)
    obj.shape_key_add(name="Basis")
    key = obj.shape_key_add(name="flat")
    key.value = 0.0                    # Blender 5 creates new keys at 1.0: the cloth would start flat
    for i, v in enumerate(flat):
        key.data[i].co = Y_UP_TO_Z_UP @ (Vector(v) * CM)
    obj["rest_key"] = "flat"
    if len(pins):
        vg = obj.vertex_groups.new(name="pin")
        vg.add([int(i) for i in pins], 1.0, "REPLACE")
        info["pinned_vertices"] = len(pins)
    obj["n_sew"] = len(pairs)
    return obj, info, (E, L)


def weld_sewn(garment, a):
    """Stage 2: the sewn shape (evaluated) -> new mesh with every stitched pair merged; rest = that shape."""
    import numpy as np
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import presew
    dg = bpy.context.evaluated_depsgraph_get()
    ev = garment.evaluated_get(dg).data
    X = np.array([list(v.co) for v in ev.vertices])
    me = garment.data
    pairs = [(e.vertices[0], e.vertices[1]) for e in me.edges]
    faces = np.array([list(p.vertices) for p in me.polygons])
    face_edges = {tuple(sorted(e)) for f in faces for e in ((f[0], f[1]), (f[1], f[2]), (f[2], f[0]))}
    sew = [p for p in pairs if tuple(sorted(p)) not in face_edges]
    gaps = np.array([np.linalg.norm(X[i] - X[j]) for i, j in sew]) / CM
    new, n = presew.weld(len(X), faces, sew)
    Xw = np.zeros((n, 3))
    np.add.at(Xw, new, X)
    Xw /= np.bincount(new, minlength=n)[:, None]
    F = new[faces]
    F = F[(F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])]
    name = garment.name
    bpy.data.objects.remove(garment)
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([Vector(v) for v in Xw], [], F.tolist())
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    info = {"seam_gap_before_weld_cm": {"median": float(np.median(gaps)), "p95": float(np.percentile(gaps, 95)),
                                        "max": float(gaps.max())}, "welded_vertices": int(n)}
    return obj, info, new


def setup_cloth(garment, body, a):
    if not a.no_collision and "Collision" not in body.modifiers:
        body.modifiers.new("Collision", "COLLISION")
        body.collision.thickness_outer = a.body_thickness
        body.collision.cloth_friction = a.friction

    cloth = garment.modifiers.new("Cloth", "CLOTH")
    s = cloth.settings
    s.quality = a.quality
    s.mass = 0.15                      # kg/m^2-ish per vertex mass, light woven fabric
    s.tension_stiffness = 15.0
    s.compression_stiffness = a.compression
    s.shear_stiffness = 5.0
    s.bending_stiffness = a.bending
    s.air_damping = a.damping
    if "pin" in garment.vertex_groups and not getattr(a, "_stage2", False):
        s.vertex_group_mass = "pin"     # anchors hold the garment in place while the seams close
    if "rest_key" in garment:          # rest lengths from the flat pattern, start from the wrapped shape
        s.rest_shape_key = garment.data.shape_keys.key_blocks[garment["rest_key"]]
    s.use_sewing_springs = a.sew_force > 0
    s.sewing_force_max = a.sew_force
    c = cloth.collision_settings
    c.distance_min = a.coll_distance
    c.collision_quality = a.coll_quality
    c.use_self_collision = a.self_collision
    c.self_distance_min = 0.002
    cache = cloth.point_cache
    cache.frame_start, cache.frame_end = 1, a.frames
    ew = s.effector_weights
    ew.gravity = 0.0
    ew.keyframe_insert("gravity", frame=1)
    if a.presew:                       # gravity grows gradually: after the seams close when not welded
        start = 1 if (a.weld or getattr(a, "_stage2", False)) else a.sew_frames
        ew.keyframe_insert("gravity", frame=start)
        ew.gravity = 1.0
        ew.keyframe_insert("gravity", frame=start + a.gravity_ramp)
    else:                              # gravity off while seams close, then on
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
    presew_info, rest = {}, None
    if a.presew:
        if a.weld:
            a.sew_force = 0.0
        garment, presew_info, rest = build_presewn(json.load(open(a.panels)), a.body, a.body_seg, a)
        n_sew = int(garment.get("n_sew", 0))
    else:
        garment, n_sew = build_garment(json.load(open(a.panels)))
    export(garment, out / "garment_start.obj", evaluated=False)
    setup_cloth(garment, body, a)
    t_build = time.time() - t0

    stage1 = {}
    if a.presew and a.weld_after and not a.weld:
        ts = time.time()
        frames = a.frames
        a.frames = a.sew_frames
        garment.modifiers["Cloth"].point_cache.frame_end = a.sew_frames
        for f in range(1, a.sew_frames + 1):
            scene.frame_set(f)
        E_flat, L_flat = rest
        garment, winfo, new = weld_sewn(garment, a)
        export(garment, out / "garment_sewn.obj", evaluated=False)
        # strain of the welded edges against the flat pattern
        import numpy as np
        Ew = np.sort(new[E_flat], 1)
        keep = Ew[:, 0] != Ew[:, 1]
        rest = (Ew[keep], L_flat[keep])
        a.frames, a._stage2, a.sew_force = frames, True, 0.0
        scene.frame_set(1)
        setup_cloth(garment, body, a)
        stage1 = {"sew_s": round(time.time() - ts, 1), **winfo}

    t1 = time.time()
    frame_times = []
    for f in range(1, a.frames + 1):
        tf = time.time()
        scene.frame_set(f)
        frame_times.append(time.time() - tf)
        if a.trace and f % 10 == 0:
            ev = garment.evaluated_get(bpy.context.evaluated_depsgraph_get()).data
            zs = [v.co.z for v in ev.vertices]
            print(f"TRACE frame {f}: z {min(zs):.3f}..{max(zs):.3f}", flush=True)
    t_sim = time.time() - t1

    export(garment, out / "garment_sim.obj", evaluated=True)
    stats = {
        "panels": a.panels, "body": a.body, "frames": a.frames, "sew_frames": a.sew_frames,
        "quality": a.quality, "self_collision": a.self_collision, "sew_force": a.sew_force,
        "compression": a.compression, "bending": a.bending, "damping": a.damping,
        "vertices": len(garment.data.vertices), "triangles": len(garment.data.polygons),
        "sewing_edges": n_sew, "build_s": round(t_build, 2), "sim_s": round(t_sim, 2),
        "s_per_frame": round(t_sim / a.frames, 3), "slowest_frame_s": round(max(frame_times), 3),
        "blender": bpy.app.version_string, "presew": presew_info, "stage1": stage1,
    }
    if rest is not None:               # strain of the draped garment against the flat pattern
        import numpy as np
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import presew
        dg = bpy.context.evaluated_depsgraph_get()
        ev = garment.evaluated_get(dg).data
        Xs = np.array([list(Y_UP_TO_Z_UP.inverted() @ v.co) for v in ev.vertices]) / CM
        stats["strain_draped"] = presew.strain(Xs, *rest)
    if a.render:
        render(out, garment, body)
    (out / "sim_stats.json").write_text(json.dumps(stats, indent=2))
    print("SIM_STATS", json.dumps(stats))


if __name__ == "__main__":
    main()
