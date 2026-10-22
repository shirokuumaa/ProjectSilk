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
#   research/patterns/.envs/mac/bin/python scripts/garments/export_demo_drapes.py

import json
import sys
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

REPO = Path(__file__).resolve().parents[2]
PATTERNS = REPO / "research" / "patterns"
RUNS = PATTERNS / "runs" / "newtontest_gpu" / "mu02" / "renders"
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
SIZES = ("S", "L")


def z_offsets():
    """Сдвиг по z (м) от системы симуляции к системе сайта для каждой фигуры."""
    mp = MPFB()
    rows = {r["name"]: r for r in json.load(open(BODIES / "bodies.json"))}
    out = {}
    for name, row in rows.items():
        u = np.array([row["controls"][c] for c in config.CONTROL_NAMES])
        app = mp.body.coords(u)
        sim = np.array([[float(x) for x in l.split()[1:4]] for l in open(BODIES / f"{name}.obj") if l.startswith("v ")])
        d = app - sim
        assert d.std(0).max() < 2e-4, f"{name}: сдвиг не постоянный ({d.std(0)})"
        assert abs(d[:, 0].mean()) < 1e-4 and abs(d[:, 1].mean()) < 5e-4, f"{name}: сдвиг не только по z"
        out[name] = float(d[:, 2].mean())
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
    path.write_bytes(trimesh.exchange.gltf.export_glb(trimesh.Scene(mesh), include_normals=True))
    return path.stat().st_size / 1e6


def product_image(case, path):
    """Картинка товара: рендер Newton спереди (наша болванка), кадр по ткани."""
    img = Image.open(RUNS / f"{case}_S_front.png").convert("RGB")
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
    OUT.mkdir(parents=True, exist_ok=True)
    dz = z_offsets()
    manifest = {"source": "Newton 1.7 (SolverStyle3D), friction 0.2, on our MPFB base avatar; "
                          "research/patterns/runs/newtontest_gpu", "items": {}}
    for item, cfg in ITEMS.items():
        models = []
        for size in SIZES:
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
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))
    print("manifest:", OUT / "manifest.json")


if __name__ == "__main__":
    main()
