#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# 1) подготавливаем датасет (клац-клики в обучающие примеры)
python3 assistant/train_lgbm.py

# 2) после обучения кладём модель в data/lgbm_model.txt
# 3) мягкий рестарт API (если у тебя pm2/systemd — замени на свой способ)
if command -v pkill >/dev/null 2>&1; then
  pkill -HUP -f "uvicorn app:app" || true
fi

echo "[cron_retrain] done at $(date)"