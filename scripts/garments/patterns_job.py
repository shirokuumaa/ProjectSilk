"""Patterns of a seller's product for every size of its chart, and the Newton inputs ("boxes") — stage 1 of
the garment pipeline (docs/TRYON_REVIEW.md, section 3). CPU only; started by the server as a separate process
(server/services/patternJobs.js) after the product is saved.

The research code does the work (research/patterns/, see its README, "day 7" and "3.5B"):
  size row (garment measurements) -> the figure the size is cut for: body = (garment - ideal ease) / (1 - stretch),
      the same rule as the app's size advice (client/src/utils/fitCalculator.js; a server test keeps the numbers
      in step); girths the chart lacks come from the general chart (mpfb_body.CHARTS) shifted to the known ones
  -> our MPFB body of that figure (mpfb_body.build) -> the seller's silhouette (templates.py) drafted on it and its
      knobs fitted to the size's measurements (size_fit.Drafter, size_fit.fit_drafter)
  -> the pattern with GarmentCode's spec header and the welded body (simtest_prep.assemble, weld_body)
  -> GarmentCode's box mesh, the start of the Newton simulation (pod/box_case.py, in the gcsim environment).

Usage: <research env python> scripts/garments/patterns_job.py --job job.json --out <dir>
  job.json: {"product", "garmentType", "stretch", "silhouette": {"template", "sleeve"?, "length"},
             "sizeChart": [{"size", "chest"?, "waist"?, "hips"?, "length"?, "shoulder"?, "sleeve"?, "fit"?}]}
  -> <dir>/result.json: {"sizes": [{"size", "body", "target", "measured", "within_1cm", "box"}],
                         "failed": [{"size", "error"}]}  (errors are for the seller, in English)
     <dir>/bodies/, bodies_mpfb/, cases/<size>/, boxes/<size>/
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESEARCH = ROOT / "research" / "patterns"
GC = Path(os.environ.get("GARMENTCODE_DIR", RESEARCH / ".envs" / "src" / "GarmentCode"))
BOX_PYTHON = os.environ.get("BOX_PYTHON", str(RESEARCH / ".envs" / "gcsim" / "bin" / "python"))
SIM_CONFIG = Path(os.environ.get("SIM_CONFIG", RESEARCH / "data" / "gcd" / "default_body" / "dataset_properties_default_body.yaml"))

# client/src/utils/fitCalculator.js: EASE_TARGETS[fit].ideal (cm) and STRETCH_SHARE
IDEAL_EASE = {"tight": 2, "regular": 6, "loose": 16}
STRETCH_SHARE = {"none": 0, "slight": 0.05, "stretchy": 0.15}
HEIGHT = 166.0          # sizes carry no height; lengths come from the garment measurements (as in research)
OUT_OF_RANGE_CM = 1.0   # the MPFB body misses a girth by more than this -> the figure is outside our range
# the template types in templates.py for our garment types
KIND = {"dress": ("dress",), "bottom": ("skirt", "pants"), "top": ("top",), "outerwear": ("outerwear",)}
GIRTHS = {"chest": "bust", "waist": "waist", "hips": "hips"}
# the figure of an outerwear size comes from the chest only: a jacket or coat is a straight shell (templates.py),
# its waist is a style (boxy or belted), not the wearer's waist
FIGURE_GIRTHS = {"outerwear": {"chest": "bust"}}


def size_body(row, stretch, garment_type=None):
    """The figure a size is cut for: {bust, waist, hips} (cm), or an error for the seller."""
    ease = IDEAL_EASE.get(row.get("fit") or "regular", IDEAL_EASE["regular"])
    share = STRETCH_SHARE.get(stretch or "none", 0)
    girths = FIGURE_GIRTHS.get(garment_type, GIRTHS)
    known = {b: (float(row[g]) - ease) / (1 - share) for g, b in girths.items() if row.get(g)}
    if not known:
        return None, "The size chart has no bust, waist or hips for this size."
    import mpfb_body
    chart = list(mpfb_body.CHARTS["zara"].values())       # (bust, waist, hips) of a general women's chart
    names = ("bust", "waist", "hips")
    nearest = min(chart, key=lambda r: sum(abs(r[names.index(k)] - v) for k, v in known.items()))
    shift = sum(v - nearest[names.index(k)] for k, v in known.items()) / len(known)
    body = {k: round(known.get(k, nearest[i] + shift), 1) for i, k in enumerate(names)}
    return body, None


def targets(row):
    """Garment measurements the pattern is fitted to (full circumferences, cm)."""
    return {k: float(row[k]) for k in ("length", "shoulder", "chest", "waist", "hips", "sleeve") if row.get(k)}


def drafter_class():
    import size_fit as S
    from templates import TEMPLATES, design

    class ProductDrafter(S.Drafter):
        """size_fit.Drafter for a seller's product instead of a research item."""

        def __init__(self, size, silhouette, bodies, body_name, level_rows):
            self.item, self.size = f"product_{size}", size
            self.template = silhouette["template"]
            self.kind = TEMPLATES[self.template]["type"]
            self.garment = self.kind
            self.body_name = body_name
            self.body_file = bodies / f"{body_name}.yaml"
            self.levels = level_rows[body_name]
            import yaml
            self.gcbody = yaml.safe_load(open(self.body_file))["body"]
            knobs = {k: silhouette[k] for k in ("sleeve", "length") if silhouette.get(k)}
            self.design = design(GC, self.template, **knobs)
            self.ease = {"bust": 1.0, "waist": 1.0, "hips": 1.0}
            # dresses and skirts: length over all panels; tops: the back length, as most stores measure it
            self.length_panels = "back" if self.kind in ("top", "outerwear") else "all"

    return ProductDrafter


def make_boxes(out, case, body):
    """GarmentCode box mesh of one case (pod/box_case.py in the gcsim environment)."""
    cmd = [BOX_PYTHON, str(RESEARCH / "pod" / "box_case.py"), "--gc", str(GC), "--case-dir", str(out / "cases" / case),
           "--case", case, "--bodies", str(out / "bodies_mpfb"), "--body", body, "--config", str(out / "sim_config.yaml"),
           "--out", str(out / "boxes")]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or "BOX " not in r.stdout:
        sys.stderr.write(r.stdout[-2000:] + r.stderr[-4000:])
        raise RuntimeError("box mesh failed")
    return f"boxes/{case}"


def run(job, out):
    sys.path.insert(0, str(RESEARCH))
    os.chdir(RESEARCH)                       # research modules read their data relative to themselves
    import mpfb_body
    import numpy as np
    import simtest_prep
    import size_fit as S
    import yaml

    for d in ("bodies", "bodies_mpfb", "cases", "boxes"):
        shutil.rmtree(out / d, ignore_errors=True)
        (out / d).mkdir(parents=True)
    shutil.copy(SIM_CONFIG, out / "sim_config.yaml")
    bodies, welded = out / "bodies", out / "bodies_mpfb"
    S.BODIES = bodies                         # simtest_prep.weld_body reads bodies from here
    silhouette, stretch = job["silhouette"], job.get("stretch") or "none"
    ProductDrafter = drafter_class()
    mp = mpfb_body.MPFB()
    done, failed, seg_done = [], [], False

    for row in job["sizeChart"]:
        size = str(row["size"])
        try:
            body, err = size_body(row, stretch, job.get("garmentType"))
            if err:
                failed.append({"size": size, "error": err})
                continue
            info = mpfb_body.build(mp, "product", size, bodies, target=(HEIGHT, body["bust"], body["waist"], body["hips"]))
            off = max(abs(v) for k, v in info["app_residual"].items() if k in ("bust", "waist", "hips"))
            if off > OUT_OF_RANGE_CM:
                failed.append({"size": size, "error": "This size is outside the body range we can model yet."})
                continue
            name = info["name"]
            D = ProductDrafter(size, silhouette, bodies, name, {name: info["levels"]})
            target = targets(row)
            fit = S.fit_drafter(D, target)

            V, F, new = simtest_prep.weld_body(name)
            with open(welded / f"{name}.obj", "w") as f:
                f.write("".join(f"v {x:.6f} {y:.6f} {z:.6f}\n" for x, y, z in V))
                f.write("".join(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in F))
            shutil.copy(bodies / f"{name}.yaml", welded / f"{name}.yaml")
            if not seg_done:                  # the same topology for every size: one segmentation file
                seg = json.load(open(bodies / f"{name}_segmentation.json"))
                json.dump({k: sorted(set(new[np.array(v, int)].tolist())) for k, v in seg.items()},
                          open(welded / "ggg_body_segmentation.json", "w"))
                seg_done = True

            case = f"size_{size}"
            pattern = simtest_prep.assemble(D)
            (out / "cases" / case).mkdir()
            json.dump(dict(pattern.spec), open(out / "cases" / case / f"{case}_specification.json", "w"), indent=1)
            yaml.safe_dump({"design": D.design}, open(out / "cases" / case / "design_params.yaml", "w"))
            box = make_boxes(out, case, name)

            measured = {k: round(float(v), 1) for k, v in fit["after"].items()}
            done.append({"size": size, "body": {"heightCm": HEIGHT, "chest": body["bust"], "waist": body["waist"],
                                                "hips": body["hips"]},
                         "target": target, "measured": measured,
                         "within_1cm": all(abs(measured[k] - v) <= 1.0 for k, v in target.items() if k in measured),
                         "self_intersecting": fit["self_intersecting"], "case": case, "box": box})
            print("SIZE", size, "ok", flush=True)
        except Exception:
            traceback.print_exc()
            failed.append({"size": size, "error": "Could not draft the pattern for this size."})
    return {"sizes": done, "failed": failed}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    job = json.load(open(a.job))
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    if KIND.get(job.get("garmentType")) is None:
        result = {"sizes": [], "failed": [], "error": "Patterns are built only for dresses, skirts, trousers, tops and outerwear."}
    else:
        result = run(job, out)
    json.dump(result, open(out / "result.json", "w"), indent=1)


if __name__ == "__main__":
    main()
