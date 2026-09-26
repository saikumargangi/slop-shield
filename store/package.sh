#!/bin/sh
# Build the Web Store upload: only the files the extension needs.
set -e
cd "$(dirname "$0")/.."
V=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
OUT="store/slop-shield-$V.zip"
rm -f "$OUT"
zip -q -X "$OUT" manifest.json detect.js common.js youtube.js styles.css popup.html popup.js icons/icon16.png icons/icon48.png icons/icon128.png
echo "$OUT"; unzip -Z1 "$OUT"
