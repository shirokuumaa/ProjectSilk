"""ChatGarment image -> GarmentCode pattern, for comparison with AIpparel (evaluation only).

Runs the upstream scripts/evaluate_garment_v2_imggen_1float.py unchanged in-process, with:
  * attention 'sdpa' instead of the hard-coded flash_attention_2 (no flash-attn build);
  * no deepspeed launcher, no wandb;
  * the pattern parser wrapped: per-image time, raw JSON + float predictions saved
    (so the GarmentCode pattern can be regenerated on a Mac), errors do not stop the run.

Usage (cwd does not matter):
  python run_chatgarment.py --cg <ChatGarment> --gc <GarmentCodeRC>
      --manifest runs/inputs/manifest.json --out runs/chatgarment [--views model,item]
"""
import argparse
import json
import os
import runpy
import shutil
import sys
import time
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
os.environ.setdefault("WANDB_MODE", "disabled")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cg", required=True, help="ChatGarment checkout")
    ap.add_argument("--gc", required=True, help="GarmentCodeRC checkout")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--views", default="model,item")
    ap.add_argument("--attn", default="sdpa")
    a = ap.parse_args()

    cg, gc = Path(a.cg).resolve(), Path(a.gc).resolve()
    manifest_path = Path(a.manifest).resolve()
    out = Path(a.out).resolve()
    images = out / "inputs"  # the upstream dataset takes every image of one folder
    shutil.rmtree(images, ignore_errors=True)
    images.mkdir(parents=True)
    for m in json.loads(manifest_path.read_text()):
        if m["view"] in a.views.split(","):
            (images / f"{m['id']}.png").symlink_to(manifest_path.parent / m["image"])

    sys.path[:0] = [str(cg), str(gc)]
    os.chdir(cg)  # upstream uses repo-relative paths: docs/, assets/, checkpoints/, runs/

    import numpy as np
    import llava.garment_utils_v2 as gu
    from llava.model import GarmentGPTFloat50ForCausalLM

    orig_from_pretrained = GarmentGPTFloat50ForCausalLM.from_pretrained.__func__

    def from_pretrained(cls, *args, **kwargs):
        kwargs["attn_implementation"] = a.attn
        return orig_from_pretrained(cls, *args, **kwargs)
    GarmentGPTFloat50ForCausalLM.from_pretrained = classmethod(from_pretrained)

    timings = []
    state = {"t": time.time()}
    orig_parser = gu.run_garmentcode_parser_float50

    def parser(all_json_spec_files, json_output, float_preds, output_dir):
        rec = {"id": Path(output_dir).name.removeprefix("valid_garment_"),
               "generate_s": round(time.time() - state["t"], 2)}
        try:
            (Path(output_dir) / "json_output.json").write_text(json.dumps(json_output, indent=2))
            np.save(Path(output_dir) / "float_preds.npy", float_preds.float().cpu().numpy())
            t = time.time()
            all_json_spec_files = orig_parser(all_json_spec_files, json_output, float_preds, output_dir)
            rec["parse_s"] = round(time.time() - t, 2)
            rec["ok"] = True
        except Exception as e:
            rec["ok"] = False
            rec["error"] = f"{type(e).__name__}: {e}"
        print(json.dumps(rec), flush=True)
        timings.append(rec)
        (out / "timings.json").write_text(json.dumps(timings, indent=2))
        state["t"] = time.time()
        return all_json_spec_files
    gu.run_garmentcode_parser_float50 = parser

    # Same arguments as upstream scripts/v1_5/evaluate_garment_v2_imggen_2step.sh,
    # minus --deepspeed and --report_to wandb.
    sys.argv = [
        "evaluate_garment_v2_imggen_1float.py",
        "--lora_enable", "True", "--lora_r", "128", "--lora_alpha", "256", "--mm_projector_lr", "2e-5",
        "--model_name_or_path", "liuhaotian/llava-v1.5-7b", "--version", "v1",
        "--data_path", "./", "--data_path_eval", str(images), "--image_folder", "./",
        "--vision_tower", "openai/clip-vit-large-patch14-336", "--mm_projector_type", "mlp2x_gelu",
        "--mm_vision_select_layer", "-2", "--mm_use_im_start_end", "False", "--mm_use_im_patch_token", "False",
        "--image_aspect_ratio", "pad", "--group_by_modality_length", "True", "--bf16", "True",
        "--output_dir", str(out / "hf_output_dir"), "--num_train_epochs", "1",
        "--per_device_train_batch_size", "16", "--per_device_eval_batch_size", "4",
        "--gradient_accumulation_steps", "1", "--evaluation_strategy", "no", "--save_strategy", "steps",
        "--save_steps", "50000", "--save_total_limit", "1", "--learning_rate", "2e-4", "--weight_decay", "0.",
        "--warmup_ratio", "0.03", "--lr_scheduler_type", "cosine", "--logging_steps", "1", "--tf32", "True",
        "--model_max_length", "3072", "--gradient_checkpointing", "True", "--dataloader_num_workers", "4",
        "--lazy_preprocess", "True", "--report_to", "none",
    ]
    t0 = time.time()
    state["t"] = t0
    try:
        runpy.run_path(str(cg / "scripts" / "evaluate_garment_v2_imggen_1float.py"), run_name="__main__")
    finally:
        # upstream writes to <cg>/runs/<exp>/<folder>_img_recon/vis_new/valid_garment_<id>/
        for d in (cg / "runs").glob("*/inputs_img_recon/vis_new"):
            shutil.copytree(d, out / "vis_new", dirs_exist_ok=True)
        (out / "total.json").write_text(json.dumps({"total_s": round(time.time() - t0, 1)}))


if __name__ == "__main__":
    main()
