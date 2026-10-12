#!/usr/bin/env bash
# scripts/avatar/build.sh — пересборка болванки одной командой.
#
#   scripts/avatar/build.sh
#
# Нужны Blender 5.0 и расширение MPFB 2.0.18 с пакетом makehuman_system_assets.
# Путь к Blender можно задать переменной BLENDER.
#
# Результат:
#   client/public/models/base_avatar.glb     — болванка
#   client/src/data/avatarCalibration.json   — калибровка
#   scripts/avatar/out/                      — картинки и отчёт (в git не попадают)

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"

run() {
  "$BLENDER" -b --python-exit-code 1 --python "$@"
}

echo "== 1/4 build GLB"
run "$HERE/build_avatar.py"

echo "== 2/4 calibrate"
run "$HERE/calibrate.py"

echo "== 3/4 renders: every key at -1 and +1, stretched keys"
run "$HERE/render_check.py" -- keys
run "$HERE/render_check.py" -- stretch weight,waist,bust,hips 1,1.25,1.5,2
run "$HERE/render_check.py" -- stretch shoulder -1,-1.5,-2,-2.5

echo "== 4/4 renders: test figures"
run "$HERE/render_check.py" -- figures

echo "done: see $HERE/out/report.md"
