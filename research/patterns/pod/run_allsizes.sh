#!/usr/bin/env bash
# GPU session for the all-sizes drapes (3.5B): every chart size of dress 03, skirt 04 and tee 09 on its own
# MPFB size body. Inputs and box meshes are prepared on the Mac (mpfb_body.py --all, size_fit.py --run allsizes
# --all-sizes, simtest_prep.py --run allsizes --all-sizes, pod/make_boxes.sh runs/allsizes).
#
# On the pod (RunPod A40, PyTorch 2.4 / CUDA 12.4 image, driver < 580), from research/patterns/:
#   bash pod/run_allsizes.sh            # ~12-15 min of simulation, one garment at a time
# Then copy runs/allsizes/newton/ back to the Mac.
set -uo pipefail
P="$(cd "$(dirname "$0")/.." && pwd)"
cd "$P"
START=$(date +%s)
pip install -q newton==1.7.0 pyyaml
# the PyPI warp wheel needs a CUDA 13 driver (>= 580); with 570 it silently runs on the CPU
pip install -q --force-reinstall --no-deps \
  https://github.com/NVIDIA/warp/releases/download/v1.18.0/warp_lang-1.18.0+cu12-py3-none-manylinux_2_28_x86_64.whl
python -c "import warp as wp; wp.init(); assert wp.is_cuda_available(), 'Warp does not see the GPU'; print(wp.get_device())"

export PYTHON=python INPUTS="$P/runs/allsizes/inputs" BOXES="$P/runs/allsizes/boxes" DEVICE=cuda:0 PARALLEL=1
SKIRTS=$(python -c "import json; print(' '.join(c['case'] for c in json.load(open('$INPUTS/cases.json')) if 'skirt' in c['case']))")
OTHERS=$(python -c "import json; print(' '.join(c['case'] for c in json.load(open('$INPUTS/cases.json')) if 'skirt' not in c['case']))")
# skirts with friction 0.5 (as GarmentCode): with 0.2 the L skirt slid 6 cm in the first GPU test
OUT="$P/runs/allsizes/newton" MU=0.2 ONLY="$OTHERS" bash pod/newton_test.sh
OUT="$P/runs/allsizes/newton" MU=0.5 ONLY="$SKIRTS" bash pod/newton_test.sh
tar czf runs/allsizes/newton_results.tar.gz -C runs/allsizes newton
echo "== all done in $(( ($(date +%s) - START) / 60 )) min: runs/allsizes/newton_results.tar.gz"
