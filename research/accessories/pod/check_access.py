"""Before anything is installed: does HF_TOKEN open the gated weights the session needs? Exits 1 if not.

TRELLIS.2 reads the photo with DINOv3; SF3D is behind the Stability AI Community License click-through.
Access is granted per Hugging Face account on each page. The background is cut with BiRefNet (MIT, open)
instead of the gated, non-commercial RMBG-2.0 from TRELLIS.2's pipeline.json (run_trellis2.py --rembg).
"""
import os
import sys

from huggingface_hub import get_token, hf_hub_download

NEEDED = [
    ("microsoft/TRELLIS.2-4B", "pipeline.json"),
    ("facebook/dinov3-vitl16-pretrain-lvd1689m", "config.json"),
    ("stabilityai/stable-fast-3d", "config.yaml"),
]

# токен — из HF_TOKEN (секрет RunPod) или из `hf auth login` на поде (~/.cache/huggingface/token)
if not (os.environ.get("HF_TOKEN") or get_token()):
    sys.exit("No Hugging Face token: set HF_TOKEN = {{ RUNPOD_SECRET_hf_token }} or run `hf auth login` on the pod")
bad = []
for repo, file in NEEDED:
    try:
        hf_hub_download(repo, file)
        print(f"ok   {repo}")
    except Exception as e:  # noqa: BLE001 — любая ошибка доступа одинаково останавливает сеанс
        print(f"FAIL {repo}: {type(e).__name__}: {str(e).splitlines()[0][:160]}")
        bad.append(repo)
sys.exit(1 if bad else 0)
