#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

REPORT_DIR="$ROOT_DIR/atlas-build-lab/reports"
STRESS_DIR="$ROOT_DIR/atlas-build-lab/stress-cases"
CHECKPOINT_ROOT="$ROOT_DIR/.atlas-checkpoints"
mkdir -p "$REPORT_DIR" "$STRESS_DIR" "$CHECKPOINT_ROOT"

run_id="heavy-$(date +%Y%m%d%H%M%S)"
report_path="$REPORT_DIR/${run_id}.json"

echo "[heavy:1/5] Running full validation harness"
"$ROOT_DIR/scripts/full-validation.sh"

echo "[heavy:2/5] Benchmark determinism stress (simulate x5 with same seed)"
tmp_dir="$(mktemp -d)"
hashes=()
for i in 1 2 3 4 5; do
  out="$tmp_dir/results-$i.json"
  node "$ROOT_DIR/packages/benchmark/dist/cli.js" simulate --seed 1337 --out "$out" >/dev/null
  hash="$(node --input-type=module -e "import { readFileSync } from 'node:fs'; import { createHash } from 'node:crypto'; const buf = readFileSync(process.argv[1]); process.stdout.write(createHash('sha256').update(buf).digest('hex'));" "$out")"
  hashes+=("$hash")
done
expected_hash="${hashes[0]}"
for hash in "${hashes[@]}"; do
  if [ "$hash" != "$expected_hash" ]; then
    echo "determinism failure: mismatched simulate hash"
    rm -rf "$tmp_dir"
    exit 1
  fi
done

echo "[heavy:3/5] Benchmark score+gate soak (score x5)"
for i in 1 2 3 4 5; do
  score_out="$tmp_dir/report-$i.json"
  node "$ROOT_DIR/packages/benchmark/dist/cli.js" score \
    "$tmp_dir/results-$i.json" \
    --out "$score_out" \
    --history "$ROOT_DIR/packages/benchmark/fixtures/metrics-history.jsonl" \
    --run-id "${run_id}-score-$i" >/dev/null
  node "$ROOT_DIR/packages/benchmark/dist/cli.js" gate "$score_out" >/dev/null
done

echo "[heavy:4/5] Project builder stress (generate + validate 6 projects)"
rm -rf "$STRESS_DIR"
mkdir -p "$STRESS_DIR"
node --input-type=module <<'EOF'
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { buildProjectTemplate } from "/Users/ekambindra/NEWIDE/apps/desktop/dist/main/project-builder.js";

const workspaceRoot = "/Users/ekambindra/NEWIDE";
const checkpointRoot = join(workspaceRoot, ".atlas-checkpoints");
await mkdir(checkpointRoot, { recursive: true });

const names = [
  "Atlas Stress Alpha",
  "Atlas Stress Beta",
  "Atlas Stress Gamma",
  "Atlas Stress Delta",
  "Atlas Stress Epsilon",
  "Atlas Stress Zeta"
];

for (const name of names) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  await buildProjectTemplate({
    request: {
      workspaceRoot,
      projectName: name,
      outputDir: `atlas-build-lab/stress-cases/${slug}`
    },
    checkpointRoot
  });
}
EOF

stress_total=0
while IFS= read -r product; do
  if [ ! -f "$product/package.json" ]; then
    continue
  fi
  stress_total=$((stress_total + 1))
  echo "  -> stress validating $(basename "$product")"
  (
    cd "$product"
    npm install --silent
    npm run lint --silent
    npm run test --silent
    npm run build --silent
    rm -rf node_modules
  )
done < <(find "$STRESS_DIR" -mindepth 1 -maxdepth 1 -type d | sort)

echo "[heavy:5/5] Writing heavy-test report"
cat > "$report_path" <<JSON
{
  "run_id": "$run_id",
  "generated_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "pass",
  "benchmark_determinism_hash": "$expected_hash",
  "benchmark_simulate_runs": 5,
  "benchmark_score_gate_runs": 5,
  "stress_projects_validated": $stress_total
}
JSON

rm -rf "$tmp_dir"
echo "heavy testing complete: $report_path"
