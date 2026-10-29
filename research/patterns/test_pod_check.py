"""Tests of the short-check settings (pod/run_check_short.sh): newton_case's attachment / settle / speed / snapshot
flags, and GarmentCode parameter overrides in a research pattern job.

Usage (from research/patterns/): .envs/mac/bin/python -m unittest test_pod_check
The Newton test runs 2 frames on the CPU in .envs/newton and needs the trousers boxes (runs/arms_trousers);
skipped without them.
"""
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1] / "scripts" / "garments"))

NEWTON = HERE / ".envs" / "newton" / "bin" / "python"
TROUSERS = HERE / "runs" / "arms_trousers"
BODIES = HERE / "runs" / "arms" / "bodies"


@unittest.skipUnless(NEWTON.exists() and (TROUSERS / "boxes" / "size_XS").exists(), "no Newton env or trousers boxes")
class NewtonFlags(unittest.TestCase):
    def test_attachment_settle_speed_and_snapshots_reach_the_run(self):
        with tempfile.TemporaryDirectory() as out:
            r = subprocess.run([str(NEWTON), str(HERE / "pod" / "newton_case.py"),
                                "--box-dir", str(TROUSERS / "boxes" / "size_XS"), "--case", "size_XS",
                                "--body-obj", str(TROUSERS / "bodies_mpfb" / "product_XS.obj"),
                                "--body-yaml", str(TROUSERS / "bodies_mpfb" / "product_XS.yaml"), "--out", out,
                                "--max-frames", "2", "--device", "cpu", "--attach-ke", "20", "--settle-frames", "60",
                                "--max-speed", "0.3", "--snapshots", "1"], capture_output=True, text=True, timeout=600)
            self.assertEqual(r.returncode, 0, r.stderr[-2000:])
            res = json.load(open(Path(out) / "size_XS" / "case_result.json"))
            self.assertEqual((res["attach_ke"], res["settle_frames"], res["max_speed"]), (20.0, 60, 0.3))
            self.assertEqual(res["nan_vertices"], 0)
            snaps = sorted(p.name for p in (Path(out) / "size_XS").glob("size_XS_f*.obj"))
            self.assertEqual(snaps, ["size_XS_f0000.obj", "size_XS_f0001.obj"])


@unittest.skipUnless((BODIES / "zara_M.yaml").exists(), "no MPFB size bodies in runs/arms/bodies")
class DesignOverrides(unittest.TestCase):
    def test_a_research_job_can_set_garmentcode_parameters(self):
        import patterns_job
        rows = {r["name"]: r["levels"] for r in json.load(open(BODIES / "bodies.json"))}
        D = patterns_job.drafter_class()("M", {"template": "jacket", "length": "hip", "design": {"sleeve.end_width": 1.0}},
                                         BODIES, "zara_M", rows)
        self.assertEqual(D.design["sleeve"]["end_width"]["v"], 1.0)
        plain = patterns_job.drafter_class()("M", {"template": "jacket", "length": "hip"}, BODIES, "zara_M", rows)
        self.assertEqual(plain.design["sleeve"]["end_width"]["v"], 0.75)


if __name__ == "__main__":
    unittest.main()
