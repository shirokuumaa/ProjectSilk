"""AIpparel pattern -> template + knobs suggestion (the seller confirms), and its check on 10 items.

The seller states the garment type (dress / skirt / top), so the rules only choose within it.
Centimetres from AIpparel are not used as sizes; only shape ratios that do not depend on size:
  * sleeve      — sleeve length incl. cap: none / short (<35) / 3/4 / long (>45 cm);
  * torso fit   — waist / chest circumference of the bodice: fitted < 0.93 (body 0.85, straight ~1.0);
  * skirt shape — hem / hip length along the fabric (hip 20 cm below the waist edge):
                  pencil < 1.15, A-line < 1.6, flared otherwise; flare knob low/mid/high inside each;
  * length      — hem height on the 172 cm body: maxi <= 25, midi <= 45, knee <= 60, mini above;
                  tops: cropped hem above 98, long below 75 (lengths in cm come from the seller anyway).
If the pattern has no panels of the stated type (AIpparel drew another garment), the type's
default template is suggested with low confidence.

Usage: python suggest_template.py   -> runs/day6/suggestions.json, runs/day6/report.md
"""
import json
from pathlib import Path

import numpy as np

import week1_report as W
from templates import TEMPLATES

OUT = Path(__file__).resolve().parent / "runs" / "day6"

# Ground truth: my labels from the photos, store descriptions and measurements
# (alt = also acceptable). Shown to the user for review.
LABELS = {
    "01_dress": {"template": "dress_flared", "alt": [], "sleeve": "none", "length": "maxi"},
    "02_dress": {"template": "dress_fitted", "alt": [], "sleeve": "long", "length": "maxi"},
    "03_dress": {"template": "dress_fitted", "alt": [], "sleeve": "short", "length": "mini"},
    "04_skirt": {"template": "skirt_flared", "alt": ["skirt_aline"], "length": "midi"},
    "05_skirt": {"template": "skirt_pencil", "alt": [], "length": "midi"},
    "06_skirt": {"template": "skirt_aline", "alt": [], "length": "mini"},
    "07_top": {"template": "top_loose", "alt": [], "sleeve": "none", "length": "regular"},
    "08_top": {"template": "top_fitted", "alt": ["top_loose"], "sleeve": "short", "length": "regular"},
    "09_tee": {"template": "top_loose", "alt": [], "sleeve": "short", "length": "regular"},
    "10_tee": {"template": "top_fitted", "alt": [], "sleeve": "short", "length": "cropped"},
}
TYPE = {"dress": "dress", "skirt": "skirt", "top": "top", "tee": "top"}


def distance_field(P, key, cell=0.5):
    """Distances (cm, along the flat panel) from the waist edge for grid points inside the panel."""
    from matplotlib.path import Path as MplPath
    from scipy.spatial import cKDTree
    p = P.panels[key]
    b = p["b"]
    tops = [b[p["edges"][e]] for e in P.top_edges(key)]
    if not tops:
        return np.zeros(0), cell
    dense = np.concatenate([np.linspace(t[i], t[i + 1], 8) for t in tops for i in range(len(t) - 1)])
    lo, hi = b.min(0), b.max(0)
    gx, gy = np.meshgrid(np.arange(lo[0], hi[0], cell), np.arange(lo[1], hi[1], cell))
    g = np.stack([gx.ravel(), gy.ravel()], 1)
    g = g[MplPath(b).contains_points(g)]
    return cKDTree(dense).query(g)[0], cell


def skirt_ratio(P, keys):
    """hem / hip length along the fabric over the skirt panels (None if no skirt panels).
    hip: 20 cm below the waist edge (or mid-depth for short skirts); hem: the 1 cm band just
    above the 97th percentile of the distance from the waist edge."""
    sk = [k for k in keys if P.panels[k]["cls"] in ("skirt", "pants")]
    hip = hem = 0.0
    for k in sk:
        d, cell = distance_field(P, k)
        if len(d) == 0:
            continue
        dmax = float(np.percentile(d, 97))  # robust to slit corners and pointed hems
        band = lambda a: float(((d >= a) & (d < a + 1.0)).sum() * cell * cell)
        hip += band(min(20.0, dmax / 2))
        hem += band(max(dmax - 2.5, 0.5))
    return hem / hip if hip > 0 else None


def torso_fit(P, keys, chest_level):
    torso = [k for k in keys if P.panels[k]["cls"] == "torso"]
    if not torso:
        return None
    lo, _ = P.yrange(torso)
    chest = P.circumference(torso, chest_level)
    waist_level = max(111.0, lo + 2.0)
    waist = P.circumference(torso, waist_level)
    return waist / chest if chest > 0 else None


def suggest(r):
    """r: week1_report.analyse() result for one AIpparel prediction."""
    t = TYPE[r["garment"]]
    P, keys = r["sel"], r["sel_keys"]
    f = {"sleeve": r.get("sleeve_pred")}
    have = {P.panels[k]["cls"] for k in keys}
    conf = "high"
    if (t == "dress" and not ({"torso"} <= have and have & {"skirt"})) or (t == "skirt" and not have & {"skirt"}) \
            or (t == "top" and "torso" not in have):
        conf = "low"
    f["skirt_ratio"] = skirt_ratio(P, keys) if t in ("dress", "skirt") else None
    f["fit_ratio"] = torso_fit(P, keys, r.get("chest_level", 124.0)) if t in ("dress", "top") else None
    lo = P.yrange(keys)[0] if keys else None
    s = f["skirt_ratio"]
    shape = None if s is None else ("pencil" if s < 1.15 else ("aline" if s < 1.6 else "flared"))
    fitted = None if f["fit_ratio"] is None else f["fit_ratio"] < 0.93
    if t == "skirt":
        name = {"pencil": "skirt_pencil", "aline": "skirt_aline", "flared": "skirt_flared"}.get(shape, "skirt_aline")
    elif t == "dress":
        if shape == "flared":
            name = "dress_flared"
        elif shape == "pencil" or (fitted and shape != "aline"):
            name = "dress_fitted"
        else:
            name = "dress_aline"
    else:
        name = "top_fitted" if fitted else "top_loose"
    knobs = {}
    if t in ("dress", "top"):
        knobs["sleeve"] = f["sleeve"] or "short"
    if s is not None:
        bands = {"pencil": (1.0, 1.08), "aline": (1.3, 1.45), "flared": (2.0, 2.6)}[shape]
        knobs["flare"] = "low" if s < bands[0] else ("mid" if s < bands[1] else "high")
    if lo is not None:
        if t == "top":
            knobs["length"] = "cropped" if lo > 98 else ("long" if lo < 75 else "regular")
        else:
            knobs["length"] = "maxi" if lo <= 25 else ("midi" if lo <= 45 else ("knee" if lo <= 60 else "mini"))
    if conf == "low":
        name = {"dress": "dress_aline", "skirt": "skirt_aline", "top": "top_loose"}[t]
    return {"template": name, "knobs": knobs, "confidence": conf,
            "features": {k: (round(v, 2) if isinstance(v, float) else v) for k, v in f.items()}}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((W.INPUTS / "manifest.json").read_text())
    items = {}
    for m in manifest:
        items.setdefault(m["item"], m["garment"])
    modes = [(v, m) for (mdl, v, m) in W.MODES if mdl == "AIp"]
    res = {}
    for item, garment in items.items():
        for view, mode in modes:
            r = W.analyse(item, garment, "AIp", view, mode)
            res[(item, view, mode)] = suggest(r)

    lines = ["# День 6: подсказка шаблона по выкройке AIpparel\n",
             "Тип вещи даёт продавец; правила выбирают шаблон внутри типа. ✓ — совпало с разметкой, "
             "≈ — допустимая альтернатива, ✗ — нет.\n",
             "## Сводка по режимам\n",
             "| Режим AIpparel | Шаблон точно | Шаблон с альтернативами | Рукав | Длина (категория) | Низкая уверенность |",
             "|---|---|---|---|---|---|"]
    detail = []
    for view, mode in modes:
        ok = alt = sl = sl_n = ln = low = 0
        for item in items:
            lab, s = LABELS[item], res[(item, view, mode)]
            ok += s["template"] == lab["template"]
            alt += s["template"] == lab["template"] or s["template"] in lab["alt"]
            if "sleeve" in lab:
                sl_n += 1
                sl += s["knobs"].get("sleeve") == lab["sleeve"]
            ln += s["knobs"].get("length") == lab["length"]
            low += s["confidence"] == "low"
        name = W.MODE_NAME[("AIp", view, mode)]
        lines.append(f"| {name} | {ok}/10 | {alt}/10 | {sl}/{sl_n} | {ln}/10 | {low}/10 |")
    lines += ["\n## По вещам: режим «фото вещи + описание» (основной)\n",
              "| Вещь | Разметка (правильно) | Подсказка | Рукав: разметка → подсказка | Длина: разметка → подсказка | Признаки |",
              "|---|---|---|---|---|---|"]
    for item in items:
        lab, s = LABELS[item], res[(item, "item", "text_image")]
        mark = "✓" if s["template"] == lab["template"] else ("≈" if s["template"] in lab["alt"] else "✗")
        alts = f" (или {', '.join(lab['alt'])})" if lab["alt"] else ""
        sleeve = f"{lab.get('sleeve', '—')} → {s['knobs'].get('sleeve', '—')}"
        feats = ", ".join(f"{k}={v}" for k, v in s["features"].items() if v is not None)
        lines.append(f"| {item} | {lab['template']}{alts} | {s['template']} {mark}"
                     f"{' (низкая уверенность)' if s['confidence'] == 'low' else ''} | {sleeve} | "
                     f"{lab['length']} → {s['knobs'].get('length', '—')} | {feats} |")
    (OUT / "report.md").write_text("\n".join(lines) + "\n")
    (OUT / "suggestions.json").write_text(json.dumps(
        {f"{i}__{v}__{m}": s for (i, v, m), s in res.items()}, indent=2, ensure_ascii=False))
    print("\n".join(lines))


if __name__ == "__main__":
    main()
