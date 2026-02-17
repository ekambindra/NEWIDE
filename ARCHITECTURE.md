# Architecture

## Core topology

- Desktop shell (Electron): UI panes + local runtime bridge
- Local runtime packages: policy, agent, indexer, benchmark
- Managed control plane (AWS target): org/workspace/policy/audit/metrics APIs

## Deterministic runtime artifacts

Each step emits:

- `plan.json`
- `patch.diff`
- `tool_calls.jsonl`
- `results.json`

Stored at `checkpoints/<run_id>/<step>/`.

## Security baseline

- Tool-only actions
- Diff-first mutation model
- Policy gates for high-risk operations
- Redaction path in audit logs
