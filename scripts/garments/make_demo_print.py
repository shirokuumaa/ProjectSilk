# scripts/garments/make_demo_print.py
#
# Принт демо-платья — клетка-гингем, нарисованная кодом (без чужих картинок):
#   client/public/models/demo-garments/dress_print.png — бесшовная плитка, один повтор клетки:
#   светлое поле, полоса по x и полоса по y в половину плитки; где полосы пересекаются — темнее.
# Повтор на ткани (tileCm) — в server/scripts/seedDemoGarments.js (4 см: клетка 2 см).
#
# Запуск: research/patterns/.envs/mac/bin/python scripts/garments/make_demo_print.py

from pathlib import Path

import numpy as np
from PIL import Image

OUT = Path(__file__).resolve().parents[2] / "client" / "public" / "models" / "demo-garments" / "dress_print.png"
SIDE = 256                                   # px на плитку

# цвета гингема (RGB): поле, одна полоса, пересечение — голубой демо-ткани (export_demo_drapes.CLOTH)
FIELD = np.array([244, 246, 250])
BAND = np.array([160, 186, 219])
CROSS = np.array([84, 120, 168])


def gingham(side=SIDE):
    """Плитка side × side: полосы занимают первую половину по x и по y — повтор без шва."""
    half = np.arange(side) < side // 2
    bx, by = np.meshgrid(half, half)          # bx — вертикальная полоса, by — горизонтальная
    n = bx.astype(int) + by.astype(int)       # 0 — поле, 1 — полоса, 2 — пересечение
    return np.choose(n[..., None], [FIELD, BAND, CROSS]).astype(np.uint8)


def main():
    Image.fromarray(gingham()).save(OUT, optimize=True)
    print(OUT, f"{OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
