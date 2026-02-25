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
    apple_count=0
    if [ -n "${APPLE_ID:-}" ]; then
      apple_count=$((apple_count + 1))
    fi
    if [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ]; then
      apple_count=$((apple_count + 1))
    fi
    if [ -n "${APPLE_TEAM_ID:-}" ]; then
      apple_count=$((apple_count + 1))
    fi

    if [ "$apple_count" -gt 0 ] && [ "$apple_count" -lt 3 ]; then
      missing+=("Apple notarization credentials (provide APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID together)")
    fi

    if [ "$apple_count" -eq 0 ]; then
      echo "warning: Apple notarization credentials are unset; macOS release will be signed without notarization."
    fi
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
