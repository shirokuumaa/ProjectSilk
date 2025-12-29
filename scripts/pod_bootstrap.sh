#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/workspace/ProjectSilk}"
APP_DIR="${APP_DIR:-fastapi_app}"
UVICORN_APP="${UVICORN_APP:-app:app}"
PORT="${PORT:-8000}"

echo "== APT tools =="
sudo apt-get update -y
sudo apt-get install -y git curl build-essential python3-venv python3-dev ffmpeg tmux

echo "== Python venv =="
cd "$PROJECT_DIR"
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip wheel setuptools

echo "== Find requirements.txt =="
REQ=""
if [ -f "${APP_DIR}/requirements.txt" ]; then
  REQ="${APP_DIR}/requirements.txt"
elif [ -f "requirements.txt" ]; then
  REQ="requirements.txt"
fi

if [ "${REQ_PATH:-}" != "" ]; then
  REQ="$REQ_PATH"
fi

if [ -z "$REQ" ]; then
  echo "⚠️ requirements.txt not found."
  echo "Run again with: REQ_PATH=path/to/requirements.txt bash scripts/pod_bootstrap.sh"
else
  echo "Installing: $REQ"
  pip install -r "$REQ"
fi

echo "== Create /workspace/run_gpu_api.sh =="
cat > /workspace/run_gpu_api.sh <<RUN
#!/usr/bin/env bash
set -euo pipefail
cd "$PROJECT_DIR"
source .venv/bin/activate
cd "$PROJECT_DIR/$APP_DIR"
exec uvicorn "$UVICORN_APP" --host 0.0.0.0 --port "$PORT"
RUN
chmod +x /workspace/run_gpu_api.sh

echo "✅ Done."
echo "Start API: /workspace/run_gpu_api.sh"
echo "Health: curl -s http://127.0.0.1:${PORT}/healthz"
