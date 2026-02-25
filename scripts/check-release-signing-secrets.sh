#!/usr/bin/env bash
set -euo pipefail

target="${1:-}"

if [ -z "$target" ]; then
  echo "usage: scripts/check-release-signing-secrets.sh <macos|windows>"
  exit 64
fi

required=()
case "$target" in
  macos)
    required=(
      "MACOS_CSC_LINK"
      "MACOS_CSC_KEY_PASSWORD"
      "APPLE_ID"
      "APPLE_APP_SPECIFIC_PASSWORD"
      "APPLE_TEAM_ID"
    )
    ;;
  windows)
    required=(
      "WINDOWS_CSC_LINK"
      "WINDOWS_CSC_KEY_PASSWORD"
    )
    ;;
  *)
    echo "unknown target: $target"
    echo "supported targets: macos, windows"
    exit 64
    ;;
esac

missing=()
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ]; then
    missing+=("$key")
  fi
done

if [ "${#missing[@]}" -gt 0 ]; then
  echo "release signing preflight failed for $target."
  echo "missing required secrets:"
  for key in "${missing[@]}"; do
    echo "- $key"
  done
  exit 1
fi

echo "release signing preflight passed for $target"
