"""Generated accessory models (TRELLIS.2) → models for the try-on, in the system of
client/src/utils/accessoryPlacement.js: Y up, +Z the face seen when worn, metres, centred, ~1 MB.

  - keeps what is worn: one of a pair (earrings, shoes), the pendant of a necklace (the chain is drawn
    by the try-on), the buckle of a belt (the strap is a ribbon), the hat without the mannequin;
  - turns the item by its kind: shoes toe forward (+Z) and sole down, a bag upright with its handle
    up, flat items (earrings, pendant, buckle) facing +Z, glasses with the frame in front;
  - scales it to the product card (cm) and centres its box at the origin;
  - decimates to --faces triangles, textures to --texture px (WebP).

Glasses keep their see-through lenses (alpha of the base colour, alphaMode BLEND).

Run (Blender 4.2+ / 5.x, light — no GPU):
  blender -b --factory-startup --python scripts/accessories/prepare_models.py -- \
      --src research/accessories/runs/session1/trellis2 --out client/public/models/demo-accessories
Reads <src>/<item>_1024_cascade.glb for every item of ITEMS, writes <out>/<item>.glb and <out>/prepared.json.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

# товар → вид и карточка (см), как их ввёл бы продавец; карточка — и масштаб модели
ITEMS = {
    "01_earrings": {"kind": "earrings", "card": {"lengthCm": 5.5}},
    "02_necklace": {"kind": "necklace", "card": {"lengthCm": 50, "heightCm": 3.5}},
    "04_watch":    {"kind": "watch", "card": {"widthCm": 4.4}},
    "05_belt":     {"kind": "belt", "card": {"widthCm": 3.5, "lengthCm": 95, "level": "waist"}},
    "06_handbag":  {"kind": "handbag", "card": {"widthCm": 20, "heightCm": 20, "depthCm": 6}},
    "07_sneakers": {"kind": "shoes", "card": {"size": "38", "sizeSystem": "EU"}},
    "08_heels":    {"kind": "shoes", "card": {"size": "38", "sizeSystem": "EU"}},
    "09_hat":      {"kind": "hat", "card": {"size": "57", "widthCm": 34}},
    "10_glasses":  {"kind": "glasses", "card": {"widthCm": 14}},
}
X, Y, Z = 0, 1, 2


# ── геометрия в системе glTF (Y вверх, +Z — лицо); в Blender это (x, −z, y) ──

def to_gltf(v):
    return np.column_stack([v[:, 0], v[:, 2], -v[:, 1]])


def from_gltf(g):
    return np.column_stack([g[:, 0], -g[:, 2], g[:, 1]])


def mesh_arrays(me):
    v = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", v)
    tri = np.empty(len(me.polygons) * 3, dtype=np.int64)
    me.polygons.foreach_get("vertices", tri)
    return to_gltf(v.reshape(-1, 3)), tri.reshape(-1, 3)


def set_vertices(me, g):
    me.vertices.foreach_set("co", from_gltf(g).ravel())
    me.update()


def components(V, F, mask=None):
    """Связные куски треугольников (вершины, раздвоенные на швах развёртки, склеиваются по координатам)."""
    _, weld = np.unique(np.round(V / 1e-5).astype(np.int64), axis=0, return_inverse=True)
    weld = weld.ravel()
    parent = np.arange(weld.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    faces = np.flatnonzero(mask) if mask is not None else np.arange(len(F))
    for f in faces:
        a, b, c = (find(x) for x in weld[F[f]])
        parent[b] = a
        parent[c] = a
    label = np.full(len(F), -1)
    label[faces] = [find(weld[F[f, 0]]) for f in faces]
    return label


def largest(label, keep):
    ids, counts = np.unique(label[keep], return_counts=True)
    return keep & (label == ids[np.argmax(counts)])


def one_of_pair(V, F):
    """Из пары — одна вещь: куски делятся на две группы по оси, вдоль которой пара лежит рядом."""
    C = V[F].mean(1)
    axis = X if np.ptp(C[:, X]) >= np.ptp(C[:, Z]) else Z
    lo, hi = np.percentile(C[:, axis], [10, 90])
    cut = (lo + hi) / 2
    for _ in range(20):                                  # 1-D k-means на две группы
        a, b = C[C[:, axis] < cut, axis], C[C[:, axis] >= cut, axis]
        cut = (a.mean() + b.mean()) / 2
    label = components(V, F)
    side = np.zeros(len(F), bool)
    for lab in np.unique(label):                         # кусок целиком — туда, где его больше
        m = label == lab
        side[m] = (C[m, axis] >= cut).mean() >= 0.5
    return side if side.sum() >= (~side).sum() else ~side


def pendant(V, F):
    """У колье — подвеска: снизу вверх до места, где ширина падает ниже 45 % (там начинается цепочка)."""
    C = V[F].mean(1)
    y0, y1 = C[:, Y].min(), C[:, Y].max()
    edges = np.linspace(y0, y1, 41)
    width = np.array([np.ptp(C[(C[:, Y] >= a) & (C[:, Y] < b), X]) if ((C[:, Y] >= a) & (C[:, Y] < b)).any() else 0
                      for a, b in zip(edges[:-1], edges[1:])])
    top = int(np.argmax(width))
    k = top
    while k < len(width) - 1 and width[k] >= 0.45 * width[top]:
        k += 1
    cut = edges[k] + 0.03 * (y1 - y0)                    # с ушком
    return C[:, Y] < cut


def bright_faces(obj, F):
    """Светлые и серые (металл) треугольники по базовому цвету в центре их развёртки."""
    me = obj.data
    mat = obj.active_material
    img = next((n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image
                and any(l.to_socket.name == "Base Color" for o in n.outputs for l in o.links)), None)
    if img is None:
        return None
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)
    uv = np.empty(len(me.loops) * 2)
    me.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    start = np.empty(len(me.polygons), dtype=np.int64)
    me.polygons.foreach_get("loop_start", start)
    c = uv[start[:, None] + np.arange(3)].mean(1) % 1.0
    rgb = px[(c[:, 1] * (h - 1)).astype(int), (c[:, 0] * (w - 1)).astype(int), :3]
    lum = rgb @ np.array([0.2126, 0.7152, 0.0722])
    sat = rgb.max(1) - rgb.min(1)
    return (lum > 0.35) & (sat < 0.18)


def hat_only(V, F):
    """Шапка без манекена. Поля — самое широкое место в верхней половине (ниже — плечи манекена,
    они шире); всё, что ниже полей, — манекен. Выше полей остаётся то, что видно снаружи: стенка
    тульи (дальше всех от оси на своей высоте) и её верх (выше всех над своим местом); голова
    манекена внутри тульи не видна ни сбоку, ни сверху."""
    C = V[F].mean(1)
    cx, cz = (C[:, X].min() + C[:, X].max()) / 2, (C[:, Z].min() + C[:, Z].max()) / 2
    r = np.hypot(C[:, X] - cx, C[:, Z] - cz)
    y0, y1 = C[:, Y].min(), C[:, Y].max()
    H = y1 - y0
    edges = np.linspace(y0, y1, 61)
    slab = np.clip(np.digitize(C[:, Y], edges) - 1, 0, 59)
    rmax = np.array([r[slab == s].max() if (slab == s).any() else 0 for s in range(60)])
    upper = np.arange(60) >= 24                          # верхние 60 %
    b = int(np.argmax(np.where(upper, rmax, 0)))
    brim_y = (edges[b] + edges[b + 1]) / 2
    keep = C[:, Y] > brim_y - 0.02 * H
    above = C[:, Y] > brim_y + 0.02 * H
    wall = r >= 0.75 * rmax[slab]
    # верх: самый высокий треугольник в своей клетке сетки 48×48 по XZ
    gx = np.clip(((C[:, X] - C[:, X].min()) / np.ptp(C[:, X]) * 47).astype(int), 0, 47)
    gz = np.clip(((C[:, Z] - C[:, Z].min()) / np.ptp(C[:, Z]) * 47).astype(int), 0, 47)
    cell = gx * 48 + gz
    top = np.full(48 * 48, -np.inf)
    np.maximum.at(top, cell, C[:, Y])
    roof = C[:, Y] >= top[cell] - 0.06 * H
    keep &= ~above | wall | roof
    # у полей: шея манекена проходит сквозь середину
    r_crown = np.median(rmax[(edges[:-1] > brim_y + 0.05 * H) & (rmax > 0)])
    keep &= ~(~above & (r < 0.8 * r_crown) & ~roof)
    return keep


def pca_axes(P):
    P = P - P.mean(0)
    w, v = np.linalg.eigh(P.T @ P)
    return v[:, np.argsort(w)]                           # столбцы: от самой тонкой оси к самой длинной


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def basis(ey, ez):
    """Поворот: новые оси Y и Z модели — ey и ez (в старой системе)."""
    ey = ey / np.linalg.norm(ey)
    ez = ez - ey * (ez @ ey)
    ez /= np.linalg.norm(ez)
    return np.vstack([np.cross(ey, ez), ey, ez])         # строки — новые оси: g' = R @ g


def orient(kind, V):
    """Поворот вещи по её виду (матрица R, g' = R @ g)."""
    if kind == "shoes":
        h = V[:, [X, Z]] - V[:, [X, Z]].mean(0)
        w, v = np.linalg.eigh(h.T @ h)
        d = v[:, np.argmax(w)]                           # длина стопы
        R = rot_y(math.atan2(-d[0], d[1]))               # длина — вдоль Z
        G = V @ R.T
        L = G[:, Z]
        lo, hi = np.percentile(L, [15, 85])
        if G[L > hi, Y].max() > G[L < lo, Y].max():      # пятка выше носка — она должна быть сзади (−Z)
            R = rot_y(math.pi) @ R
        return R
    if kind == "handbag":
        axes = pca_axes(V)
        n = axes[:, 0] * (1 if axes[1, 0] >= 0 else -1)  # нормаль плоской стороны; верхняя на фото — лицом вперёд
        G = V @ basis(np.array([0, 0, -1.0]) if abs(n[Y]) > 0.7 else np.array([0, 1.0, 0]), n).T
        # ручка — самая дальняя от центра точка в плоскости лица: она вверх
        P = G[:, [X, Y]] - np.median(G[:, [X, Y]], 0)
        far = P[np.argmax(np.hypot(P[:, 0], P[:, 1]))]
        a = math.atan2(far[0], far[1])
        Rz = np.array([[math.cos(a), -math.sin(a), 0], [math.sin(a), math.cos(a), 0], [0, 0, 1]])
        return Rz @ basis(np.array([0, 0, -1.0]) if abs(n[Y]) > 0.7 else np.array([0, 1.0, 0]), n)
    if kind in ("earrings", "necklace", "belt"):
        n = pca_axes(V)[:, 0]
        if kind == "belt":                               # пряжка смотрит наружу от середины ремня
            n = n * (1 if n @ (V.mean(0) - ORIGIN_HINT[0]) >= 0 else -1)
        else:
            n = n * (1 if n[Z] >= 0 else -1)
        return basis(np.array([0, 1.0, 0]), n)
    if kind == "glasses":
        L = V[:, Z]
        lo, hi = np.percentile(L, [15, 85])
        front, back = np.ptp(V[L > hi, X]), np.ptp(V[L < lo, X])
        return np.eye(3) if front >= back else rot_y(math.pi)
    return np.eye(3)                                     # часы, шапка — как их поставил генератор


ORIGIN_HINT = [np.zeros(3)]                              # центр всего ремня — для стороны пряжки

SCALE_AXIS = {"earrings": (Y, "lengthCm"), "necklace": (Y, "heightCm"), "watch": (X, "widthCm"),
              "handbag": (X, "widthCm"), "hat": (X, "widthCm"), "glasses": (X, "widthCm")}


def target_size(kind, card):
    """Ось и размер (м), к которому приводится модель."""
    if kind == "shoes":
        foot = int(card["size"]) * 2 / 3 - 1.5           # EU: колодка · 2/3 − 1,5 см (accessoryPlacement.js)
        return Z, (foot + 2.5) / 100
    if kind == "belt":
        return Y, (card["widthCm"] + 0.6) / 100          # пряжка выше ремня на 6 мм
    axis, field = SCALE_AXIS[kind]
    return axis, card[field] / 100


def prepare(src, item, spec, out, faces_target, texture):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(src))
    obj = next(o for o in bpy.data.objects if o.type == "MESH")
    bpy.context.view_layer.objects.active = obj
    me = obj.data
    V, F = mesh_arrays(me)
    kind = spec["kind"]
    notes = []

    keep = np.ones(len(F), bool)
    if kind in ("earrings", "shoes"):
        keep = one_of_pair(V, F)
    elif kind == "necklace":
        keep = pendant(V, F)
        notes.append("pendant only; the chain is drawn by the try-on")
    elif kind == "belt":
        ORIGIN_HINT[0] = (V.min(0) + V.max(0)) / 2
        bright = bright_faces(obj, F)
        if bright is None or bright.sum() < 50:
            notes.append("buckle not found — whole belt kept")
        else:
            keep = largest(components(V, F, bright), bright)
            notes.append("buckle only; the strap is a ribbon in the product colour")
    elif kind == "hat":
        keep = hat_only(V, F)
        notes.append("mannequin cut below the brim and inside the crown; the crown has holes where the generator "
                     "fused it with the mannequin's head — needs a photo of the hat alone")
    if not keep.all():
        bm = bmesh.new()
        bm.from_mesh(me)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.faces[i] for i in np.flatnonzero(~keep)], context="FACES")
        loose = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
        bm.to_mesh(me)
        bm.free()
        V, F = mesh_arrays(me)

    R = orient(kind, V)
    G = V @ R.T
    axis, size = target_size(kind, spec["card"])
    G = (G - (G.min(0) + G.max(0)) / 2) * (size / np.ptp(G[:, axis]))
    set_vertices(me, G)

    ratio = min(1.0, faces_target / len(me.polygons))
    if ratio < 1.0:
        mod = obj.modifiers.new("decimate", "DECIMATE")
        mod.ratio = ratio
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if kind == "glasses":                                # линзы прозрачные — альфа базового цвета
        for mat in me.materials:
            mat.surface_render_method = "BLENDED"
    for img in bpy.data.images:
        if img.size[0] > texture:
            img.scale(texture, texture)
    path = out / f"{item}.glb"
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_image_format="WEBP",
                              use_selection=False, export_apply=True)
    v = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get("co", v)
    G = to_gltf(v.reshape(-1, 3))
    return {"item": item, "kind": kind, "card": spec["card"], "file": path.name,
            "mb": round(path.stat().st_size / 1e6, 3), "triangles": len(me.polygons),
            "sizeCm": [round(float(v) * 100, 1) for v in np.ptp(G, 0)], "notes": notes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--faces", type=int, default=16000)
    ap.add_argument("--texture", type=int, default=1024)
    ap.add_argument("--only", default="")
    a = ap.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for item, spec in ITEMS.items():
        if a.only and item not in a.only.split(","):
            continue
        row = prepare(Path(a.src) / f"{item}_1024_cascade.glb", item, spec, out, a.faces, a.texture)
        print("PREPARED", json.dumps(row), flush=True)
        rows.append(row)
    if not a.only:
        (out / "prepared.json").write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
