#!/usr/bin/env bash
# Second pass of session 1 (31.10.2026) on the same pod: the two model environments did not build.
#   - o-voxel needs Eigen from the TRELLIS.2 submodule (the repo was cloned without --recursive);
#   - SF3D requirements pulled torch 2.15 (cu132) into the venv over the image's torch 2.4, and its
#     uv_unwrapper / texture_baker were compiled against the other one (undefined torch symbol).
# Then the model runs, previews and the sheet again. Blender pictures (C, D) are already done.
# Run from /workspace/ProjectSilk: bash research/accessories/pod/fix_rerun.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
POD="$ROOT/research/accessories/pod"
PHOTOS="$ROOT/research/photos/accessories"
OUT="$ROOT/research/accessories/runs/session1"
W=/workspace
T2="$W/venv_t2/bin/python"
SF="$W/venv_sf3d/bin/python"
BL="$W/blender-5.0.1-linux-x64/blender"
START=$(date +%s)
exec > >(tee -a "$OUT/session.log") 2>&1
stamp() { echo "== $(date -u +%H:%M:%S) UTC, +$(( ($(date +%s) - START) / 60 )) min: $*"; }
CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader | head -1)
export TORCH_CUDA_ARCH_LIST="$CAP" MAX_JOBS=$(nproc) PATH="/usr/local/cuda/bin:$PATH" CUDA_HOME=/usr/local/cuda

stamp "fix: o-voxel with Eigen"
git -C "$W/TRELLIS.2" submodule update -q --init --recursive
rm -rf /tmp/extensions/o-voxel && cp -r "$W/TRELLIS.2/o-voxel" /tmp/extensions/o-voxel
uv pip install -q -p "$T2" --no-build-isolation /tmp/extensions/o-voxel || echo "!! o-voxel failed to build"
"$T2" -c "import torch, o_voxel, cumesh, flex_gemm, nvdiffrast.torch; print('trellis2 env ok', torch.__version__)"

stamp "fix: SF3D on torch 2.4.1 (cu124)"
uv pip install -q -p "$SF" torch==2.4.1 torchvision==0.19.1 --index-url https://download.pytorch.org/whl/cu124
(cd "$W/stable-fast-3d" && uv pip install -q -p "$SF" --no-build-isolation --reinstall --no-deps ./texture_baker/ ./uv_unwrapper/) \
  || echo "!! SF3D extensions failed"
"$SF" -c "import torch, uv_unwrapper, texture_baker; print('sf3d env ok', torch.__version__)"

stamp "TRELLIS.2 runs"
"$T2" "$POD/run_trellis2.py" --repo "$W/TRELLIS.2" --photos "$PHOTOS" --out "$OUT/trellis2"
stamp "SF3D runs"
"$SF" "$POD/run_sf3d.py" --repo "$W/stable-fast-3d" --photos "$PHOTOS" --out "$OUT/sf3d"
stamp "previews"
for d in trellis2 sf3d; do "$BL" -b --factory-startup --python "$POD/render_previews.py" -- --glbs "$OUT/$d" --out "$OUT/previews" 2>&1 | grep -E "preview|Error"; done
"$T2" "$POD/make_sheet.py" --session "$OUT" --out "$OUT/sheet.jpg"
stamp "second pass done in $(( ($(date +%s) - START) / 60 )) min"
tar czf "$ROOT/research/accessories/runs/session1.tar.gz" -C "$ROOT/research/accessories/runs" session1
ls -la "$ROOT/research/accessories/runs/session1.tar.gz"
