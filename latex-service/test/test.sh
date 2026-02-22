#!/usr/bin/env bash
set -euo pipefail

SERVICE_URL="${LATEX_SERVICE_URL:-http://localhost:8417}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$SCRIPT_DIR/output"

mkdir -p "$OUT_DIR"

# Create zip from test files while preserving paths
echo "==> Zipping test files (preserving paths)..."
cd "$SCRIPT_DIR"
zip -r "$OUT_DIR/test.zip" main.tex example.jpg

# Send to service
echo "==> Sending to $SERVICE_URL/compile..."
HTTP_CODE=$(curl -s -o "$OUT_DIR/result.pdf" -w "%{http_code}" \
  -F "file=@$OUT_DIR/test.zip" \
  -F "entrypoint=main.tex" \
  "$SERVICE_URL/compile")

if [ "$HTTP_CODE" = "200" ]; then
  FILE_TYPE=$(file -b "$OUT_DIR/result.pdf")
  echo "==> OK (HTTP $HTTP_CODE): $FILE_TYPE"
  echo "    Output: $OUT_DIR/result.pdf"
else
  echo "==> FAILED (HTTP $HTTP_CODE)"
  cat "$OUT_DIR/result.pdf"  # will contain error JSON
  echo
  exit 1
fi
