#!/usr/bin/env bash
# Builds the server for the platforms an app build needs and lays it out where electron-builder picks it up
# (package.json build.extraResources: bundled-server/<os>-<arch> -> <resources>/server). The app copies it out
# on first run, so an app always starts with the server it was built with.
# Usage: scripts/bundle-server.sh <server-checkout> <version> <os-arch>...   (linux-x64 mac-arm64 mac-x64 win-x64 ...)
set -euo pipefail
src=$1 ver=$2
shift 2
root=$(pwd)
for t in "$@"; do
  os=${t%-*} arch=${t#*-}
  goos=$os; [ "$os" = mac ] && goos=darwin; [ "$os" = win ] && goos=windows
  goarch=$arch; [ "$arch" = x64 ] && goarch=amd64
  ext=; [ "$os" = win ] && ext=.exe
  mkdir -p "$root/bundled-server/$t"
  (cd "$src" && CGO_ENABLED=0 GOOS=$goos GOARCH=$goarch go build -trimpath -ldflags "-s -w -X main.version=$ver" \
    -o "$root/bundled-server/$t/yoakeland$ext" ./cmd/yoakeland)
  echo "$ver" > "$root/bundled-server/$t/version"
done
