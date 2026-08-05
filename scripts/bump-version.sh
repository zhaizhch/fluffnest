#!/usr/bin/env bash
# Sync version across package.json / tauri.conf.json / Cargo.toml
# Usage: ./scripts/bump-version.sh 0.1.1
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NEW="${1:-}"

if [[ -z "$NEW" ]]; then
  echo "Usage: $0 <version>   e.g. $0 0.1.1"
  exit 1
fi

if ! [[ "$NEW" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must look like 0.1.0"
  exit 1
fi

cd "$ROOT"

# package.json
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('package.json','utf8'));
p.version='$NEW';
fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');
"

# tauri.conf.json
node -e "
const fs=require('fs');
const p=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
p.version='$NEW';
fs.writeFileSync('src-tauri/tauri.conf.json', JSON.stringify(p,null,2)+'\n');
"

# Cargo.toml
perl -i -pe "s/^version = \".*\"/version = \"$NEW\"/ if \$. < 10" src-tauri/Cargo.toml

# Cargo.lock root package only (do not use perl $1 via shell interpolation)
python3 - "$NEW" <<'PY'
import pathlib, re, sys
new = sys.argv[1]
path = pathlib.Path("src-tauri/Cargo.lock")
text = path.read_text()
pat = re.compile(r'(name = "fluffnest"\nversion = ")[^"]+(")')
updated, n = pat.subn(rf"\g<1>{new}\2", text, count=1)
if n != 1:
    raise SystemExit(f"expected 1 fluffnest version in Cargo.lock, got {n}")
path.write_text(updated)
print(f"Cargo.lock fluffnest -> {new}")
PY

echo "Version bumped to $NEW"
echo "Next:"
echo "  git add -A && git commit -m \"chore: release v$NEW\""
echo "  git tag v$NEW"
echo "  git push origin main --tags"
