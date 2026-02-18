# Atlas Meridian Benchmark Harness

This package provides the local benchmark harness and scoring/gating logic.

## Core Commands

- `node dist/cli.js corpus --out packages/benchmark/tasks/default-corpus.json`
- `node dist/cli.js simulate --seed 1337 --out /tmp/results.json`
- `node dist/cli.js score /tmp/results.json --history /tmp/history.jsonl --out /tmp/report.json`
- `node dist/cli.js gate /tmp/report.json`
- `node dist/cli.js trends /tmp/history.jsonl`

## Feature Mapping

- `EVAL-001`: Benchmark harness CLI
- `EVAL-002`: Task corpus (`tasks/default-corpus.json`)
- `EVAL-003..008`: Category coverage in corpus (`greenfield_build`, `feature_add`, `stacktrace_bugfix`, `refactor_30`, `refactor_100`, `replay_determinism`)
- `EVAL-009`: Scoring engine (`score`)
- `EVAL-010`: Regression budget scoring (`scoreRegressionBudget`)
- `EVAL-011`: Metrics store (`appendMetricsStore`, `readMetricsStore`)
- `EVAL-013`: Trend alerts (`buildTrendAlerts`)
- `EVAL-014`: CI gate (`.github/workflows/benchmark-gate.yml`)
