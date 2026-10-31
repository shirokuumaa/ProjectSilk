"""uv_raster — замена nvdiffrast при запекании текстуры TRELLIS.2: покрытие развёртки и интерполяция.

Run (from research/accessories/): ../patterns/.envs/mac/bin/python -m unittest test_uv_raster
"""
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent / "pod"))
from uv_raster import interpolate_np, rasterize_uv_np  # noqa: E402


class UvRaster(unittest.TestCase):
    def test_square_layout_covers_every_texel_and_interpolates_exactly(self):
        uv = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], float)
        faces = np.array([[0, 1, 2], [0, 2, 3]])
        pos = np.array([[0, 0, 0], [2, 0, 0], [2, 3, 0], [0, 3, 0]], float)   # плоскость: x = 2u, y = 3v
        rast = rasterize_uv_np(uv, faces, 16)
        assert (rast[..., 3] > 0).all()
        p = interpolate_np(pos, rast, faces)
        v, u = np.mgrid[0:16, 0:16]
        assert np.allclose(p[..., 0], 2 * (u + 0.5) / 16, atol=1e-5)          # строка 0 — v = 0, как у nvdiffrast
        assert np.allclose(p[..., 1], 3 * (v + 0.5) / 16, atol=1e-5)


    def test_barycentrics_follow_nvdiffrast_layout(self):
        uv = np.array([[0.1, 0.1], [0.9, 0.1], [0.1, 0.9]])
        rast = rasterize_uv_np(uv, np.array([[0, 1, 2]]), 32)
        m = rast[..., 3] > 0
        v, u = np.mgrid[0:32, 0:32]
        b0, b1 = rast[..., 0][m], rast[..., 1][m]
        rec = b0[:, None] * uv[0] + b1[:, None] * uv[1] + (1 - b0 - b1)[:, None] * uv[2]
        assert np.allclose(rec, np.column_stack([(u[m] + 0.5) / 32, (v[m] + 0.5) / 32]), atol=1e-6)


    def test_coverage_matches_layout_area(self):
        rng = np.random.default_rng(1)
        uv = rng.random((60, 2))
        faces = np.array([[i, i + 1, i + 2] for i in range(0, 57, 3)])
        rast = rasterize_uv_np(uv, faces, 256)
        a, b, c = uv[faces[:, 0]], uv[faces[:, 1]], uv[faces[:, 2]]
        area = 0.5 * np.abs((b - a)[:, 0] * (c - a)[:, 1] - (b - a)[:, 1] * (c - a)[:, 0])
        ids = rast[..., 3].astype(int) - 1
        for f in range(len(faces)):                          # каждый треугольник — около своей площади (без перекрытий)
            if area[f] > 0.01:
                own = (ids == f).sum() / 256 ** 2
                assert own <= area[f] * 1.05 + 4 / 256
        assert ((ids >= 0).sum() / 256 ** 2) <= area.sum() + 0.01


if __name__ == "__main__":
    unittest.main()
