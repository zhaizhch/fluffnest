#!/usr/bin/env bash
# Build the browser try-on demo into website/try (no API keys, no Tauri).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/website/try"
PETS_OUT="$ROOT/website/pets"

cd "$ROOT"

echo "→ vite build (demo → website/try)"
npx vite build --config vite.demo.config.ts

# demo.html is emitted at website/try/demo.html; expose as index for /try/
if [[ -f "$OUT/demo.html" ]]; then
  mv "$OUT/demo.html" "$OUT/index.html"
fi

echo "→ copy demo pet sprites to website/pets"
mkdir -p "$PETS_OUT"
for pack in kaka-5 rising-kaka; do
  rm -rf "$PETS_OUT/$pack"
  cp -R "$ROOT/public/pets/$pack" "$PETS_OUT/$pack"
done

# Remove previous try-on packs if present
for pack in butter-bear milk-tea-mouse kebo; do
  rm -rf "$PETS_OUT/$pack"
done

# Favicon for try page (optional)
if [[ -f "$ROOT/website/assets/social.png" ]]; then
  mkdir -p "$OUT/assets"
  cp "$ROOT/website/assets/social.png" "$OUT/assets/social.png" 2>/dev/null || true
fi

echo "✓ demo ready:"
echo "    open $OUT/index.html  (or https://virtualpet.beer/try/)"
echo "    embed: <iframe src=\"https://virtualpet.beer/try/?embed=1\" …>"
