#!/usr/bin/env bash
# Third pass of session 1 (31.10.2026): TRELLIS.2 only (BiRefNet weights are fp16 — now cast to float),
# after fix_rerun.sh has finished; then its previews, the sheet and the tarball.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
POD="$ROOT/research/accessories/pod"
OUT="$ROOT/research/accessories/runs/session1"
W=/workspace
while pgrep -f fix_rerun.sh >/dev/null; do sleep 10; done
exec > >(tee -a "$OUT/session.log") 2>&1
echo "== $(date -u +%H:%M:%S) UTC: TRELLIS.2 runs (third pass)"
"$W/venv_t2/bin/python" "$POD/run_trellis2.py" --repo "$W/TRELLIS.2" --photos "$ROOT/research/photos/accessories" --out "$OUT/trellis2"
"$W/blender-5.0.1-linux-x64/blender" -b --factory-startup --python "$POD/render_previews.py" -- --glbs "$OUT/trellis2" --out "$OUT/previews" 2>&1 | grep -E "preview|Error"
"$W/venv_t2/bin/python" "$POD/make_sheet.py" --session "$OUT" --out "$OUT/sheet.jpg"
tar czf "$ROOT/research/accessories/runs/session1.tar.gz" -C "$ROOT/research/accessories/runs" session1
echo "== $(date -u +%H:%M:%S) UTC: third pass done"
