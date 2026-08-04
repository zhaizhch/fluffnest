#!/usr/bin/env bash
# Build GitHub Release artifacts: .app → DMG + ZIP + SHA256SUMS
#
# Usage:
#   ./scripts/package-release.sh              # current machine arch
#   ./scripts/package-release.sh aarch64
#   ./scripts/package-release.sh x86_64
#   ./scripts/package-release.sh universal
#
# Output: release/v{VERSION}/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
MODE="${1:-auto}"

case "$MODE" in
  auto)
    case "$(uname -m)" in
      arm64) ARCH_LABEL=aarch64; TAURI_TARGET="" ;;
      x86_64) ARCH_LABEL=x86_64; TAURI_TARGET="" ;;
      *) echo "Unsupported arch"; exit 1 ;;
    esac
    ;;
  aarch64)
    ARCH_LABEL=aarch64
    TAURI_TARGET="aarch64-apple-darwin"
    ;;
  x86_64)
    ARCH_LABEL=x86_64
    TAURI_TARGET="x86_64-apple-darwin"
    ;;
  universal)
    ARCH_LABEL=universal
    TAURI_TARGET="universal-apple-darwin"
    ;;
  *)
    echo "Usage: $0 [auto|aarch64|x86_64|universal]"
    exit 1
    ;;
esac

OUT="$ROOT/release/v${VERSION}"
mkdir -p "$OUT"

echo "==> FluffNest v${VERSION} (${ARCH_LABEL})"

# Build Go AI sidecar for the release architecture before Tauri bundles it.
case "$ARCH_LABEL" in
  aarch64) GOARCH=arm64 bash "$ROOT/scripts/build-go-sidecar.sh" ;;
  x86_64) GOARCH=amd64 bash "$ROOT/scripts/build-go-sidecar.sh" ;;
  universal)
    GOARCH=arm64 bash "$ROOT/scripts/build-go-sidecar.sh"
    GOARCH=amd64 bash "$ROOT/scripts/build-go-sidecar.sh"
    ;;
esac

if [[ -n "$TAURI_TARGET" ]]; then
  rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
  npm run tauri build -- --bundles app --target "$TAURI_TARGET"
else
  npm run tauri build -- --bundles app
fi

# Host-arch builds land in target/release; cross / universal use target/<triple>/release
APP=""
for candidate in \
  "$ROOT/src-tauri/target/release/bundle/macos/FluffNest.app" \
  "$ROOT/src-tauri/target/${TAURI_TARGET:-}/release/bundle/macos/FluffNest.app" \
  "$ROOT/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/FluffNest.app" \
  "$ROOT/src-tauri/target/x86_64-apple-darwin/release/bundle/macos/FluffNest.app" \
  "$ROOT/src-tauri/target/universal-apple-darwin/release/bundle/macos/FluffNest.app"
do
  if [[ -n "$candidate" && -d "$candidate" ]]; then
    APP="$candidate"
    break
  fi
done

if [[ -z "$APP" || ! -d "$APP" ]]; then
  echo "Build failed: FluffNest.app not found under src-tauri/target/"
  find "$ROOT/src-tauri/target" -name 'FluffNest.app' -type d 2>/dev/null || true
  exit 1
fi

echo "==> Using app: $APP"
DMG_NAME="FluffNest_${VERSION}_${ARCH_LABEL}.dmg"
ZIP_NAME="FluffNest_${VERSION}_${ARCH_LABEL}.zip"

export APP_PATH="$APP"
export OUT_DIR="$OUT"
export VERSION
export ARCH_LABEL
bash "$ROOT/scripts/make-dmg.sh"
# make-dmg writes into OUT_DIR

echo "==> Creating ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP" "$OUT/$ZIP_NAME"

echo "==> Checksums"
(
  cd "$OUT"
  shasum -a 256 "$DMG_NAME" "$ZIP_NAME" | tee "SHA256SUMS_${ARCH_LABEL}.txt"
)

# Human-readable install blurb for Release notes
cat > "$OUT/INSTALL_${ARCH_LABEL}.txt" <<EOF
绒窝 FluffNest v${VERSION} (${ARCH_LABEL})

推荐：下载 ${DMG_NAME}
1. 打开 DMG，将 FluffNest 拖到「应用程序」
2. 若提示无法打开：右键 App → 打开；或执行：
   xattr -cr /Applications/FluffNest.app
3. 从启动台 / 应用程序打开「绒窝」

备选：${ZIP_NAME}（解压后得到 FluffNest.app，同样拖到应用程序）

校验：
  shasum -a 256 -c SHA256SUMS_${ARCH_LABEL}.txt
EOF

echo ""
echo "Artifacts ready in: $OUT"
ls -lah "$OUT"
