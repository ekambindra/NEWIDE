# Beta Program and Acceptance

This runbook defines how Atlas Meridian executes M10 beta validation.

## Scope

1. Publish reproducible benchmark reports for each beta drop.
2. Validate determinism and non-destructive safety on supported templates.
3. Validate desktop install/update flow for macOS and Windows beta channels.

## Entry Criteria

1. `npm run lint`, `npm run test`, and `npm run build` are green on `main`.
2. Benchmark gate workflow is green on `main`.
3. Desktop build workflows are green for macOS and Windows.

## Beta Validation Steps

1. Trigger benchmark simulation and scoring:
   - `node packages/benchmark/dist/cli.js simulate --seed 1337 --run-id beta-<date>`
   - `node packages/benchmark/dist/cli.js score packages/benchmark/fixtures/latest-results.json`
2. Run gate evaluation:
   - `node packages/benchmark/dist/cli.js gate packages/benchmark/fixtures/latest-report.json`
3. Append metrics history:
   - `node packages/benchmark/dist/cli.js trends packages/benchmark/fixtures/metrics-history.jsonl packages/benchmark/fixtures/latest-report.json`
4. Verify update channels:
   - `stable` and `beta` selectable in desktop UI.
5. Verify deterministic replay sample:
   - run replay comparator against at least 10 deterministic tasks.

## Acceptance Gates

1. Replay determinism >= 95%.
2. Artifact completeness = 100%.
3. Green pipeline guarantee >= 90% on template corpus.
4. Grounded edit ratio >= 98%.
5. Non-destructive rate >= 99.9%.

## Outputs

1. Benchmark report JSON in artifacts.
2. Human-readable benchmark summary in docs site benchmark page.
3. Beta release notes with known risks and rollback instructions.
