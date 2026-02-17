import { z } from "zod";

export const ToolCallSchema = z.object({
  id: z.string(),
  step_id: z.string(),
  tool: z.string(),
  args: z.record(z.unknown()),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  exit_code: z.number().int().nullable(),
  status: z.enum(["queued", "running", "success", "error", "blocked"]),
  output_ref: z.string().nullable()
});

export const StepPlanSchema = z.object({
  run_id: z.string(),
  step_id: z.string(),
  goal: z.string(),
  acceptance_criteria: z.array(z.string()),
  risks: z.array(z.string()),
  policy_context: z.record(z.unknown()),
  deterministic_seed: z.string()
});

export const StepResultSchema = z.object({
  status: z.enum(["success", "failed", "blocked"]),
  checks: z.object({
    lint: z.enum(["pass", "fail", "skip"]),
    typecheck: z.enum(["pass", "fail", "skip"]),
    test: z.enum(["pass", "fail", "skip"]),
    build: z.enum(["pass", "fail", "skip"])
  }),
  failures: z.array(z.string()),
  metrics: z.record(z.number()),
  next_action: z.string().nullable()
});

export const PatchArtifactSchema = z.object({
  base_commit: z.string().nullable(),
  files_changed: z.array(z.string()),
  additions: z.number().int(),
  deletions: z.number().int(),
  sensitive_touches: z.array(z.string())
});

export const RunManifestSchema = z.object({
  run_id: z.string(),
  task_type: z.string(),
  repo_snapshot: z.string(),
  model: z.string(),
  policy_version: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
  final_status: z.enum(["running", "success", "failed", "blocked"])
});

export const PolicyConfigSchema = z.object({
  command_rules: z.array(
    z.object({ pattern: z.string(), allowed: z.boolean(), reason: z.string().optional() })
  ),
  network_rules: z.object({
    default_allow: z.boolean(),
    allow_domains: z.array(z.string())
  }),
  path_rules: z.array(
    z.object({ glob: z.string(), writable: z.boolean(), requires_approval: z.boolean() })
  ),
  overwrite_limit: z.number().int().nonnegative(),
  delete_limit: z.number().int().nonnegative(),
  dep_change_gate: z.boolean(),
  sensitive_paths: z.array(z.string())
});

export const AuditEventSchema = z.object({
  event_id: z.string(),
  ts: z.string(),
  actor: z.string(),
  org_id: z.string(),
  workspace_id: z.string(),
  action: z.string(),
  target: z.string(),
  decision: z.enum(["allow", "deny", "require_approval"]),
  reason: z.string(),
  checksum: z.string()
});

export const IndexSymbolSchema = z.object({
  symbol_id: z.string(),
  file: z.string(),
  kind: z.string(),
  name: z.string(),
  range: z.object({ start: z.number().int(), end: z.number().int() }),
  signature: z.string().nullable(),
  references: z.array(z.string())
});

export const GroundingEvidenceSchema = z.object({
  edit_id: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  evidence_type: z.enum(["search", "symbol", "diagnostic", "test_failure"]),
  excerpt_hash: z.string()
});

export const BenchmarkTaskSchema = z.object({
  task_id: z.string(),
  category: z.string(),
  input: z.string(),
  expected_outcome: z.string(),
  timeout_sec: z.number().int().positive(),
  scorer: z.string()
});

export const MetricRecordSchema = z.object({
  metric_name: z.string(),
  ts: z.string(),
  value: z.number(),
  tags: z.object({
    org: z.string(),
    repo: z.string(),
    branch: z.string(),
    run_id: z.string()
  })
});

export const DecisionLogSchema = z.object({
  decision_id: z.string(),
  title: z.string(),
  context: z.string(),
  options: z.array(z.string()),
  chosen: z.string(),
  consequences: z.array(z.string()),
  related_files: z.array(z.string())
});

export type ToolCall = z.infer<typeof ToolCallSchema>;
export type StepPlan = z.infer<typeof StepPlanSchema>;
export type StepResult = z.infer<typeof StepResultSchema>;
export type PatchArtifact = z.infer<typeof PatchArtifactSchema>;
export type RunManifest = z.infer<typeof RunManifestSchema>;
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;
export type AuditEvent = z.infer<typeof AuditEventSchema>;
export type IndexSymbol = z.infer<typeof IndexSymbolSchema>;
export type GroundingEvidence = z.infer<typeof GroundingEvidenceSchema>;
export type BenchmarkTask = z.infer<typeof BenchmarkTaskSchema>;
export type MetricRecord = z.infer<typeof MetricRecordSchema>;
export type DecisionLog = z.infer<typeof DecisionLogSchema>;

export const ReplayComparisonSchema = z.object({
  determinism_score: z.number().min(0).max(1),
  diff_delta: z.number().nonnegative(),
  tool_call_delta: z.number().nonnegative()
});

export type ReplayComparison = z.infer<typeof ReplayComparisonSchema>;

export const defaultBalancedPolicy: PolicyConfig = {
  command_rules: [
    { pattern: "npm *", allowed: true },
    { pattern: "node *", allowed: true },
    { pattern: "git status", allowed: true },
    { pattern: "git diff", allowed: true },
    { pattern: "rm -rf *", allowed: false, reason: "destructive" }
  ],
  network_rules: {
    default_allow: false,
    allow_domains: ["registry.npmjs.org", "github.com"]
  },
  path_rules: [
    { glob: "infra/**", writable: false, requires_approval: true },
    { glob: "**/security/**", writable: false, requires_approval: true },
    { glob: "**/auth/**", writable: false, requires_approval: true },
    { glob: "**", writable: true, requires_approval: false }
  ],
  overwrite_limit: 500,
  delete_limit: 500,
  dep_change_gate: true,
  sensitive_paths: ["infra/**", "**/security/**", "**/auth/**"]
};
