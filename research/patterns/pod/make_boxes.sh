#!/usr/bin/env bash
# Box meshes (GarmentCode BoxMesh, CPU) for every case of a prepared run — on the Mac, one at a time,
# before the GPU session; Newton then only simulates (pod/newton_test.sh with BOXES=<run>/boxes).
#   bash pod/make_boxes.sh runs/allsizes      # needs <run>/inputs from simtest_prep.py --run <name>
set -uo pipefail
P="$(cd "$(dirname "$0")/.." && pwd)"
RUN="$(cd "${1:?run dir}" && pwd)"
PY="${PYTHON:-$P/.envs/gcsim/bin/python}"
I="$RUN/inputs"
mkdir -p "$RUN/boxes"
"$P/.envs/mac/bin/python" -c "import json,sys; [print(c['case'], c['body']) for c in json.load(open(sys.argv[1]))]" \
  "$I/cases.json" | while read -r case body; do
  "$PY" "$P/pod/box_case.py" --gc "$P/.envs/src/GarmentCode" --case-dir "$I/cases/$case" --case "$case" \
    --bodies "$I/bodies_mpfb" --body "$body" --config "$I/sim_config.yaml" --out "$RUN/boxes" 2>&1 | grep '^BOX' \
    || echo "FAILED $case"
done
