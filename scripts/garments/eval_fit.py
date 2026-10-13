# scripts/garments/eval_fit.py
#
# Метрики и картинки подгонки одежды (Blender в фоне):
#   Blender -b --python-exit-code 1 --python scripts/garments/eval_fit.py
# Берёт прогон из scripts/garments/out/runs/ (его пишет
# client/src/utils/garmentFit.harness.test.js) и считает для каждой вещи на каждой фигуре:
#
#   inside_pct     — доля вершин вещи внутри торса или ног глубже 2 мм;
#   inside_arm_pct — то же под кожей рук (боковина под прижатой рукой: рука её закрывает);
#   skin_pct       — доля точек кожи под вещью, где ткань ушла под кожу (кожа «проступает»):
#                    луч от кожи наружу ткань не встречает, а внутрь — встречает; кожа рук
#                    не считается (кисть у бедра «видит» вещь внутрь — ложная тревога);
#   girth_err_*    — обхват ткани минус ожидаемый (см) на уровнях груди/талии/бёдер;
#                    ожидаемый = max(обхват размера + 2π·припуск кроя, обхват тела + 2π·толщина ткани);
#   ref_mean/p95   — среднее и 95% расстояние до посадки MakeHuman на той же фигуре (см);
#   flips, stretch — перевёрнутые треугольники и рёбра, растянутые больше чем вдвое.
#
# Пишет out/fit_report.md, out/fit_metrics.json и листы out/fit_<вещь>.png,
# out/sections_<вещь>.png (см. «картинки» ниже). Только листы, без метрик:
#   Blender -b --python-exit-code 1 --python scripts/garments/eval_fit.py -- --sheets

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "avatar"))
sys.path.insert(0, HERE)
import config  # noqa: E402  (scripts/avatar/config.py)
import garment_config as gc  # noqa: E402
import glb  # noqa: E402
import measure  # noqa: E402

RUNS = gc.OUT_DIR / "runs"
EASE_BY_FIT = {"tight": 0.004, "regular": 0.010, "loose": 0.022}   # как в client/src/utils/garmentDrape.js
FABRIC_GAP = 0.003
FIGURES = ["petite", "small", "medium", "large"]
SHEETS_ONLY = "--sheets" in sys.argv     # … --python eval_fit.py -- --sheets: только картинки
SHEET_ITEMS = ["dress", "tee", "blouse", "jeans", "leggings", "skirt", "croptop", "shorts"]

BODY_COLOR = (0.82, 0.70, 0.60)
TEXT_COLOR = (0.15, 0.15, 0.15)


def log(*args):
    print("[fit]", *args, flush=True)


def load_runs():
    meta = json.loads((RUNS / "meta.json").read_text())
    return meta


def read_bin(path, dtype, width):
    return np.fromfile(path, dtype=dtype).reshape(-1, width) if width > 1 else np.fromfile(path, dtype=dtype)


def vertex_normals(co, tris):
    n = np.zeros_like(co)
    f = np.cross(co[tris[:, 1]] - co[tris[:, 0]], co[tris[:, 2]] - co[tris[:, 0]])
    for k in range(3):
        np.add.at(n, tris[:, k], f)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)


def bvh(co, tris):
    return BVHTree.FromPolygons([Vector(p) for p in co], [tuple(map(int, t)) for t in tris], all_triangles=True)


def section_points(co, tris, y):
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    out = []
    for p, q in ((a, b), (b, c), (c, a)):
        s = (p[:, 1] - y) * (q[:, 1] - y) < 0
        t = (y - p[s, 1]) / (q[s, 1] - p[s, 1])
        out.append((p[s] + (q[s] - p[s]) * t[:, None])[:, [0, 2]])
    return np.concatenate(out) if out else np.empty((0, 2))


def girth_at(co, tris, y, keep=None):
    pts = section_points(co, tris, y)
    if keep is not None and len(pts):
        pts = pts[keep(pts)]
    h = measure.hull(pts) if len(pts) >= 3 else np.empty((0, 2))
    return measure.perimeter(h), h


def body_for(body, controls):
    u = np.array([controls.get(c, 0.0) for c in config.CONTROL_NAMES])
    co = body.coords(u)
    crotch_y, nipple_y = body._levels(co)
    span = nipple_y - crotch_y
    levels = {"chest": nipple_y, "waist": crotch_y + body.waist_level * span, "hips": crotch_y + body.hip_level * span,
              "crotch": crotch_y}
    return co, levels


def metrics(run, body_co, skin_mask, arm_tri, torso_tris, body_tree, body_normals, levels, placed, draped, tris):
    out = {}
    # 1. вершины ткани внутри тела (отдельно — под кожей рук)
    inside = inside_arm = 0
    for p in draped:
        loc, nrm, face, dist = body_tree.find_nearest(Vector(p))
        if loc is not None and (Vector(p) - loc).dot(nrm) < 0 and dist > 0.002:
            if arm_tri[face]:
                inside_arm += 1
            else:
                inside += 1
    out["inside_pct"] = 100.0 * inside / len(draped)
    out["inside_arm_pct"] = 100.0 * inside_arm / len(draped)

    # 2. кожа проступает: луч от кожи наружу ткань не встречает, внутрь — встречает
    g_tree = bvh(draped, tris)
    covered = through = 0
    ylo, yhi = draped[:, 1].min(), draped[:, 1].max()
    for p, n in zip(body_co[skin_mask], body_normals[skin_mask]):
        if p[1] < ylo or p[1] > yhi:
            continue
        o = Vector(p + n * 0.0005)
        out_hit = g_tree.ray_cast(o, Vector(n), 0.08)[0] is not None
        in_hit = g_tree.ray_cast(o, Vector(-n), 0.03)[0] is not None
        if out_hit or in_hit:
            covered += 1
            if in_hit and not out_hit:
                through += 1
    out["skin_pct"] = 100.0 * through / max(covered, 1)

    # 3. обхват ткани против ожидаемого на уровнях обмеров
    ease = EASE_BY_FIT.get(run["fit"], EASE_BY_FIT["regular"])
    row = run["sizeRow"] or {}
    for key in ("chest", "waist", "hips"):
        if not row.get(key):
            continue
        y = levels[key]
        if y < ylo + 0.01 or y > yhi - 0.01:
            continue
        b_girth, b_hull = girth_at(body_co, torso_tris, y)
        if not b_girth:
            continue
        cx = b_hull[:, 0].mean()
        half = (b_hull[:, 0].max() - b_hull[:, 0].min()) / 2
        g_girth, _ = girth_at(draped, tris, y, keep=lambda pts: np.abs(pts[:, 0] - cx) < half + 0.05)
        expected = max(row[key] / 100.0 + 2 * math.pi * ease, b_girth + 2 * math.pi * FABRIC_GAP)
        out[f"girth_err_{key}"] = (g_girth - expected) * 100
        out[f"girth_{key}"] = g_girth * 100
        out[f"expected_{key}"] = expected * 100

    # 5. артефакты: перевёрнутые треугольники, рёбра длиннее вдвое
    def face_n(co):
        return np.cross(co[tris[:, 1]] - co[tris[:, 0]], co[tris[:, 2]] - co[tris[:, 0]])
    fa, fb = face_n(placed), face_n(draped)
    valid = (np.linalg.norm(fa, axis=1) > 1e-12) & (np.linalg.norm(fb, axis=1) > 1e-12)
    out["flips"] = int(((fa * fb).sum(1) < 0)[valid].sum())
    e = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    la = np.linalg.norm(placed[e[:, 0]] - placed[e[:, 1]], axis=1)
    lb = np.linalg.norm(draped[e[:, 0]] - draped[e[:, 1]], axis=1)
    ok = la > 1e-6
    out["stretch_pct"] = 100.0 * float((lb[ok] / la[ok] > 2.0).mean())
    return out


def ref_distance(draped, ref):
    """Среднее и 95% расстояние от вершин ткани до ближайших точек посадки MakeHuman, см."""
    d = np.empty(len(draped))
    for i in range(0, len(draped), 512):
        chunk = draped[i:i + 512]
        d[i:i + 512] = np.sqrt(((chunk[:, None, :] - ref[None, :, :]) ** 2).sum(-1)).min(1)
    return float(d.mean() * 100), float(np.percentile(d, 95) * 100)


# ── картинки ────────────────────────────────────────────────────
#
# Листы fit_<вещь>.png: крупно зона вещи; строки — фигуры, столбцы — S и L
# спереди, S и L сбоку; S синим, L оранжевым. Листы sections_<вещь>.png:
# горизонтальные сечения на уровнях груди, талии и бёдер — тело, S и L одним
# рисунком (перед — внизу), с обхватами в подписи.

S_COLOR = (0.22, 0.42, 0.80)
L_COLOR = (0.92, 0.55, 0.18)
SIZE_COLORS = {"S": S_COLOR, "L": L_COLOR}
PX_PER_M = 500
CELLS_DIR = gc.OUT_DIR / "cells"


def to_blender(co):
    return np.stack([co[:, 0], -co[:, 2], co[:, 1]], axis=-1)


def clear_scene():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in (bpy.data.meshes, bpy.data.curves, bpy.data.cameras):
        for item in list(block):
            block.remove(item)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light, sh.color_type, sh.show_cavity = "STUDIO", "OBJECT", True
    scene.world.color = (1, 1, 1)
    scene.view_settings.view_transform = "Standard"


def add_mesh(name, verts, faces, color, location=(0, 0, 0), rot_z=0.0, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(np.asarray(verts).tolist(), [], np.asarray(faces).tolist())
    mesh.polygons.foreach_set("use_smooth", [smooth] * len(mesh.polygons))
    obj = bpy.data.objects.new(name, mesh)
    obj.color = (*color, 1)
    obj.rotation_euler = (0, 0, rot_z)
    obj.location = location
    bpy.context.scene.collection.objects.link(obj)


def add_text(text, location, size, facing_front=True, align="CENTER"):
    curve = bpy.data.curves.new("label", "FONT")
    curve.body = text
    curve.size = size
    curve.align_x = align
    obj = bpy.data.objects.new("label", curve)
    obj.rotation_euler = (math.pi / 2, 0, 0) if facing_front else (0, 0, 0)
    obj.location = location
    obj.color = (*TEXT_COLOR, 1)
    bpy.context.scene.collection.objects.link(obj)


def render_window(path, x0, x1, v0, v1, top=False):
    """Ортокамера на окно [x0, x1] × [v0, v1]: спереди (v — высота) или сверху (v — Y)."""
    scene = bpy.context.scene
    cam = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(x1 - x0, v1 - v0)
    if top:
        cam.location, cam.rotation_euler = ((x0 + x1) / 2, (v0 + v1) / 2, 10), (0, 0, 0)
    else:
        cam.location, cam.rotation_euler = ((x0 + x1) / 2, -10, (v0 + v1) / 2), (math.pi / 2, 0, 0)
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = max(1, int(round((x1 - x0) * PX_PER_M)))
    scene.render.resolution_y = max(1, int(round((v1 - v0) * PX_PER_M)))
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def load_png(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1]          # строки сверху вниз


def save_png(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new("sheet", w, h)
    img.pixels.foreach_set(np.ascontiguousarray(arr[::-1], dtype=np.float32).ravel())
    img.filepath_raw = str(path)
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def compose(grid, path, pad=16):
    """grid — строки картинок (сверху вниз); столбцы выравниваются по самой широкой."""
    widths = [max(row[c].shape[1] for row in grid) for c in range(len(grid[0]))]
    heights = [max(im.shape[0] for im in row) for row in grid]
    sheet = np.ones((sum(heights) + pad * (len(grid) + 1), sum(widths) + pad * (len(widths) + 1), 4), np.float32)
    y = pad
    for row, h in zip(grid, heights):
        x = pad
        for im, w in zip(row, widths):
            sheet[y:y + im.shape[0], x + (w - im.shape[1]) // 2:x + (w - im.shape[1]) // 2 + im.shape[1]] = im
            x += w + pad
        y += h + pad
    save_png(sheet, path)
    log("wrote", path)


def fit_sheet(item, figures, body_tris, g_tris, path):
    """figures: [(name, body_co, {size: draped})]; столбцы: S и L спереди, S и L сбоку."""
    CELLS_DIR.mkdir(parents=True, exist_ok=True)
    grid = []
    for fig, body_co, draped in figures:
        both = np.concatenate(list(draped.values()))
        m = 0.06
        y0, y1 = both[:, 1].min() - m, both[:, 1].max() + m + 0.05
        row = []
        for size, side in (("S", False), ("L", False), ("S", True), ("L", True)):
            h = both[:, 2] if side else both[:, 0]
            x0, x1 = h.min() - m, h.max() + m
            clear_scene()
            rot = math.pi / 2 if side else 0.0
            add_mesh("body", to_blender(body_co), body_tris, BODY_COLOR, rot_z=rot)
            add_mesh("garment", to_blender(draped[size]), g_tris, SIZE_COLORS[size], rot_z=rot)
            # подпись на белой плашке поверх тела
            add_mesh("plate", [(x0, -0.55, y1 - 0.055), (x1, -0.55, y1 - 0.055), (x1, -0.55, y1), (x0, -0.55, y1)],
                     [(0, 1, 2, 3)], (1, 1, 1), smooth=False)
            add_text(f"{fig} · {size}{' · side' if side else ''}", ((x0 + x1) / 2, -0.6, y1 - 0.04), 0.03)
            cell = CELLS_DIR / f"{item}__{fig}__{size}{'_side' if side else ''}.png"
            render_window(cell, x0, x1, y0, y1)
            row.append(load_png(cell))
        grid.append(row)
    compose(grid, path)


def ribbon(poly, width):
    """Замкнутая ломаная в плоскости XY → полоска из четырёхугольников."""
    n = len(poly)
    verts, faces = [], []
    for i in range(n):
        t = poly[(i + 1) % n] - poly[i - 1]
        t = t / max(np.linalg.norm(t), 1e-9)
        nrm = np.array([t[1], -t[0]]) * width / 2
        verts += [(*(poly[i] - nrm), 0.0), (*(poly[i] + nrm), 0.0)]
        faces.append((2 * i, 2 * ((i + 1) % n), 2 * ((i + 1) % n) + 1, 2 * i + 1))
    return verts, faces


def sections_sheet(item, rows, path):
    """rows: [(фигура, [(уровень, тело, {размер: сечение}, {подпись: обхват})])] — сечения в XY (Blender)."""
    clear_scene()
    STEP = 0.62
    cols = max(len(cells) for _, cells in rows)
    for r, (fig, cells) in enumerate(rows):
        for c, (level, body_poly, garments, girths) in enumerate(cells):
            ox, oy = c * STEP, -r * STEP
            if len(body_poly) >= 3:
                verts = [(ox + x, oy + y, 0.0) for x, y in body_poly]
                add_mesh("body", verts, [list(range(len(verts)))], BODY_COLOR, smooth=False)
            for k, (size, poly) in enumerate(garments.items()):
                if len(poly) >= 3:
                    verts, faces = ribbon(poly, 0.005)
                    verts = [(ox + x, oy + y, 0.002 * (k + 1)) for x, y, _ in verts]
                    add_mesh(size, verts, faces, SIZE_COLORS[size], smooth=False)
            text = f"{fig} · {level}\nbody {girths['body']:.0f}"
            for size in garments:
                text += f" · {size} {girths[size]:.0f}"
            add_text(text + " cm", (ox, oy - 0.235, 0.01), 0.024, facing_front=False)
    x0, x1 = -STEP / 2, (cols - 0.5) * STEP
    y0, y1 = -(len(rows) - 0.5) * STEP, STEP / 2
    render_window(path, x0, x1, y0, y1, top=True)
    log("wrote", path)


def main():
    meta = load_runs()
    info = json.loads(config.BUILD_INFO_PATH.read_text())
    body = measure.Body(glb.load_body(config.GLB_PATH), info["landmarks"])
    tris_all = body.tris
    skin_mask = np.zeros(len(body.base), bool)          # кожа торса и ног, без рук
    skin_mask[body.torso_tris.ravel()] = True
    arm_tri = ~skin_mask[tris_all].all(1)               # грани, задевающие кожу рук
    bodies = {}
    for fig in FIGURES:
        co, levels = body_for(body, meta["figures"][fig]["controls"])
        bodies[fig] = (co, levels, bvh(co, tris_all), vertex_normals(co, tris_all))

    results = []
    for run in ([] if SHEETS_ONLY else meta["runs"]):
        if run["kind"] != "base":
            continue
        name = run["name"]
        placed = read_bin(RUNS / f"{name}.placed.bin", np.float32, 3).astype(np.float64)
        draped = read_bin(RUNS / f"{name}.draped.bin", np.float32, 3).astype(np.float64)
        tris = read_bin(RUNS / f"{run['item']}__{run['variant']}.index.bin", np.uint32, 1).reshape(-1, 3).astype(np.int64)
        co, levels, tree, normals = bodies[run["figure"]]
        m = metrics(run, co, skin_mask, arm_tri, body.torso_tris, tree, normals, levels, placed, draped, tris)
        ref_path = gc.OUT_DIR / "ref" / f"{run['figure']}__{run['item']}.npy"
        if ref_path.exists():
            m["ref_mean"], m["ref_p95"] = ref_distance(draped, np.load(ref_path).astype(np.float64))
        m.update({k: run[k] for k in ("figure", "item", "variant", "size", "ms", "vertices", "legsDetected", "legsHint")})
        results.append(m)
        log(name, {k: round(v, 2) if isinstance(v, float) else v for k, v in m.items() if k not in ("figure", "item", "variant", "size")})

    if not SHEETS_ONLY:
        (gc.OUT_DIR / "fit_metrics.json").write_text(json.dumps(results, indent=1))
        write_report(results, meta)

    # листы (вариант «как от продавца»): крупно S и L спереди и сбоку, и сечения
    for item in SHEET_ITEMS:
        variant = "seller"
        tris = read_bin(RUNS / f"{item}__{variant}.index.bin", np.uint32, 1).reshape(-1, 3).astype(np.int64)
        figures, rows = [], []
        for fig in FIGURES:
            co, levels = bodies[fig][0], bodies[fig][1]
            draped = {size: read_bin(RUNS / f"{fig}__{item}__{variant}__{size}.draped.bin", np.float32, 3).astype(np.float64)
                      for size in ("S", "L")}
            figures.append((fig, co, draped))
            cells = []
            ylo = max(d[:, 1].min() for d in draped.values()) + 0.01
            yhi = min(d[:, 1].max() for d in draped.values()) - 0.01
            for level in ("chest", "waist", "hips"):
                y = levels[level]
                if not ylo <= y <= yhi:
                    continue
                b_girth, b_hull = girth_at(co, body.torso_tris, y)
                if not b_girth:
                    continue
                cx, cz = b_hull[:, 0].mean(), b_hull[:, 1].mean()
                half = (b_hull[:, 0].max() - b_hull[:, 0].min()) / 2
                to_xy = lambda h: np.stack([h[:, 0] - cx, -(h[:, 1] - cz)], axis=-1) if len(h) else h
                garments, girths = {}, {"body": b_girth * 100}
                for size, d in draped.items():
                    g, h = girth_at(d, tris, y, keep=lambda pts: np.abs(pts[:, 0] - cx) < half + 0.05)
                    garments[size], girths[size] = to_xy(h), g * 100
                cells.append((level, to_xy(b_hull), garments, girths))
            if cells:
                rows.append((fig, cells))
        fit_sheet(item, figures, tris_all, tris, gc.OUT_DIR / f"fit_{item}.png")
        if rows:
            sections_sheet(item, rows, gc.OUT_DIR / f"sections_{item}.png")


def write_report(results, meta):
    cols = ["item", "variant", "figure", "size", "inside_pct", "inside_arm_pct", "skin_pct", "girth_err_chest", "girth_err_waist",
            "girth_err_hips", "ref_mean", "flips", "stretch_pct", "ms"]
    lines = ["# Garment fit on the base avatar", "",
             "Body shape build, ms: " + ", ".join(f"{k} {v['buildMs']:.0f}" for k, v in meta["figures"].items() if v["buildMs"]),
             "", "| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    for r in sorted(results, key=lambda r: (r["item"], r["variant"], FIGURES.index(r["figure"]), r["size"])):
        cells = []
        for c in cols:
            v = r.get(c)
            cells.append("—" if v is None else f"{v:+.1f}" if c.startswith("girth_err") else f"{v:.1f}" if isinstance(v, float) else str(v))
        lines.append("| " + " | ".join(cells) + " |")
    (gc.OUT_DIR / "fit_report.md").write_text("\n".join(lines) + "\n")
    log("wrote", gc.OUT_DIR / "fit_report.md")


if __name__ == "__main__":
    main()
