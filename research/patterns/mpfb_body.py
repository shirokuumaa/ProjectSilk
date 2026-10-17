"""Our MPFB dummy as a GarmentCode body: a size-chart row -> morphed mesh + 26 measurements + segmentation.

  size row (height, bust, waist, hips; cm) -> morph values by the app's own calibrated solver
  (scripts/avatar/calibrate.solve on the real mesh, the same definitions as in the app)
  -> mesh in cm (Y up, +Z front, feet at y=0, centred so GarmentCode's balance plane is z=0)
  -> body_measure.Measurer: 26 GarmentCode measurements -> body.yaml; segmentation json like
  ggg_body_segmentation.json (from the skin weights); body.obj.

Size charts (body, cm): Uniqlo — from the store page (photos/*/body_size_chart.csv), range midpoints;
Zara — no body chart on item pages; the general Zara women's chart from third-party size tables
(size-charts.com, sizecharter.com; not official). Heights are not in either chart: 166 cm for all
sizes (lengths come from the garment measurements anyway).

Usage: python mpfb_body.py [--out runs/day7/bodies]  -> {store}_{size}.{obj,yaml,json} + report
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "avatar"))
import calibrate  # noqa: E402
import config  # noqa: E402
import glb  # noqa: E402
import measure  # noqa: E402

from body_measure import KEYS, Measurer  # noqa: E402

HEIGHT = 166.0
CHARTS = {
    # store: size -> (bust, waist, hips)
    "zara": {"S": (86, 66, 94), "L": (96, 76, 104)},
    "uniqlo": {"S": (86, 68, 94), "L": (96, 78, 104)},  # midpoints of 83-89/65-71/91-97 and 93-99/75-81/101-107
}
ARM_BONES = measure.ARM_BONES
LEG_BONES = ("thigh", "calf", "foot", "ball")


class MPFB:
    def __init__(self):
        self.data = glb.load_body(config.GLB_PATH)
        info = json.loads(config.BUILD_INFO_PATH.read_text())
        self.body = measure.Body(self.data, info["landmarks"])
        names = self.data["joint_names"]
        W = np.zeros((len(self.data["positions"]), len(names)))
        np.add.at(W, (np.arange(len(W))[:, None], self.data["joints"]), self.data["weights"])
        side = lambda n: "left" if n.endswith("_l") else ("right" if n.endswith("_r") else None)
        arm = {s: np.array([n.split("_")[0] in ARM_BONES and side(n) == s for n in names]) for s in ("left", "right")}
        leg = {s: np.array([n.split("_")[0] in LEG_BONES and side(n) == s for n in names]) for s in ("left", "right")}
        lab = {}
        for s in ("left", "right"):
            lab[f"{s}_arm"] = np.flatnonzero(W[:, arm[s]].sum(1) > 0.5)
            lab[f"{s}_leg"] = np.flatnonzero(W[:, leg[s]].sum(1) > 0.5)
        used = np.zeros(len(W), bool)
        for v in lab.values():
            used[v] = True
        lab["body"] = np.flatnonzero(~used)
        lab["face_internal"] = np.zeros(0, int)
        self.labels = lab

    def solve(self, height, bust, waist, hips):
        targets = {"height": height, "bust": bust, "waist": waist, "hips": hips}
        u, f, res = calibrate.solve(calibrate.TrueModel(self.body), targets)
        return u, res

    def mesh(self, u):
        """Vertices in cm, feet at y = 0."""
        V = self.body.coords(u) * 100.0
        V[:, 1] -= V[:, 1].min()
        return V


def build(mp, store, size, out):
    bust, waist, hips = CHARTS[store][size]
    u, res = mp.solve(HEIGHT, bust, waist, hips)
    V, F = mp.mesh(u), mp.data["triangles"]
    gc, aux = Measurer(V, F, mp.labels).measure()
    V = V - np.array([0.0, 0.0, aux["z_bal"]])          # balance plane -> z = 0, as on GarmentCode's bodies
    name = f"{store}_{size}"
    out.mkdir(parents=True, exist_ok=True)
    with open(out / f"{name}.obj", "w") as f:              # metres, like GarmentCode's bodies
        f.write("".join(f"v {x / 100:.6f} {y / 100:.6f} {z / 100:.6f}\n" for x, y, z in V))
        f.write("".join(f"f {a + 1} {b + 1} {c + 1}\n" for a, b, c in F))
    yaml.safe_dump({"body": gc}, open(out / f"{name}.yaml", "w"), sort_keys=True)
    json.dump({k: v.tolist() for k, v in mp.labels.items()}, open(out / f"{name}_segmentation.json", "w"))
    return {"name": name, "target": dict(height=HEIGHT, bust=bust, waist=waist, hips=hips),
            "app_residual": {k: round(v, 2) for k, v in res.items()},
            "controls": dict(zip(config.CONTROL_NAMES, np.round(u, 3).tolist())), "gc": gc,
            "levels": {k: round(v, 1) for k, v in aux.items() if k.endswith("_y")}}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE / "runs" / "day7" / "bodies"))
    a = ap.parse_args()
    out = Path(a.out)
    mp = MPFB()
    rows = [build(mp, store, size, out) for store in CHARTS for size in CHARTS[store]]
    json.dump(rows, open(out / "bodies.json", "w"), indent=1)
    ref = yaml.safe_load(open(HERE / ".envs/src/GarmentCode/assets/bodies/mean_female.yaml"))["body"]
    print(f"{'measure':22s}" + "".join(f"{r['name']:>11s}" for r in rows) + "  mean_female")
    for k in KEYS:
        print(f"{k:22s}" + "".join(f"{r['gc'][k]:11.1f}" for r in rows) + f"{ref[k]:13.1f}")
    for r in rows:
        print(r["name"], "app residual", r["app_residual"], r["levels"])


if __name__ == "__main__":
    main()
