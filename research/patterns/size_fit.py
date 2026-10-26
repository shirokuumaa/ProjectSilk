"""Day 7: the seller's size chart -> template knobs for each size (S and L), on our MPFB body of that size.

For every item: the confirmed template + style knobs (day 6 labels) -> GarmentCode pattern drafted for
the MPFB body of the size (mpfb_body.py) -> knobs fitted by bisection so that the flat pattern matches
the store's garment measurements for that size, in this order: length -> chest -> waist -> hips ->
sleeve, target +-1 cm (measured like week 1: flat pattern in GarmentCode's placement around the body).

Knobs per measurement, tried in order until one moves the measurement:
  length  — shirt.length (tops) / skirt length (dresses, skirts);
  chest   — shirt.width (Shirt, 1.0-1.3 x bust); else the drafting body's bust (FittedShirt, or a stretch
            garment smaller than the body: the pattern goes below the body, the fabric must stretch);
  waist   — the drafting body's waist (bodice dart / skirt top);
  hips    — skirt.flare (A-line), flare-skirt.suns (flared), the drafting body's hips (pencil);
  sleeve  — sleeve.length.
"Drafting body" = the size's body measurements with an ease factor; the simulation body stays the size's
own MPFB body. Store conventions: Zara widths flat x2; Uniqlo chest flat x2, skirt waist/hips as is;
Uniqlo sleeve "from centre back" minus half the shoulder width.

Usage: python size_fit.py [items]   -> runs/day7/{fit/*.json, patterns/*.json, fit.json}
       python size_fit.py --run allsizes --all-sizes 03_dress 04_skirt 09_tee
                                     -> every chart size, bodies and results in runs/allsizes/
       python size_fit.py --report  -> runs/day7/{report.md, sheet_S_vs_L.png} from fit.json
"""
import copy
import csv
import json
import sys
from pathlib import Path

import numpy as np
import yaml

import week1_report as W
from suggest_template import LABELS, distance_field
from templates import TEMPLATES, design as tdesign

HERE = Path(__file__).resolve().parent
GC = HERE / ".envs" / "src" / "GarmentCode"
BODIES = HERE / "runs" / "day7" / "bodies"
OUT = HERE / "runs" / "day7"
STORE = {"01_dress": "zara", "02_dress": "zara", "03_dress": "zara", "04_skirt": "zara", "05_skirt": "zara",
         "06_skirt": "uniqlo", "07_top": "uniqlo", "08_top": "zara", "09_tee": "uniqlo", "10_tee": "uniqlo"}
SIZES = ("S", "L")
TOL = 1.0
# --run <name>: bodies from runs/<name>/bodies and results into runs/<name>/ (default: day7);
# --all-sizes: every size of the item's store chart (product_measurements.csv) instead of S and L
if "--run" in sys.argv:
    OUT = HERE / "runs" / sys.argv[sys.argv.index("--run") + 1]
    BODIES = OUT / "bodies"
ALL_SIZES = "--all-sizes" in sys.argv


def sizes_of(item):
    if not ALL_SIZES:
        return SIZES
    return tuple(r[0] for r in list(csv.reader(open(W.PHOTOS / item / "product_measurements.csv")))[1:])
# style knobs not given by the size chart: from the confirmed labels (day 6), flare level from the photos
STYLE = {"01_dress": {"sleeve": "none", "flare": "high"}, "02_dress": {"sleeve": "long"},
         "03_dress": {"sleeve": "short"}, "04_skirt": {"flare": "mid"}, "05_skirt": {"slit": True},
         "06_skirt": {"flare": "low"}, "07_top": {"sleeve": "none"}, "08_top": {"sleeve": "short"},
         "09_tee": {"sleeve": "short"}, "10_tee": {"sleeve": "short"}}

sys.path.insert(0, str(GC))
from assets.bodies.body_params import BodyParameters  # noqa: E402
from assets.garment_programs.meta_garment import MetaGarment  # noqa: E402


def store_targets(item, size):
    rows = list(csv.reader(open(W.PHOTOS / item / "product_measurements.csv")))
    head, data = rows[0], {r[0]: r[1:] for r in rows[1:]}
    out, shoulder, sleeve_cb = {}, None, None
    for col, val in zip(head[1:], data[size]):
        key, _, _, kind = [x.strip() for x in col.split("|")]
        v = float(val) * (2 if kind == "flat" else 1)
        k = key.lower()
        if k.startswith("chest"):
            out["chest"] = v
        elif k.startswith("waist"):
            out["waist"] = v
        elif k.startswith("hip"):
            out["hips"] = v
        elif k.startswith("shoulder"):
            shoulder = v
        elif k.startswith("sleeve"):
            if "center back" in k:
                sleeve_cb = v
            else:
                out["sleeve"] = v
        elif "length" in k:
            out["length"] = v
    if sleeve_cb is not None and shoulder is not None:
        out["sleeve"] = sleeve_cb - shoulder / 2
    return out


def armhole_bottom(P, keys):
    """Top of the side seam (front <-> back torso): the highest side-seam edge — a bust dart splits the
    side seam, and its lower part ends at the dart (week1_report took the lowest edge)."""
    tops = []
    for k in keys:
        if P.panels[k]["cls"] != "torso" or not P.front(k):
            continue
        side = []
        for e in range(len(P.panels[k]["edges"])):
            w = P.edge_world(k, e)
            vertical = np.ptp(w[:, 1]) > np.ptp(w[:, 0])          # not the shoulder seam
            if vertical and any(P.panels[q]["cls"] == "torso" and not P.front(q) for q in P.partners(k, e)):
                side.append(w[:, 1].max())
        if side:
            tops.append(max(side))
    return float(np.median(tops)) if tops else None


class Drafter:
    def __init__(self, item, size):
        self.item, self.size = item, size
        self.garment = item.split("_")[1]
        self.template = LABELS[item]["template"]
        self.kind = TEMPLATES[self.template]["type"]
        self.body_name = f"{STORE[item]}_{size}"
        self.body_file = BODIES / f"{self.body_name}.yaml"
        self.levels = {r["name"]: r["levels"] for r in json.load(open(BODIES / "bodies.json"))}[self.body_name]
        self.gcbody = yaml.safe_load(open(self.body_file))["body"]
        knobs = {k: v for k, v in STYLE[item].items()}
        knobs["length"] = LABELS[item]["length"] if LABELS[item]["length"] != "regular" or self.kind == "top" else "knee"
        if self.kind != "top" and knobs["length"] not in ("mini", "knee", "midi", "maxi"):
            knobs["length"] = "knee"
        self.design = tdesign(GC, self.template, **knobs)
        self.ease = {"bust": 1.0, "waist": 1.0, "hips": 1.0}
        self.length_panels = W.LENGTH_PANELS[item]   # which panels span the store's "length"

    # ── knobs ──
    def get(self, knob):
        src, key = knob
        if src == "body":
            return self.ease[key]
        node = self.design
        for k in key.split("."):
            node = node[k]
        return node["v"]

    def set(self, knob, v):
        src, key = knob
        if src == "body":
            self.ease[key] = v
            return
        node = self.design
        for k in key.split("."):
            node = node[k]
        node["v"] = int(round(v)) if node.get("type") == "int" else float(v)

    def bounds(self, knob):
        src, key = knob
        if src == "body":
            return (0.8, 1.4)
        node = self.design
        for k in key.split("."):
            node = node[k]
        lo, hi = node["range"]
        if key == "shirt.width":
            lo = 0.9
        return float(lo), float(hi)

    # ── build + measure ──
    def build(self):
        b = BodyParameters(str(self.body_file))
        for k, e in self.ease.items():
            if e != 1.0:
                b[k] = self.gcbody[k] * e
        g = MetaGarment("fit", b, copy.deepcopy(self.design))
        return g.assembly().pattern, g.is_self_intersecting()

    def measure(self, spec=None):
        spec = spec or self.build()[0]
        P = W.Pattern([{"pattern": spec}])
        cls = {"dress": {"torso", "skirt", "wb"}, "skirt": {"skirt", "wb"}, "top": {"torso"}}[self.kind]
        keys = P.keys(cls)
        m = {}
        which = self.length_panels
        lk = [k for k in keys if which == "all" or (P.front(k) == (which == "front"))] or keys
        # length along the body: bodice by height (shoulder to its hem), skirt along the fabric
        # (furthest distance from the waist edge) — a flat circle-skirt sector is taller than the skirt
        torso = [k for k in lk if P.panels[k]["cls"] == "torso"]
        skirt = [k for k in lk if P.panels[k]["cls"] == "skirt"]
        wb = [k for k in lk if P.panels[k]["cls"] == "wb"]
        m["length"] = (np.ptp(P.yrange(torso)) if torso else 0.0) \
            + max((float(np.percentile(distance_field(P, k)[0], 99.5)) for k in skirt), default=0.0) \
            + max((float(np.ptp(P.world(k)[:, 1])) for k in wb), default=0.0)
        if self.kind == "skirt":
            m["waist"], m["hips"] = P.skirt_waist(keys), P.skirt_hips(keys)
        else:
            arm = armhole_bottom(P, keys)
            m["chest"] = P.circumference(keys, (arm - 1.0) if arm else self.levels["bust_y"], extent=True)
            if self.kind == "dress":   # the waist seam: bodice edges sewn to the skirt (dart openings excluded)
                m["waist"] = sum(P.edge_length(k, e) for k in keys if P.panels[k]["cls"] == "torso"
                                 for e in range(len(P.panels[k]["edges"]))
                                 if any(P.panels[q]["cls"] in ("skirt", "wb") for q in P.partners(k, e)))
                m["hips"] = P.circumference(keys, self.levels["hip_y"])
        if P.keys({"sleeve"}):
            m["sleeve"] = self.sleeve_length(P)
        return m

    def sleeve_length(self, P):
        """Shoulder (cap top) to hem along the arm direction of this body."""
        a = np.radians(self.gcbody["arm_pose_angle"])
        best = 0.0
        for side, sx in (("left", 1), ("right", -1)):
            ks = [k for k in P.keys({"sleeve"}) if side in P.panels[k]["name"]]
            if ks:
                d = np.array([sx * np.cos(a), -np.sin(a), 0.0])
                best = max(best, float(np.ptp(np.concatenate([P.world(k) @ d for k in ks]))))
        return best

    def knobs_for(self, m):
        upper, wb, bottom = TEMPLATES[self.template]["meta"]
        prefix = {"PencilSkirt": "pencil-skirt", "Skirt2": "skirt", "SkirtCircle": "flare-skirt"}.get(bottom)
        if m == "length":
            return [("design", "shirt.length")] if self.kind == "top" else [("design", f"{prefix}.length")]
        if m == "chest":
            return ([("design", "shirt.width")] if upper == "Shirt" else []) + [("body", "bust")]
        if m == "waist":
            return ([("design", "shirt.flare")] if upper == "Shirt" else []) + [("body", "waist")]
        if m == "hips":
            return {"Skirt2": [("design", "skirt.flare")], "SkirtCircle": [("design", "flare-skirt.suns")],
                    "PencilSkirt": [("body", "hips")]}.get(bottom, [])
        if m == "sleeve":
            return [("design", "sleeve.length")]
        return []

    def fit_one(self, m, target):
        """Bisection on the first knob that moves measurement m; returns (value, knob, steps)."""
        for knob in self.knobs_for(m):
            lo, hi = self.bounds(knob)
            v0 = self.get(knob)
            def f(v):
                self.set(knob, v)
                try:
                    return self.measure().get(m, np.nan)
                except Exception:                       # GarmentCode refuses the shape (e.g. invalid dart)
                    return np.nan
            # shrink the range from an invalid end towards the current value
            for _ in range(6):
                flo = f(lo)
                if np.isfinite(flo):
                    break
                lo = 0.5 * (lo + v0)
            for _ in range(6):
                fhi = f(hi)
                if np.isfinite(fhi):
                    break
                hi = 0.5 * (hi + v0)
            if not np.isfinite(flo) or not np.isfinite(fhi) or abs(fhi - flo) < 0.5:
                self.set(knob, v0)
                continue
            inc = fhi > flo
            if (target - flo) * (target - fhi) > 0:          # out of reach: clamp to the nearer end,
                v = lo if abs(target - flo) < abs(target - fhi) else hi   # then try the next knob
                self.set(knob, v)
                last = (f(v), knob, "clamped")
                continue
            a, b, steps = lo, hi, 0
            while steps < 25:
                mid = 0.5 * (a + b)
                fm = f(mid)
                steps += 1
                if not np.isfinite(fm):
                    break
                if abs(fm - target) <= 0.3:
                    break
                if (fm < target) == inc:
                    a = mid
                else:
                    b = mid
            return fm, knob, steps
        if "last" in locals():
            return last
        return self.measure().get(m, np.nan), None, "no knob"


def fit_item(item, size):
    D = Drafter(item, size)
    return {"item": item, "size": size, "body": D.body_name, "template": D.template,
            **fit_drafter(D, store_targets(item, size))}


def fit_drafter(D, target):
    """Fit the drafter's knobs to the garment measurements target {length, chest, waist, hips, sleeve}
    (also used by scripts/garments/patterns_job.py for a seller's product)."""
    before = D.measure()
    log = {}
    for _ in range(2):               # two passes: a later knob can move an earlier measurement (flare -> chest)
        for m in ("length", "chest", "waist", "hips", "sleeve"):
            if m in target and m in before:
                val, knob, steps = D.fit_one(m, target[m])
                log[m] = {"knob": None if knob is None else ".".join(knob), "steps": steps}
    spec, bad = D.build()
    after = D.measure(spec)
    knobs = {".".join(k): round(D.get(k), 3) for m in log for k in D.knobs_for(m)[:2]}
    return {"target": target,
            "before": before, "after": after, "log": log, "knobs": knobs, "ease": D.ease,
            "self_intersecting": bool(bad), "spec": spec, "body_measure": {k: D.gcbody[k] for k in ("bust", "waist", "hips")}}


def main(items=None):
    """Fit the given items (default: all) for S and L; one json per item-size in runs/day7/fit/ (so several
    processes can run in parallel), patterns in runs/day7/patterns/; then fit.json collects all of them."""
    (OUT / "fit").mkdir(parents=True, exist_ok=True)
    (OUT / "patterns").mkdir(exist_ok=True)
    for item in items or LABELS:
        for size in sizes_of(item):
            try:
                r = fit_item(item, size)
            except Exception as e:
                print(item, size, "FAILED", type(e).__name__, str(e)[:120], flush=True)
                continue
            err = {m: round(r["after"][m] - r["target"][m], 1) for m in r["target"] if m in r["after"]}
            print(item, size, r["template"], "err", err, {m: v["knob"] for m, v in r["log"].items()}, flush=True)
            json.dump({"pattern": r["spec"]}, open(OUT / "patterns" / f"{item}_{size}.json", "w"))
            json.dump({k: v for k, v in r.items() if k != "spec"}, open(OUT / "fit" / f"{item}_{size}.json", "w"),
                      indent=1, default=float)
    collect()


def collect():
    res = [json.load(open(f)) for f in sorted((OUT / "fit").glob("*.json"))]
    json.dump(res, open(OUT / "fit.json", "w"), indent=1, default=float)


MEAS = ("length", "chest", "waist", "hips", "sleeve")
NAME = {"length": "длина", "chest": "грудь", "waist": "талия", "hips": "бёдра", "sleeve": "рукав"}


def report():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    res = sorted(json.load(open(OUT / "fit.json")), key=lambda r: (r["item"], SIZES.index(r["size"])))
    bodies = {r["name"]: r for r in json.load(open(BODIES / "bodies.json"))}
    L = ["# День 7: сетка продавца → ручки шаблона, на болванке MPFB размера\n",
         "Цель — замеры изделия магазина для размера (Zara: ширины × 2; Uniqlo: грудь × 2, юбка как есть, "
         "рукав «от центра спинки» минус пол-плеча). Выкройка мерится плоской в расстановке GarmentCode вокруг "
         "болванки размера; длина — лиф по высоте + юбка по ткани. Δ = выкройка − цель, см; ✓ — |Δ| ≤ 1.\n",
         "## Болванки размеров (MPFB, обмеры GarmentCode)\n",
         "| Болванка | Цель: рост / грудь / талия / бёдра | Обмер: грудь / талия / бёдра | Плечи | Рука | Талия сзади (waist_back_width) |",
         "|---|---|---|---|---|---|"]
    for n, b in bodies.items():
        t, g = b["target"], b["gc"]
        L.append(f"| {n} | {t['height']:.0f} / {t['bust']} / {t['waist']} / {t['hips']} | {g['bust']:.1f} / "
                 f"{g['waist']:.1f} / {g['hips']:.1f} | {g['shoulder_w']:.1f} | {g['arm_length']:.1f} | "
                 f"{g['waist_back_width']:.1f} |")
    L += ["\n## Подбор по вещам\n",
          "| Вещь | Размер | Шаблон | " + " | ".join(NAME[m] + ": цель / получилось / Δ" for m in MEAS) + " | Ручки | Свобода тела кроя |",
          "|---|---|---|" + "---|" * len(MEAS) + "---|---|"]
    ok = tot = 0
    for r in res:
        cells = []
        for m in MEAS:
            if m in r["target"] and m in r["after"]:
                d = r["after"][m] - r["target"][m]
                good = abs(d) <= TOL
                ok += good
                tot += 1
                knob = r["log"].get(m, {})
                note = "" if good else (" (упор)" if knob.get("steps") == "clamped" else
                                       (" (нет ручки)" if knob.get("knob") is None else ""))
                cells.append(f"{r['target'][m]:.1f} / {r['after'][m]:.1f} / {d:+.1f}{' ✓' if good else ''}{note}")
            elif m in r["target"]:
                cells.append(f"{r['target'][m]:.1f} / нет в выкройке")
            else:
                cells.append("—")
        knobs = ", ".join(f"{'.'.join(k.split('.')[-2:])}={v}" for k, v in r["knobs"].items() if not k.startswith("body"))
        ease = ", ".join(f"{k} ×{v:.2f}" for k, v in r["ease"].items() if abs(v - 1) > 1e-3) or "—"
        L.append(f"| {r['item']} | {r['size']} | {r['template']} | " + " | ".join(cells) + f" | {knobs} | {ease} |")
    L.insert(2, f"**Итого: {ok} из {tot} мерок в пределах ±{TOL:.0f} см.** (упор) — ручка дошла до границы "
                f"диапазона GarmentCode.\n")
    (OUT / "report.md").write_text("\n".join(L) + "\n")

    # sheet: S (blue) vs L (orange) patterns per item, panels as laid out by GarmentCode
    from blender.pattern_to_panels import convert
    items = sorted({r["item"] for r in res})
    fig, axes = plt.subplots(2, 5, figsize=(25, 12))
    for ax, item in zip(axes.ravel(), items):
        drawn = {}
        for size in ("S", "L"):
            f = OUT / "patterns" / f"{item}_{size}.json"
            if f.exists():
                data = convert(json.load(open(f)), 1.0, interior=False)
                drawn[size] = [((np.array(p["R"])[:, :2] @ np.array(p["boundary"]).T).T + np.array(p["t"]), p["t"][2] > 0)
                               for p in data["panels"].values()]
        allw = [w for v in drawn.values() for w in v]
        fx = max(w[:, 0].max() for w, fr in allw if fr) if any(fr for _, fr in allw) else 0
        bx = min(w[:, 0].min() for w, fr in allw if not fr) if any(not fr for _, fr in allw) else 0
        off = fx - bx + 15                                 # back panels to the right of the front ones
        for size, col in (("S", "#3b6fd1"), ("L", "#e07b39")):
            for w, fr in drawn.get(size, []):
                ax.plot(np.r_[w[:, 0], w[:1, 0]] + (0 if fr else off), np.r_[w[:, 1], w[:1, 1]], color=col, lw=0.8)
        r = {x["size"]: x for x in res if x["item"] == item}
        tmpl = next(iter(r.values()))["template"] if r else ""
        ax.set_title(f"{item} ({tmpl})\nсиний S, оранжевый L; слева перед, справа спинка", fontsize=9)
        ax.set_aspect("equal")
        ax.axis("off")
    fig.savefig(OUT / "sheet_S_vs_L.png", dpi=80, bbox_inches="tight")
    print("\n".join(L))


if __name__ == "__main__":
    if "--report" in sys.argv:
        collect()
        report()
    else:
        skip = {sys.argv[sys.argv.index("--run") + 1]} if "--run" in sys.argv else set()
        main([a for a in sys.argv[1:] if not a.startswith("-") and a not in skip] or None)
