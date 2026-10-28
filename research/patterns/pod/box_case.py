"""GarmentCode's stitched box mesh of one pattern (pygarment BoxMesh) — without the simulation.

The box is what Newton starts from (pod/newton_case.py --box-dir): <case>_boxmesh.obj, _sim_segmentation.txt,
_orig_lens.pickle, _vertex_labels.yaml. BoxMesh runs on the CPU, so this is done on the Mac before a GPU session;
the same steps as gc_sim_case.py up to run_sim.

Usage: .envs/gcsim/bin/python pod/box_case.py --gc .envs/src/GarmentCode --case-dir <dir> --case <case>
           --bodies <bodies dir> --body <body> --config <sim_config.yaml> --out <dir>
"""
import argparse
import json
import os
import shutil
import sys
import tempfile
import time
import types
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    for k in ("--gc", "--case-dir", "--case", "--bodies", "--body", "--config", "--out"):
        ap.add_argument(k, required=True)
    a = ap.parse_args()
    gc, case_dir, bodies, out, config = (Path(p).resolve() for p in (a.gc, a.case_dir, a.bodies, a.out, a.config))
    out.mkdir(parents=True, exist_ok=True)
    # GarmentCode reads ./system.json (the bodies folder) and ./assets from the working directory: each process works
    # in its own folder — in GarmentCode's own folder two box builds at once read each other's bodies folder
    work = Path(tempfile.mkdtemp(prefix="box_case_"))
    (work / "assets").symlink_to(gc / "assets")
    os.chdir(work)
    sys.path.insert(0, str(gc))
    json.dump({"output": str(out), "datasets_path": "", "datasets_sim": "",
               "sim_configs_path": str(gc / "assets" / "Sim_props"), "bodies_default_path": str(bodies),
               "body_samples_path": ""}, open(work / "system.json", "w"), indent=1)
    stub = types.ModuleType("pygarment.meshgen.render.pythonrender")
    stub.render_images = lambda *args, **kwargs: None
    sys.modules["pygarment.meshgen.render.pythonrender"] = stub
    # cairosvg only draws the pattern PNG/PDF; on the Mac there is no system libcairo — not needed for the box
    cairo = types.ModuleType("cairosvg")
    cairo.svg2png = cairo.svg2pdf = lambda *args, **kwargs: None
    sys.modules["cairosvg"] = cairo

    import pygarment.data_config as data_config
    from pygarment.meshgen.boxmeshgen import BoxMesh
    from pygarment.meshgen.sim_config import PathCofig

    props = data_config.Properties(str(config))
    uv = props["render"]["config"]["uv_texture"]
    if not (gc / uv["fabric_grain_texture_path"]).exists():
        uv["fabric_grain_texture_path"] = "./assets/img/fabric_texture.png"
    paths = PathCofig(in_element_path=case_dir, out_path=str(out), in_name=a.case, body_name=a.body,
                      smpl_body=False, add_timestamp=False)
    t0 = time.time()
    box = BoxMesh(str(paths.in_g_spec), props["sim"]["config"]["resolution_scale"])
    box.load()
    box.serialize(paths, store_panels=False, uv_config=uv)
    print("BOX", json.dumps({"case": a.case, "body": a.body, "box_s": round(time.time() - t0, 1),
                             "dir": str(paths.out_el)}))
    os.chdir(out)
    shutil.rmtree(work)                      # removes the assets link, not GarmentCode's assets


if __name__ == "__main__":
    main()
