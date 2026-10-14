"""Can we regrade a GarmentCode pattern to another body and get the dataset's own result?

For each GarmentCodeData datapoint present in both subsets (same design, neutral body and a
random body): rebuild the pattern from <name>_design_params.yaml with each subset's
<name>_body_measurements.yaml through GarmentCode (MIT) and compare with the dataset's
<name>_specification.json — panel by panel, vertex by vertex (cm). A small difference means
"new size = same design + other body measurements" reproduces the authors' data, so this is
the mechanism we can use for S/M/L.

Usage: python regrade_check.py --gc <GarmentCode checkout> --data data/gcd
"""
import argparse
import json
import os
import sys
from pathlib import Path

import numpy as np
import yaml


def build(gc, design_file, body_file):
    from assets.garment_programs.meta_garment import MetaGarment
    from assets.bodies.body_params import BodyParameters
    design = yaml.safe_load(open(design_file))["design"]
    body = BodyParameters(str(body_file))
    return MetaGarment("regrade", body, design).assembly().pattern  # spec dict: panels, stitches


def compare(ours, ref):
    """Max/mean vertex distance (cm) over panels with matching names, in each panel's 2D frame."""
    names = sorted(set(ours["panels"]) & set(ref["panels"]))
    dists, missing = [], sorted(set(ours["panels"]) ^ set(ref["panels"]))
    for n in names:
        a, b = np.array(ours["panels"][n]["vertices"]), np.array(ref["panels"][n]["vertices"])
        if a.shape != b.shape:
            missing.append(f"{n}(shape {a.shape} vs {b.shape})")
            continue
        dists.append(np.linalg.norm(a - b, axis=1))
    d = np.concatenate(dists) if dists else np.array([np.nan])
    return {"panels": len(names), "mismatch": missing, "max_cm": round(float(d.max()), 3),
            "mean_cm": round(float(d.mean()), 3)}


def panel_widths(spec):
    """Total panel width in x (cm), a rough 'how much fabric around the body' number."""
    return round(sum(np.ptp(np.array(p["vertices"])[:, 0]) for p in spec["panels"].values()), 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gc", required=True)
    ap.add_argument("--data", required=True)
    a = ap.parse_args()
    gc, data = Path(a.gc).resolve(), Path(a.data).resolve()
    sys.path.insert(0, str(gc))
    os.chdir(gc)

    for d in sorted((data / "default_body").glob("rand_*")):
        n = d.name
        r = data / "random_body" / n
        if not (r / f"{n}_specification.json").exists():
            continue
        row = {"name": n}
        for subset, folder in (("neutral", d), ("random", r)):
            ref = json.load(open(folder / f"{n}_specification.json"))["pattern"]
            try:
                ours = build(gc, folder / f"{n}_design_params.yaml", folder / f"{n}_body_measurements.yaml")
                row[subset] = compare(ours, ref)
            except Exception as e:
                row[subset] = {"error": f"{type(e).__name__}: {e}"}
        # Does the same design actually change with the body? (dataset's own patterns)
        neu = json.load(open(d / f"{n}_specification.json"))["pattern"]
        ran = json.load(open(r / f"{n}_specification.json"))["pattern"]
        bn = yaml.safe_load(open(d / f"{n}_body_measurements.yaml"))["body"]
        br = yaml.safe_load(open(r / f"{n}_body_measurements.yaml"))["body"]
        row["body_bust_waist_hips_neutral"] = [round(bn[k], 1) for k in ("bust", "waist", "hips")]
        row["body_bust_waist_hips_random"] = [round(br[k], 1) for k in ("bust", "waist", "hips")]
        row["panel_width_sum_neutral_random"] = [panel_widths(neu), panel_widths(ran)]
        print(json.dumps(row))


if __name__ == "__main__":
    main()
