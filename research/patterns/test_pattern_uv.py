"""Tests of the pattern unwrap in the demo drapes (scripts/garments/export_demo_drapes.py): GarmentCode box-mesh UVs
(pattern cm / atlas width) back to metres of the flat pattern, seam vertices split, normals from the welded mesh.

Usage (from research/patterns/): .envs/mac/bin/python -m unittest test_pattern_uv
The last test needs the dress S Newton result (runs/arms); skipped without it.
"""
import struct
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "garments"))

import export_demo_drapes as e  # noqa: E402

ATLAS_CM = 50.0


def write_obj(path, V, F, VT=None, FT=None):
    with open(path, "w") as f:
        for v in V:
            f.write("v %f %f %f\n" % tuple(v))
        for t in VT if VT is not None else []:
            f.write("vt %f %f\n" % tuple(t))
        for i, face in enumerate(F):
            if FT is None:
                f.write("f %d %d %d\n" % tuple(np.asarray(face) + 1))
            else:
                f.write("f " + " ".join(f"{a + 1}/{b + 1}" for a, b in zip(face, FT[i])) + "\n")


def two_panels():
    """Two 10 × 20 cm panels stitched along x = 0, at a right angle in 3D (front in z = 0, side in x = 0)."""
    V = np.array([[0, 0, 0], [0, 20, 0], [-10, 0, 0], [-10, 20, 0],  # front; 0, 1 — the stitch
                  [0, 0, -10], [0, 20, -10]], float)                 # side
    F = np.array([[0, 2, 1], [1, 2, 3], [0, 1, 4], [1, 5, 4]])
    pat = np.array([[10, 0], [10, 20], [0, 0], [0, 20],              # front panel in its 2D, cm
                    [20, 0], [20, 20], [30, 0], [30, 20]], float)     # side panel moved to x 20…30 in the atlas
    FT = np.array([[0, 2, 1], [1, 2, 3], [4, 5, 6], [5, 7, 6]])
    return V, F, pat / ATLAS_CM, FT


class PatternUv(unittest.TestCase):
    def test_scale_back_to_pattern_metres(self):
        V, F, VT, FT = two_panels()
        cm, exact = e.pattern_scale(V, VT, F, FT)
        self.assertAlmostEqual(cm, ATLAS_CM, places=4)
        self.assertEqual(exact, 1.0)

    def test_seam_vertices_split_and_normals_welded(self):
        V, F, VT, FT = two_panels()
        with tempfile.TemporaryDirectory() as d:
            box, sim = Path(d) / "x_boxmesh.obj", Path(d) / "x_sim.obj"
            write_obj(box, V, F, VT, FT)
            write_obj(sim, V + [0, 0, 3], F)                      # the drape: same vertices, moved
            mesh, uv, normals, info = e.pattern_mesh(sim, box)
        self.assertEqual(len(mesh.vertices), 8)                   # the 2 stitch vertices — twice
        self.assertAlmostEqual(info["cmPerUv"], ATLAS_CM, places=2)
        # a panel edge in UV is its pattern length in metres
        for a, b in mesh.edges_unique:
            l3 = np.linalg.norm(mesh.vertices[a] - mesh.vertices[b])
            self.assertAlmostEqual(np.linalg.norm(uv[a] - uv[b]) * 100, l3, places=3)
        # copies of a stitch vertex: one position, one normal
        for p in ([0, 0, 3], [0, 20, 3]):
            ids = np.nonzero(np.all(np.isclose(mesh.vertices, p), axis=1))[0]
            self.assertEqual(len(ids), 2)
            np.testing.assert_allclose(normals[ids[0]], normals[ids[1]])

    def test_glb_has_texcoords_and_flag_with_v_up(self):
        V, F, VT, FT = two_panels()
        with tempfile.TemporaryDirectory() as d:
            box, sim, out = Path(d) / "x_boxmesh.obj", Path(d) / "x_sim.obj", Path(d) / "x.glb"
            write_obj(box, V, F, VT, FT)
            write_obj(sim, V, F)
            mesh, uv, normals, _ = e.pattern_mesh(sim, box)
            e.export_glb(mesh, e.CLOTH, out, uv, normals)
            glb = out.read_bytes()
        jlen = struct.unpack_from("<I", glb, 12)[0]
        doc = json.loads(glb[20:20 + jlen])
        self.assertEqual(doc["meshes"][0]["extras"], {"uvMetres": True})
        prim = doc["meshes"][0]["primitives"][0]
        acc = doc["accessors"][prim["attributes"]["TEXCOORD_0"]]
        view = doc["bufferViews"][acc["bufferView"]]
        start = 28 + jlen + view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stored = np.frombuffer(glb[start:start + acc["count"] * 8], np.float32).reshape(-1, 2)
        pos = doc["accessors"][prim["attributes"]["POSITION"]]
        pview = doc["bufferViews"][pos["bufferView"]]
        pstart = 28 + jlen + pview.get("byteOffset", 0) + pos.get("byteOffset", 0)
        P = np.frombuffer(glb[pstart:pstart + pos["count"] * 12], np.float32).reshape(-1, 3)
        # v in the file grows up the pattern, as y does on the body (the client loads the tile with flipY)
        self.assertGreater(np.corrcoef(stored[:, 1], P[:, 1])[0, 1], 0.99)
        self.assertAlmostEqual(float(np.ptp(stored[:, 1])), 0.20, places=4)

    @unittest.skipUnless((HERE / "runs" / "arms" / "newton" / "results" / "03_dress_S").exists(), "no runs/arms")
    def test_real_dress_matches_its_report_glb(self):
        run = HERE / "runs" / "arms"
        sim, box = e.find_sim(run / "report" / "renders" / "03_dress_S.glb", sorted(run.glob("newton*/results/03_dress_S")))
        mesh, uv, normals, info = e.pattern_mesh(sim, box)
        self.assertGreater(info["exactEdges"], 0.9)
        self.assertEqual(len(uv), len(mesh.vertices))


if __name__ == "__main__":
    unittest.main()
