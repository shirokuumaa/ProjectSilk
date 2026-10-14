#!/usr/bin/env bash
# Install AIpparel (code MIT) for inference only: pinned repo + Python 3.10 venv.
# Same script for the RunPod pod and the Dockerfile. Weights are NOT installed here
# (see pod/fetch_weights.py).
#
# Usage: install.sh <prefix>        -> <prefix>/AIpparel-Code, <prefix>/venv-aipparel
# Needs: uv, git. Runtime system libs: libcairo2 (CairoSVG renders pattern PNGs).
# Set TORCH_CPU=1 for a CPU-only check on a Mac (torch from PyPI instead of the CUDA index).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/../pod/versions.sh"

PREFIX="${1:?usage: install.sh <prefix>}"
SRC="$PREFIX/AIpparel-Code"
VENV="$PREFIX/venv-aipparel"
mkdir -p "$PREFIX"

if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$AIPPAREL_REPO"
fi
git -C "$SRC" fetch -q --depth 1 origin "$AIPPAREL_COMMIT"
git -C "$SRC" checkout -q FETCH_HEAD

# Upstream bug: in "text_image" mode the description is never read, so the prompt says "None".
DS="$SRC/data/datasets/inference_dataset.py"
sed -i.orig "s/if data_type in \['description', 'occasion'\]:/if data_type in ['description', 'occasion', 'text_image']:/" "$DS"
grep -q "'description', 'occasion', 'text_image'\]" "$DS" || { echo "text_image patch failed" >&2; exit 1; }

uv venv -q --allow-existing -p "$PYTHON_VERSION" "$VENV"
if [ "${TORCH_CPU:-0}" = 1 ]; then
  uv pip install -q -p "$VENV/bin/python" $AIPPAREL_TORCH
else
  uv pip install -q -p "$VENV/bin/python" --index-url "$TORCH_INDEX" $AIPPAREL_TORCH
fi
# Every later install is constrained to this torch build (otherwise uv may "upgrade" it).
printf '%s\n' $AIPPAREL_TORCH > "$PREFIX/aipparel-constraints.txt"
PIN=(-c "$PREFIX/aipparel-constraints.txt")

# Their requirements.txt minus training-only packages (flash_attn is only used by the MPT
# branch, deepspeed/wandb only by trainers/) and with headless OpenCV (no libGL in the image).
grep -viE '^(flash_attn|deepspeed|wandb)==' "$SRC/requirements.txt" \
  | sed -E 's/^opencv_python==/opencv-python-headless==/' > "$PREFIX/aipparel-requirements.txt"
# accelerate: needed by from_pretrained(low_cpu_mem_usage=True), contemporary with transformers 4.31;
# setuptools<70: torch cpp_extension still imports pkg_resources
printf "accelerate==0.21.0\nsetuptools<70\n" >> "$PREFIX/aipparel-requirements.txt"
uv pip install -q -p "$VENV/bin/python" "${PIN[@]}" -r "$PREFIX/aipparel-requirements.txt"

"$VENV/bin/python" -c "import torch, transformers, hydra, cairosvg; print('aipparel env ok: torch', torch.__version__, 'transformers', transformers.__version__)"
