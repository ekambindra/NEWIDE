# Atlas Meridian

Standalone Electron + TypeScript IDE with deterministic agent execution, enterprise policy controls, and benchmark-driven quality gates.

## Key Features Implemented

- Kiro-style desktop layout with file/search/editor/agent/diff/checkpoint/terminal panes.
- Deterministic checkpoint artifacts for runtime and terminal operations.
- Policy-gated command execution with approval path.
- Immutable local audit event chain + export.
- Multi-agent parallel execution mode with coordinator summaries.

## Workspaces

- `apps/desktop`: Electron desktop app
- `apps/control-plane`: Managed cloud control plane API
- `packages/shared`: Shared schemas/contracts
- `packages/policy-engine`: Policy evaluation and gates
- `packages/agent-runtime`: Deterministic agent orchestration/checkpoints
- `packages/indexer`: Search/symbol/context indexing
- `packages/benchmark`: Evaluation harness and KPI scoring

## Quick Start

```bash
npm install
npm run dev:desktop
```

## Documentation

- Full docs index: `docs/INDEX.md`
- Decision-complete plan: `docs/plan/DECISION_COMPLETE_PLAN.md`
- Master prompt: `docs/prompts/MASTER_EXECUTION_PROMPT.md`
- Feature status: `docs/FEATURE_STATUS.md`
- Chat continuity protocol: `CHAT_CONTINUITY.md` and `chat1`

## Milestone Status

- M0-M9: Implemented (core desktop, enterprise controls, cloud baseline, release pipelines, benchmark harness)
- M10-M11: Implemented as operational runbooks/checklists for beta and GA execution
