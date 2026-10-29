"""Tests of the straight-arm avatar (scripts/avatar/build_avatar.straighten_arms, 60f05a29) as the simulation sees it.

Usage (from research/patterns/): .envs/mac/bin/python -m unittest test_arms
The sleeve tests need a jacket box on the new bodies (local, not in git: scripts/garments/patterns_job.py
--job demo/jacket_job.json --out runs/arms_jacket) and its Newton drape (pod/run_demo_all.sh); skipped without them.
"""
import json
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "avatar"))
import config  # noqa: E402

JACKET = HERE / "runs" / "cuff_jacket"   # the wide cuff (sleeve.end_width 1.0), every size


class Avatar(unittest.TestCase):
    def test_the_arms_are_straight_and_the_hands_not_forward(self):
        """Axes of the upper arm and the forearm through the centres of 2 cm slices of the neutral body's arm."""
        import mpfb_body
        mp = mpfb_body.MPFB()
        V = mp.body.coords(np.zeros(len(config.CONTROL_NAMES)))
        for side in ("left", "right"):
            A = V[mp.labels[f"{side}_arm"]]
            c = A.mean(0)
            d = np.linalg.svd(A - c)[2][0]
            t = (A - c) @ d
            t = t - t.min() if abs(A[np.argmin(t), 0]) < abs(A[np.argmax(t), 0]) else t.max() - t   # 0 at the shoulder
            bins = np.arange(0, t.max(), 0.02)
            cen = np.array([A[(t >= b) & (t < b + 0.02)].mean(0) for b in bins if ((t >= b) & (t < b + 0.02)).sum() > 5])
            n = len(cen)
            def axis(P):
                return np.linalg.svd(P - P.mean(0))[2][0]
            upper, fore = axis(cen[int(0.15 * n):int(0.4 * n)]), axis(cen[int(0.5 * n):int(0.75 * n)])
            self.assertLess(np.degrees(np.arccos(min(1.0, abs(upper @ fore)))), 8.0)   # bent elbows: ~30 deg
            self.assertLess(abs(fore[2]), 0.1)            # glTF z = forward: the forearm does not point forward

    def test_a_size_body_has_the_norm_arm_and_its_legs(self):
        import mpfb_body
        mp = mpfb_body.MPFB()
        u, res = mp.solve(166, 90, 70, 98)
        m = mp.body.measure(u)
        self.assertAlmostEqual(m["arm_length"], config.ARM_PER_HEIGHT * 166, delta=0.5)
        self.assertGreater(m["inseam"], 76.5)                   # was 75.8 when the arm took the height morph
        for k in ("bust", "waist", "hips"):
            self.assertLess(abs(res[k]), config.TOLERANCE_CM)


@unittest.skipUnless((JACKET / "result.json").exists(), "no jacket boxes on the straight-arm bodies")
class Sleeve(unittest.TestCase):
    def test_the_arm_lies_in_the_sleeve_tube(self):
        from sleeve_fit_check import check
        r = json.load(open(JACKET / "result.json"))
        size = r["sizes"][0]["size"]
        res = check(JACKET / "boxes" / f"size_{size}", f"size_{size}", JACKET / "bodies_mpfb" / f"product_{size}.obj",
                    JACKET / "bodies_mpfb" / "ggg_body_segmentation.json")
        for side in res.values():
            self.assertGreater(side["arm_inside_%"], 85, res)    # bent elbows: 35-52 %
            self.assertLess(side["axes_angle_deg"], 10, res)      # bent elbows: 29-35 deg



@unittest.skipUnless((JACKET / "newton" / "results" / "size_L" / "size_L_sim.obj").exists(), "no draped jacket L")
class DrapedSleeve(unittest.TestCase):
    def test_the_jacket_sleeve_follows_the_arm_after_the_drape_in_every_size(self):
        from sleeve_drape_check import check
        for size in ("XS", "S", "M", "L", "XL", "XXL"):
            c = f"size_{size}"
            res = check(JACKET / "newton" / "results" / c / f"{c}_sim.obj", JACKET / "boxes" / c, c,
                        JACKET / "bodies_mpfb" / f"product_{size}.obj", JACKET / "bodies_mpfb" / "ggg_body_segmentation.json")
            for side in ("left", "right"):
                self.assertGreater(res[side]["cover_%"], 80, (size, res))  # bent elbows: 25 %; cuff 0.75 in XS-M: 59-71 %
                self.assertLess(res[side]["hem_gap_cm"], 5, (size, res))   # bent elbows ~9 cm; cuff 0.75 in XS-M 8-12
            self.assertLess(res["top_drop_body_cm"], 12, res)          # from GarmentCode's layout above the shoulders


if __name__ == "__main__":
    unittest.main()
