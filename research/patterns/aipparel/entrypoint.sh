#!/usr/bin/env bash
# Container entrypoint: fetch weights into /cache if missing, then run inference.
# Arguments are passed to run_aipparel.py (e.g. --manifest /data/manifest.json --out /data/out).
set -euo pipefail
PY=/opt/aipparel/venv-aipparel/bin/python
TOOLS=/opt/venv-tools/bin/python
D=/opt/patterns/aipparel
for s in aipparel llava clip224; do
  "$TOOLS" "$D/fetch_weights.py" "$s"
done
CKPT=$("$TOOLS" -c "from huggingface_hub import hf_hub_download as d; print(d('georgeNakayama/AIpparel','aipparel_pretrained.pth',local_files_only=True))")
exec "$PY" "$D/run_aipparel.py" --src /opt/aipparel/AIpparel-Code --ckpt "$CKPT" "$@"
