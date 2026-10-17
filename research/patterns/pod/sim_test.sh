#!/usr/bin/env bash
# GPU test of GarmentCode's own cloth simulator (pygarment + their Warp fork) on our MPFB size bodies.
# Stage B of the simulator test (README «Тест симулятора GarmentCode»). No network volume.
#
# On the pod (PyTorch 2.4 template = CUDA 12.4 *devel* image: nvcc for building the Warp fork):
#   copy research/patterns/pod/ and research/patterns/runs/simtest/inputs/ keeping the layout
#   (…/pod and …/runs/simtest/inputs), then:
#     bash pod/sim_test.sh             # W=/root/simtest; prints elapsed time and cost at the end
#   The pod is created and deleted by the user (no self-delete timer this time); the 2-hour limit is
#   kept by LIMIT_MIN below and by whoever runs it.
#   Result: $W/simtest_results.tar.gz (results/<case>/…, summary.tsv, timings.tsv, logs/).
#
# Env: SIMTEST_DIR (work dir), PRICE_PER_HOUR (default 0.40, A40 on-demand), LIMIT_MIN (default 100:
# no new case starts after that many minutes from the script start), FORCE=1 (go on even if the
# control case shows a broken simulator), CASES="09_tee_S …" (subset).
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PATTERNS="$(cd "$HERE/.." && pwd)"
INPUTS="${SIMTEST_INPUTS:-$PATTERNS/runs/simtest/inputs}"
source "$HERE/versions.sh"

W="${SIMTEST_DIR:-/root/simtest}"
PRICE="${PRICE_PER_HOUR:-0.40}"
LIMIT_MIN="${LIMIT_MIN:-100}"
START=$(date +%s)
mkdir -p "$W/logs" "$W/results"
export UV_CACHE_DIR="$W/uv-cache" UV_LINK_MODE=copy UV_HTTP_TIMEOUT=120 UV_HTTP_RETRIES=5 \
  GIT_LFS_SKIP_SMUDGE=1 DEBIAN_FRONTEND=noninteractive
T="$W/timings.tsv"
[ -f "$T" ] || printf 'step\tstart\tend\tseconds\texit\n' > "$T"
PY="$W/venv/bin/python"

elapsed_min() { awk "BEGIN{printf \"%.1f\", ($(date +%s) - $START) / 60}"; }
cost() { awk "BEGIN{printf \"%.2f\", ($(date +%s) - $START) / 3600 * $PRICE}"; }
report_time() { echo "== elapsed $(elapsed_min) min, ≈ \$$(cost) at \$$PRICE/h (this script only; add pod start-up and download)"; }
trap report_time EXIT

step() {  # step <name> <command...>: run, log to logs/<name>.log, record time
  local name=$1; shift
  local s; s=$(date +%s.%N)
  "$@" > "$W/logs/$name.log" 2>&1
  local rc=$?
  local e; e=$(date +%s.%N)
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$(date -d @"${s%.*}" +%T)" "$(date -d @"${e%.*}" +%T)" \
    "$(awk "BEGIN{printf \"%.1f\", $e - $s}")" "$rc" >> "$T"
  echo "[$(date +%T) | $(elapsed_min) min] $name: exit $rc ($(tail -n1 "$T" | cut -f4) s)"
  return $rc
}

sysinfo() {
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv || echo "no GPU"
  echo "cpus: $(nproc)"; free -g | head -2; df -h / "$W"
  nvcc --version | tail -2 || echo "no nvcc"; gcc --version | head -1; python3 --version
  echo "CUDA_HOME=${CUDA_HOME:-} PYTORCH_VERSION=${PYTORCH_VERSION:-}"
}
apt_deps() {  # libcairo2: CairoSVG (pygarment imports it); git for the clones
  apt-get update -qq && apt-get install -y -qq --no-install-recommends libcairo2 git
}
venv() {
  { python3 -m pip install -q "uv==$UV_VERSION" || python3 -m pip install -q --break-system-packages "uv==$UV_VERSION"; } &&
  uv venv -q --allow-existing -p "$PYTHON_VERSION" "$W/venv" &&
  uv pip install -q -p "$PY" -r "$HERE/gcsim_requirements.txt"
}
clone() {  # clone <repo> <commit> <dir>
  [ -d "$3/.git" ] || git clone -q "$1" "$3"
  git -C "$3" fetch -q --depth 1 origin "$2" 2>/dev/null || true
  git -C "$3" checkout -q "$2" && git -C "$3" log -1 --format='%H %ci'
}
build_warp() {  # their fork: native lib with CUDA (PTX only, --quick: no CUTLASS), then editable install
  local cuda="${CUDA_HOME:-/usr/local/cuda}"
  chmod +x "$W/warp/tools/packman/packman" "$W/warp/tools/packman/"*.sh 2>/dev/null
  (cd "$W/warp" && "$PY" build_lib.py --quick --no_verbose --cuda_path "$cuda") &&
  uv pip install -q -p "$PY" -e "$W/warp"
}
check_cuda() {
  "$PY" - <<'EOF'
import warp as wp
wp.init()
d = wp.get_device()
print("preferred device:", d, "| cuda devices:", wp.get_cuda_device_count())
assert d.is_cuda, "Warp fork built without CUDA"
EOF
}

echo "== simulator test in $W; inputs $INPUTS; limit $LIMIT_MIN min for starting cases"
[ -f "$INPUTS/cases.json" ] || { echo "no $INPUTS/cases.json — copy runs/simtest/inputs first"; exit 1; }
step sysinfo sysinfo
step apt apt_deps || exit 1
step venv venv &
step clone_gc clone "$GARMENTCODE_REPO" "$GARMENTCODE_COMMIT" "$W/GarmentCode" &
step clone_warp clone "$WARP_GC_REPO" "$WARP_GC_COMMIT" "$W/warp" &
wait
[ -x "$PY" ] && [ -d "$W/GarmentCode/pygarment" ] && [ -d "$W/warp/warp" ] || { echo "setup failed, see $W/logs"; exit 1; }
step build_warp build_warp || { tail -30 "$W/logs/build_warp.log"; exit 1; }
step check_cuda check_cuda || { cat "$W/logs/check_cuda.log"; exit 1; }

# cases: the GarmentCodeData control first (their body), then ours (MPFB bodies)
mapfile -t LINES < <("$PY" - "$INPUTS/cases.json" <<'EOF'
import json, sys
cases = json.load(open(sys.argv[1]))
cases.sort(key=lambda c: c["bodies"] != "gc")
for c in cases:
    print(c["case"], c["bodies"], c["body"])
EOF
)
printf 'case\tbody\tdevice\twall_s\tframes\ts_per_frame\tfails\tbody_coll\tself_coll\tmove_max_cm\tnan\tobj_mb\n' > "$W/summary.tsv"
for line in "${LINES[@]}"; do
  read -r case bodies body <<< "$line"
  if [ -n "${CASES:-}" ] && [[ " $CASES " != *" $case "* ]] && [ "$bodies" != gc ]; then continue; fi
  if [ "$(awk "BEGIN{print ($(date +%s) - $START) / 60 > $LIMIT_MIN}")" = 1 ]; then
    echo "== time limit ($LIMIT_MIN min) reached: $case and the rest skipped"; break
  fi
  bdir="$INPUTS/bodies_mpfb"; [ "$bodies" = gc ] && bdir="$W/GarmentCode/assets/bodies"
  step "sim_$case" timeout 1500 "$PY" "$HERE/gc_sim_case.py" --gc "$W/GarmentCode" \
    --case-dir "$INPUTS/cases/$case" --case "$case" --bodies "$bdir" --body "$body" \
    --config "$INPUTS/sim_config.yaml" --out "$W/results"
  r="$W/results/$case/case_result.json"
  if [ -f "$r" ]; then
    "$PY" - "$r" >> "$W/summary.tsv" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
print("\t".join(str(r.get(k)) for k in ("case", "body", "device", "sim_wall_s", "frames", "s_per_frame",
      "fails", "body_collisions", "self_collisions", "move_max_cm", "nan_vertices", "sim_obj_mb")))
EOF
    tail -n1 "$W/summary.tsv"
  else
    printf '%s\t%s\tFAILED (see logs/sim_%s.log)\n' "$case" "$body" "$case" >> "$W/summary.tsv"
  fi
  if [ "$bodies" = gc ] && [ -z "${FORCE:-}" ]; then   # control: the simulator must move the cloth
    ok=$("$PY" -c "import json,sys; r=json.load(open(sys.argv[1])); print(int((r.get('move_max_cm') or 0) > 5 and not r.get('nan_vertices')))" "$r" 2>/dev/null || echo 0)
    [ "$ok" = 1 ] || { echo "== control case did not simulate (cloth did not move / NaN): stopping. FORCE=1 to go on."; break; }
  fi
done

echo "== summary"; column -t -s $'\t' "$W/summary.tsv" 2>/dev/null || cat "$W/summary.tsv"
cp "$T" "$W/summary.tsv" "$W/results/"; cp -r "$W/logs" "$W/results/"
tar -czf "$W/simtest_results.tar.gz" -C "$W" results
ls -la "$W/simtest_results.tar.gz"
