"""How a long sleeve lies after the simulation (jacket, coat) — numbers and a picture; the check after sleeve_fit_check.py.

Per side, along the arm (shoulder point -> fingertips, from the body's arm vertices):
  * cover_% — share of the arm's vertices from the shoulder to the sleeve's end that have sleeve fabric around them
    (a sleeve vertex within 12 cm in the arm's cross-section, in both halves: front and back of the arm);
  * hem_gap_cm — median distance from the last 5 cm of the sleeve to the arm's surface (the empty end of a sleeve
    that does not follow the forearm: ~10 cm on the bent-elbow body, README «Рукав на болванке с согнутыми локтями»);
  * width_ratio — the sleeve's median radius around the forearm against the forearm's own radius;
  * hand_out_cm — how far the arm (hand) reaches past the sleeve's end.
Also top_drop_body_cm — how far the garment's shoulders went down, without the collar pieces (a lapel collar starts
above the shoulders in GarmentCode's layout and falls onto the neck: simtest_report's "top" includes it).

Usage: python sleeve_drape_check.py <sim obj> <box dir> <case> <body obj> <body segmentation json> [picture.png]
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree


def read_obj(path):
    V = np.array([[float(x) for x in l.split()[1:4]] for l in open(path) if l.startswith("v ")])
    return V * 100 if np.ptp(V[:, 1]) < 3 else V


def check(sim_obj, box_dir, case, body_obj, seg_json, picture=None):
    box_dir = Path(box_dir)
    V = read_obj(sim_obj)
    V0 = read_obj(box_dir / f"{case}_boxmesh.obj")
    labels = np.array([l.strip() for l in open(box_dir / f"{case}_sim_segmentation.txt")][:len(V)])
    B = read_obj(body_obj)
    seg = json.load(open(seg_json))
    collar = np.array(["collar" in l or "lapel" in l for l in labels])
    sleeve = np.array(["sleeve" in l for l in labels])
    out = {"top_drop_body_cm": round(float(V0[~collar, 1].max() - V[~collar, 1].max()), 1),
           "top_drop_all_cm": round(float(V0[:, 1].max() - V[:, 1].max()), 1)}
    for side, sx in (("left", 1), ("right", -1)):
        A = B[np.array(seg[f"{side}_arm"], int)]
        S = V[sleeve & (V[:, 0] * sx > 0)]
        c = A.mean(0)
        d = np.linalg.svd(A - c)[2][0]
        d *= np.sign(d[0] * sx)
        ta, ts = (A - c) @ d, (S - c) @ d
        end = np.percentile(ts, 99.5)
        A_in = A[(ta > ta.min() + 3) & (ta < end)]
        tree = cKDTree(S)
        covered = []
        for p in A_in:                                    # fabric around: sleeve points near the arm's slice
            near = S[tree.query_ball_point(p, 12.0)]
            near = near[np.abs((near - p) @ d) < 1.5]
            if len(near) == 0:
                covered.append(False)
                continue
            off = near - p - np.outer((near - p) @ d, d)
            covered.append(bool((off[:, 2] > 0).any() and (off[:, 2] < 0).any()))
        last = S[ts > end - 5]
        fore = (ta > ta.min() + 0.55 * np.ptp(ta)) & (ta < end)
        axis_pts = lambda P, t: c + np.outer(t, d)       # noqa: E731
        r_arm = np.median(np.linalg.norm(A[fore] - axis_pts(A[fore], ta[fore]), axis=1))
        fs = (ts > ta.min() + 0.55 * np.ptp(ta)) & (ts < end)
        r_sl = np.median(np.linalg.norm(S[fs] - axis_pts(S[fs], ts[fs]), axis=1))
        out[side] = {"cover_%": round(100 * float(np.mean(covered)), 1),
                     "hem_gap_cm": round(float(np.median(cKDTree(A).query(last)[0])), 1),
                     "width_ratio": round(float(r_sl / r_arm), 2),
                     "hand_out_cm": round(float(max(0.0, ta.max() - end)), 1)}
    if picture:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        fig, axs = plt.subplots(1, 2, figsize=(10, 8))
        for ax, (i, j), title in zip(axs, ((0, 1), (2, 1)), ("front", "side")):
            ax.scatter(B[:, i], B[:, j], s=0.2, c="#cfcac2")
            ax.scatter(V[~sleeve, i], V[~sleeve, j], s=0.2, c="#7a9cc6", alpha=0.3)
            ax.scatter(V[sleeve, i], V[sleeve, j], s=0.2, c="#2c5d9e")
            ax.set_aspect("equal"); ax.axis("off"); ax.set_title(title)
        fig.savefig(picture, dpi=80, bbox_inches="tight")
    return out


if __name__ == "__main__":
    print(json.dumps(check(*sys.argv[1:6], *(sys.argv[6:7] or [None]))))
