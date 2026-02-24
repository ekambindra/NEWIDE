#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "[1/6] Core workspace validation: lint/test/build"
npm run lint
npm run test
npm run build

echo "[2/6] Benchmark simulation + score + gate + trends"
node packages/benchmark/dist/cli.js simulate --seed 1337 --out packages/benchmark/fixtures/latest-results.json
node packages/benchmark/dist/cli.js score \
  packages/benchmark/fixtures/latest-results.json \
  --out packages/benchmark/fixtures/latest-report.json \
  --history packages/benchmark/fixtures/metrics-history.jsonl \
  --run-id "local-$(date +%Y%m%d%H%M%S)"
node packages/benchmark/dist/cli.js gate packages/benchmark/fixtures/latest-report.json
node packages/benchmark/dist/cli.js trends packages/benchmark/fixtures/metrics-history.jsonl

if [ -d "$ROOT_DIR/atlas-build-lab/test-cases" ]; then
  echo "[3/6] Sample test-case product smoke checks"
  while IFS= read -r product; do
    if [ ! -f "$product/package.json" ]; then
      continue
    fi
    if [ ! -f "$product/services/api/test/server.test.ts" ] || [ ! -f "$product/services/worker/test/worker.test.ts" ]; then
      echo "missing generated starter tests in $product"
      exit 1
    fi
    echo "  -> validating $(basename "$product")"
    (
      cd "$product"
      npm install --silent
      npm run lint --silent
      npm run test --silent
      npm run build --silent
      rm -rf node_modules
    )
  done < <(find "$ROOT_DIR/atlas-build-lab/test-cases" -mindepth 1 -maxdepth 1 -type d | sort)
else
  echo "[3/6] Skipped sample test-case checks (atlas-build-lab/test-cases not found)"
fi

echo "[4/6] Template generator regression test"
npm run test --workspace @ide/desktop -- src/main/project-builder.test.ts

if [ -d "$ROOT_DIR/atlas-build-lab/games/atlas-number-duel" ]; then
  echo "[5/6] Game product checks"
  (
    cd "$ROOT_DIR/atlas-build-lab/games/atlas-number-duel"
    npm run test
    ATLAS_GAME_SECRET=12 ATLAS_GAME_GUESSES=9,13,12 npm run start
  )
else
  echo "[5/6] Skipped game checks (atlas-build-lab/games/atlas-number-duel not found)"
fi

echo "[6/6] Validation complete"
