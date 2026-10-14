"""Distance between two draped garments (ours vs a reference, e.g. GarmentCodeData *_sim.ply).

Both meshes in cm, Y up. Surfaces are sampled uniformly by area; reports the symmetric
Chamfer distance (mean of both directions), the 95th percentile and the bounding boxes.
Usage: python compare_mesh.py ours.obj reference.ply [--samples 50000]
"""
import argparse
import json

import numpy as np
import trimesh
from scipy.spatial import cKDTree


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ours")
    ap.add_argument("ref")
    ap.add_argument("--samples", type=int, default=50000)
    a = ap.parse_args()
    m1 = trimesh.load(a.ours, process=False, force="mesh")
    m2 = trimesh.load(a.ref, process=False, force="mesh")
    p1, _ = trimesh.sample.sample_surface(m1, a.samples, seed=0)
    p2, _ = trimesh.sample.sample_surface(m2, a.samples, seed=0)
    d12, _ = cKDTree(p2).query(p1)
    d21, _ = cKDTree(p1).query(p2)
    res = {
        "chamfer_cm": round(float((d12.mean() + d21.mean()) / 2), 2),
        "ours_to_ref_p95_cm": round(float(np.percentile(d12, 95)), 2),
        "ref_to_ours_p95_cm": round(float(np.percentile(d21, 95)), 2),
        "ours_bbox_cm": np.round(m1.bounds, 1).tolist(),
        "ref_bbox_cm": np.round(m2.bounds, 1).tolist(),
        "area_ratio": round(float(m1.area / m2.area), 3),
    }
    print(json.dumps(res))


if __name__ == "__main__":
    main()
