# Atlas Meridian Codex-Style UI Migration Task List

## Goal
Rework Atlas Meridian UI/UX to match the Codex workflow pattern shown in the reference:
1. left rail for navigation + threads,
2. center for conversation + run output,
3. right panel for change review + file tree,
4. fast prompt-first interaction with transparent execution and diff controls.

## Target Interaction Model (How Codex Works)
1. User sends a prompt in a single composer.
2. App creates a `turn` and streams planning/execution events.
3. Center pane shows reasoning/output timeline and run status.
4. Right pane shows `last turn changes` as reviewable diffs.
5. User can inspect, filter, and approve/reject changes.
6. User runs follow-up prompts; context is thread-scoped.
7. User finalizes with commit/open/export actions.

## Non-Negotiables
1. Keep deterministic checkpoint artifacts and policy gates already implemented.
2. Keep diff-first editing and approval controls.
3. Preserve accessibility baseline and keyboard-first navigation.
4. Preserve enterprise controls (RBAC/policy/audit/secret handling).

## Milestone Backlog

### M0 - UI Foundation
1. `CDX-001` Create Codex-style layout spec (left/center/right widths, spacing, typography).
2. `CDX-002` Define component-level design tokens for dark shell, panel elevation, borders, and hover states.
3. `CDX-003` Add responsive breakpoints and collapse strategy for <= 1280px width.
4. `CDX-004` Add icon set mapping for rail, thread, action, and change states.
5. `CDX-005` Implement global keyboard map registry (`cmd/ctrl+k`, thread navigation, composer focus).

### M1 - Left Rail + Thread Workspace
6. `CDX-006` Replace current left pane with fixed rail + thread list container.
7. `CDX-007` Add primary rail actions: `New thread`, `Automations`, `Skills`, `Settings`.
8. `CDX-008` Add workspace section (project name + open-folder action).
9. `CDX-009` Add thread list with title, timestamp, unread/state badge, and run count.
10. `CDX-010` Persist selected thread and scroll position.
11. `CDX-011` Add thread search/filter.
12. `CDX-012` Add thread CRUD actions (rename, archive, delete with guard).
13. `CDX-013` Add keyboard thread navigation (`j/k` or arrow variants).

### M2 - Center Conversation Surface
14. `CDX-014` Build conversation header (thread title, workspace, run controls).
15. `CDX-015` Build message timeline (user/agent/system/tool events).
16. `CDX-016` Add turn cards with status states: `thinking`, `running`, `blocked`, `completed`, `failed`, `cancelled`.
17. `CDX-017` Add structured tool-call/event rendering per turn.
18. `CDX-018` Add "last turn summary" card (files changed, additions/deletions, checks).
19. `CDX-019` Rework composer to Codex-style footer with model/effort selectors.
20. `CDX-020` Add `Send`/`Stop` control semantics tied to run lifecycle.
21. `CDX-021` Add command hints/autocomplete and keep slash-help panel.
22. `CDX-022` Add follow-up prompt box behavior with thread context continuity.
23. `CDX-023` Add optimistic UI states and streaming cursor for active turn.

### M3 - Right Review Panel (Changes + Tree)
24. `CDX-024` Build `Last turn changes` panel shell with turn-scoped data.
25. `CDX-025` Add file change list grouped by folder with +/- counts.
26. `CDX-026` Add file filter input and type/status filters.
27. `CDX-027` Add unified diff viewer with hunk folding and unchanged context blocks.
28. `CDX-028` Add file tree explorer below diff list.
29. `CDX-029` Add click-through from diff line -> editor tab location.
30. `CDX-030` Add turn-local undo/revert actions and checkpoint jump.
31. `CDX-031` Add per-file apply/reject controls and state badges.
32. `CDX-032` Add compact review actions row: `Open`, `Commit`, `Export patch`.

### M4 - Cross-Pane State and Coordination
33. `CDX-033` Introduce shared UI store for selected thread/turn/file/hunk.
34. `CDX-034` Sync center turn selection with right-panel diffs.
35. `CDX-035` Sync right-panel file selection with center summary card.
36. `CDX-036` Add URL/state restoration for thread + selected file/hunk.
37. `CDX-037` Ensure layout persistence still works with new shell.

### M5 - Runtime Semantics (Codex-Like Flow)
38. `CDX-038` Formalize turn lifecycle state machine in renderer (`idle -> planning -> running -> review -> done/error/cancelled`).
39. `CDX-039` Add cancellable run tokens for freeform and task runs.
40. `CDX-040` Add explicit `blocked awaiting approval` turn state.
41. `CDX-041` Stream checkpoint/tool-call/result events into turn timeline.
42. `CDX-042` Add robust resume/retry actions from failed turns.
43. `CDX-043` Show run badge in header + rail with thread-level status.

### M6 - Data Contracts and Storage
44. `CDX-044` Add thread/turn/message schemas for UI data model.
45. `CDX-045` Add change-set schema for right panel (`files`, `hunks`, `stats`, `artifacts`).
46. `CDX-046` Add local persistence migration for thread store.
47. `CDX-047` Add IPC contracts for thread CRUD, turn history, and change retrieval.
48. `CDX-048` Add audit mappings for new UI actions (thread edit, commit, export, cancel).

### M7 - QA, Accessibility, Performance
49. `CDX-049` Add renderer unit tests for thread store/reducers/selectors.
50. `CDX-050` Add component tests for composer, turn cards, and right diff panel.
51. `CDX-051` Add E2E flow tests: prompt -> run -> review -> commit.
52. `CDX-052` Add E2E cancellation and blocked-approval tests.
53. `CDX-053` Accessibility pass: focus order, aria labels, contrast, keyboard-only operation.
54. `CDX-054` Performance pass: virtualize long thread list and heavy diff rendering.

### M8 - Release and Adoption
55. `CDX-055` Add feature flag `codex_shell_v1` for staged rollout.
56. `CDX-056` Update beginner/pro user docs with new workflow.
57. `CDX-057` Add in-product onboarding tour for first run.
58. `CDX-058` Add telemetry counters for prompt-to-first-change and review completion.
59. `CDX-059` Run beta feedback loop and refine interaction friction points.
60. `CDX-060` GA switch-over and deprecate legacy shell components.

## Definition of Done
1. All `CDX-*` tasks implemented and tested.
2. Prompt -> run -> review -> commit flow works without switching modes.
3. Existing deterministic artifacts/policy/audit guarantees remain intact.
4. Desktop lint/build/test + E2E suite green.

## Execution Order Recommendation
1. M0 -> M2 first (core shell + composer + timeline).
2. M3 -> M4 next (review panel + state sync).
3. M5 -> M6 for runtime/data hardening.
4. M7 -> M8 for quality and rollout.
