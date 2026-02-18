# Atlas Meridian Decision-Complete Plan

## Product Summary

Build a standalone Electron + TypeScript IDE with deterministic agent execution, enterprise guardrails, deep codebase intelligence, team workflows, and a public release/deployment pipeline.

## Locked Decisions

1. Templates first: Node microservices + Postgres.
2. Backend: Node.js + TypeScript.
3. MVP platform: macOS + Windows GA.
4. Product model: open-core.
5. Deployment scope: managed cloud in v1 with local/offline mode.
6. Cloud: AWS.
7. Policy default: balanced.
8. OSS license: Apache-2.0.
9. Telemetry: opt-in only.

## Functional Surface (Top-Level)

1. Desktop IDE shell with Kiro-like pane layout.
2. Workspace/file operations and safe write abstractions.
3. Diff-first editing and approval flows.
4. Deterministic checkpointed agent runtime.
5. Indexing stack (lexical + symbol + context builder).
6. Multi-agent parallel task orchestration.
7. Control-plane APIs for org/workspace/policy/audit/metrics.
8. Enterprise policy + audit + security controls.
9. Benchmark and KPI scoring harness.
10. Public release and deployment workflows.

## Measurable Targets

1. Inline suggestion P95 <= 250ms.
2. Repo-to-production readiness <= 8 min on supported templates.
3. Green pipeline guarantee >= 90% on supported templates.
4. Replay determinism >= 95%.
5. Index freshness <= 200ms small / <= 2s batch.
6. Grounded edit ratio >= 98%.
7. Non-destructive rate >= 99.9%.

## Required Deterministic Artifacts

Each step writes:

- `checkpoints/<run_id>/<step>/plan.json`
- `checkpoints/<run_id>/<step>/patch.diff`
- `checkpoints/<run_id>/<step>/tool_calls.jsonl`
- `checkpoints/<run_id>/<step>/results.json`

## Current Implementation Snapshot

Implemented now:

1. Full monorepo architecture and CI pipelines across desktop, runtime, benchmark, and cloud services.
2. Electron shell with Kiro-like panes, persisted layout, session restore, crash-safe boundary, and accessibility baseline.
3. Workspace tree/search/editor/split + terminal/tests/logs with policy-aware command execution.
4. Diff chunk approval queue, signed patch manifests, checkpoint restore, and grounding evidence links.
5. Deterministic runtime artifacts, replay comparison, bounded repair loop, and multi-agent orchestration.
6. Team layer: memory KB, ADR logs, reviewer mode, ownership mapping/conflict detection.
7. Enterprise controls: OIDC/SAML provider support, RBAC role enforcement, policy gates, secret redaction.
8. Managed/self-hosted control-plane integration with encrypted metadata and backup/restore paths.
9. Release/distribution stack: macOS/Windows build/release workflows, signing paths, updater channels, provenance attestations.
10. Benchmark harness with >=30-task corpus, KPI scoring, trend alerts, dashboard, and CI regression gates.

Operational notes:

- Desktop release signing/notarization still requires repository secrets to be configured in GitHub Actions.
- GitHub Pages deployment requires Pages to be enabled; the workflow now auto-enables via `actions/configure-pages`.
