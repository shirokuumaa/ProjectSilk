"""Does the arm lie inside the sleeve tube of a box mesh? A check before any simulation.

GarmentCode's sleeve is a straight tube along the arm at the body's arm_pose_angle. Our MPFB body had bent elbows
with the hands forward: the forearm left the tube (README «Рукав на болванке с согнутыми локтями»). Since
60f05a29 the avatar stands with straight arms. Per side: the sleeve's axis (principal direction of its vertices),
its radius along the axis (median distance of sleeve vertices to the axis, 2 cm bins), and the share of the arm's
vertices — between the sleeve's two ends — that are inside that radius; plus the arm's own axis against it.
For long sleeves (jacket, coat): a short wide sleeve's principal axis runs across the arm, not along it.

Usage: python sleeve_fit_check.py <box dir> <case> <body obj> <body segmentation json>
"""
import json
import sys
from pathlib import Path

import numpy as np


def read_obj(path):
    return np.array([[float(x) for x in l.split()[1:4]] for l in open(path) if l.startswith("v ")])


def check(box_dir, case, body_obj, seg_json):
    box_dir = Path(box_dir)
    V = read_obj(box_dir / f"{case}_boxmesh.obj")
    labels = [l.strip() for l in open(box_dir / f"{case}_sim_segmentation.txt")][:len(V)]
    B = read_obj(body_obj)
    if np.ptp(B[:, 1]) < 3:
        B = B * 100
    if np.ptp(V[:, 1]) < 3:
        V = V * 100
    seg = json.load(open(seg_json))
    out = {}
    for side, sx in (("left", 1), ("right", -1)):
        S = V[np.array(["sleeve" in l for l in labels]) & (V[:, 0] * sx > 0)]
        A = B[np.array(seg[f"{side}_arm"], int)]
        c = S.mean(0)
        d = np.linalg.svd(S - c)[2][0]
        d *= np.sign(d[0] * sx)                                 # pointing out along the arm
        def axial(P):
            t = (P - c) @ d
            return t, np.linalg.norm(P - c - np.outer(t, d), axis=1)
        ts, rs = axial(S)
        ta, ra = axial(A)
        edges = np.arange(ts.min(), ts.max() + 2, 2.0)
        idx_s = np.digitize(ts, edges)
        radius = {i: np.median(rs[idx_s == i]) for i in np.unique(idx_s)}
        inside_range = (ta > ts.min()) & (ta < ts.max())
        idx_a = np.digitize(ta[inside_range], edges)
        r_lim = np.array([radius.get(i, 0.0) for i in idx_a])
        share = float((ra[inside_range] < r_lim).mean()) if inside_range.any() else 0.0
        ca = A[inside_range].mean(0)
        da = np.linalg.svd(A[inside_range] - ca)[2][0]
        angle = float(np.degrees(np.arccos(min(1.0, abs(da @ d)))))
        # the sleeve's far end against the arm: arm vertices beyond the sleeve end (hand and the rest of the arm)
        out[side] = {"arm_inside_%": round(100 * share, 1), "axes_angle_deg": round(angle, 1),
                     "sleeve_len_cm": round(float(np.ptp(ts)), 1),
                     "arm_beyond_sleeve_cm": round(float(max(0.0, ta.max() - ts.max())), 1)}
    return out


if __name__ == "__main__":
    print(json.dumps(check(*sys.argv[1:5])))
