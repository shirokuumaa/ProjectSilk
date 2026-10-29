#!/usr/bin/env bash
# Mac: everything the pod session needs in one tarball (paths relative to the repo root):
#   research/accessories/pod/            scripts
#   research/photos/accessories/         10 product photos with info.md (internal test only, not in git)
#   client/public/models/demo-garments/  dress_S.glb, dress_print.png, manifest.json
#   research/patterns/runs/arms/bodies/  zara_S.obj (the figure of dress size S)
# -> research/accessories/runs/accessories_inputs.tar.gz (~6 MB)
#
# Run from the repo root: bash research/accessories/pod/pack_inputs.sh
set -euo pipefail
cd "$(dirname "$0")/../../.."
mkdir -p research/accessories/runs
OUT=research/accessories/runs/accessories_inputs.tar.gz
COPYFILE_DISABLE=1 tar czf "$OUT" \
  research/accessories/pod \
  research/photos/accessories \
  client/public/models/demo-garments/dress_S.glb \
  client/public/models/demo-garments/dress_print.png \
  client/public/models/demo-garments/manifest.json \
  research/patterns/runs/arms/bodies/zara_S.obj
ls -la "$OUT"
tar tzf "$OUT" | grep -c . | xargs echo "files:"
