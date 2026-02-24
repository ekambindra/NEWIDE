# Full System Test Case Matrix

This document defines the full Atlas Meridian test suite and maps every feature area to executable test cases.

## Scope

- Product: Atlas Meridian desktop + local runtime + control plane modules + release/benchmark pipeline.
- Coverage target: all feature families from `UI-001` through `EVAL-014`.
- Validation modes:
  - automated command suites (unit/integration/build/benchmark),
  - generated product smoke tests,
  - desktop manual/E2E scenarios for UX and gated actions.

## Coverage Map (All Feature Families)

| Feature family | Coverage in this matrix |
|---|---|
| `UI-001..UI-020` | `TC-UI-*` |
| `WS-001..WS-015` | `TC-WS-*` |
| `DIFF-001..DIFF-012` | `TC-DIFF-*` |
| `TERM-001..TERM-010` | `TC-TERM-*` |
| `AGENT-001..AGENT-020` | `TC-AGENT-*` |
| `IDX-001..IDX-015` | `TC-IDX-*` |
| `AUTO-001..AUTO-018` | `TC-AUTO-*` |
| `TEAM-001..TEAM-010` | `TC-TEAM-*` |
| `ENT-001..ENT-017` | `TC-ENT-*` |
| `CLOUD-001..CLOUD-009` | `TC-CLOUD-*` |
| `REL-001..REL-010` | `TC-REL-*` |
| `EVAL-001..EVAL-014` | `TC-EVAL-*` |

## Execution Order

1. `TC-CORE-001`: `npm run lint`
2. `TC-CORE-002`: `npm run test`
3. `TC-CORE-003`: `npm run build`
4. `TC-EVAL-001..004`: benchmark simulate/score/gate/trends
5. `TC-AUTO-006`: project builder regression test
6. `TC-AUTO-007`: generated product smoke tests
7. `TC-AUTO-008`: game build smoke test
8. Manual/E2E passes (`TC-UI-*`, `TC-DIFF-*`, `TC-TERM-*`, `TC-AGENT-*`, `TC-ENT-*`)

## Automated Test Cases

### Core + Quality Gates

| ID | Objective | Command | Expected |
|---|---|---|---|
| `TC-CORE-001` | Type/lint gate for all workspaces | `npm run lint` | exit code `0` |
| `TC-CORE-002` | Unit/integration tests for all workspaces | `npm run test` | exit code `0` and all suites pass |
| `TC-CORE-003` | Build validation for all workspaces | `npm run build` | exit code `0` and artifacts generated |
| `TC-CORE-004` | Full local validation harness | `./scripts/full-validation.sh` | all sections complete without error |
| `TC-CORE-005` | Heavy stress harness (repeatability + scale) | `./scripts/heavy-test.sh` | deterministic simulate hash stable; stress products validate; report generated |

### Benchmark + KPI Gates (`EVAL-*`)

| ID | Objective | Command | Expected |
|---|---|---|---|
| `TC-EVAL-001` | Deterministic corpus simulation | `node packages/benchmark/dist/cli.js simulate --seed 1337 --out packages/benchmark/fixtures/latest-results.json` | results JSON produced |
| `TC-EVAL-002` | KPI scoring and metric history append | `node packages/benchmark/dist/cli.js score ...` | report JSON generated with KPI fields |
| `TC-EVAL-003` | Regression gate | `node packages/benchmark/dist/cli.js gate packages/benchmark/fixtures/latest-report.json` | `PASS` |
| `TC-EVAL-004` | Trend analysis | `node packages/benchmark/dist/cli.js trends packages/benchmark/fixtures/metrics-history.jsonl` | trend output produced |

### Project Builder + Generated Products (`AUTO-*`)

| ID | Objective | Command | Expected |
|---|---|---|---|
| `TC-AUTO-001` | Builder unit tests | `npm run test --workspace @ide/desktop -- src/main/project-builder.test.ts` | test file passes |
| `TC-AUTO-002` | Required artifacts completeness | project-builder unit assertions | `README/ARCHITECTURE/RUNBOOK/SECURITY/.env/docker-compose/CI` present |
| `TC-AUTO-003` | Deterministic checkpoint artifacts | project-builder unit assertions | `plan.json`, `patch.diff`, `tool_calls.jsonl`, `results.json` present |
| `TC-AUTO-004` | Non-empty target safety | project-builder unit assertions | generation blocked with explicit error |
| `TC-AUTO-005` | Template starter service tests exist | project-builder unit assertions | generated files include API + worker test files |
| `TC-AUTO-006` | Generated sample products pass lint/test/build | loop `atlas-build-lab/test-cases/*` | each sample exits `0` for lint/test/build |
| `TC-AUTO-007` | Generated sample products include DB + service scaffolds | artifact scan script | API/worker/DB paths exist |
| `TC-AUTO-008` | Creative game product smoke test | `cd atlas-build-lab/games/atlas-number-duel && npm run test && ATLAS_GAME_SECRET=12 ATLAS_GAME_GUESSES=9,13,12 npm run start` | tests pass + deterministic win output |

## Desktop Functional Test Cases

### UI and Workspace (`UI-*`, `WS-*`)

| ID | Objective | Procedure | Expected |
|---|---|---|---|
| `TC-UI-001` | Open workspace and restore session | launch app, open folder, restart app | prior tabs/panels restore |
| `TC-UI-002` | Topbar feature toggles | toggle `Files/Search/Agent/Plan/Diff/Checkpoints/Terminal/Tests/Logs` | corresponding pane visibility updates |
| `TC-UI-003` | Split editor + secondary tab selector | open 2 files, enable split | both panes render and edit independently |
| `TC-UI-004` | Keyboard-first + command palette | open palette and execute commands | command executes, focus remains usable |
| `TC-UI-005` | Accessibility baseline | verify skip link, tablist semantics, visible focus ring | all elements keyboard accessible |
| `TC-WS-001` | File tree + git decorations | open repo with modified files | tree renders statuses |
| `TC-WS-002` | Search and replace preview/apply | run find/replace in open tab and project search | preview count correct and changes apply |
| `TC-WS-003` | External file change handling | edit file outside app while open | conflict/refresh behavior is safe |
| `TC-WS-004` | Unsaved changes guard | modify file and close window | close is blocked or prompts user |
| `TC-WS-005` | Encoding/line-ending normalization | save file with mixed endings | normalized output per policy |

### Diff and Checkpoints (`DIFF-*`)

| ID | Objective | Procedure | Expected |
|---|---|---|---|
| `TC-DIFF-001` | Chunk-level accept/reject | open diff panel and process chunks | accepted/rejected statuses persist |
| `TC-DIFF-002` | Sensitive-file + dependency gates | apply patch touching protected paths/deps | approval gate triggers before apply |
| `TC-DIFF-003` | Overwrite/delete thresholds | attempt large destructive diff | operation blocked/prompted by policy |
| `TC-DIFF-004` | Signature and checkpoint integrity | verify checkpoint signature and revert | signature result shown and revert succeeds |
| `TC-DIFF-005` | Grounding evidence counts | apply patch with index context | checkpoint records grounding evidence metadata |

### Terminal and Pipeline (`TERM-*`)

| ID | Objective | Procedure | Expected |
|---|---|---|---|
| `TC-TERM-001` | Controlled PTY start/send/stop | start session, send stdin, stop | state transitions correct and output captured |
| `TC-TERM-002` | Command allow/deny policy | run blocked command | denial reason surfaced and audited |
| `TC-TERM-003` | Network command gate | run command requiring network when restricted | gate requests approval or blocks |
| `TC-TERM-004` | Pipeline runner | run lint/typecheck/test/build pipeline | stage statuses + parsed tests displayed |
| `TC-TERM-005` | Terminal replay | load replay in checkpoints tab | prior command outputs replayed |

### Agent and Indexing (`AGENT-*`, `IDX-*`, `AUTO-*`)

| ID | Objective | Procedure | Expected |
|---|---|---|---|
| `TC-AGENT-001` | Deterministic run artifacts | execute task mode | each step writes `plan/patch/tool_calls/results` |
| `TC-AGENT-002` | Retry/repair bounded loop | seed failing test and run task mode | bounded retries, repair trace, final status captured |
| `TC-AGENT-003` | Replay determinism comparator | replay prior run | determinism score + deltas produced |
| `TC-IDX-001` | Incremental indexing freshness | modify small file and batch files | freshness metrics meet target buckets |
| `TC-IDX-002` | Symbol/call/import graph diagnostics | open diagnostics panel | populated symbols + graph summaries |
| `TC-IDX-003` | Rename impact analysis | run multi-file refactor preview | declaration/reference/collision metrics shown |
| `TC-AUTO-009` | Project builder from UI | run builder from agent panel | project generated + completeness shown |
| `TC-AUTO-010` | Multi-agent mode | launch with coordinator goal and >1 agents | multiple run outputs and summary displayed |

### Team and Governance (`TEAM-*`)

| ID | Objective | Procedure | Expected |
|---|---|---|---|
| `TC-TEAM-001` | Team memory CRUD + retrieval | add/search memory entries | scored retrieval returns relevant entries |
| `TC-TEAM-002` | ADR decision log generation | create decision entry | persisted decision has context/options/consequences |
| `TC-TEAM-003` | Reviewer mode findings | run reviewer on changed files | grounded line-item findings generated |
| `TC-TEAM-004` | Ownership map/conflict report | run ownership scan | owner matches + conflicts reported |
| `TC-TEAM-005` | Changelog/release/handoff drafts | generate artifacts | markdown outputs generated and auditable |

### Enterprise, Cloud, and Release (`ENT-*`, `CLOUD-*`, `REL-*`)

| ID | Objective | Procedure | Expected |
|---|---|---|---|
| `TC-ENT-001` | OIDC/SAML provider flows | configure providers and authenticate | auth sessions created with role context |
| `TC-ENT-002` | RBAC enforcement | attempt high-impact actions as each role | deny/allow behavior matches matrix |
| `TC-ENT-003` | Secret redaction and detection | submit secret-like payloads/logs | redaction applied and secret findings surfaced |
| `TC-ENT-004` | Telemetry consent + privacy mode | toggle consent/privacy settings | metric/audit push obeys consent policy |
| `TC-ENT-005` | TLS policy validation | set non-HTTPS endpoint in strict mode | endpoint rejected unless localhost exception |
| `TC-CLOUD-001` | Backup/restore endpoints | perform backup then restore in control-plane tests | encrypted snapshot restores successfully |
| `TC-CLOUD-002` | Policy and audit ingestion APIs | push policies/events/metrics | accepted with signed/authenticated requests |
| `TC-REL-001` | Desktop build workflows | run macOS/Windows build workflows | signed artifacts generated |
| `TC-REL-002` | Update channel behavior | switch stable/beta in desktop settings | update checks hit selected channel |
| `TC-REL-003` | Provenance attestation | run release workflow | attestation artifacts emitted |

## Issue Remediation Log (Current Cycle)

| Issue ID | Description | Impact | Fix | Status |
|---|---|---|---|---|
| `ISSUE-001` | Generated microservice templates had `0` starter tests in API/worker services. | Reduced confidence in generated-product validation. | Added scaffolded service test files and testable helper exports in generated API/worker code; updated builder unit tests to enforce this. | `Resolved` |
| `ISSUE-002` | Generated starter tests originally imported runtime entry files that auto-started long-running server/worker loops. | Generated product test runs could hang indefinitely. | Added direct-execution guards in generated API/worker entrypoints (`startServer`/`startWorker` + `fileURLToPath(import.meta.url)` check). | `Resolved` |
| `ISSUE-003` | Benchmark trend analyzer classified decreases in lower-is-better metrics as regressions. | False critical alerts in KPI trend output (for example `human_intervention_rate`). | Reworked trend direction mapping with explicit lower-is-better metric list, corrected regression sign logic, and added unit tests for both improvement and regression cases. | `Resolved` |
| `ISSUE-004` | Heavy-test determinism hashing using `shasum` failed under locale mismatch (`C.UTF-8`) in some environments. | Heavy validation run could fail despite healthy product behavior. | Replaced shell hashing with Node `crypto.createHash('sha256')` in `scripts/heavy-test.sh`. | `Resolved` |

## Current Exit Criteria

1. `TC-CORE-001..004` all pass.
2. `TC-EVAL-001..004` pass and benchmark gate remains green.
3. `TC-AUTO-001..008` pass for generated samples and game sample.
4. Manual suites complete with no P0/P1 defects.
5. Resolved issues recorded in remediation log.
