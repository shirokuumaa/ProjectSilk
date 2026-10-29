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
#
# Запуск (окружение research/patterns/.envs/mac):
#   research/patterns/.envs/mac/bin/python scripts/garments/export_demo_drapes.py            # S и L (Newton, 18.10)
#   … export_demo_drapes.py --run allsizes   # все размеры: GLB из simtest_report.py --no-render
#        по runs/allsizes/newton (renders/), болванки runs/allsizes/bodies
#   … export_demo_drapes.py --run arms --jobs trousers:arms_trousers,jacket:arms_jacket,coat:arms_coat
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

MAX_MB = 1.0

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
    """Товары конвейера продавца: "id:run,…" → {id: {"run", "sizes": [(size, figure, dz)]}}. Фигура размера —
    из result.json; морфы — тем же подбором, что строил болванку (mpfb_body.MPFB.solve), сдвиг — от неё."""
    mp = MPFB()
    out = {}
    for part in filter(None, spec.split(",")):
        item, run = part.split(":")
        run = PATTERNS / "runs" / run
        sizes = []
        for s in json.load(open(run / "result.json"))["sizes"]:
            b = s["body"]
            u, _ = mp.solve(b["heightCm"], b["chest"], b["waist"], b["hips"])
            sizes.append((s["size"], b, z_offset(mp, u, run / "bodies" / f"product_{s['size']}.obj")))
        out[item] = {"run": run, "sizes": sizes}
    return out


def load_mesh(path):
    scene = trimesh.load(path, force="scene")
    meshes = [g for g in scene.geometry.values() if isinstance(g, trimesh.Trimesh)]
    return trimesh.util.concatenate(meshes)


def export_glb(mesh, color, path):
    mesh.visual = trimesh.visual.TextureVisuals(material=trimesh.visual.material.PBRMaterial(
        name="fabric", baseColorFactor=[int(c * 255) for c in color],
        metallicFactor=0.0, roughnessFactor=0.9, doubleSided=True,
    ))
    _ = mesh.vertex_normals  # нормали уходят в GLB
    path.write_bytes(uint16_indices(trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh), include_normals=True)))
    return path.stat().st_size / 1e6


def uint16_indices(glb):
    """Индексы треугольников 16-битные вместо 32-битных, без потерь (вершин < 65 535): trimesh всегда пишет
    uint32, и пальто XXL (41 тыс. треугольников) вышло 1,04 МБ при пределе 1 МБ."""
    magic, version, _ = struct.unpack_from("<III", glb, 0)
    jlen, _ = struct.unpack_from("<II", glb, 12)
    doc = json.loads(glb[20:20 + jlen])
    blen, _ = struct.unpack_from("<II", glb, 20 + jlen)
    binary = glb[28 + jlen:28 + jlen + blen]
    index_views = {}
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            acc = doc["accessors"][prim["indices"]]
            if acc["componentType"] == 5125:
                index_views[acc["bufferView"]] = acc
    out = bytearray()
    for i, view in enumerate(doc["bufferViews"]):
        data = binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        if i in index_views:
            idx = np.frombuffer(data, np.uint32)
            if idx.max() >= 65535:
                return glb                                   # не помещается — как было
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


def product_image(case, path, images=None):
    """Картинка товара: рендер Newton спереди (наша болванка), кадр по ткани."""
    img = Image.open((images or IMAGES) / f"{case}_S_front.png").convert("RGB")
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
            mesh = load_mesh(RUNS / f"{cfg['case']}_{size}.glb")
            mesh.apply_scale(0.01)                           # см → м
            mesh.apply_translation([0.0, 0.0, dz[body]])     # система симуляции → система сайта
            mb = export_glb(mesh, cfg["color"], OUT / f"{item}_{size}.glb")
            assert mb <= MAX_MB, f"{item}_{size}: {mb:.2f} МБ > {MAX_MB}"
            bust, waist, hips = CHARTS[cfg["store"]][size]
            models.append({"size": size, "file": f"/models/demo-garments/{item}_{size}.glb", "mb": round(mb, 3),
                           "triangles": int(len(mesh.faces)), "zOffsetM": round(dz[body], 5),
                           "body": {"heightCm": HEIGHT, "chest": bust, "waist": waist, "hips": hips}})
            print(f"{item}_{size}: {mb:.2f} MB, {len(mesh.faces)} tris, body {body}, dz {dz[body] * 100:.2f} cm")
        img_mb = product_image(cfg["case"], OUT / f"{item}.jpg")
        manifest["items"][item] = {"case": cfg["case"], "image": f"/models/demo-garments/{item}.jpg",
                                   "imageMb": round(img_mb, 3), "models": models}
    for item, job in job_items(a.jobs).items():
        renders, models = job["run"] / "report" / "renders", []
        for size, figure, dz in job["sizes"]:
            mesh = load_mesh(renders / f"size_{size}.glb")
            mesh.apply_scale(0.01)
            mesh.apply_translation([0.0, 0.0, dz])
            mb = export_glb(mesh, CLOTH, OUT / f"{item}_{size}.glb")
            assert mb <= MAX_MB, f"{item}_{size}: {mb:.2f} МБ > {MAX_MB}"
            models.append({"size": size, "file": f"/models/demo-garments/{item}_{size}.glb", "mb": round(mb, 3),
                           "triangles": int(len(mesh.faces)), "zOffsetM": round(dz, 5), "body": figure})
            print(f"{item}_{size}: {mb:.2f} MB, {len(mesh.faces)} tris, dz {dz * 100:.2f} cm")
        img_mb = product_image("size", OUT / f"{item}.jpg", images=renders)
        manifest["items"][item] = {"case": f"{job['run'].name}/size", "image": f"/models/demo-garments/{item}.jpg",
                                   "imageMb": round(img_mb, 3), "models": models}
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("manifest:", OUT / "manifest.json")


if __name__ == "__main__":
    main()
