#!/usr/bin/env bash
# Newton (Apache-2.0) cloth test on the same 7 cases as GarmentCode's simulator test (pod/sim_test.sh).
# Input: the GarmentCode box meshes of the cases (pygarment BoxMesh — written by the GarmentCode test run into
# runs/simtest/results/<case>/, or by gc_sim_case.py on the Mac, where BoxMesh works on the CPU) and the bodies
# (runs/simtest/inputs). Each case: pod/newton_case.py, one process each, in parallel.
#
# Mac (CPU):  bash pod/newton_test.sh               # PARALLEL=7, DEVICE=cpu
# GPU pod:    DEVICE=cuda:0 PARALLEL=1 bash pod/newton_test.sh   (pip install newton==1.7.0 pyyaml first)
# Output: runs/newtontest/results/<case>/ + logs/, summary.tsv; then on the Mac:
#   python simtest_report.py --results runs/newtontest/results --out runs/newtontest --price 0 \
#       --title "Newton (SolverStyle3D) на CPU Mac" --compare runs/simtest/results
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
P="$(cd "$HERE/.." && pwd)"
PY="${PYTHON:-$P/.envs/newton/bin/python}"
BOXES="${BOXES:-$P/runs/simtest/results}"
INPUTS="${INPUTS:-$P/runs/simtest/inputs}"
GC_BODIES="${GC_BODIES:-$P/.envs/src/GarmentCode/assets/bodies}"
OUT="${OUT:-$P/runs/newtontest}"
DEVICE="${DEVICE:-cpu}"
PARALLEL="${PARALLEL:-7}"
MAX_FRAMES="${MAX_FRAMES:-2400}"
MU="${MU:-0.2}"          # cloth-body friction; GarmentCode's config uses 0.5
ONLY="${ONLY:-}"         # e.g. ONLY="04_skirt_S 04_skirt_L" to run a subset
mkdir -p "$OUT/logs" "$OUT/results"
START=$(date +%s)

"$PY" - "$INPUTS/cases.json" > "$OUT/cases.txt" <<'EOF'
import json, sys
for c in sorted(json.load(open(sys.argv[1])), key=lambda c: c["bodies"] != "gc"):   # the big control first
    print(c["case"], c["bodies"], c["body"])
EOF

run_case() {
  local case=$1 bodies=$2 body=$3 bdir
  bdir="$INPUTS/bodies_mpfb"; [ "$bodies" = gc ] && bdir="$GC_BODIES"
  local s; s=$(date +%s)
  "$PY" "$HERE/newton_case.py" --box-dir "$BOXES/$case" --case "$case" --body-obj "$bdir/$body.obj" \
    --body-yaml "$bdir/$body.yaml" --out "$OUT/results" --max-frames "$MAX_FRAMES" --device "$DEVICE" --mu "$MU" \
    > "$OUT/logs/$case.log" 2>&1
  echo "[$(date +%T)] $case: exit $? ($(( $(date +%s) - s )) s)"
}
export -f run_case
export HERE INPUTS GC_BODIES BOXES OUT PY MAX_FRAMES DEVICE MU
if [ -n "$ONLY" ]; then grep -E "^($(echo $ONLY | tr ' ' '|')) " "$OUT/cases.txt" > "$OUT/cases_run.txt"; else cp "$OUT/cases.txt" "$OUT/cases_run.txt"; fi
xargs -P "$PARALLEL" -L 1 bash -c 'run_case "$0" "$1" "$2"' < "$OUT/cases_run.txt"

printf 'case\tdevice\twall_s\tframes\ts_per_frame\tfails\tmove_max_cm\tnan\tobj_mb\n' > "$OUT/summary.tsv"
for r in "$OUT"/results/*/case_result.json; do
  "$PY" - "$r" >> "$OUT/summary.tsv" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
print("\t".join(str(r.get(k)) for k in ("case", "device", "sim_wall_s", "frames", "s_per_frame", "fails",
                                         "move_max_cm", "nan_vertices", "sim_obj_mb")))
EOF
done
column -t -s $'\t' "$OUT/summary.tsv" 2>/dev/null || cat "$OUT/summary.tsv"
echo "== elapsed $(( ($(date +%s) - START) / 60 )) min"
