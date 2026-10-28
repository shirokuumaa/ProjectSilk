"""Pictures of our 13 templates for the seller's silhouette picker (client/public/silhouettes/<template>.png).

Each template (templates.py, default knobs) is drafted on our MPFB body of size M (runs/allsizes/bodies,
mpfb_body.py --all) and drawn from the front: the pattern panels in GarmentCode's placement around the body
(blender/pattern_to_panels.convert), front panels over back ones, over a light silhouette of the same body.
Our own templates and body only — no store photos. Colours are the app's tokens (client/src/styles/tokens.css).

Usage: .envs/mac/bin/python render_silhouettes.py [--out ../../client/public/silhouettes]
"""
import argparse
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

from blender.pattern_to_panels import convert  # noqa: E402
from templates import TEMPLATES, build, design  # noqa: E402

HERE = Path(__file__).resolve().parent
GC = HERE / ".envs" / "src" / "GarmentCode"
BODY = HERE / "runs" / "allsizes" / "bodies" / "zara_M"
# tokens.css: --line (body), --line-strong (back panels), --muted (front panels), --ink (outline)
BODY_FILL, BACK_FILL, FRONT_FILL, OUTLINE = "#E4E1DC", "#CFCAC2", "#7A7580", "#16141A"


def body_faces():
    V, F = [], []
    for line in open(f"{BODY}.obj"):
        if line.startswith("v "):
            V.append([float(x) for x in line.split()[1:4]])
        elif line.startswith("f "):
            F.append([int(t.split("/")[0]) - 1 for t in line.split()[1:4]])
    V = np.array(V) * 100.0                       # metres -> cm, as the pattern
    return V[np.array(F)][:, :, :2]


def panels_world(spec):
    """Panel outlines in the body's frame (cm): [(is_front, xy)], back panels first."""
    out = []
    for p in convert({"pattern": spec}, 1.0)["panels"].values():
        w = (np.array(p["R"])[:, :2] @ np.array(p["boundary"]).T).T + np.array(p["t"])
        out.append((p["t"][2] > 0, w[:, :2]))
    return sorted(out, key=lambda x: x[0])


def render(name, faces, out):
    spec, _ = build(GC, design(GC, name), body=f"{BODY}.yaml")
    fig, ax = plt.subplots(figsize=(2.4, 3.1), dpi=100)
    ax.add_collection(PolyCollection(faces, facecolor=BODY_FILL, edgecolor="none"))
    for front, xy in panels_world(spec):
        ax.fill(xy[:, 0], xy[:, 1], color=FRONT_FILL if front else BACK_FILL, ec=OUTLINE, lw=0.6)
    ax.set_xlim(-67, 67)           # down to the feet for full-length trousers, same 240:310 frame
    ax.set_ylim(-1, 172)
    ax.set_aspect("equal")
    ax.axis("off")
    fig.subplots_adjust(0, 0, 1, 1)
    fig.savefig(out / f"{name}.png", transparent=True)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(HERE.parents[1] / "client" / "public" / "silhouettes"))
    out = Path(ap.parse_args().out)
    out.mkdir(parents=True, exist_ok=True)
    faces = body_faces()
    for name in TEMPLATES:
        render(name, faces, out)
        print(name)


if __name__ == "__main__":
    main()
