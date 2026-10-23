#!/usr/bin/env bash
# Install the harness CLIs the conformance run drives into ./.harnesses (never global, no sudo).
#
#   scripts/install-harnesses.sh                      pinned versions from pins/ (reproducible; default)
#   scripts/install-harnesses.sh --channel latest     newest published versions (nightly drift detection)
#   scripts/install-harnesses.sh --only claude,grok   subset (claude,opencode,grok,codex,pi)
#
# Official channels only:
#   claude, opencode, codex, pi  npm registry. Pinned mode uses `npm ci` against a committed lockfile, so every
#                                package (including the per-platform native binaries) is verified against its
#                                sha512 integrity. Install scripts are disabled, then re-enabled ONLY for the
#                                pinned packages that need their postinstall to place the native binary.
#   grok                         the same artifact URL the official installer (https://x.ai/cli/install.sh)
#                                downloads. x.ai publishes no checksum, so pins/harnesses.json carries a sha256
#                                per platform, recorded once from a manual download (trust on first use).
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DEST="$ROOT/.harnesses"
CHANNEL=pinned
ONLY=claude,opencode,grok,codex,pi

while [ $# -gt 0 ]; do
  case $1 in
    --channel) CHANNEL=$2; shift 2 ;;
    --only) ONLY=$2; shift 2 ;;
    --dest) DEST=$2; shift 2 ;;
    -h | --help) sed -n '2,19p' "$0"; exit 0 ;;
    *) echo "install-harnesses: unknown option $1" >&2; exit 64 ;;
  esac
done
case $CHANNEL in pinned | latest) ;; *) echo "install-harnesses: --channel must be pinned or latest" >&2; exit 64 ;; esac

want() { case ",$ONLY," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }
log() { printf 'install-harnesses: %s\n' "$*" >&2; }

case "$(uname -s)" in Darwin) OS=macos ;; Linux) OS=linux ;; *) log "unsupported OS $(uname -s)"; exit 1 ;; esac
case "$(uname -m)" in x86_64 | amd64) ARCH=x86_64 ;; arm64 | aarch64) ARCH=aarch64 ;; *) log "unsupported arch $(uname -m)"; exit 1 ;; esac

mkdir -p "$DEST/bin"
VERSIONS="$DEST/versions.json"
echo '{}' >"$VERSIONS"
record() { node -e 'const f=process.argv[1],j=JSON.parse(require("fs").readFileSync(f));j[process.argv[2]]=process.argv[3];require("fs").writeFileSync(f,JSON.stringify(j,null,2)+"\n")' "$VERSIONS" "$1" "$2"; }

npm_group() { # <dir-under-pins> <dest-subdir> <package...>
  local pins=$1 sub=$2
  shift 2
  local d="$DEST${sub:+/$sub}"
  mkdir -p "$d"
  if [ "$CHANNEL" = pinned ]; then
    cp "$ROOT/$pins/package.json" "$ROOT/$pins/package-lock.json" "$d/"
    (cd "$d" && npm ci --ignore-scripts --no-audit --no-fund >&2)
  else
    printf '{"name":"hc-latest","private":true}' >"$d/package.json"
    local specs=() p
    for p in "$@"; do specs+=("$p@latest"); done
    (cd "$d" && npm install --ignore-scripts --no-audit --no-fund --save-exact "${specs[@]}" >&2)
  fi
  # Postinstall places the platform-native binary; run it only for the packages we just verified.
  (cd "$d" && npm rebuild "$@" >&2)
  for p in "$@"; do
    record "$p" "$(node -p "require('$d/node_modules/$p/package.json').version")"
  done
}

if want claude || want opencode; then
  pk=()
  want claude && pk+=("@anthropic-ai/claude-code")
  want opencode && pk+=("@opencode/cli")
  if [ "$CHANNEL" = pinned ]; then
    # The lockfile covers both; installing a subset is not worth a second lockfile.
    npm_group pins "" "@anthropic-ai/claude-code" "@opencode/cli"
  else
    npm_group pins "" "${pk[@]}"
  fi
fi
if want codex || want pi; then
  npm_group pins/stretch stretch "@openai/codex" "@earendil-works/pi-coding-agent"
fi

if want grok; then
  if [ "$CHANNEL" = pinned ]; then
    GV=$(node -p "require('$ROOT/pins/harnesses.json').grok.version")
    EXPECT=$(node -p "require('$ROOT/pins/harnesses.json').grok.sha256['$OS-$ARCH'] || ''")
    [ -n "$EXPECT" ] || { log "no pinned sha256 for grok $OS-$ARCH"; exit 1; }
  else
    GV=$(curl -fsSL https://x.ai/cli/stable | head -n1 | tr -d '[:space:]')
    EXPECT=
  fi
  [[ $GV =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9._]+)?$ ]] || { log "bad grok version '$GV'"; exit 1; }
  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  curl -fsSL --proto '=https' -o "$tmp" "https://x.ai/cli/grok-${GV}-${OS}-${ARCH}"
  if command -v sha256sum >/dev/null 2>&1; then GOT=$(sha256sum "$tmp" | cut -d' ' -f1); else GOT=$(shasum -a 256 "$tmp" | cut -d' ' -f1); fi
  if [ -n "$EXPECT" ] && [ "$GOT" != "$EXPECT" ]; then
    log "grok $GV $OS-$ARCH checksum mismatch: expected $EXPECT, got $GOT"
    exit 1
  fi
  install -m 0755 "$tmp" "$DEST/bin/grok"
  record grok "$GV"
  record "grok-sha256-$OS-$ARCH" "$GOT"
fi

log "installed into $DEST ($CHANNEL):"
cat "$VERSIONS" >&2
