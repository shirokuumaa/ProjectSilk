"""Prepare model inputs from research/photos for the GPU session.

For every item: two square images (photo on a model, photo of the item alone),
padded with the photo's own background colour so that CLIP's centre crop does
not cut the garment, plus a short English description for text+image runs.

Output (gitignored, derived from store photos — never publish):
  research/patterns/runs/inputs/images/<item>__<view>.png
  research/patterns/runs/inputs/manifest.json

Usage: python prepare_inputs.py [--size 1024]
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
PHOTOS = HERE.parent / "photos"
OUT = HERE / "runs" / "inputs"

# item -> (photo on a model, item photo, description, garment class)
# Descriptions follow info.md; for Uniqlo items without one they are written from the product page title.
ITEMS = {
    "01_dress": ("front.jpg", "item_front.jpg", "Long flowy dress, round neck, spaghetti straps, back tie closure", "dress"),
    "02_dress": ("front.jpg", "item_front.jpg", "Fitted stretch maxi dress, high neck, long sleeves, back zip", "dress"),
    "03_dress": ("front.jpg", "item_front.jpg", "Fitted mini dress, high neck, short sleeves", "dress"),
    "04_skirt": ("front.jpg", "item_front.jpg", "Mid-rise midi skirt with flared hem", "skirt"),
    "05_skirt": ("front.jpg", "item_front.jpg", "Mid-rise straight satin midi skirt with back slit", "skirt"),
    "06_skirt": ("front.jpg", "item.jpg", "A-line corduroy mini skirt with waistband", "skirt"),
    "07_top": ("front.jpg", "item.jpg", "Sleeveless loose blouse with round neck", "top"),
    "08_top": ("front.jpg", "item_front.jpg", "Round neck short sleeve knit top", "top"),
    "09_tee": ("front.jpg", "item.jpg", "Crew neck short sleeve T-shirt, regular fit", "tee"),
    "10_tee": ("front_full.jpg", "item.jpg", "Very fitted cropped crew neck T-shirt with short sleeves", "tee"),
}


def background_colour(img):
    """Median colour of a thin border strip — the studio backdrop."""
    a = np.asarray(img)
    m = max(2, min(a.shape[:2]) // 100)
    border = np.concatenate([a[:m].reshape(-1, 3), a[-m:].reshape(-1, 3),
                             a[:, :m].reshape(-1, 3), a[:, -m:].reshape(-1, 3)])
    return tuple(int(v) for v in np.median(border, axis=0))


def square(img, size):
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), background_colour(img))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas.resize((size, size), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--size", type=int, default=1024)
    args = ap.parse_args()

    (OUT / "images").mkdir(parents=True, exist_ok=True)
    manifest = []
    for item, (model_photo, item_photo, description, garment) in ITEMS.items():
        for view, name in (("model", model_photo), ("item", item_photo)):
            src = PHOTOS / item / name
            img = Image.open(src).convert("RGB")
            rel = f"images/{item}__{view}.png"
            square(img, args.size).save(OUT / rel)
            manifest.append({
                "id": f"{item}__{view}",
                "item": item,
                "view": view,
                "garment": garment,
                "image": rel,
                "source": f"research/photos/{item}/{name}",
                "description": description,
            })
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"{len(manifest)} inputs -> {OUT}")


if __name__ == "__main__":
    main()
