"""Run GarmentCode's own simulator (pygarment + their Warp fork) on one pattern and one body.

The same steps as GarmentCode's test_garment_sim.py: box mesh -> run_sim, with three changes:
  * the body comes from any folder in their layout (<body>.obj in metres, <body>.yaml,
    ggg_body_segmentation.json) — written into GarmentCode's system.json for this process;
  * their pyrender renderer is replaced by a no-op (no OpenGL on the pod; pictures are made on the Mac);
  * a result json with wall-clock times, their quality stats and file sizes.

Usage (cwd anywhere):
  python gc_sim_case.py --gc <GarmentCode repo> --case-dir <dir with <case>_specification.json>
      --case <case> --bodies <bodies dir> --body <body name> --config <sim config yaml> --out <dir>
      [--max-steps N]   # override max_sim_steps (CPU smoke test)
"""
import argparse
import json
import os
import sys
import time
import types
from pathlib import Path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gc", required=True)
    ap.add_argument("--case-dir", required=True)
    ap.add_argument("--case", required=True)
    ap.add_argument("--bodies", required=True)
    ap.add_argument("--body", required=True)
    ap.add_argument("--config", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--max-steps", type=int)
    a = ap.parse_args()
    gc, case_dir, bodies, out = (Path(p).resolve() for p in (a.gc, a.case_dir, a.bodies, a.out))
    config = Path(a.config).resolve()
    out.mkdir(parents=True, exist_ok=True)

    os.chdir(gc)                                  # their code reads ./system.json and ./assets/...
    sys.path.insert(0, str(gc))
    json.dump({"output": str(out), "datasets_path": "", "datasets_sim": "",
               "sim_configs_path": str(gc / "assets" / "Sim_props"), "bodies_default_path": str(bodies),
               "body_samples_path": ""}, open(gc / "system.json", "w"), indent=1)
    stub = types.ModuleType("pygarment.meshgen.render.pythonrender")
    stub.render_images = lambda *args, **kwargs: None
    sys.modules["pygarment.meshgen.render.pythonrender"] = stub

    t0 = time.time()
    import warp as wp
    import pygarment.data_config as data_config
    from pygarment.meshgen.boxmeshgen import BoxMesh
    from pygarment.meshgen.sim_config import PathCofig
    from pygarment.meshgen.simulation import run_sim
    t_import = time.time() - t0

    props = data_config.Properties(str(config))
    if a.max_steps:
        props["sim"]["config"]["max_sim_steps"] = a.max_steps
    props["sim"]["config"]["optimize_storage"] = False
    uv = props["render"]["config"]["uv_texture"]
    if not (gc / uv["fabric_grain_texture_path"]).exists():       # GarmentCodeData configs use an older path
        uv["fabric_grain_texture_path"] = "./assets/img/fabric_texture.png"
    props.set_section_stats("sim", fails={}, sim_time={}, spf={}, fin_frame={}, body_collisions={},
                            self_collisions={})
    props.set_section_stats("render", render_time={})

    paths = PathCofig(in_element_path=case_dir, out_path=str(out), in_name=a.case, body_name=a.body,
                      smpl_body=False, add_timestamp=False)
    t1 = time.time()
    box = BoxMesh(str(paths.in_g_spec), props["sim"]["config"]["resolution_scale"])
    box.load()
    box.serialize(paths, store_panels=False, uv_config=props["render"]["config"]["uv_texture"])
    t_box = time.time() - t1
    props.serialize(paths.element_sim_props)

    t2 = time.time()
    run_sim(box.name, props, paths, save_v_norms=False, store_usd=False, optimize_storage=False, verbose=False)
    t_sim = time.time() - t2
    props.serialize(paths.element_sim_props)

    st = props["sim"]["stats"]
    fails = [k for k, v in st["fails"].items() if box.name in v] if st.get("fails") else []
    sim_obj = paths.g_sim
    res = {
        "case": a.case, "body": a.body, "device": str(wp.get_device()),
        "import_s": round(t_import, 1), "boxmesh_s": round(t_box, 1), "sim_wall_s": round(t_sim, 1),
        "sim_time_s": st["sim_time"].get(box.name), "frames": (st["fin_frame"].get(box.name) or 0) + 1,
        "s_per_frame": st["spf"].get(box.name), "fails": fails,
        "body_collisions": st["body_collisions"].get(box.name),
        "self_collisions": st["self_collisions"].get(box.name),
        "sim_obj": str(sim_obj.relative_to(out)) if sim_obj.exists() else None,
        "sim_obj_mb": round(sim_obj.stat().st_size / 2 ** 20, 2) if sim_obj.exists() else None,
        "max_steps": props["sim"]["config"]["max_sim_steps"],
    }
    if sim_obj.exists():                            # did the cloth move at all, did it blow up
        import numpy as np
        import trimesh
        v0 = np.asarray(trimesh.load(paths.g_box_mesh, process=False, force="mesh").vertices)
        v1 = np.asarray(trimesh.load(sim_obj, process=False, force="mesh").vertices)
        if v0.shape == v1.shape:
            d = np.linalg.norm(v1 - v0, axis=1)
            res.update(move_max_cm=round(float(np.nanmax(d)), 2), move_mean_cm=round(float(np.nanmean(d)), 2))
        res.update(nan_vertices=int(np.isnan(v1).any(1).sum()),
                   sim_bbox_cm=np.round([np.nanmin(v1, 0), np.nanmax(v1, 0)], 1).tolist())
    json.dump(res, open(paths.out_el / "case_result.json", "w"), indent=1)
    print("CASE_RESULT", json.dumps(res))


if __name__ == "__main__":
    main()
