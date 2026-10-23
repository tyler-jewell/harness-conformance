#!/usr/bin/env bash
# Download the official actionlint release, verify its sha256 against the value pinned here, print the binary path.
#   scripts/install-actionlint.sh [dest-dir]      (default: ./.actionlint)
set -euo pipefail
VERSION=1.7.12
DEST=${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.actionlint"}
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) PLAT=darwin_arm64 SHA=aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f ;;
  Linux-x86_64) PLAT=linux_amd64 SHA=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8 ;;
  Linux-aarch64 | Linux-arm64) PLAT=linux_arm64 SHA=325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6 ;;
  *) echo "install-actionlint: no pinned checksum for $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac
mkdir -p "$DEST"
tgz="$DEST/actionlint.tgz"
curl -fsSL --proto '=https' -o "$tgz" "https://github.com/rhysd/actionlint/releases/download/v${VERSION}/actionlint_${VERSION}_${PLAT}.tar.gz"
if command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum "$tgz" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$tgz" | cut -d' ' -f1); fi
[ "$GOT" = "$SHA" ] || { echo "install-actionlint: checksum mismatch (got $GOT)" >&2; exit 1; }
tar -xzf "$tgz" -C "$DEST" actionlint
rm -f "$tgz"
echo "$DEST/actionlint"
