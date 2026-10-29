#!/usr/bin/env bash
# Addition to run_check_short.sh in the same pod session (29.10.2026): the wide cuff (sleeve.end_width 1.0) helped
# the XS-M jacket and coat sleeves, so before changing the template it is checked on L-XL-XXL too (they were good
# with 0.75). Inputs on the Mac: patterns_job.py --job <demo/<item>_job.json with "design": {"sleeve.end_width": 1.0},
# sizes L-XXL> --out runs/sleeve_<item>_big. 6 drapes, ~5 min. Run after run_check_short.sh (Newton is installed).
set -uo pipefail
P="$(cd "$(dirname "$0")/.." && pwd)"
cd "$P"
export PYTHON=python DEVICE=cuda:0 PARALLEL=1
for ITEM in jacket coat; do
  T="$P/runs/sleeve_${ITEM}_big"
  python - "$T" <<'PY'
import json, sys
from pathlib import Path
t = Path(sys.argv[1])
json.dump([{"case": s["case"], "bodies": "mpfb", "body": f"product_{s['size']}"} for s in json.load(open(t / "result.json"))["sizes"]],
          open(t / "cases.json", "w"), indent=1)
PY
  INPUTS="$T" BOXES="$T/boxes" OUT="$T/newton" MU=0.2 bash pod/newton_test.sh
done
tar czf runs/cuff_big.tar.gz -C runs sleeve_jacket_big/newton sleeve_coat_big/newton
echo "== all done"
