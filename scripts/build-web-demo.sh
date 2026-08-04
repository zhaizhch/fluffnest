#!/usr/bin/env bash
# Build the browser try-on demo (暖卡卡 only, no API keys / no Tauri).
# - website/try + website/pets  → virtualpet.beer
# - docs/web-demo              → GitHub Pages + jsDelivr
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK="kaka-5"

cd "$ROOT"

build_one() {
  local target="$1"
  echo "→ vite build (demo target=${target})"
  DEMO_TARGET="$target" npx vite build --config vite.demo.config.ts
}

# ── virtualpet.beer ──────────────────────────────────────────
build_one site
SITE_OUT="$ROOT/website/try"
if [[ -f "$SITE_OUT/demo.html" ]]; then
  mv "$SITE_OUT/demo.html" "$SITE_OUT/index.html"
fi

PETS_OUT="$ROOT/website/pets"
mkdir -p "$PETS_OUT"
rm -rf "$PETS_OUT"/*
cp -R "$ROOT/public/pets/$PACK" "$PETS_OUT/$PACK"

if [[ -f "$ROOT/website/assets/social.png" ]]; then
  mkdir -p "$SITE_OUT/assets"
  cp "$ROOT/website/assets/social.png" "$SITE_OUT/assets/social.png" 2>/dev/null || true
fi

# ── GitHub portable demo (relative paths) ────────────────────
build_one pages
PAGES_OUT="$ROOT/docs/web-demo"
if [[ -f "$PAGES_OUT/demo.html" ]]; then
  mv "$PAGES_OUT/demo.html" "$PAGES_OUT/index.html"
fi
mkdir -p "$PAGES_OUT/pets"
rm -rf "$PAGES_OUT/pets"/*
cp -R "$ROOT/public/pets/$PACK" "$PAGES_OUT/pets/$PACK"
if [[ -f "$ROOT/website/assets/social.png" ]]; then
  mkdir -p "$PAGES_OUT/assets"
  cp "$ROOT/website/assets/social.png" "$PAGES_OUT/assets/social.png" 2>/dev/null || true
fi
# Prefer relative favicon for portable hosting.
if [[ -f "$PAGES_OUT/index.html" ]]; then
  sed -i.bak 's|href="/assets/social.png"|href="./assets/social.png"|g' "$PAGES_OUT/index.html"
  rm -f "$PAGES_OUT/index.html.bak"
fi

# Keep a copy for the Pages workflow artifact path used previously.
rm -rf "$ROOT/dist-pages"
cp -R "$PAGES_OUT" "$ROOT/dist-pages"

echo "✓ demo ready:"
echo "    site : $SITE_OUT  (+ $PETS_OUT/$PACK)"
echo "    pages: $PAGES_OUT"
echo "    gh   : https://zhaizhch.github.io/fluffnest/"
echo "    cdn  : https://cdn.jsdelivr.net/gh/zhaizhch/fluffnest@main/docs/web-demo/"
echo "    embed: <iframe src=\"https://virtualpet.beer/try/?embed=1\" …>"
