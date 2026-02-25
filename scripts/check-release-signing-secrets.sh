#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"

if [ -z "$target" ]; then
  echo "usage: scripts/check-release-signing-secrets.sh <macos|windows>"
  exit 64
fi

missing=()

require_any() {
  local label="$1"
  shift
  local key=""
  for key in "$@"; do
    if [ -n "${!key:-}" ]; then
      return 0
    fi
  done
  missing+=("$label (any of: $*)")
}

case "$target" in
  macos)
    require_any "macOS cert link" MACOS_CSC_LINK CSC_LINK
    require_any "macOS cert password" MACOS_CSC_KEY_PASSWORD CSC_KEY_PASSWORD
    require_any "Apple ID" APPLE_ID
    require_any "Apple app-specific password" APPLE_APP_SPECIFIC_PASSWORD
    require_any "Apple team ID" APPLE_TEAM_ID
    ;;
  windows)
    require_any "Windows cert link" WINDOWS_CSC_LINK WIN_CSC_LINK CSC_LINK
    require_any "Windows cert password" WINDOWS_CSC_KEY_PASSWORD WIN_CSC_KEY_PASSWORD CSC_KEY_PASSWORD
    ;;
  *)
    echo "unknown target: $target"
    echo "supported targets: macos, windows"
    exit 64
    ;;
esac

if [ "${#missing[@]}" -gt 0 ]; then
  echo "release signing preflight failed for $target."
  echo "missing required secrets:"
  for key in "${missing[@]}"; do
    echo "- $key"
  done
  exit 1
fi

echo "release signing preflight passed for $target"
