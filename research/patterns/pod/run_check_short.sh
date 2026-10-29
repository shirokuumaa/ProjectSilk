#!/usr/bin/env bash
# Short GPU check of two fixes (README «Диагностика: пояса и рукава XS–M», 29.10.2026), on the straight-arm bodies:
#   A. waists — skirt 04 (all 5) and trousers (all 6) with a 20 N/m waist attachment (was 0.5: the box's seams pull
#      the waistband 6 cm down in the first frame and the weak spring never brings it back) and 60 frames after the
#      release before the run may stop (was 5: "holds" was judged right after letting go);
#   B. long sleeves XS-M — jacket and coat with a cuff as wide as the sleeve (sleeve.end_width 1.0 instead of 0.75;
#      Mac: patterns_job.py --job demo/sleeve_test_<item>_job.json --out runs/sleeve_<item>);
#   C. why the XS-M sleeve leaves the arm — jacket M (bad) and L (good) as before, cloth saved every 10 frames,
#      and jacket M with the seams closing slower (cloth speed limit 0.3 m/s instead of 1).
# 20 drapes, ~15 min of simulation.
#
# On the pod (RunPod RTX A5000 or A40, PyTorch 2.4 / CUDA 12.4 image), from research/patterns/:
#   bash pod/run_check_short.sh
# Then copy runs/check_short.tar.gz back to the Mac (unpacks into runs/).
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

cases_from_result() {   # seller-pipeline runs: cases.json from result.json (bodies product_<size>)
  python - "$1" <<'EOF'
import json, sys
from pathlib import Path
t = Path(sys.argv[1])
sizes = json.load(open(t / "result.json"))["sizes"]
json.dump([{"case": s["case"], "bodies": "mpfb", "body": f"product_{s['size']}"} for s in sizes],
          open(t / "cases.json", "w"), indent=1)
EOF
}

# A. waists
R="$P/runs/arms"
SKIRTS=$(python -c "import json; print(' '.join(c['case'] for c in json.load(open('$R/inputs/cases.json')) if 'skirt' in c['case']))")
INPUTS="$R/inputs" BOXES="$R/boxes" OUT="$R/newton_fix" MU=0.5 ATTACH_KE=20 SETTLE=60 ONLY="$SKIRTS" bash pod/newton_test.sh
T="$P/runs/arms_trousers"
cases_from_result "$T"
INPUTS="$T" BOXES="$T/boxes" OUT="$T/newton_fix" MU=0.5 ATTACH_KE=20 SETTLE=60 bash pod/newton_test.sh

# B. sleeves XS-M with a wide cuff
for ITEM in jacket coat; do
  T="$P/runs/sleeve_$ITEM"
  cases_from_result "$T"
  INPUTS="$T" BOXES="$T/boxes" OUT="$T/newton" MU=0.2 bash pod/newton_test.sh
done

# C. jacket M and L as before, with snapshots; jacket M with slower seams
J="$P/runs/arms_jacket"
cases_from_result "$J"
INPUTS="$J" BOXES="$J/boxes" OUT="$J/newton_snap" MU=0.2 SNAPSHOTS=10 ONLY="size_M size_L" bash pod/newton_test.sh
INPUTS="$J" BOXES="$J/boxes" OUT="$J/newton_slow" MU=0.2 MAX_SPEED=0.3 SNAPSHOTS=10 ONLY="size_M" bash pod/newton_test.sh

tar czf runs/check_short.tar.gz -C runs arms/newton_fix arms_trousers/newton_fix sleeve_jacket/newton sleeve_coat/newton \
  arms_jacket/newton_snap arms_jacket/newton_slow
echo "== all done in $(( ($(date +%s) - START) / 60 )) min"
