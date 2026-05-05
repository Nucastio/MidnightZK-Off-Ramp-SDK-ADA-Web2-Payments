#!/usr/bin/env bash
# Lucid pulls libsodium-wrappers-sumo which expects libsodium-sumo.mjs alongside wrappers (npm layout quirk).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${ROOT}/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs"
DST_DIR="${ROOT}/node_modules/libsodium-wrappers-sumo/dist/modules-sumo-esm"
if [[ -f "$SRC" && -d "$DST_DIR" ]]; then
  cp -f "$SRC" "$DST_DIR/libsodium-sumo.mjs"
  echo "libsodium-sumo.mjs copied for libsodium-wrappers-sumo ESM."
fi
