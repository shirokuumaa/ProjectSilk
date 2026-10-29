"""One sheet per session: a row per photo — the photo without background, then front and three-quarter views
of every model (TRELLIS.2 512, TRELLIS.2 1024 cascade, SF3D) with generation time, GPU memory and file size.

Run (any Python with Pillow): python make_sheet.py --session <runs/session dir> --out sheet.jpg
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

CELL = 220
COLUMNS = [("trellis2", "512"), ("trellis2", "1024_cascade"), ("sf3d", "sf3d")]


def results(session):
    rows = {}
    for model, _ in COLUMNS:
        f = session / model / "results.json"
        if f.exists():
            for r in json.loads(f.read_text())["items"]:
                rows[(r["item"], r.get("type"))] = r
    return rows


def thumb(path):
    if not path.exists():
        return None
    im = Image.open(path).convert("RGB")
    im.thumbnail((CELL, CELL))
    return im


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--session", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    s = Path(a.session)
    res = results(s)
    items = sorted({k[0] for k in res})
    cols = 1 + 2 * len(COLUMNS)
    sheet = Image.new("RGB", (cols * CELL, len(items) * (CELL + 34) + 24), "white")
    d = ImageDraw.Draw(sheet)
    head = ["photo"] + [f"{m} {t} {v}" for m, t in COLUMNS for v in ("front", "3/4")]
    for c, h in enumerate(head):
        d.text((c * CELL + 4, 4), h, fill="black")
    for r, item in enumerate(items):
        y = 24 + r * (CELL + 34)
        cells = [thumb(s / "trellis2" / f"{item}_input.png") or thumb(s / "sf3d" / f"{item}_sf3d_input.png")]
        notes = [item]
        for model, t in COLUMNS:
            stem = f"{item}_{t}" if model == "trellis2" else f"{item}_sf3d"
            cells += [thumb(s / "previews" / f"{stem}_front.png"), thumb(s / "previews" / f"{stem}_34.png")]
            row = res.get((item, t), {})
            note = "error" if "error" in row else (
                f"{row.get('generate_s', '?')}+{row.get('export_s', 0)} s, {row.get('peak_gb', '?')} GB, {row.get('mb', '?')} MB")
            notes += [note, ""]
        for c, im in enumerate(cells):
            if im is not None:
                sheet.paste(im, (c * CELL + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
        for c, n in enumerate(notes):
            d.text((c * CELL + 4, y + CELL + 4), n, fill="black")
    sheet.save(a.out, quality=88)
    print(a.out)


if __name__ == "__main__":
    main()
