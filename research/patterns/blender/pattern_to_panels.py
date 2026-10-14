"""GarmentCode sewing pattern (*_specification.json) -> panels.json for blender/sim_garment.py.

Same geometry rules as GarmentCode's own box mesh (pygarment/meshgen/boxmeshgen.py, MIT),
re-implemented with numpy + svgpathtools so Blender does not need pygarment:
  * edge curves: straight / quadratic / cubic Bezier with control points relative to the edge,
    circle arcs; units are cm, panel-local 2D, then rotation (intrinsic XYZ Euler, degrees)
    and translation place the panel around the body;
  * every edge is sampled every ~`res` cm; the two edges of a stitch get the same number of
    points (that of the longer edge); by default a stitch joins edge A's start to edge B's end;
  * interior points on a staggered grid (spacing `res`) for the triangulation done in Blender.

Output panels.json:
  {"units": "cm", "res": 1.0,
   "panels": {name: {"R": 3x3, "t": [3], "boundary": [[x,y]...], "interior": [[x,y]...],
                     "edges": [[boundary idx...] per pattern edge]}},
   "stitches": [[[panelA, [boundary idx...]], [panelB, [boundary idx...]]], ...]}

Usage: python pattern_to_panels.py spec.json out.json [--res 1.0]
"""
import argparse
import json
import math

import numpy as np
import svgpathtools as svg
from matplotlib.path import Path as MplPath


def rel_to_abs(start, end, rel):
    edge = end - start
    return start + rel[0] * edge + rel[1] * np.array([-edge[1], edge[0]])


def c(p):
    return complex(p[0], p[1])


def edge_curve(edge, verts):
    start, end = verts[edge["endpoints"][0]], verts[edge["endpoints"][1]]
    cv = edge.get("curvature")
    if cv is None:
        return svg.Line(c(start), c(end))
    if isinstance(cv, list) or cv["type"] == "quadratic":
        rel = cv if isinstance(cv, list) else cv["params"][0]
        return svg.QuadraticBezier(c(start), c(rel_to_abs(start, end, rel)), c(end))
    if cv["type"] == "cubic":
        cps = [rel_to_abs(start, end, p) for p in cv["params"]]
        return svg.CubicBezier(c(start), c(cps[0]), c(cps[1]), c(end))
    if cv["type"] == "circle":
        radius, large_arc, right = cv["params"]
        return svg.Arc(c(start), radius + 1j * radius, rotation=0, large_arc=large_arc, sweep=right, end=c(end))
    raise NotImplementedError(cv["type"])


def sample(curve, n):
    """n points evenly spaced by arc length, including both ends."""
    t = np.linspace(0, 1, 400)
    pts = np.array([[curve.point(x).real, curve.point(x).imag] for x in t])
    seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    target = np.linspace(0, s[-1], n)
    return np.stack([np.interp(target, s, pts[:, 0]), np.interp(target, s, pts[:, 1])], axis=1)


def euler_xyz_to_R(e):
    x, y, z = np.deg2rad(e)
    rx = np.array([[1, 0, 0], [0, math.cos(x), -math.sin(x)], [0, math.sin(x), math.cos(x)]])
    ry = np.array([[math.cos(y), 0, math.sin(y)], [0, 1, 0], [-math.sin(y), 0, math.cos(y)]])
    rz = np.array([[math.cos(z), -math.sin(z), 0], [math.sin(z), math.cos(z), 0], [0, 0, 1]])
    return rz @ ry @ rx


def interior_points(boundary, res):
    """Staggered grid inside the polygon, kept >= 0.6*res away from the boundary."""
    poly = MplPath(boundary)
    lo, hi = boundary.min(0), boundary.max(0)
    dy = res * math.sqrt(3) / 2
    pts = []
    for j, y in enumerate(np.arange(lo[1] + dy / 2, hi[1], dy)):
        x0 = lo[0] + (res / 2 if j % 2 else 0)
        pts += [[x, y] for x in np.arange(x0, hi[0], res)]
    pts = np.array(pts) if pts else np.zeros((0, 2))
    if len(pts) == 0:
        return pts
    pts = pts[poly.contains_points(pts)]
    # distance to the boundary polyline
    a, b = boundary, np.roll(boundary, -1, axis=0)
    ab = b - a
    t = np.clip(((pts[:, None, :] - a[None]) * ab[None]).sum(-1) / np.maximum((ab ** 2).sum(-1), 1e-12)[None], 0, 1)
    d = np.linalg.norm(pts[:, None, :] - (a[None] + t[..., None] * ab[None]), axis=-1).min(1)
    return pts[d >= 0.6 * res]


def convert(spec, res):
    pattern = spec["pattern"]
    panels = pattern["panels"]

    # number of samples per edge; stitched edges share the count of the longer edge
    curves = {name: [edge_curve(e, np.array(p["vertices"], float)) for e in p["edges"]] for name, p in panels.items()}
    n = {(name, i): max(2, math.ceil(cv.length() / res) + 1) for name, cvs in curves.items() for i, cv in enumerate(cvs)}
    for st in pattern["stitches"]:
        a, b = (st[0]["panel"], st[0]["edge"]), (st[1]["panel"], st[1]["edge"])
        longer = a if curves[a[0]][a[1]].length() >= curves[b[0]][b[1]].length() else b
        n[a] = n[b] = n[longer]

    out_panels, edge_idx = {}, {}
    for name, p in panels.items():
        ends = [e["endpoints"] for e in p["edges"]]
        assert all(ends[i][1] == ends[(i + 1) % len(ends)][0] for i in range(len(ends))), f"{name}: edges are not a loop"
        boundary = []
        for i, cv in enumerate(curves[name]):
            pts = sample(cv, n[(name, i)])
            start = len(boundary)
            boundary += pts[:-1].tolist()  # the last point is the next edge's first
            edge_idx[(name, i)] = list(range(start, start + n[(name, i)]))
        total = len(boundary)
        for key in [k for k in edge_idx if k[0] == name]:
            edge_idx[key] = [j % total for j in edge_idx[key]]
        boundary = np.array(boundary)
        out_panels[name] = {
            "R": euler_xyz_to_R(p.get("rotation", [0, 0, 0])).tolist(),
            "t": list(map(float, p.get("translation", [0, 0, 0]))),
            "boundary": boundary.tolist(),
            "interior": interior_points(boundary, res).tolist(),
            "edges": [edge_idx[(name, i)] for i in range(len(p["edges"]))],  # boundary indices per edge
        }

    stitches = []
    for st in pattern["stitches"]:
        a, b = (st[0]["panel"], st[0]["edge"]), (st[1]["panel"], st[1]["edge"])
        ib = edge_idx[b]
        swap = not (len(st) == 3 and st[-1] == "right_wrong")
        stitches.append([[a[0], edge_idx[a]], [b[0], ib[::-1] if swap else ib]])
    return {"units": "cm", "res": res, "panels": out_panels, "stitches": stitches}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("spec")
    ap.add_argument("out")
    ap.add_argument("--res", type=float, default=1.0, help="target edge length, cm")
    a = ap.parse_args()
    spec = json.load(open(a.spec))
    data = convert(spec, a.res)
    json.dump(data, open(a.out, "w"))
    nb = sum(len(p["boundary"]) for p in data["panels"].values())
    ni = sum(len(p["interior"]) for p in data["panels"].values())
    print(f"{len(data['panels'])} panels, {len(data['stitches'])} stitches, {nb} boundary + {ni} interior points")


if __name__ == "__main__":
    main()
