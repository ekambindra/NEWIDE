# Enterprise AI IDE Decision-Complete Plan

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

1. Monorepo architecture and CI.
2. Electron shell + pane layout + persistent layout sizing.
3. Workspace tree/search/editor/split + terminal/tests/logs.
4. Diff chunk queue with accept/reject decisions.
5. Checkpoint timeline + detail inspector + terminal replay.
6. Immutable audit JSONL chain with export.
7. Policy-gated command execution + approval path.
8. Deterministic runtime with replay comparison.
9. Multi-agent concurrent orchestration in runtime + UI trigger.
10. Control-plane endpoint skeleton for required domains.

Pending:

- Full OIDC/SAML production integration.
- Full RBAC admin UX.
- Complete packaging/signing/update channels.
- Full benchmark corpus and dashboard visuals.
