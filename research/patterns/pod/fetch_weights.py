"""Download Hugging Face weights into HF_HOME (standard cache layout, so
from_pretrained(..., local_files_only) in both model envs finds them).

Usage: python fetch_weights.py {aipparel|llava|clip224|clip336|all} [--dry-run]
Prints one line per file with size, seconds and MB/s.
"""
import argparse
import os
import sys
import time

from huggingface_hub import HfApi, hf_hub_download

CLIP_FILES = ["config.json", "preprocessor_config.json", "tokenizer.json", "tokenizer_config.json",
              "special_tokens_map.json", "vocab.json", "merges.txt", "pytorch_model.bin"]

SETS = {
    # AIpparel checkpoint (MIT). Does not include the vision tower and projector -> llava + clip224.
    "aipparel": ("georgeNakayama/AIpparel", ["aipparel_pretrained.pth"]),
    # LLaVA-1.5-7B base (Llama 2 Community License); shared by AIpparel and ChatGarment.
    "llava": ("liuhaotian/llava-v1.5-7b", None),
    "clip224": ("openai/clip-vit-large-patch14", CLIP_FILES),       # AIpparel
    "clip336": ("openai/clip-vit-large-patch14-336", CLIP_FILES),   # ChatGarment
}


def fetch(name, dry_run):
    repo, files = SETS[name]
    if files is None:
        files = [f for f in HfApi().list_repo_files(repo) if not f.startswith(".") and f != "README.md"]
    for f in files:
        if dry_run:
            print(f"{name}\t{repo}/{f}\tdry-run", flush=True)
            continue
        t = time.time()
        path = hf_hub_download(repo, f)
        dt = time.time() - t
        size = os.path.getsize(path) / 1e6
        print(f"{name}\t{repo}/{f}\t{size:.0f} MB\t{dt:.1f} s\t{size / max(dt, 1e-3):.0f} MB/s", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("set", choices=[*SETS, "all"])
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    for name in (SETS if a.set == "all" else [a.set]):
        fetch(name, a.dry_run)


if __name__ == "__main__":
    sys.exit(main())
