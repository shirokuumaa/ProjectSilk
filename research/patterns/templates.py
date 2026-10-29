"""Garment templates: a small catalogue of GarmentCode styles (silhouette families) with knobs.

The AI (AIpparel, item photo + garment type) only suggests the template and knobs; the seller
confirms. Sizes are not here: centimetres come from the seller's size chart (week 2, day 7).

  TEMPLATES[name] = {"type", "title", "meta": GarmentCode meta.upper/wb/bottom, "set": fixed params}
  KNOBS: sleeve (none/short/3-4/long), length (category), flare (low/mid/high), neckline, slit.
  Trousers: GarmentCode's Pants (straight / slim / wide by pants.width and pants.flare), length only.
  Jackets and coats: GarmentCode's bodice has no front opening (both front halves are sewn at the centre), no
  lining and no pockets, so they are a closed shell — a straight Shirt with ease, long sleeves, a deep V and
  SimpleLapel lapels; a jacket to the hips, a coat to the knee (length knob hip / thigh / knee).
  A template may carry its own default knobs ("knobs").

design(name, **knobs) -> GarmentCode design dict (default.yaml + template + knobs).
Usage: python templates.py --gc <GarmentCode> [--out runs/day6]  # builds every template on the
neutral body, checks it, draws runs/day6/templates.png
"""
import argparse
import copy
import sys
from pathlib import Path

import yaml

# lapels of the closed jacket / coat: a deep V (fc_depth of the neck depth, 0.3-2) with SimpleLapel along it
LAPELS = {"collar.fc_depth": 1.6, "collar.component.style": "SimpleLapel", "collar.component.depth": 7,
          "collar.component.lapel_standing": False, "sleeve.end_width": 1.0}
# the cuff as wide as the sleeve: with 0.75 (narrowing to the cuff) the XS-M sleeves turned off the arm in the first
# 20 frames and hung off the forearm (59-71 % of the arm covered; 1.0: 85-99 %, L-XXL unchanged 96-98 %),
# README «Короткий сеанс: пояса и манжет»

TEMPLATES = {
    # dresses
    "dress_fitted": {"type": "dress", "title": "Платье прилегающее (лиф с вытачками + юбка-карандаш)",
                     "meta": ("FittedShirt", None, "PencilSkirt"), "set": {}},
    "dress_aline": {"type": "dress", "title": "Платье А-силуэта (прямой лиф + трапеция)",
                    "meta": ("Shirt", None, "Skirt2"), "set": {}},
    "dress_flared": {"type": "dress", "title": "Платье с юбкой-клёш / солнце",
                     "meta": ("Shirt", None, "SkirtCircle"), "set": {}},
    # skirts
    "skirt_pencil": {"type": "skirt", "title": "Юбка прямая / карандаш",
                     "meta": (None, "FittedWB", "PencilSkirt"), "set": {}},
    "skirt_aline": {"type": "skirt", "title": "Юбка-трапеция (А-силуэт)",
                    "meta": (None, "StraightWB", "Skirt2"), "set": {}},
    "skirt_flared": {"type": "skirt", "title": "Юбка клёш / солнце",
                     "meta": (None, "StraightWB", "SkirtCircle"), "set": {}},
    # tops (tees are tops)
    # Shirt with little ease, not FittedShirt: FittedShirt always ends at the waist (no length knob), so a
    # cropped or long fitted tee could not be built (day 7)
    "top_fitted": {"type": "top", "title": "Топ / футболка прилегающая",
                   "meta": ("Shirt", None, None), "set": {"shirt.width": 1.0, "shirt.flare": 0.95}},
    "top_loose": {"type": "top", "title": "Топ / футболка / блузка прямая",
                  "meta": ("Shirt", None, None), "set": {}},
    # trousers: straight waistband at the waist (rise 1.0); pants.width = the leg's base width (crotch
    # extension x 1.0-1.5), pants.flare = the hem against the leg (0.5-1.2)
    "pants_straight": {"type": "pants", "title": "Брюки прямые",
                       "meta": (None, "StraightWB", "Pants"), "set": {"pants.width": 1.0, "pants.flare": 1.0}},
    "pants_slim": {"type": "pants", "title": "Брюки узкие",
                   "meta": (None, "StraightWB", "Pants"), "set": {"pants.width": 1.0, "pants.flare": 0.75}},
    "pants_wide": {"type": "pants", "title": "Брюки широкие",
                   "meta": (None, "StraightWB", "Pants"), "set": {"pants.width": 1.5, "pants.flare": 1.1}},
    # outerwear: a closed shell with lapels (no front opening in GarmentCode); shirt.width = chest ease
    "jacket": {"type": "outerwear", "title": "Жакет / пиджак (закрытая оболочка с лацканами)",
               "meta": ("Shirt", None, None), "knobs": {"length": "hip"}, "set": LAPELS | {"shirt.width": 1.15,
                                                                                          "shirt.flare": 1.05}},
    "coat": {"type": "outerwear", "title": "Пальто (закрытая оболочка с лацканами)",
             "meta": ("Shirt", None, None), "knobs": {"length": "knee"}, "set": LAPELS | {"shirt.width": 1.2,
                                                                                         "shirt.flare": 1.15}},
}

SLEEVE = {"none": None, "short": 0.25, "3/4": 0.6, "long": 1.0}  # sleeve.length, fraction of arm
# length categories -> GarmentCode fractions (skirts: of leg length; tops: of waist line)
LENGTH = {"skirt": {"mini": 0.25, "knee": 0.45, "midi": 0.65, "maxi": 0.9},
          "top": {"cropped": 0.9, "regular": 1.25, "long": 1.6},
          "pants": {"cropped": 0.72, "full": 0.85},   # pants: of the leg below the hip line (M: ~92 / ~101 cm)
          "outerwear": {"hip": 1.65, "thigh": 2.1, "knee": 2.85}}   # outerwear: of the shoulder-waist line
FLARE = {"PencilSkirt": ("pencil-skirt.flare", {"low": 0.9, "mid": 1.05, "high": 1.2}),
         "Skirt2": ("skirt.flare", {"low": 5, "mid": 10, "high": 18}),
         "SkirtCircle": ("flare-skirt.suns", {"low": 0.35, "mid": 0.6, "high": 1.0})}
NECK_DEPTH = {"high": 0.3, "round": 0.4, "square": 0.6, "v": 1.0}
NECK = {"round": "CircleNeckHalf", "v": "VNeckHalf", "square": "SquareNeckHalf", "high": "CircleNeckHalf"}
DEFAULT_KNOBS = {"dress": {"sleeve": "short", "length": "knee", "flare": "mid", "neckline": "round", "slit": False},
                 "skirt": {"length": "knee", "flare": "mid", "slit": False},
                 "top": {"sleeve": "short", "length": "regular", "neckline": "round"},
                 "pants": {"length": "full"},
                 "outerwear": {"sleeve": "long", "length": "hip", "neckline": "v"}}


def _set(design, dotted, value):
    node = design
    for k in dotted.split("."):
        node = node[k]
    node["v"] = value


def design(gc_dir, name, **knobs):
    t = TEMPLATES[name]
    d = copy.deepcopy(yaml.safe_load(open(Path(gc_dir) / "assets/design_params/default.yaml"))["design"])
    k = {**DEFAULT_KNOBS[t["type"]], **t.get("knobs", {}), **knobs}
    upper, wb, bottom = t["meta"]
    _set(d, "meta.upper", upper)
    _set(d, "meta.wb", wb)
    _set(d, "meta.bottom", bottom)
    if upper:
        sl = SLEEVE[k["sleeve"]]
        _set(d, "sleeve.sleeveless", sl is None)
        if sl is not None:
            _set(d, "sleeve.length", sl)
        neck = NECK[k["neckline"]]
        _set(d, "collar.f_collar", neck)
        _set(d, "collar.b_collar", "CircleNeckHalf")
        # front neck depth (GarmentCode default 0.4, min 0.3); day 6 had 1.0 for "round" — a scoop down to the bust
        _set(d, "collar.fc_depth", NECK_DEPTH[k["neckline"]])
        if bottom is None:
            _set(d, "shirt.length", LENGTH["outerwear" if t["type"] == "outerwear" else "top"][k["length"]])
        else:
            _set(d, "shirt.length", 1.0)  # dress: the bodice ends at the waist (GarmentCode default 1.2 = below it)
    if bottom == "Pants":
        _set(d, "pants.length", LENGTH["pants"][k["length"]])
    elif bottom:
        frac = LENGTH["skirt"][k["length"]]
        prefix = {"PencilSkirt": "pencil-skirt", "Skirt2": "skirt", "SkirtCircle": "flare-skirt"}[bottom]
        _set(d, f"{prefix}.length", frac)
        param, levels = FLARE[bottom]
        _set(d, param, levels[k["flare"]])
        if bottom == "PencilSkirt":
            _set(d, "pencil-skirt.back_slit", 0.3 if k.get("slit") else 0)
    for p, v in t["set"].items():
        _set(d, p, v)
    return d


def build(gc_dir, design_dict, body="assets/bodies/mean_all.yaml"):
    """GarmentCode pattern (spec dict) for a design on a body yaml."""
    sys.path.insert(0, str(Path(gc_dir).resolve()))
    from assets.garment_programs.meta_garment import MetaGarment
    from assets.bodies.body_params import BodyParameters
    b = BodyParameters(str(Path(gc_dir) / body))
    g = MetaGarment("tmpl", b, design_dict)
    return g.assembly().pattern, g.is_self_intersecting()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gc", required=True)
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent / "runs" / "day6"))
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np
    from blender.pattern_to_panels import convert
    fig, axes = plt.subplots(1, len(TEMPLATES), figsize=(3 * len(TEMPLATES), 4.5))
    for ax, name in zip(axes, TEMPLATES):
        spec, bad = build(a.gc, design(a.gc, name))
        data = convert({"pattern": spec}, 1.0)
        for p in data["panels"].values():
            w = (np.array(p["R"])[:, :2] @ np.array(p["boundary"]).T).T + np.array(p["t"])
            ax.fill(w[:, 0] + (0 if p["t"][2] > 0 else 80), w[:, 1], alpha=0.8,
                    color="#5b8bd6" if p["t"][2] > 0 else "#8fb3ea", ec="#333", lw=0.4)
        ax.set_aspect("equal"); ax.axis("off"); ax.set_ylim(0, 175)
        ax.set_title(f"{name}\n{len(spec['panels'])} деталей{' ⚠ самопересечение' if bad else ''}", fontsize=8)
        print(f"{name}: {len(spec['panels'])} panels, self-intersecting={bad}")
    fig.savefig(out / "templates.png", dpi=110, bbox_inches="tight")


if __name__ == "__main__":
    main()
