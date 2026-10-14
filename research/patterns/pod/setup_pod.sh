#!/usr/bin/env bash
# One-shot setup of a fresh RunPod pod for the pattern prototype (no network volume).
# Everything that can overlap runs in parallel: weight downloads (~59 GB) start first,
# code + environments install meanwhile. Every step is timed into $W/timings.tsv.
#
# Usage (on the pod, after copying research/patterns there):
#   bash <patterns>/pod/setup_pod.sh            # W=/root/silk by default
# Then: bash <patterns>/pod/run_all.sh
# Test without GPU/weights (e.g. in a local Linux container): SKIP_DOWNLOADS=1 TORCH_CPU=1
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PATTERNS="$(cd "$HERE/.." && pwd)"
source "$HERE/versions.sh"

W="${SILK_DIR:-/root/silk}"
mkdir -p "$W/logs"
export HF_HOME="$W/hf" HF_XET_HIGH_PERFORMANCE=1 UV_CACHE_DIR="$W/uv-cache" UV_LINK_MODE=hardlink \
  UV_HTTP_TIMEOUT=120 UV_HTTP_RETRIES=5 PIP_DEFAULT_TIMEOUT=60 PIP_RETRIES=5
T="$W/timings.tsv"
[ -f "$T" ] || printf 'step\tstart\tend\tseconds\texit\n' > "$T"

step() {  # step <name> <command...>: run, log output to logs/<name>.log, record time
  local name=$1; shift
  local s; s=$(date +%s.%N)
  "$@" > "$W/logs/$name.log" 2>&1
  local rc=$?
  local e; e=$(date +%s.%N)
  printf '%s\t%s\t%s\t%s\t%s\n' "$name" "$(date -d @"${s%.*}" +%T)" "$(date -d @"${e%.*}" +%T)" \
    "$(awk "BEGIN{printf \"%.1f\", $e - $s}")" "$rc" >> "$T"
  echo "[$(date +%T)] $name: exit $rc ($(tail -n1 "$T" | cut -f4) s)"
  return $rc
}

sysinfo() {
  nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv || echo "no GPU"
  echo "cpus: $(nproc)"; free -g | head -2; df -h / "$W" | tail -n +1
  python3 --version; echo "PYTORCH_VERSION=${PYTORCH_VERSION:-} CUDA_VERSION=${CUDA_VERSION:-}"
}
tools() {  # uv + a tiny venv with huggingface_hub (Xet) for downloads
  { python3 -m pip install -q "uv==$UV_VERSION" ||
    python3 -m pip install -q --break-system-packages "uv==$UV_VERSION"; } &&
  uv venv -q --allow-existing -p "$PYTHON_VERSION" "$W/venv-tools" &&
  uv pip install -q -p "$W/venv-tools/bin/python" "huggingface_hub[hf_xet]==2.2.0"
}
apt_deps() {  # aria2: parallel SharePoint download; libcairo2: CairoSVG pattern renders
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq --no-install-recommends aria2 libcairo2
}
hf() { "$W/venv-tools/bin/python" "$HERE/fetch_weights.py" "$1" ${SKIP_DOWNLOADS:+--dry-run}; }
cg_weights() { [ -n "${SKIP_DOWNLOADS:-}" ] && { echo "skipped"; return 0; }; bash "$HERE/fetch_chatgarment.sh" "$1"; }

echo "== setup in $W, log $T"
step sysinfo sysinfo
step tools tools || exit 1

# Downloads first: they are the long pole.
step dl_aipparel hf aipparel &
step dl_llava hf llava &
step dl_clip224 hf clip224 &
step dl_clip336 hf clip336 &
step apt apt_deps || exit 1
step dl_chatgarment cg_weights "$W/weights/chatgarment" &

# Environments in parallel with the downloads (shared uv cache).
step install_aipparel bash "$PATTERNS/aipparel/install.sh" "$W" &
step install_chatgarment bash "$PATTERNS/chatgarment/install.sh" "$W" &

wait
echo "== done"
cat "$T"
du -sh "$HF_HOME" "$W/weights" 2>/dev/null
grep -h "MB/s" "$W"/logs/dl_*.log | sort -t$'\t' -k4 -n | tail -5 || true
