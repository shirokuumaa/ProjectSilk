"""Stable Fast 3D on the product photos: GLB per photo, times and GPU memory (as the repo's run.py, one photo at a time).

Run inside the SF3D venv (run_session.sh):
  python run_sf3d.py --repo /workspace/stable-fast-3d --photos <dir with NN_kind/item.*> --out <dir> [--texture 1024]
Writes <out>/<NN_kind>_sf3d.glb, <out>/<NN_kind>_sf3d_input.png and <out>/results.json.
"""
import argparse
import json
import sys
import time
import traceback
from pathlib import Path


def photos_in(root):
    return sorted(p for p in Path(root).glob("*/item.*") if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--photos", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--texture", type=int, default=1024)
    a = ap.parse_args()
    sys.path.insert(0, a.repo)

    import rembg
    import torch
    from PIL import Image
    from sf3d.system import SF3D
    from sf3d.utils import remove_background, resize_foreground

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    model = SF3D.from_pretrained("stabilityai/stable-fast-3d", config_name="config.yaml", weight_name="model.safetensors")
    model.to("cuda")
    model.eval()
    session = rembg.new_session()
    results = {"gpu": torch.cuda.get_device_name(0), "load_s": round(time.time() - t0, 1), "items": []}

    for photo in photos_in(a.photos):
        name = photo.parent.name
        row = {"item": name, "type": "sf3d"}
        try:
            t = time.time()
            image = resize_foreground(remove_background(Image.open(photo).convert("RGBA"), session), 0.85)
            image.save(out / f"{name}_sf3d_input.png")
            row["preprocess_s"] = round(time.time() - t, 1)
            torch.cuda.reset_peak_memory_stats()
            torch.cuda.synchronize()
            t = time.time()
            with torch.no_grad(), torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                mesh, _ = model.run_image([image], bake_resolution=a.texture, remesh="none", vertex_count=-1)
            torch.cuda.synchronize()
            row["generate_s"] = round(time.time() - t, 1)
            mesh = mesh[0] if isinstance(mesh, list) else mesh
            path = out / f"{name}_sf3d.glb"
            mesh.export(path, include_normals=True)
            row.update(peak_gb=round(torch.cuda.max_memory_allocated() / 2**30, 1), glb=path.name,
                       mb=round(path.stat().st_size / 1e6, 2), faces=int(len(mesh.faces)))
        except Exception:  # noqa: BLE001
            row["error"] = traceback.format_exc(limit=3)
        print(json.dumps(row), flush=True)
        results["items"].append(row)
        (out / "results.json").write_text(json.dumps(results, indent=1))
    results["total_s"] = round(time.time() - t0, 1)
    (out / "results.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main()
