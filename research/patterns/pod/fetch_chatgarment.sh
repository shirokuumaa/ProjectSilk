#!/usr/bin/env bash
# ChatGarment weights (15.0 GB, no license: evaluation only) from the authors' SharePoint link
# (docs/Installation.md). SharePoint sets a cookie on the first request and supports ranges,
# so the file is fetched with parallel connections by aria2c; curl is the fallback.
# Usage: fetch_chatgarment.sh <dest_dir>
set -euo pipefail
DEST="${1:?usage: fetch_chatgarment.sh <dest_dir>}"
URL='https://sjtueducn-my.sharepoint.com/:u:/g/personal/biansiyuan_sjtu_edu_cn/EQayoB8ie7ZIsFrjLWdBASQBFexZHXcGjrS6ghgGCjIMzw?e=o60Y65&download=1'
SIZE=14987210682
mkdir -p "$DEST"
cd "$DEST"

final=$(curl -s -L -c cookies.txt -r 0-0 -o /dev/null -w '%{url_effective}' "$URL")
echo "resolved: ${final%%\?*}"
if command -v aria2c >/dev/null; then
  aria2c -q -x 16 -s 16 -k 64M --file-allocation=none --load-cookies=cookies.txt \
    --summary-interval=0 -o pytorch_model.bin "$final" || true
fi
got=$(stat -c %s pytorch_model.bin 2>/dev/null || echo 0)
if [ "$got" != "$SIZE" ]; then
  echo "aria2c result $got bytes, falling back to curl"
  curl -s -L -b cookies.txt -C - -o pytorch_model.bin "$final"
fi
got=$(stat -c %s pytorch_model.bin)
[ "$got" = "$SIZE" ] || { echo "size mismatch: $got != $SIZE" >&2; exit 1; }
rm -f cookies.txt
echo "ok $got bytes"
