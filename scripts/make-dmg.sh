#!/usr/bin/env bash
# Create a DMG from the built FluffNest.app
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${APP_PATH:-$ROOT/src-tauri/target/release/bundle/macos/FluffNest.app}"
OUT_DIR="${OUT_DIR:-$ROOT/src-tauri/target/release/bundle/dmg}"
VERSION="${VERSION:-$(node -p "require('$ROOT/package.json').version")}"

detect_arch() {
  case "$(uname -m)" in
    arm64) echo "aarch64" ;;
    x86_64) echo "x86_64" ;;
    *) echo "unknown" ;;
  esac
}

# Allow override: ARCH_LABEL=universal ./scripts/make-dmg.sh
ARCH_LABEL="${ARCH_LABEL:-$(detect_arch)}"
DMG="$OUT_DIR/FluffNest_${VERSION}_${ARCH_LABEL}.dmg"
STAGE="$(mktemp -d)/FluffNest"

if [[ ! -d "$APP" ]]; then
  echo "App not found: $APP"
  echo "Run: npm run tauri:build"
  exit 1
fi

mkdir -p "$OUT_DIR" "$STAGE"
cp -R "$APP" "$STAGE/"
ln -sf /Applications "$STAGE/Applications"

rm -f "$DMG"
hdiutil create \
  -volname "FluffNest 绒窝" \
  -srcfolder "$STAGE" \
  -ov -format UDZO \
  "$DMG"

rm -rf "$(dirname "$STAGE")"
echo "Created: $DMG"
