#!/usr/bin/env bash
# One GPU session for every demo product on the straight-arm avatar (60f05a29): every size of
#   dress 03, skirt 04, tee 09 — research items (Mac: mpfb_body.py --all --out runs/arms/bodies,
#       size_fit.py --run arms --all-sizes <item>, simtest_prep.py --run arms --all-sizes, pod/make_boxes.sh runs/arms)
#   trousers, jacket, coat — the seller pipeline (Mac: scripts/garments/patterns_job.py
#       --job research/patterns/demo/<item>_job.json --out research/patterns/runs/arms_<item>)
# each size on its own MPFB size body.
#
# On the pod (RunPod RTX A5000 or A40, PyTorch 2.4 / CUDA 12.4 image, driver < 580), from research/patterns/:
#   bash pod/run_demo_all.sh
# Then copy runs/arms/newton_results.tar.gz and runs/arms_*/newton_results.tar.gz back to the Mac.
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

# dress, skirt, tee: skirts with friction 0.5 (as GarmentCode; with 0.2 the L skirt slid 6 cm), the rest 0.2
R="$P/runs/arms"
SKIRTS=$(python -c "import json; print(' '.join(c['case'] for c in json.load(open('$R/inputs/cases.json')) if 'skirt' in c['case']))")
OTHERS=$(python -c "import json; print(' '.join(c['case'] for c in json.load(open('$R/inputs/cases.json')) if 'skirt' not in c['case']))")
INPUTS="$R/inputs" BOXES="$R/boxes" OUT="$R/newton" MU=0.2 ONLY="$OTHERS" bash pod/newton_test.sh
INPUTS="$R/inputs" BOXES="$R/boxes" OUT="$R/newton" MU=0.5 ONLY="$SKIRTS" bash pod/newton_test.sh
tar czf "$R/newton_results.tar.gz" -C "$R" newton

# trousers (0.5: the waistband holds them; waist attachment 20 N/m and 60 frames after the release — with 0.5 N/m
# the seams pulled the waistband 5 cm low, README «Короткий сеанс»), jacket and coat (0.2: they hang from the
# shoulders; inputs built with the wide-cuff template since 29.10, runs/cuff_<item> there); the cases from each
# job's result (bodies product_<size>)
for ITEM in trousers:0.5 jacket:0.2 coat:0.2; do
  T="$P/runs/arms_${ITEM%%:*}"
  if [ ! -f "$T/result.json" ]; then echo "skip $T: no result.json"; continue; fi
  python - "$T" <<'EOF'
import json, sys
from pathlib import Path
t = Path(sys.argv[1])
sizes = json.load(open(t / "result.json"))["sizes"]
json.dump([{"case": s["case"], "bodies": "mpfb", "body": f"product_{s['size']}"} for s in sizes],
          open(t / "cases.json", "w"), indent=1)
EOF
  K=""; S=""; [ "${ITEM%%:*}" = trousers ] && K=20 && S=60
  INPUTS="$T" BOXES="$T/boxes" OUT="$T/newton" MU="${ITEM##*:}" ATTACH_KE="$K" SETTLE="$S" bash pod/newton_test.sh
  tar czf "$T/newton_results.tar.gz" -C "$T" newton
done
echo "== all done in $(( ($(date +%s) - START) / 60 )) min"
