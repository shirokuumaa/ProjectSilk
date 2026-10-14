"""AIpparel inference over our manifest (photos -> sewing patterns).

Follows the upstream scripts/inference.py, with these changes:
  * config via hydra.compose (no hydra run dir), HF offline, paths from arguments;
  * the 27 GB checkpoint is memory-mapped and loaded after the model is on the GPU,
    so peak RAM stays ~15 GB; missing/unexpected keys are reported;
  * fixed seed per sample, per-sample time and token count;
  * raw model outputs are saved (raw_output.pt) so patterns can be re-decoded on a Mac.

Usage (pod):
  python run_aipparel.py --src <AIpparel-Code> --ckpt <aipparel_pretrained.pth>
      --manifest runs/inputs/manifest.json --out runs/aipparel [--modes image,text_image] [--views model,item]
  --smoke: build tokenizer + dataset + batches only (no model); works on CPU.
"""
import argparse
import json
import os
import random
import sys
import time
from functools import partial
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def build_inference_json(manifest, inputs_dir, modes, views, path):
    entries, ids = [], []
    for mode in modes:
        for m in manifest:
            if m["view"] not in views:
                continue
            inputs = {"image_path": str(inputs_dir / m["image"])}
            if mode == "text_image":
                inputs["description"] = m["description"] + "."
            entries.append({"type": mode, "inputs": inputs})
            ids.append(f"{m['id']}__{mode}")
    path.write_text(json.dumps(entries, indent=2))
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="AIpparel-Code checkout")
    ap.add_argument("--ckpt", help="aipparel_pretrained.pth")
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--modes", default="image,text_image")
    ap.add_argument("--views", default="model,item")
    ap.add_argument("--max-new-tokens", type=int, default=2100)
    ap.add_argument("--smoke", action="store_true")
    a = ap.parse_args()

    src = Path(a.src).resolve()
    manifest_path = Path(a.manifest).resolve()
    out = Path(a.out).resolve()
    ckpt = Path(a.ckpt).resolve() if a.ckpt else None
    sys.path.insert(0, str(src))
    os.chdir(src)  # upstream uses repo-relative asset paths

    import torch
    import transformers
    import hydra
    from hydra import compose, initialize_config_dir
    from omegaconf import OmegaConf
    from torch.utils.data import DataLoader
    from PIL import Image

    from models.aipparel_model import AIpparelForCausalLM
    from models.llava import conversation as conversation_lib
    from data.data_wrappers.collate_fns import collate_fn
    from data.datasets.inference_dataset import InferenceDataset
    from data.datasets.utils import DEFAULT_IM_END_TOKEN, DEFAULT_IM_START_TOKEN
    from trainers.utils import dict_to_cuda, dict_to_cpu, dict_to_dtype

    manifest = json.loads(manifest_path.read_text())
    out.mkdir(parents=True, exist_ok=True)
    ids = build_inference_json(manifest, manifest_path.parent, a.modes.split(","), a.views.split(","),
                               out / "inference.json")

    with initialize_config_dir(config_dir=str(src / "configs"), version_base=None):
        cfg = compose(config_name="aipparel_inference")

    t0 = time.time()
    tokenizer = transformers.AutoTokenizer.from_pretrained(
        cfg.version, model_max_length=cfg.model_max_length, padding_side="right", use_fast=False)
    dataset = InferenceDataset(
        inference_json=str(out / "inference.json"),
        vision_tower=cfg.vision_tower,
        image_size=224,
        garment_tokenizer=hydra.utils.instantiate(cfg.garment_tokenizer),
        panel_classification=cfg.panel_classification,
    )
    tokenizer.pad_token = tokenizer.unk_token
    all_new_tokens = dataset.get_all_token_names()
    tokenizer.add_tokens(all_new_tokens)
    token_name2_idx_dict = {t: tokenizer(t, add_special_tokens=False).input_ids[0] for t in all_new_tokens}
    dataset.set_token_indices(token_name2_idx_dict)
    model_cfg = OmegaConf.to_container(cfg.model, resolve=True)
    if model_cfg["use_mm_start_end"]:
        tokenizer.add_tokens([DEFAULT_IM_START_TOKEN, DEFAULT_IM_END_TOKEN], special_tokens=True)
    conversation_lib.default_conversation = conversation_lib.conv_templates[cfg.conv_type]
    collate = partial(collate_fn, tokenizer=tokenizer, conv_type=cfg.conv_type,
                      use_mm_start_end=model_cfg["use_mm_start_end"], local_rank=0, generation_only=True)

    if a.smoke:
        for i in range(len(dataset)):
            random.seed(i)
            batch = collate([dataset[i]])
            print(ids[i], tuple(batch["question_ids"].shape), tuple(batch["images_clip"].shape))
        print(f"smoke ok: {len(dataset)} samples, {time.time() - t0:.1f} s")
        return

    torch_dtype = torch.bfloat16 if cfg.precision == "bf16" else torch.half
    model = AIpparelForCausalLM.from_pretrained(
        cfg.version, torch_dtype=torch_dtype, low_cpu_mem_usage=True, **model_cfg,
        vision_tower=cfg.vision_tower, panel_edge_indices=dataset.panel_edge_type_indices,
        gt_stats=dataset.gt_stats)
    model.config.eos_token_id = tokenizer.eos_token_id
    model.config.bos_token_id = tokenizer.bos_token_id
    model.config.pad_token_id = tokenizer.pad_token_id
    model.get_model().initialize_vision_modules(model.get_model().config)
    model.get_model().get_vision_tower().to(dtype=torch_dtype, device="cuda")
    model.resize_token_embeddings(len(tokenizer))
    for p in model.parameters():
        p.requires_grad = False
    model = model.to("cuda")

    t1 = time.time()
    try:
        state_dict = torch.load(ckpt, map_location="cpu", mmap=True)
    except RuntimeError as e:  # legacy (non-zip) checkpoints cannot be memory-mapped
        print(f"mmap failed ({e}); loading into RAM", flush=True)
        state_dict = torch.load(ckpt, map_location="cpu")
    res = model.load_state_dict(state_dict, strict=False)
    del state_dict
    model.eval()
    load = {"base_model_s": round(t1 - t0, 1), "checkpoint_s": round(time.time() - t1, 1),
            "missing_keys": len(res.missing_keys), "unexpected_keys": len(res.unexpected_keys),
            "missing_examples": res.missing_keys[:20], "unexpected_examples": res.unexpected_keys[:20],
            "gpu_mem_gb": round(torch.cuda.memory_allocated() / 1e9, 1)}
    print("load:", json.dumps(load), flush=True)
    (out / "load.json").write_text(json.dumps(load, indent=2))

    loader = DataLoader(dataset, batch_size=1, shuffle=False, num_workers=0, collate_fn=collate)
    timings = []
    for i, input_dict in enumerate(loader):
        sample = out / ids[i]
        sample.mkdir(exist_ok=True)
        t = time.time()
        rec = {"id": ids[i]}
        try:
            torch.cuda.empty_cache()
            random.seed(i)
            torch.manual_seed(i)
            input_dict = dict_to_cuda(input_dict)
            input_dict = dict_to_dtype(input_dict, torch_dtype, [
                "images_clip", "param_targets", "param_target_endpoints", "param_target_transformations",
                "questions_pattern_endpoints", "questions_pattern_transformations"])
            output_dict = model.evaluate(
                input_dict["images_clip"], input_dict["question_ids"], input_dict["question_attention_masks"],
                endpoints=input_dict["questions_pattern_endpoints"],
                endpoints_mask=input_dict["questions_pattern_endpoints_mask"],
                transformations=input_dict["questions_pattern_transformations"],
                transformations_mask=input_dict["questions_pattern_transformations_mask"],
                max_new_tokens=a.max_new_tokens)
            torch.cuda.synchronize()
            rec["generate_s"] = round(time.time() - t, 2)
            output_dict = dict_to_dtype(dict_to_cpu(output_dict), torch.float32)
            output_dict["input_mask"] = (torch.arange(output_dict["output_ids"].shape[1]).reshape(1, -1)
                                         >= input_dict["question_ids"].shape[1])
            rec["new_tokens"] = int(output_dict["output_ids"].shape[1] - input_dict["question_ids"].shape[1])
            torch.save({"output_dict": output_dict, "question_ids": input_dict["question_ids"].cpu(),
                        "question": input_dict["questions_list"][0]}, sample / "raw_output.pt")
            output_text, patterns, _ = dataset.decode(output_dict, tokenizer)
            patterns.serialize(str(sample), spec_only=False, with_3d=False, with_text=False,
                               view_ids=False, to_subfolder=False, tag="_pred")
            (sample / "output.txt").write_text(
                f"Question: {input_dict['questions_list'][0]}\nOutput Text: {output_text}\n")
            Image.open(input_dict["image_paths"][0]).save(sample / "input.png")
            rec["ok"] = True
        except Exception as e:  # keep going: one bad sample must not stop the GPU session
            rec["ok"] = False
            rec["error"] = f"{type(e).__name__}: {e}"
        rec["total_s"] = round(time.time() - t, 2)
        print(json.dumps(rec), flush=True)
        timings.append(rec)
        (out / "timings.json").write_text(json.dumps(timings, indent=2))


if __name__ == "__main__":
    main()
