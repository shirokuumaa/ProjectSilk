"""Week 1: patterns from AIpparel and ChatGarment vs the store's garment measurements.

Inputs: runs/gpu1/runs/{aipparel,chatgarment} (GPU session 1), runs/inputs/manifest.json,
research/photos/*/product_measurements.csv. Output (local only, contains store photos):
runs/week1/{sheets/*.png, measurements.csv, report.md}.

Both models give GarmentCode patterns in cm, Y up, panels placed around the GarmentCode
neutral body (height 172; bust 99.8 at y=124, waist 84.3 at y=111, hips 103.5 at y=87.5;
armpit ~129 — measured on mean_all.obj by slicing).

Measurements on a pattern (no simulation):
  * circumference at height h = sum over the garment's body panels (torso / skirt / waistband /
    pants; not sleeves, collars, cuffs) of the panel's width where the plane y=h cuts it —
    i.e. front + back widths, the same thing a "flat x 2" store measurement describes;
  * chest 1 cm below the armhole (top of the front/back side seam; y=124 if there is none),
    waist at y=111, hips at y=87.5 — only if the garment covers that height;
  * skirt panels (flat sectors in GarmentCode's placement) are measured along the fabric at the
    same distance below their waist edge as the level is below it, like a laid-flat skirt;
    a skirt's waist = waistband length, else the length of its waist edge(s); a skirt's hips =
    along the fabric 20 cm below the top of the waistband (store practice);
  * length = vertical extent of the panels the store measures (all / front / back).

Store reference: size L for everything — the size whose body matches the neutral body
(Uniqlo L: bust 93-99, waist 75-81, hips 101-107). Zara widths are flat -> x2.
Stretch: a garment smaller than the body at a level must stretch to be worn; then the worn
circumference is the body's ("with stretch"). Required for dress 02, also applies to 03, 10.
"""
import csv
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from blender.pattern_to_panels import convert

HERE = Path(__file__).resolve().parent
RUNS = HERE / "runs" / "gpu1" / "runs"
INPUTS = HERE / "runs" / "inputs"
PHOTOS = HERE.parent / "photos"
OUT = HERE / "runs" / "week1"

BODY = {"chest": (124.0, 99.8), "waist": (111.0, 84.3), "hips": (87.5, 103.5)}  # level y, body circumference
REF_SIZE = "L"
# what each store "length" means: which panels span it
LENGTH_PANELS = {"01_dress": "all", "02_dress": "all", "03_dress": "all", "04_skirt": "all", "05_skirt": "all",
                 "06_skirt": "all", "07_top": "back", "08_top": "front", "09_tee": "back", "10_tee": "back"}
SHORT_MAX, LONG_MIN = 35.0, 45.0  # sleeve length incl. the cap, cm (cap adds ~10 cm to the store's sleeve length)
SLEEVES = {"01_dress": "none", "02_dress": "long", "03_dress": "short", "07_top": "none",
           "08_top": "short", "09_tee": "short", "10_tee": "short"}
MODES = [("AIp", "model", "image"), ("AIp", "item", "image"), ("AIp", "model", "text_image"),
         ("AIp", "item", "text_image"), ("CG", "model", None), ("CG", "item", None)]
MODE_NAME = {("AIp", "model", "image"): "AIpparel: фото на модели", ("AIp", "item", "image"): "AIpparel: фото вещи",
             ("AIp", "model", "text_image"): "AIpparel: модель + описание",
             ("AIp", "item", "text_image"): "AIpparel: вещь + описание",
             ("CG", "model", None): "ChatGarment: фото на модели", ("CG", "item", None): "ChatGarment: фото вещи"}


def panel_class(name):
    n = name.lower()
    if "sleeve" in n or n.startswith("sl_") or "cuff" in n:
        return "sleeve"
    if "collar" in n or "hood" in n or "lapel" in n:
        return "collar"
    if "torso" in n:
        return "torso"
    if "pant" in n:
        return "pants"
    if n.startswith("wb") or "waistband" in n:
        return "wb"
    if "skirt" in n:
        return "skirt"
    return "other"


def load_store(item):
    rows = list(csv.reader(open(PHOTOS / item / "product_measurements.csv")))
    head, data = rows[0], {r[0]: r[1:] for r in rows[1:]}
    out = {}
    for col, val in zip(head[1:], data[REF_SIZE]):
        key, _, _, kind = [x.strip() for x in col.split("|")]
        v = float(val) * (2 if kind == "flat" else 1)
        k = key.lower()
        if k.startswith("chest"):
            out["chest"] = v
        elif k.startswith("waist"):
            out["waist"] = v
        elif k.startswith("hip"):
            out["hips"] = v
        elif "length" in k and "sleeve" not in k:
            out["length"] = v
    return out


# ---------- pattern geometry ----------
class Pattern:
    def __init__(self, specs):
        """specs: list of GarmentCode spec dicts (ChatGarment may give upper + lower)."""
        self.panels, self.links, self.seams = {}, [], []
        for k, spec in enumerate(specs):
            data = convert(spec, 0.5)
            pre = f"{k}:" if len(specs) > 1 else ""
            for name, p in data["panels"].items():
                self.panels[pre + name] = {"name": name, "cls": panel_class(name), "R": np.array(p["R"]),
                                           "t": np.array(p["t"]), "b": np.array(p["boundary"]), "edges": p["edges"]}
            for st in spec["pattern"]["stitches"]:
                a, b = (pre + st[0]["panel"], st[0]["edge"]), (pre + st[1]["panel"], st[1]["edge"])
                self.links.append((a[0], b[0]))
                self.seams.append((a, b))

    def world(self, key):
        p = self.panels[key]
        b = p["b"]
        return (p["R"][:, :2] @ b.T).T + p["t"]

    def front(self, key):
        return self.panels[key]["t"][2] > 0

    def width_at(self, key, h):
        """Length of the panel's cut by the plane y = h (sum of inside segments)."""
        w = self.world(key)
        b = self.panels[key]["b"]
        y = w[:, 1]
        pts = []
        for i in range(len(b)):
            j = (i + 1) % len(b)
            if (y[i] - h) * (y[j] - h) < 0:
                s = (h - y[i]) / (y[j] - y[i])
                pts.append(w[i] + s * (w[j] - w[i]))
        if len(pts) < 2:
            return 0.0
        pts = np.array(pts)
        d = pts[:, [0, 2]]
        axis = d[-1] - d[0]
        axis = axis / (np.linalg.norm(axis) or 1)
        order = np.argsort(d @ axis)
        pts = pts[order]
        return float(sum(np.linalg.norm(pts[i + 1] - pts[i]) for i in range(0, len(pts) - 1, 2)))

    def partners(self, key, e):
        return [b[0] for a, b in self.seams if a == (key, e)] + [a[0] for a, b in self.seams if b == (key, e)]

    def edge_world(self, key, e):
        return self.world(key)[self.panels[key]["edges"][e]]

    def armhole_bottom(self, keys):
        """Top of the side seam (front torso <-> back torso, lowest such seam) = bottom of the armhole."""
        tops = []
        for k in keys:
            if self.panels[k]["cls"] != "torso" or not self.front(k):
                continue
            side = []
            for e in range(len(self.panels[k]["edges"])):
                if any(self.panels[q]["cls"] == "torso" and not self.front(q) for q in self.partners(k, e)):
                    w = self.edge_world(k, e)
                    side.append((w[:, 1].mean(), w[:, 1].max()))
            if side:
                tops.append(min(side)[1])
        return float(np.median(tops)) if tops else None

    def top_edges(self, key):
        """Waist edge(s) of a skirt/pants panel: stitched to waistband/bodice, else the free edges at the top."""
        p = self.panels[key]
        n = len(p["edges"])
        joined = [e for e in range(n) if any(self.panels[q]["cls"] in ("wb", "torso") for q in self.partners(key, e))]
        if joined:
            return joined
        y = self.world(key)[:, 1]
        lim = y.max() - 0.25 * np.ptp(y)
        return [e for e in range(n) if not self.partners(key, e) and self.edge_world(key, e)[:, 1].mean() >= lim]

    def edge_length(self, key, e):
        w = self.edge_world(key, e)
        return float(np.linalg.norm(np.diff(w, axis=0), axis=1).sum())

    def level_length(self, key, d, cell=0.25):
        """Length of the line inside a skirt panel at distance d (cm) from its waist edge,
        measured along the fabric (band area / band width) — like measuring a laid-flat skirt."""
        from matplotlib.path import Path as MplPath
        from scipy.spatial import cKDTree
        p = self.panels[key]
        b = p["b"]
        top = np.concatenate([b[p["edges"][e]] for e in self.top_edges(key)] or [b[:0]])
        if len(top) == 0:
            return 0.0
        # densify the waist edge
        dense = np.concatenate([np.linspace(top[i], top[i + 1], 8) for i in range(len(top) - 1)] or [top])
        lo, hi = b.min(0), b.max(0)
        gx, gy = np.meshgrid(np.arange(lo[0], hi[0], cell), np.arange(lo[1], hi[1], cell))
        g = np.stack([gx.ravel(), gy.ravel()], 1)
        g = g[MplPath(b).contains_points(g)]
        dist, _ = cKDTree(dense).query(g)
        return float(((dist >= d) & (dist < d + 1.0)).sum() * cell * cell / 1.0)

    def skirt_top_y(self, key):
        es = self.top_edges(key)
        return max(self.edge_world(key, e)[:, 1].max() for e in es) if es else self.world(key)[:, 1].max()

    def keys(self, classes):
        return [k for k, p in self.panels.items() if p["cls"] in classes]

    def circumference(self, keys, h):
        """Torso/waistband: horizontal cut. Skirt/pants panels: along the fabric at the same
        depth below their waist edge. GarmentCode's pre-drape placement leaves gaps between
        stitched pieces; a level that falls into the gap above a skirt is measured at its top."""
        upper = [k for k in keys if self.panels[k]["cls"] not in ("skirt", "pants")]
        covered = any(self.width_at(k, h) > 0 for k in upper)
        total = sum(self.width_at(k, h) for k in upper)
        for k in keys:
            if self.panels[k]["cls"] in ("skirt", "pants"):
                d = self.skirt_top_y(k) - h
                if d <= 0.5 and not covered and d > -10:
                    d = 1.0
                total += self.level_length(k, d) if d > 0.5 else 0.0
        return total

    def skirt_hips(self, keys, depth=20.0):
        """Skirt hips the way stores measure: `depth` cm below the top of the waistband, along the fabric."""
        wb = [k for k in keys if self.panels[k]["cls"] == "wb"]
        wb_h = max((float(np.ptp(self.world(k)[:, 1])) for k in wb), default=0.0)
        d = max(depth - wb_h, 1.0)
        return sum(self.level_length(k, d) for k in keys if self.panels[k]["cls"] in ("skirt", "pants"))

    def skirt_waist(self, keys):
        wb = [k for k in keys if self.panels[k]["cls"] == "wb"]
        if wb:
            return sum(float(np.ptp(self.world(k)[:, 0])) for k in wb)
        return sum(self.edge_length(k, e) for k in keys if self.panels[k]["cls"] in ("skirt", "pants")
                   for e in self.top_edges(k))

    def yrange(self, keys):
        ys = np.concatenate([self.world(k)[:, 1] for k in keys])
        return ys.min(), ys.max()

    def connected(self, a_classes, b_classes):
        ca = {k for k in self.panels if self.panels[k]["cls"] in a_classes}
        cb = {k for k in self.panels if self.panels[k]["cls"] in b_classes}
        return any((x in ca and y in cb) or (x in cb and y in ca) for x, y in self.links)

    def sleeve_length(self):
        """Extent along the arm (A-pose ~45 deg) of the longest sleeve-side chain of panels."""
        best = 0.0
        for side, sx in (("left", 1), ("right", -1)):
            ks = [k for k in self.keys({"sleeve"}) if side in self.panels[k]["name"]]
            if not ks:
                continue
            d = np.array([sx * np.cos(np.radians(45)), -np.sin(np.radians(45)), 0.0])
            proj = np.concatenate([self.world(k) @ d for k in ks])
            best = max(best, float(np.ptp(proj)))
        return best


def load_prediction(item, view, mode, model):
    if model == "AIp":
        f = RUNS / "aipparel" / f"{item}__{view}__{mode}" / "NNSewingPattern_pred_specification.json"
        return {"all": Pattern([json.load(open(f))])}, "single"
    d = RUNS / "chatgarment" / "vis_new" / f"valid_garment_{item}__{view}"
    parts = {}
    for sub in ("upper", "lower", "wholebody"):
        f = d / f"valid_garment_{sub}" / f"valid_garment_{sub}_specification.json"
        if f.exists():
            parts[sub] = json.load(open(f))
    out = {k: Pattern([v]) for k, v in parts.items()}
    if "upper" in parts and "lower" in parts:
        out["all"] = Pattern([parts["upper"], parts["lower"]])
    else:
        out["all"] = out["wholebody"]
    return out, "+".join(sorted(parts))


def analyse(item, garment, model, view, mode):
    pats, parts = load_prediction(item, view, mode, model)
    P = pats["all"]
    cls = {p["cls"] for p in P.panels.values()}
    top, bottom = {"torso"}, {"skirt", "wb", "pants"}
    has_top, has_bottom = bool(cls & top), bool(cls & bottom)
    joined = P.connected(top, bottom)
    r = {"item": item, "garment": garment, "model": model, "view": view, "mode": mode or "image",
         "parts": parts, "classes": ",".join(sorted(cls))}
    # garment type and extras
    if model == "CG":
        if garment == "dress":
            r["type_ok"] = parts == "wholebody" and has_top and bool(cls & {"skirt"})
            r["extra"] = parts != "wholebody"
            sel = P
        elif garment == "skirt":
            r["type_ok"] = "lower" in pats
            r["extra"] = "upper" in pats or parts == "wholebody"
            sel = pats.get("lower", P)
        else:
            r["type_ok"] = "upper" in pats
            r["extra"] = "lower" in pats or parts == "wholebody"
            sel = pats.get("upper", P)
    else:
        sel = P
        if garment == "dress":
            r["type_ok"] = has_top and has_bottom and joined and "pants" not in cls
            r["extra"] = "pants" in cls or (has_top and has_bottom and not joined)
        elif garment == "skirt":
            r["type_ok"] = has_bottom and not joined and "pants" not in cls
            r["extra"] = has_top
        else:
            r["type_ok"] = has_top and not joined
            r["extra"] = has_bottom
    body_cls = {"dress": top | bottom, "skirt": bottom, "top": top, "tee": top}[garment]
    keys = sel.keys(body_cls)
    r["all"], r["sel"], r["sel_keys"] = P, sel, keys
    if not keys:
        return r
    lo, hi = sel.yrange(keys)
    which = LENGTH_PANELS[item]
    lk = [k for k in keys if which == "all" or (sel.front(k) == (which == "front"))] or keys
    l_lo, l_hi = sel.yrange(lk)
    r["length"] = l_hi - l_lo
    arm = sel.armhole_bottom(keys)
    r["chest_level"] = (arm - 1.0) if arm else BODY["chest"][0]
    for m, (h, _) in BODY.items():
        if m == "chest":
            h = r["chest_level"]
        if garment == "skirt" and m in ("waist", "hips"):
            r[m] = sel.skirt_waist(keys) if m == "waist" else sel.skirt_hips(keys)
            continue
        if lo + 0.5 < h < hi - 0.5:
            r[m] = sel.circumference(keys, h)
    if item in SLEEVES:
        sl = sel.sleeve_length() if sel.keys({"sleeve"}) else 0.0
        r["sleeve_cm"] = sl
        pred = "none" if sl == 0 else ("short" if sl < SHORT_MAX else ("long" if sl > LONG_MIN else "3/4"))
        r["sleeve_pred"] = pred
        r["sleeve_ok"] = pred == SLEEVES[item]
    return r


# ---------- drawing ----------
def draw_tile(r, title, w=330, h=520):
    """Front panels left, back panels right, at true height; the measured garment in blue,
    everything else the model added in grey; red dashes = body chest / waist / hips."""
    fig = plt.figure(figsize=(w / 100, h / 100), dpi=100)
    ax = fig.add_axes([0.02, 0.02, 0.96, 0.86])
    ax.set_aspect("equal")
    ax.axis("off")
    A, S = r["all"], r["sel"]
    fx = [A.world(k)[:, 0].max() for k in A.panels if A.front(k)] or [0]
    bx = [A.world(k)[:, 0].min() for k in A.panels if not A.front(k)] or [0]
    shift = max(fx) - min(bx) + 15
    body = set(r["sel_keys"]) | set(S.keys({"sleeve", "collar"}))
    for pat, keys, grey in ((A, list(A.panels), True), (S, [k for k in S.panels if k in body], False)):
        for k in keys:
            wv = pat.world(k)
            x = wv[:, 0] + (0 if pat.front(k) else shift)
            colour = "#cfcfcf" if grey else ("#5b8bd6" if pat.front(k) else "#8fb3ea")
            ax.fill(x, wv[:, 1], color=colour, lw=0)
            ax.plot(np.append(x, x[0]), np.append(wv[:, 1], wv[0, 1]), color="#444", lw=0.4)
    for yy, _ in BODY.values():
        ax.axhline(yy, color="#d55", lw=0.5, ls="--")
    ax.set_ylim(-5, 180)
    xs = ax.get_xlim()
    ax.set_xlim(min(xs[0], -40), max(xs[1], 40))
    fig.text(0.5, 0.965, title, ha="center", va="top", fontsize=7.5)
    fig.canvas.draw()
    img = Image.frombuffer("RGBA", fig.canvas.get_width_height(), fig.canvas.buffer_rgba()).convert("RGB")
    plt.close(fig)
    return img


def fmt(v):
    return "—" if v is None else f"{v:.0f}"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "sheets").mkdir(exist_ok=True)
    manifest = json.loads((INPUTS / "manifest.json").read_text())
    items = {}
    for m in manifest:
        items.setdefault(m["item"], m["garment"])
    results = []
    for item, garment in items.items():
        for model, view, mode in MODES:
            results.append(analyse(item, garment, model, view, mode))

    # ---- measurements table
    store = {it: load_store(it) for it in items}
    lines, csv_rows = [], []
    lines.append(f"# Неделя 1: выкройки против замеров изделия (размер {REF_SIZE})\n")
    lines.append("Тело авторов GarmentCode: грудь 99,8 / талия 84,3 / бёдра 103,5 см (≈ L–XL). "
                 "Обхваты выкройки — сумма ширин деталей на уровне тела; изделие — замер ×2 (Zara, грудь Uniqlo). "
                 "«На теле» — если изделие меньше тела, оно тянется до обхвата тела. "
                 "В скобках — выкройка минус изделие «на теле», см.\n")
    for item, garment in items.items():
        st = store[item]
        lines.append(f"\n## {item}\n")
        lines.append("| Мерка | Изделие | На теле | " + " | ".join(MODE_NAME[m] for m in MODES) + " |")
        lines.append("|---|---|---|" + "---|" * len(MODES))
        for meas in ("length", "chest", "waist", "hips"):
            if meas not in st:
                continue
            ref = st[meas]
            worn = ref if meas == "length" else max(ref, BODY[meas][1])
            cells = []
            for (model, view, mode) in MODES:
                r = next(x for x in results if x["item"] == item and x["model"] == model and x["view"] == view
                         and x["mode"] == (mode or "image"))
                v = r.get(meas)
                cells.append("—" if v is None else f"{v:.0f} ({v - worn:+.0f})")
                csv_rows.append([item, garment, MODE_NAME[(model, view, mode)], meas, ref, worn,
                                 None if v is None else round(v, 1), None if v is None else round(v - worn, 1)])
            name = {"length": "длина", "chest": "грудь", "waist": "талия", "hips": "бёдра"}[meas]
            stretch = " ↔" if worn != ref else ""
            lines.append(f"| {name} | {ref:.0f} | {worn:.0f}{stretch} | " + " | ".join(cells) + " |")
    with open(OUT / "measurements.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["item", "garment", "mode", "measure", "store_L", "store_worn", "pattern", "diff"])
        w.writerows(csv_rows)

    # ---- mode comparison
    lines.append("\n## Сравнение режимов\n")
    lines.append("| Режим | Тип вещи верный | Лишняя вещь | Рукава верно | |Δ| длина | |Δ| грудь | |Δ| талия | |Δ| бёдра | n мерок |")
    lines.append("|---|---|---|---|---|---|---|---|---|")
    summary = {}
    for mk in MODES:
        rs = [r for r in results if (r["model"], r["view"], None if r["model"] == "CG" else r["mode"]) == mk]
        rows = [x for x in csv_rows if x[2] == MODE_NAME[mk] and x[7] is not None]
        mae = {m: [abs(x[7]) for x in rows if x[3] == m] for m in ("length", "chest", "waist", "hips")}
        sl = [r["sleeve_ok"] for r in rs if "sleeve_ok" in r]
        s = {"type": sum(r["type_ok"] for r in rs), "extra": sum(r["extra"] for r in rs),
             "sleeve": (sum(sl), len(sl)), **{m: (np.mean(v) if v else None, len(v)) for m, v in mae.items()}}
        summary[MODE_NAME[mk]] = s
        lines.append(f"| {MODE_NAME[mk]} | {s['type']}/10 | {s['extra']}/10 | {s['sleeve'][0]}/{s['sleeve'][1]} | "
                     + " | ".join("—" if s[m][0] is None else f"{s[m][0]:.1f}" for m in ("length", "chest", "waist", "hips"))
                     + f" | {sum(s[m][1] for m in ('length', 'chest', 'waist', 'hips'))} |")
    lines.append("\n## По каждой выкройке\n")
    lines.append("| Вещь | Режим | Части | Классы деталей | Тип | Лишнее | Рукав (см) |")
    lines.append("|---|---|---|---|---|---|---|")
    for r in results:
        mk = (r["model"], r["view"], None if r["model"] == "CG" else r["mode"])
        sl = "" if "sleeve_cm" not in r else f"{r['sleeve_pred']} {r['sleeve_cm']:.0f}{' ✓' if r['sleeve_ok'] else ' ✗'}"
        lines.append(f"| {r['item']} | {MODE_NAME[mk]} | {r['parts']} | {r['classes']} | {'✓' if r['type_ok'] else '✗'} | "
                     f"{'да' if r['extra'] else ''} | {sl} |")
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2, default=float, ensure_ascii=False))

    # ---- sheets
    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 16)
    rows_img = []
    for item, garment in items.items():
        tiles = []
        man = {m["view"]: m for m in manifest if m["item"] == item}
        for view in ("item", "model"):
            ph = Image.open(INPUTS / man[view]["image"]).convert("RGB").resize((330, 330))
            tile = Image.new("RGB", (330, 520), "white")
            tile.paste(ph, (0, 95))
            ImageDraw.Draw(tile).text((8, 8), f"{item}: {'фото вещи' if view == 'item' else 'на модели'}", fill="black", font=font)
            tiles.append(tile)
        for mk in MODES:
            r = next(x for x in results if (x["model"], x["view"], None if x["model"] == "CG" else x["mode"]) == mk
                     and x["item"] == item)
            t = f"{MODE_NAME[mk]}\nтип {'✓' if r['type_ok'] else '✗'}{'  лишнее' if r['extra'] else ''}"
            tiles.append(draw_tile(r, t))
        sheet = Image.new("RGB", (330 * len(tiles), 520), "white")
        for i, t in enumerate(tiles):
            sheet.paste(t, (330 * i, 0))
        sheet.save(OUT / "sheets" / f"{item}.png")
        rows_img.append(sheet)
    allsheet = Image.new("RGB", (rows_img[0].width, 520 * len(rows_img)), "white")
    for i, s in enumerate(rows_img):
        allsheet.paste(s, (0, 520 * i))
    allsheet.resize((allsheet.width // 2, allsheet.height // 2)).save(OUT / "sheets" / "all.png")
    print((OUT / "report.md").read_text()[:6000])


if __name__ == "__main__":
    main()
