#!/usr/bin/env bash
# GPU session for the demo trousers (avatar step A): every size of the straight trousers drafted by the seller
# pipeline on the Mac, each on its own MPFB size body —
#   python scripts/garments/patterns_job.py --job research/patterns/demo/trousers_job.json \
#       --out research/patterns/runs/demo_trousers            (patterns, bodies and box meshes, ~10 min CPU)
# and, if prepared, dress 03 again with the fixed waist (size_fit.py --run waistfix --all-sizes 03_dress 04_skirt
# 09_tee, simtest_prep.py --run waistfix --all-sizes, pod/make_boxes.sh runs/waistfix): only its 6 dress cases.
#
# On the pod (RunPod RTX A5000 or A40, PyTorch 2.4 / CUDA 12.4 image, driver < 580), from research/patterns/:
#   bash pod/run_demo_trousers.sh        # ~5 min of simulation for the trousers, ~4 more for the dress
# Then copy runs/demo_trousers/newton_results.tar.gz (and runs/waistfix/newton_results.tar.gz) back to the Mac.
set -uo pipefail
P="$(cd "$(dirname "$0")/.." && pwd)"
cd "$P"
START=$(date +%s)
pip install -q newton==1.7.0 pyyaml
# the PyPI warp wheel needs a CUDA 13 driver (>= 580); with 570 it silently runs on the CPU
pip install -q --force-reinstall --no-deps \
  https://github.com/NVIDIA/warp/releases/download/v1.18.0/warp_lang-1.18.0+cu12-py3-none-manylinux_2_28_x86_64.whl
python -c "import warp as wp; wp.init(); assert wp.is_cuda_available(), 'Warp does not see the GPU'; print(wp.get_device())"
export PYTHON=python DEVICE=cuda:0 PARALLEL=1

# trousers: the cases from the job's result (bodies product_<size>); friction 0.5 like the skirts — the waistband
# holds the whole garment
T="$P/runs/demo_trousers"
python - "$T" <<'EOF'
import json, sys
from pathlib import Path
t = Path(sys.argv[1])
sizes = json.load(open(t / "result.json"))["sizes"]
json.dump([{"case": s["case"], "bodies": "mpfb", "body": f"product_{s['size']}"} for s in sizes],
          open(t / "cases.json", "w"), indent=1)
EOF
INPUTS="$T" BOXES="$T/boxes" OUT="$T/newton" MU=0.5 bash pod/newton_test.sh
tar czf "$T/newton_results.tar.gz" -C "$T" newton

# dress 03 with the fixed waist (optional)
W="$P/runs/waistfix"
if [ -f "$W/inputs/cases.json" ] && [ -d "$W/boxes" ]; then
  DRESS=$(python -c "import json; print(' '.join(c['case'] for c in json.load(open('$W/inputs/cases.json')) if 'dress' in c['case']))")
  INPUTS="$W/inputs" BOXES="$W/boxes" OUT="$W/newton" MU=0.2 ONLY="$DRESS" bash pod/newton_test.sh
  tar czf "$W/newton_results.tar.gz" -C "$W" newton
fi
echo "== all done in $(( ($(date +%s) - START) / 60 )) min"
