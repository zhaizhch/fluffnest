#!/usr/bin/env bash
# Build the Go AI sidecar for local Tauri / release bundling.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND="$ROOT/backend"
OUT_BIN="$ROOT/backend/bin"
OUT_TAURI="$ROOT/src-tauri/binaries"

mkdir -p "$OUT_BIN" "$OUT_TAURI"

GOOS="${GOOS:-darwin}"
GOARCH="${GOARCH:-$(go env GOARCH)}"

case "$GOARCH" in
  arm64|aarch64) TRIPLE_ARCH="aarch64" ;;
  amd64|x86_64) TRIPLE_ARCH="x86_64" ;;
  *) TRIPLE_ARCH="$GOARCH" ;;
esac

TRIPLE="${TRIPLE_ARCH}-apple-darwin"
NAME="fluffnest-ai"
TRIPLE_NAME="${NAME}-${TRIPLE}"

echo "building ${TRIPLE_NAME} (GOOS=${GOOS} GOARCH=${GOARCH})"

cd "$BACKEND"
CGO_ENABLED=0 GOOS="$GOOS" GOARCH="$GOARCH" go build -trimpath -ldflags="-s -w" \
  -o "$OUT_BIN/$NAME" ./cmd/fluffnest-ai

# Only replace dest when content differs. In-place overwrite of a running Mach-O
# can SIGKILL later execs on macOS; changing mtime also retriggers tauri:dev watch
# on src-tauri/binaries.
install_bin() {
  local src="$1"
  local dest="$2"
  if [[ -f "$dest" ]] && cmp -s "$src" "$dest"; then
    return 0
  fi
  rm -f "$dest"
  cp "$src" "$dest"
  chmod +x "$dest"
}

install_bin "$OUT_BIN/$NAME" "$OUT_BIN/$TRIPLE_NAME"
install_bin "$OUT_BIN/$NAME" "$OUT_TAURI/$NAME"
install_bin "$OUT_BIN/$NAME" "$OUT_TAURI/$TRIPLE_NAME"

DEBUG_DIR="$ROOT/src-tauri/target/debug"
if [[ -d "$DEBUG_DIR" ]]; then
  install_bin "$OUT_BIN/$NAME" "$DEBUG_DIR/$NAME"
  install_bin "$OUT_BIN/$NAME" "$DEBUG_DIR/$TRIPLE_NAME"
fi

echo "ok $OUT_TAURI/$TRIPLE_NAME"
