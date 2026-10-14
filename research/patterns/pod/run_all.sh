#!/usr/bin/env bash
# Run AIpparel (main) and ChatGarment (comparison) on all inputs, side by side on one 48 GB GPU
# (~15 GB each in bf16). Results: $W/runs/{aipparel,chatgarment}, packed into $W/results.tar.gz.
# Usage: bash <patterns>/pod/run_all.sh [aipparel|chatgarment|both]
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PATTERNS="$(cd "$HERE/.." && pwd)"
W="${SILK_DIR:-/root/silk}"
WHICH="${1:-both}"
export HF_HOME="$W/hf" HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1
T="$W/timings.tsv"
MANIFEST="$PATTERNS/runs/inputs/manifest.json"
mkdir -p "$W/runs" "$W/logs"

timed() {  # timed <name> <command...> — same format as setup_pod.sh
  local name=$1; shift
  local s; s=$(date +%s.%N)
  "$@" > "$W/logs/$name.log" 2>&1
  local rc=$?
  local e; e=$(date +%s.%N)
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$(date -d @"${s%.*}" +%T)" "$(date -d @"${e%.*}" +%T)" \
    "$(awk "BEGIN{printf \"%.1f\", $e - $s}")" "$rc" >> "$T"
  echo "[$(date +%T)] $name: exit $rc"
}

AIPPAREL_CKPT=$("$W/venv-tools/bin/python" -c \
  "from huggingface_hub import hf_hub_download as d; print(d('georgeNakayama/AIpparel','aipparel_pretrained.pth',local_files_only=True))")

nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader -l 15 > "$W/logs/gpu_usage.log" &
GPU_MON=$!
RUNS=()

if [ "$WHICH" != chatgarment ]; then
  rm -f "$W/runs/aipparel/load.json"
  timed run_aipparel "$W/venv-aipparel/bin/python" "$PATTERNS/aipparel/run_aipparel.py" \
    --src "$W/AIpparel-Code" --ckpt "$AIPPAREL_CKPT" --manifest "$MANIFEST" --out "$W/runs/aipparel" &
  RUNS+=($!)
fi
if [ "$WHICH" != aipparel ]; then
  # Start after AIpparel sits on the GPU so the two CPU-RAM load peaks (~15 GB each) don't overlap
  # on a 50 GB pod. AIpparel writes load.json once its weights are loaded; give up waiting after 10 min.
  if [ "$WHICH" = both ]; then
    for _ in $(seq 120); do [ -f "$W/runs/aipparel/load.json" ] && break; sleep 5; done
  fi
  timed run_chatgarment "$W/venv-chatgarment/bin/python" "$PATTERNS/chatgarment/run_chatgarment.py" \
    --cg "$W/ChatGarment" --gc "$W/GarmentCodeRC" --manifest "$MANIFEST" --out "$W/runs/chatgarment" &
  RUNS+=($!)
fi
wait "${RUNS[@]}"
kill $GPU_MON 2>/dev/null

cp "$T" "$W/runs/timings.tsv"; cp -r "$W/logs" "$W/runs/logs"
tar -czf "$W/results.tar.gz" -C "$W" runs
echo "packed: $(du -h "$W/results.tar.gz" | cut -f1)  ->  scp from the Mac"
grep -c '"ok": true' "$W/runs/aipparel/timings.json" "$W/runs/chatgarment/timings.json" 2>/dev/null
