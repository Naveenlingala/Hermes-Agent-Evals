#!/usr/bin/env sh
# One-command launcher for macOS / Linux. Needs only sh, curl (or wget) and tar.
# If Node >= 22.13 (with npm) is missing it installs a private, checksum-verified copy into ./.tools (no sudo, nothing global),
# then runs the app. Dependencies are installed and the app is built by `npm start` itself.
#
#   ./start.sh            start the demo (installs deps, builds, seeds demo data, serves http://127.0.0.1:3000)
#   ./start.sh real       also verify/install Hermes and collect API keys, then start   (npm run start:real)
#   ./start.sh dev        backend + Vite dev server
#   ./start.sh stop       stop this project's processes
# Windows: use WSL2.
set -eu
cd "$(dirname "$0")"

NODE_VERSION="${NODE_VERSION:-24.21.0}"
say() { printf '▸ %s\n' "$*"; }
die() { printf '✕ %s\n' "$*" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=13)?0:1)' 2>/dev/null
}

fetch() { # fetch URL DEST
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
  elif command -v wget >/dev/null 2>&1; then wget -q "$1" -O "$2"
  else die "Need curl or wget to download Node."; fi
}

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1
  else die "Need sha256sum or shasum to verify the Node download."; fi
}

install_node() {
  case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) die "Unsupported OS $(uname -s). On Windows use WSL2, or install Node >= 22.13 and run: npm start" ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) die "Unsupported CPU $(uname -m). Install Node >= 22.13 yourself and run: npm start" ;; esac
  name="node-v${NODE_VERSION}-${os}-${arch}"
  dir=".tools/$name"
  if [ ! -x "$dir/bin/node" ]; then
    say "Node >= 22.13 and npm not found. Installing a private copy of Node v${NODE_VERSION} into ./.tools (no sudo, not global)."
    mkdir -p .tools
    tmp="$(mktemp -d)"
    trap 'rm -rf "$tmp"' EXIT
    base="https://nodejs.org/dist/v${NODE_VERSION}"
    fetch "$base/$name.tar.gz" "$tmp/$name.tar.gz"
    fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt"
    want="$(grep " $name.tar.gz\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)"
    [ -n "$want" ] || die "No checksum published for $name.tar.gz."
    [ "$(sha256 "$tmp/$name.tar.gz")" = "$want" ] || die "Checksum mismatch for the Node download; refusing to use it."
    tar -xzf "$tmp/$name.tar.gz" -C .tools
    say "Node v${NODE_VERSION} installed and checksum-verified."
  fi
  PATH="$PWD/$dir/bin:$PATH"; export PATH
}

if node_ok; then say "Using Node $(node -v) / npm $(npm -v) from PATH."; else install_node; say "Using Node $(node -v) / npm $(npm -v) from ./.tools."; fi

mode="${1:-start}"; [ $# -gt 0 ] && shift
case "$mode" in
  start) exec npm start ;;
  real)  exec npm run start:real -- "$@" ;;
  dev)   exec npm run dev ;;
  stop)  exec npm stop ;;
  *)     die "Unknown command '$mode'. Use: start | real | dev | stop" ;;
esac
