"""TRELLIS.2-4B on the product photos: GLB with PBR textures per photo and pipeline type, times and GPU memory.

Run inside the TRELLIS.2 venv (run_session.sh):
  python run_trellis2.py --repo /workspace/TRELLIS.2 --photos <dir with NN_kind/item.*> --out <dir> \
      [--types 512,1024_cascade] [--faces 100000] [--texture 2048]
Writes <out>/<NN_kind>_<type>.glb, <out>/<NN_kind>_input.png (photo without background) and <out>/results.json.
"""
import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")


def photos_in(root):
    return sorted(p for p in Path(root).glob("*/item.*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--types", default="512,1024_cascade")
    ap.add_argument("--faces", type=int, default=100000, help="decimation target of the exported GLB")
    ap.add_argument("--texture", type=int, default=2048)
    ap.add_argument("--rembg", default="ZhengPeng7/BiRefNet",
                    help="background model instead of pipeline.json's RMBG-2.0 (gated, CC BY-NC); same BiRefNet architecture, MIT")
    a = ap.parse_args()
    sys.path.insert(0, a.repo)

    import torch
    from PIL import Image
    import o_voxel
    from trellis2.pipelines import Trellis2ImageTo3DPipeline
    from trellis2.pipelines import rembg as t2_rembg

    if a.rembg:                                     # pipeline.json просит briaai/RMBG-2.0 — подменяем веса
        load = t2_rembg.BiRefNet.__init__

        def init(self, model_name=None):
            load(self, a.rembg)
            self.model.float()                      # веса BiRefNet — fp16, а картинку TRELLIS.2 подаёт во float32
        t2_rembg.BiRefNet.__init__ = init

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    pipe = Trellis2ImageTo3DPipeline.from_pretrained("microsoft/TRELLIS.2-4B")
    pipe.cuda()
    results = {"gpu": torch.cuda.get_device_name(0), "load_s": round(time.time() - t0, 1), "rembg": a.rembg, "items": []}
    print(f"pipeline loaded in {results['load_s']} s on {results['gpu']}", flush=True)

    for photo in photos_in(a.photos):
        name = photo.parent.name
        try:
            t = time.time()
            image = pipe.preprocess_image(Image.open(photo))
            image.save(out / f"{name}_input.png")
            pre_s = time.time() - t
        except Exception:  # noqa: BLE001
            results["items"].append({"item": name, "error": traceback.format_exc(limit=3)})
            continue
        for ptype in a.types.split(","):
            row = {"item": name, "type": ptype, "preprocess_s": round(pre_s, 1)}
            try:
                torch.cuda.reset_peak_memory_stats()
                torch.cuda.synchronize()
                t = time.time()
                mesh = pipe.run(image, preprocess_image=False, pipeline_type=ptype, seed=1)[0]
                torch.cuda.synchronize()
                row["generate_s"] = round(time.time() - t, 1)
                mesh.simplify(16777216)                     # предел nvdiffrast, как в example.py
                t = time.time()
                glb = o_voxel.postprocess.to_glb(
                    vertices=mesh.vertices, faces=mesh.faces, attr_volume=mesh.attrs, coords=mesh.coords,
                    attr_layout=mesh.layout, voxel_size=mesh.voxel_size, aabb=[[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                    decimation_target=a.faces, texture_size=a.texture, remesh=True, remesh_band=1, remesh_project=0,
                )
                path = out / f"{name}_{ptype}.glb"
                glb.export(path, extension_webp=True)
                torch.cuda.synchronize()
                row.update(export_s=round(time.time() - t, 1), peak_gb=round(torch.cuda.max_memory_allocated() / 2**30, 1),
                           glb=path.name, mb=round(path.stat().st_size / 1e6, 2), faces=int(len(glb.faces)) if hasattr(glb, "faces") else None)
            except Exception:  # noqa: BLE001
                row["error"] = traceback.format_exc(limit=3)
            print(json.dumps(row), flush=True)
            results["items"].append(row)
            (out / "results.json").write_text(json.dumps(results, indent=1))
            torch.cuda.empty_cache()
    results["total_s"] = round(time.time() - t0, 1)
    (out / "results.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
