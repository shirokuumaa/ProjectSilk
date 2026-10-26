"""Tests of the size fitting (size_fit.py): the bracket search for knobs whose response peaks and the fitted dress's
waist.

Usage (from research/patterns/): .envs/mac/bin/python -m unittest test_size_fit
The body tests need the MPFB size bodies (local, not in git: python mpfb_body.py --all --out runs/allsizes/bodies)
and are skipped without them; all tests take ~20 s.
"""
import sys
import unittest
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "garments"))
import size_fit as S  # noqa: E402

BODIES = HERE / "runs" / "allsizes" / "bodies"
HAVE_BODIES = (BODIES / "zara_M.yaml").exists() and (BODIES / "bodies.json").exists()


def drafter(template, **knobs):
    """A drafter of our template on the MPFB body of the general chart's M (the seller pipeline's drafter)."""
    import json
    import patterns_job
    rows = {r["name"]: r["levels"] for r in json.load(open(BODIES / "bodies.json"))}
    D = patterns_job.drafter_class()("M", {"template": template, **knobs}, BODIES, "zara_M", rows)
    return D


class Scan(unittest.TestCase):
    def test_a_peaked_response_gives_the_crossing_nearest_the_current_value(self):
        f = lambda x: -(x - 1.1) ** 2         # noqa: E731 — like the old waist response: up, then down
        target = -0.005                        # crossed at 1.029 and 1.171, both ends of [0.8, 1.4] below it
        a, b, fa, fb = S.Drafter.scan(f, 0.8, 1.4, f(0.8), f(1.4), target, v0=1.0)
        self.assertLessEqual(a, 1.029)
        self.assertGreaterEqual(b, 1.029)
        self.assertLess(b, 1.171)
        self.assertLessEqual((target - fa) * (target - fb), 0)

    def test_out_of_reach_keeps_the_range(self):
        f = lambda x: x                        # noqa: E731
        self.assertEqual(S.Drafter.scan(f, 0.8, 1.4, 0.8, 1.4, 2.0, v0=1.0), (0.8, 1.4, 0.8, 1.4))


@unittest.skipUnless(HAVE_BODIES, "no MPFB size bodies in runs/allsizes/bodies")
class Bodies(unittest.TestCase):
    def test_the_fitted_dress_waist_grows_with_the_waist_ease(self):
        D = drafter("dress_fitted", sleeve="short", length="mini")
        waists = []
        for e in np.arange(0.85, 1.36, 0.1):
            D.ease["waist"] = e
            waists.append(D.measure()["waist"])
        self.assertTrue(all(b > a + 1 for a, b in zip(waists, waists[1:])), waists)


if __name__ == "__main__":
    unittest.main()
