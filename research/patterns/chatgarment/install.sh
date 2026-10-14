#!/usr/bin/env bash
# Install ChatGarment (code Apache-2.0, weights WITHOUT a license -> evaluation only, never
# in a public image or in production) + GarmentCodeRC (MIT) for image -> pattern inference.
#
# Usage: install.sh <prefix>   -> <prefix>/ChatGarment, <prefix>/GarmentCodeRC, <prefix>/venv-chatgarment
# Needs: uv, git. Runtime: libcairo2. Weights: <prefix>/weights/chatgarment/pytorch_model.bin (pod/setup_pod.sh).
# TORCH_CPU=1: CPU torch from PyPI (Mac check).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../pod/versions.sh"

PREFIX="$(mkdir -p "${1:?usage: install.sh <prefix>}" && cd "$1" && pwd)"
CG="$PREFIX/ChatGarment"
GC="$PREFIX/GarmentCodeRC"
VENV="$PREFIX/venv-chatgarment"

checkout() {  # dir repo commit
  [ -d "$1/.git" ] || { git init -q "$1"; git -C "$1" remote add origin "$2"; }
  git -C "$1" fetch -q --depth 1 origin "$3"
  git -C "$1" checkout -q -f FETCH_HEAD
}
checkout "$CG" "$CHATGARMENT_REPO" "$CHATGARMENT_COMMIT"
checkout "$GC" "$GARMENTCODERC_REPO" "$GARMENTCODERC_COMMIT"

# Hard-coded cluster paths -> our GarmentCodeRC checkout.
grep -rl "/is/cluster/fast/sbian/github/GarmentCodeV2/" "$CG" --include='*.py' \
  | xargs sed -i.orig "s#/is/cluster/fast/sbian/github/GarmentCodeV2/#$GC/#g"
# Repo-relative paths used by the code: assets/ (GarmentCodeRC) and the checkpoint location.
ln -sfn "$GC/assets" "$CG/assets"
mkdir -p "$CG/checkpoints/try_7b_lr1e_4_v3_garmentcontrol_4h100_v4_final"
ln -sfn "$PREFIX/weights/chatgarment/pytorch_model.bin" \
  "$CG/checkpoints/try_7b_lr1e_4_v3_garmentcontrol_4h100_v4_final/pytorch_model.bin"
# GarmentCodeRC reads system.json (only for simulation paths); the template's relative paths are fine.
cp -n "$GC/system.template.json" "$GC/system.json"

uv venv -q --allow-existing -p "$PYTHON_VERSION" "$VENV"
if [ "${TORCH_CPU:-0}" = 1 ]; then
  uv pip install -q -p "$VENV/bin/python" $CHATGARMENT_TORCH
else
  uv pip install -q -p "$VENV/bin/python" --index-url "$TORCH_INDEX" $CHATGARMENT_TORCH
fi
# Every later install is constrained to this torch build (otherwise uv may "upgrade" it).
printf '%s\n' $CHATGARMENT_TORCH > "$PREFIX/chatgarment-constraints.txt"
PIN=(-c "$PREFIX/chatgarment-constraints.txt")
# Their pyproject pins (minus gradio/fastapi/bitsandbytes, not used for inference) + pattern code deps.
uv pip install -q -p "$VENV/bin/python" "${PIN[@]}" \
  "transformers==4.37.2" "tokenizers==0.15.1" "sentencepiece==0.1.99" shortuuid "accelerate==0.32.0" \
  "peft==0.10.0" "einops==0.6.1" "einops-exts==0.0.4" "timm==0.6.13" opencv-python-headless easydict \
  tensorboard "scikit-learn==1.2.2" "numpy<2" pydantic requests \
  "pyyaml>=6.0" scipy svgwrite svgpathtools psutil matplotlib CairoSVG \
  ninja py-cpuinfo hjson pynvml packaging wheel "setuptools<70"  # deepspeed build: wheel + pkg_resources
# deepspeed is imported at module level by their training code; ops are not built (pure Python install).
DS_BUILD_OPS=0 uv pip install -q -p "$VENV/bin/python" "${PIN[@]}" --no-build-isolation "deepspeed==0.12.6"

cd "$CG"
PYTHONPATH="$CG:$GC" "$VENV/bin/python" -c "
import torch, transformers
from llava.model import GarmentGPTFloat50ForCausalLM
from llava.garment_utils_v2 import run_garmentcode_parser_float50
print('chatgarment env ok: torch', torch.__version__, 'transformers', transformers.__version__)"
