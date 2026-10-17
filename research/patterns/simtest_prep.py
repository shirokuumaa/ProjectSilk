"""Inputs for the GPU test of GarmentCode's own simulator (Warp fork) — stage A, on the Mac.

runs/simtest/inputs/ (local, not committed; copied to the pod):
  bodies_mpfb/{zara,uniqlo}_{S,L}.{obj,yaml} + ggg_body_segmentation.json
      our MPFB size bodies (day 7) in the layout GarmentCode expects: obj in metres, Y up, the 26
      measurements yaml, segmentation {body, left/right_arm, left/right_leg, face_internal}. Vertices
      duplicated at UV seams are welded (the glTF mesh is split there) and the segmentation remapped.
  cases/<case>/<case>_specification.json (+ design_params.yaml)
      day 7 patterns rebuilt from the fitted knobs and saved with GarmentCode's own spec header
      (units_in_meter etc.); checked against runs/day7/patterns/<item>_<size>.json: vertices within
      0.03 cm (fit.json keeps knobs to 3 decimals), measurements re-taken (prep_info.json).
      The GarmentCodeData control: rand_03EQU44RFB on their mean body (spec copied as is).
  sim_config.yaml — the simulation config GarmentCodeData used for this batch
      (dataset_properties_default_body.yaml: soft fabric, attachments, 2400 steps max).
  cases.json — what to run: case, body set (mpfb / gc), body name.
  reference/rand_03EQU44RFB_sim.ply — their simulation result, for the comparison on the Mac.

Usage: python simtest_prep.py
"""
import json
import shutil
from pathlib import Path

import numpy as np
import yaml

import size_fit as S

HERE = Path(__file__).resolve().parent
OUT = HERE / "runs" / "simtest" / "inputs"
DAY7 = HERE / "runs" / "day7"
GCD = HERE / "data" / "gcd" / "default_body"
CONTROL = "rand_03EQU44RFB"
# fitted dress 03 (short sleeves; 02 is the stretch dress whose waist/sleeve could not be fitted), flared
# skirt 04, loose tee 09
ITEMS = {"03_dress": "zara", "04_skirt": "zara", "09_tee": "uniqlo"}


def weld_body(name):
    V, F = [], []
    for line in open(DAY7 / "bodies" / f"{name}.obj"):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            F.append([int(t.split("/")[0]) - 1 for t in line.split()[1:4]])
    V, F = np.array(V), np.array(F)
    _, first, inv = np.unique(np.round(V, 7), axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    order = np.argsort(first)                      # keep the original vertex order as far as possible
    remap = np.empty(len(order), int)
    remap[order] = np.arange(len(order))
    new = remap[inv]
    Vw = np.zeros((len(order), 3))
    Vw[new] = V
    Fw = new[F]
    Fw = Fw[(Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])]
    return Vw, Fw, new


def main():
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "bodies_mpfb").mkdir(parents=True)
    (OUT / "cases").mkdir()
    (OUT / "reference").mkdir()
    cases, info = [], {}

    # bodies
    seg_done = False
    for store in sorted(set(ITEMS.values())):
        for size in S.SIZES:
            name = f"{store}_{size}"
            V, F, new = weld_body(name)
            with open(OUT / "bodies_mpfb" / f"{name}.obj", "w") as f:
                f.write("".join(f"v {x:.6f} {y:.6f} {z:.6f}\n" for x, y, z in V))
                f.write("".join(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in F))
            shutil.copy(DAY7 / "bodies" / f"{name}.yaml", OUT / "bodies_mpfb" / f"{name}.yaml")
            if not seg_done:                       # same topology for every size: one segmentation file
                seg = json.load(open(DAY7 / "bodies" / f"{name}_segmentation.json"))
                seg = {k: sorted(set(new[np.array(v, int)].tolist())) for k, v in seg.items()}
                json.dump(seg, open(OUT / "bodies_mpfb" / "ggg_body_segmentation.json", "w"))
                seg_done = True
            info[name] = {"vertices": len(V), "faces": len(F), "height_m": float(np.ptp(V[:, 1]))}

    # our patterns, rebuilt with the GarmentCode spec header
    fit = {(r["item"], r["size"]): r for r in json.load(open(DAY7 / "fit.json"))}
    for item, store in ITEMS.items():
        for size in S.SIZES:
            r = fit[(item, size)]
            D = S.Drafter(item, size)
            for k, v in r["knobs"].items():
                src, key = k.split(".", 1)
                if src == "design":
                    D.set((src, key), v)
            D.ease = dict(r["ease"])
            pattern = assemble(D)
            stored = json.load(open(DAY7 / "patterns" / f"{item}_{size}.json"))["pattern"]
            diff = max(float(np.abs(np.array(p["vertices"]) - np.array(stored["panels"][n]["vertices"])).max())
                       for n, p in pattern.spec["pattern"]["panels"].items())
            meas = {k: round(float(v), 1) for k, v in D.measure(pattern.spec["pattern"]).items()}
            case = f"{item}_{size}"
            d = OUT / "cases" / case
            d.mkdir()
            spec = dict(pattern.spec)
            json.dump(spec, open(d / f"{case}_specification.json", "w"), indent=1)
            yaml.safe_dump({"design": D.design}, open(d / "design_params.yaml", "w"))
            cases.append({"case": case, "bodies": "mpfb", "body": f"{store}_{size}", "item": item, "size": size})
            info[case] = {"max_vertex_diff_cm_vs_day7": round(diff, 4), "measured": meas,
                          "target": r["target"], "panels": len(spec["pattern"]["panels"])}

    # GarmentCodeData control on their mean body
    d = OUT / "cases" / CONTROL
    d.mkdir()
    shutil.copy(GCD / CONTROL / f"{CONTROL}_specification.json", d / f"{CONTROL}_specification.json")
    shutil.copy(GCD / CONTROL / f"{CONTROL}_design_params.yaml", d / "design_params.yaml")
    shutil.copy(GCD / CONTROL / f"{CONTROL}_sim.ply", OUT / "reference" / f"{CONTROL}_sim.ply")
    cases.append({"case": CONTROL, "bodies": "gc", "body": "mean_all", "item": "gcd_control", "size": "-"})

    shutil.copy(GCD / "dataset_properties_default_body.yaml", OUT / "sim_config.yaml")
    json.dump(cases, open(OUT / "cases.json", "w"), indent=1)
    json.dump(info, open(OUT / "prep_info.json", "w"), indent=1)
    print(json.dumps(info, indent=1))


def assemble(D):
    """GarmentCode pattern object (with .spec) for the drafter's current knobs and drafting body."""
    import copy
    b = S.BodyParameters(str(D.body_file))
    for k, e in D.ease.items():
        if e != 1.0:
            b[k] = D.gcbody[k] * e
    g = S.MetaGarment(f"{D.item}_{D.size}", b, copy.deepcopy(D.design))
    return g.assembly()


if __name__ == "__main__":
    main()
