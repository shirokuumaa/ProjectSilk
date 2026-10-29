# scripts/garments/export_demo_drapes.py
#
# Драпировки Newton (research/patterns/runs/newtontest_gpu, локально, не в git) →
# 3D-модели трёх демо-товаров для сайта:
#   client/public/models/demo-garments/{dress,skirt,tee}_{S,L}.glb + манифест + картинки.
#
# Драпировка посчитана на нашей болванке MPFB в фигуре размера (research/patterns/mpfb_body.py):
# сантиметры, ступни на y = 0, плоскость баланса GarmentCode в z = 0. Та же болванка на сайте —
# метры и без сдвига по z, поэтому: вершина_сайта = вершина_симуляции / 100 + (0, 0, z_bal).
# z_bal для каждой фигуры считается здесь же: болванка сайта − болванка симуляции (сдвиг
# одинаковый для всех вершин с точностью до 0,1 мм — это проверяется).
# Развёртка: вершины и треугольники берутся из *_sim.obj Newton, UV — из *_boxmesh.obj GarmentCode (те же
# вершины и треугольники), пересчитанные в метры плоской выкройки (pattern_mesh); принт товара ложится на них
# одним масштабом на всех размерах (client/src/utils/fabricPrint.js).
#
# Запуск (окружение research/patterns/.envs/mac):
#   research/patterns/.envs/mac/bin/python scripts/garments/export_demo_drapes.py            # S и L (Newton, 18.10)
#   … export_demo_drapes.py --run allsizes   # все размеры: GLB из simtest_report.py --no-render
#        по runs/allsizes/newton (renders/), болванки runs/allsizes/bodies
#   … export_demo_drapes.py --run arms --jobs trousers:arms_trousers,jacket:cuff_jacket,coat:cuff_coat
#        (брюки — с привязкой пояса 20 Н/м, жакет и пальто — с широким манжетом; README «Короткий сеанс»)
#        + товары конвейера продавца (scripts/garments/patterns_job.py): GLB из runs/<job>/report/renders,
#        болванки runs/<job>/bodies/product_<размер>, фигура размера — из runs/<job>/result.json

import argparse
import json
import struct
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
PATTERNS = REPO / "research" / "patterns"
RUNS = PATTERNS / "runs" / "newtontest_gpu" / "mu02" / "renders"
IMAGES = RUNS                                   # картинки товаров — рендеры этого прогона (S спереди)
BODIES = PATTERNS / "runs" / "day7" / "bodies"
OUT = REPO / "client" / "public" / "models" / "demo-garments"
sys.path.insert(0, str(PATTERNS))
sys.path.insert(0, str(REPO / "scripts" / "avatar"))

import config  # noqa: E402  (scripts/avatar/config.py)
from mpfb_body import CHARTS, HEIGHT, MPFB  # noqa: E402

MAX_MB = 1.1   # с развёрткой выкройки (UV + раздвоенные вершины швов, +25–30 %) пальто XXL — 1,01 МБ

# цвет ткани — как на рендере, из которого сделана картинка товара (RGBA 0..1)
CLOTH = (0.42, 0.58, 0.76, 1.0)

# id товара → исходник Newton, магазин (чья сетка тела)
ITEMS = {
    "dress": {"case": "03_dress", "store": "zara",   "color": CLOTH},
    "skirt": {"case": "04_skirt", "store": "zara",   "color": CLOTH},
    "tee":   {"case": "09_tee",   "store": "uniqlo", "color": CLOTH},
}
SIZES = {"03_dress": ("S", "L"), "04_skirt": ("S", "L"), "09_tee": ("S", "L")}


def z_offset(mp, u, obj):
    """Сдвиг по z (м) от фигуры симуляции obj к той же фигуре на сайте (морфы u)."""
    app = mp.body.coords(u)
    sim = np.array([[float(x) for x in l.split()[1:4]] for l in open(obj) if l.startswith("v ")])
    d = app - sim
    assert d.std(0).max() < 2e-4, f"{obj.name}: сдвиг не постоянный ({d.std(0)})"
    assert abs(d[:, 0].mean()) < 1e-4 and abs(d[:, 1].mean()) < 5e-4, f"{obj.name}: сдвиг не только по z"
    return float(d[:, 2].mean())


def z_offsets():
    """Сдвиг по z (м) от системы симуляции к системе сайта для каждой фигуры."""
    mp = MPFB()
    rows = {r["name"]: r for r in json.load(open(BODIES / "bodies.json"))}
    return {name: z_offset(mp, np.array([row["controls"][c] for c in config.CONTROL_NAMES]), BODIES / f"{name}.obj")
            for name, row in rows.items()}


def job_items(spec):
    """Товары конвейера продавца: "id:run[:размер картинки],…" → {id: {"run", "image", "sizes": [(size, figure, dz)]}}.
    Размер картинки — S, если не указан. Фигура размера —
    из result.json; морфы — тем же подбором, что строил болванку (mpfb_body.MPFB.solve), сдвиг — от неё."""
    mp = MPFB()
    out = {}
    for part in filter(None, spec.split(",")):
        item, run, *image = part.split(":")
        run = PATTERNS / "runs" / run
        sizes = []
        for s in json.load(open(run / "result.json"))["sizes"]:
            b = s["body"]
            u, _ = mp.solve(b["heightCm"], b["chest"], b["waist"], b["hips"])
            sizes.append((s["size"], b, z_offset(mp, u, run / "bodies" / f"product_{s['size']}.obj")))
        out[item] = {"run": run, "sizes": sizes, "image": image[0] if image else "S"}
    return out


def load_mesh(path):
    scene = trimesh.load(path, force="scene")
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    return trimesh.util.concatenate(meshes)


def read_obj(path):
    """OBJ GarmentCode как есть, без склейки и перестановки вершин: V (n, 3), VT (m, 2) — пусто без UV,
    F (k, 3) индексы вершин, FT (k, 3) индексы UV — None без UV."""
    V, VT, F, FT = [], [], [], []
    for line in open(path):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("vt "):
            VT.append([float(x) for x in line.split()[1:3]])
        elif line.startswith("f "):
            corners = [c.split("/") for c in line.split()[1:4]]
            F.append([int(c[0]) - 1 for c in corners])
            if len(corners[0]) > 1 and corners[0][1]:
                FT.append([int(c[1]) - 1 for c in corners])
    return (np.array(V), np.array(VT).reshape(-1, 2), np.array(F, dtype=np.int64),
            np.array(FT, dtype=np.int64) if FT else None)


def pattern_scale(B, VT, F, FT):
    """Сантиметров выкройки в единице UV box mesh GarmentCode и доля рёбер, у которых это отношение то же (±1 %).
    GarmentCode кладёт панели в атлас как есть (2D-координаты выкройки, см) и делит все UV на одну ширину
    атласа (texture_utils.normalize_UVs); box mesh — те же плоские панели, только повёрнутые в 3D, поэтому
    длина ребра в 3D / длина в UV = ширина атласа. Медиана: вершина шва стоит по первой панели, и рёбра второй
    панели у шва в 3D длиннее (у платья S так 30 % рёбер, остальные совпадают до 1 %)."""
    ratios = []
    for i, j in ((0, 1), (1, 2), (2, 0)):
        l3 = np.linalg.norm(B[F[:, i]] - B[F[:, j]], axis=1)
        luv = np.linalg.norm(VT[FT[:, i]] - VT[FT[:, j]], axis=1)
        ok = luv > 1e-9
        ratios.append(l3[ok] / luv[ok])
    r = np.concatenate(ratios)
    med = float(np.median(r))
    return med, float(np.mean(np.abs(r / med - 1) < 0.01))


def pattern_mesh(sim_obj, box_obj):
    """Драпировка (см) с развёрткой плоской выкройки GarmentCode: UV в метрах выкройки, одинаковых на всех размерах
    (плитка ткани в tileCm сантиметров ложится повтором 100 / tileCm). Вершины на краях панелей раздвоены — у
    каждой панели свои UV; нормали — по сваренной сетке, чтобы шов развёртки не было видно.
    Возвращает (mesh, uv_m, normals, scale_info)."""
    V, _, F, _ = read_obj(sim_obj)
    B, VT, FB, FT = read_obj(box_obj)
    assert FT is not None, f"{box_obj.name}: нет развёртки (vt)"
    assert np.array_equal(F, FB) and len(V) == len(B), f"{sim_obj.name}: сетка не совпадает с box mesh"
    cm, exact = pattern_scale(B, VT, FB, FT)
    welded = trimesh.Trimesh(V, F, process=False)
    pairs, inverse = np.unique(np.stack([F.ravel(), FT.ravel()], 1), axis=0, return_inverse=True)
    mesh = trimesh.Trimesh(V[pairs[:, 0]], inverse.reshape(-1, 3), process=False)
    uv_m = VT[pairs[:, 1]] * cm / 100.0
    normals = np.asarray(welded.vertex_normals)[pairs[:, 0]]
    return mesh, uv_m, normals, {"cmPerUv": round(cm, 2), "exactEdges": round(exact, 3)}


def find_sim(glb, dirs):
    """Какой результат Newton стал этим GLB отчёта (simtest_report.py собирает GLB из *_sim.obj, вершины
    склеены и переставлены): папка, чьи вершины совпадают с вершинами GLB."""
    from scipy.spatial import cKDTree
    target = np.asarray(load_mesh(glb).vertices)
    for d in dirs:
        sims = sorted(Path(d).glob("*_sim.obj"))
        if not sims:
            continue
        V = read_obj(sims[0])[0]
        if len(V) >= len(target) and cKDTree(V).query(target)[0].max() < 1e-3:
            box = sims[0].with_name(sims[0].name.replace("_sim.obj", "_boxmesh.obj"))
            return sims[0], box
    raise FileNotFoundError(f"{glb}: нет результата Newton с теми же вершинами в {[str(d) for d in dirs]}")


def export_glb(mesh, color, path, uv=None, normals=None):
    """GLB вещи. С uv (метры выкройки) — TEXCOORD_0 и пометка extras.uvMetres у сетки: примерка кладёт на такую
    вещь принт товара (client/src/utils/fabricPrint.js); v растёт вверх по выкройке."""
    material = trimesh.visual.material.PBRMaterial(
        name="fabric", baseColorFactor=[int(c * 255) for c in color],
        metallicFactor=0.0, roughnessFactor=0.9, doubleSided=True,
    )
    if uv is not None:
        # trimesh пишет в glTF 1 − v (начало UV glTF — левый верхний угол); 1 − v здесь возвращает v как есть
        mesh.visual = trimesh.visual.TextureVisuals(uv=np.column_stack([uv[:, 0], 1.0 - uv[:, 1]]), material=material)
    else:
        mesh.visual = trimesh.visual.TextureVisuals(material=material)
    if normals is not None:
        mesh.vertex_normals = normals
    _ = mesh.vertex_normals  # нормали уходят в GLB
    glb = trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh), include_normals=True)
    path.write_bytes(uint16_indices(glb, extras={"uvMetres": True} if uv is not None else None))
    return path.stat().st_size / 1e6


def uint16_indices(glb, extras=None):
    """Индексы треугольников 16-битные вместо 32-битных, без потерь (вершин < 65 535): trimesh всегда пишет
    uint32, и пальто XXL (41 тыс. треугольников) вышло 1,04 МБ при пределе 1 МБ. extras — в каждую сетку
    (GLTFLoader кладёт их в userData)."""
    magic, version, _ = struct.unpack_from("<III", glb, 0)
    jlen, _ = struct.unpack_from("<II", glb, 12)
    doc = json.loads(glb[20:20 + jlen])
    blen, _ = struct.unpack_from("<II", glb, 20 + jlen)
    binary = glb[28 + jlen:28 + jlen + blen]
    index_views = {}
    for mesh in doc["meshes"]:
        if extras:
            mesh["extras"] = {**mesh.get("extras", {}), **extras}
        for prim in mesh["primitives"]:
            acc = doc["accessors"][prim["indices"]]
            if acc["componentType"] == 5125:
                index_views[acc["bufferView"]] = acc
    out = bytearray()
    for i, view in enumerate(doc["bufferViews"]):
        data = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        if i in index_views:
            idx = np.frombuffer(data, np.uint32)
            if idx.max() < 65535:                            # не помещается — остаётся uint32
                data = idx.astype(np.uint16).tobytes()
                index_views[i]["componentType"] = 5123
        out += b"\0" * (-len(out) % 4)
        view["byteOffset"], view["byteLength"] = len(out), len(data)
        out += data
    out += b"\0" * (-len(out) % 4)
    doc["buffers"][0]["byteLength"] = len(out)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(out)
    return (struct.pack("<III", magic, version, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
            + struct.pack("<II", len(out), 0x004E4942) + bytes(out))


def drape_with_uv(glb, dirs):
    """Драпировка из GLB отчёта с развёрткой выкройки — по исходным OBJ Newton (find_sim). Без них (старые
    прогоны) — GLB как был, без UV: на примерке такая вещь только в цвете."""
    try:
        sim, box = find_sim(glb, dirs)
    except FileNotFoundError as e:
        print(f"  без развёртки: {e}")
        return load_mesh(glb), None, None, None
    mesh, uv, normals, info = pattern_mesh(sim, box)
    assert info["exactEdges"] > 0.5, f"{sim}: длины рёбер в UV и в выкройке расходятся ({info})"
    return mesh, uv, normals, info


def product_image(case, path, images=None, size="S"):
    """Картинка товара: рендер Newton спереди (наша болванка), кадр по ткани."""
    img = Image.open((images or IMAGES) / f"{case}_{size}_front.png").convert("RGB")
    a = np.asarray(img).astype(int)
    cloth = (a[..., 2] - a[..., 0] > 25)                    # голубая ткань рендера
    ys, xs = np.nonzero(cloth)
    pad = 40
    box = (max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad, a.shape[1]), min(ys.max() + pad, a.shape[0]))
    crop = img.crop(box)
    w, h = crop.size                                        # 3:4, как карточки каталога
    side = max(w, h * 3 // 4)
    canvas = Image.new("RGB", (side, side * 4 // 3), (0, 0, 0))
    canvas.paste(crop, ((side - w) // 2, (side * 4 // 3 - h) // 2))
    canvas.resize((600, 800)).save(path, quality=85)
    return path.stat().st_size / 1e6


def main():
    global RUNS, BODIES, SIZES
    ap = argparse.ArgumentParser()
    ap.add_argument("--run", help="research/patterns/runs/<run>: every size, GLBs from <run>/report/renders")
    ap.add_argument("--jobs", default="", help="seller-pipeline items id:run,… (runs/<run>/report/renders)")
    a = ap.parse_args()
    if a.run:
        run = PATTERNS / "runs" / a.run
        RUNS, BODIES = run / "report" / "renders", run / "bodies"
        cases = json.load(open(run / "inputs" / "cases.json"))
        SIZES = {c["item"]: tuple(x["size"] for x in cases if x["item"] == c["item"]) for c in cases}
    OUT.mkdir(parents=True, exist_ok=True)
    dz = z_offsets()
    source = (f"Newton 1.7 (SolverStyle3D) on our MPFB base avatar, every size on its own size body; "
              f"skirts and trousers friction 0.5, others 0.2; research/patterns/runs/{a.run}"
              + "".join(f", runs/{p.split(':')[1]}" for p in filter(None, a.jobs.split(",")))) if a.run else \
             ("Newton 1.7 (SolverStyle3D), friction 0.2, on our MPFB base avatar; "
              "research/patterns/runs/newtontest_gpu")
    manifest = {"source": source, "items": {}}
    for item, cfg in ITEMS.items():
        models = []
        for size in SIZES[cfg["case"]]:
            body = f"{cfg['store']}_{size}"
            case = f"{cfg['case']}_{size}"
            mesh, uv, normals, uv_info = drape_with_uv(RUNS / f"{case}.glb", sorted(RUNS.parents[1].glob(f"newton*/results/{case}")))
            mesh.apply_scale(0.01)                           # см → м
            mesh.apply_translation([0.0, 0.0, dz[body]])     # система симуляции → система сайта
            mb = export_glb(mesh, cfg["color"], OUT / f"{item}_{size}.glb", uv, normals)
            assert mb <= MAX_MB, f"{item}_{size}: {mb:.2f} МБ > {MAX_MB}"
            bust, waist, hips = CHARTS[cfg["store"]][size]
            models.append({"size": size, "file": f"/models/demo-garments/{item}_{size}.glb", "mb": round(mb, 3),
                           "triangles": int(len(mesh.faces)), "zOffsetM": round(dz[body], 5), "uv": uv_info,
                           "body": {"heightCm": HEIGHT, "chest": bust, "waist": waist, "hips": hips}})
            print(f"{item}_{size}: {mb:.2f} MB, {len(mesh.faces)} tris, body {body}, dz {dz[body] * 100:.2f} cm, uv {uv_info}")
        img_mb = product_image(cfg["case"], OUT / f"{item}.jpg")
        manifest["items"][item] = {"case": cfg["case"], "image": f"/models/demo-garments/{item}.jpg",
                                   "imageMb": round(img_mb, 3), "models": models}
    for item, job in job_items(a.jobs).items():
        renders, models = job["run"] / "report" / "renders", []
        for size, figure, dz in job["sizes"]:
            mesh, uv, normals, uv_info = drape_with_uv(renders / f"size_{size}.glb",
                                                       sorted(job["run"].glob(f"newton*/results/size_{size}")))
            mesh.apply_scale(0.01)
            mesh.apply_translation([0.0, 0.0, dz])
            mb = export_glb(mesh, CLOTH, OUT / f"{item}_{size}.glb", uv, normals)
            assert mb <= MAX_MB, f"{item}_{size}: {mb:.2f} МБ > {MAX_MB}"
            models.append({"size": size, "file": f"/models/demo-garments/{item}_{size}.glb", "mb": round(mb, 3),
                           "triangles": int(len(mesh.faces)), "zOffsetM": round(dz, 5), "uv": uv_info, "body": figure})
            print(f"{item}_{size}: {mb:.2f} MB, {len(mesh.faces)} tris, dz {dz * 100:.2f} cm, uv {uv_info}")
        img_mb = product_image("size", OUT / f"{item}.jpg", images=renders, size=job["image"])
        manifest["items"][item] = {"case": f"{job['run'].name}/size", "image": f"/models/demo-garments/{item}.jpg",
                                   "imageMb": round(img_mb, 3), "models": models}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("manifest:", OUT / "manifest.json")


if __name__ == "__main__":
    main()
