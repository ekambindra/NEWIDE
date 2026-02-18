import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  BenchmarkTaskSchema,
  type BenchmarkTask,
  type MetricRecord
} from "@ide/shared";

export type BenchmarkCategory =
  | "greenfield_build"
  | "feature_add"
  | "stacktrace_bugfix"
  | "refactor_30"
  | "refactor_100"
  | "replay_determinism";

export type BenchmarkResult = {
  task: BenchmarkTask;
  passed: boolean;
  durationSec: number;
  retries: number;
  toolCalls: number;
  diffChurn: number;
  timeToGreenSec?: number;
  determinismScore?: number;
  replayMatched?: boolean;
  filesTouched?: number;
  groundedEditRatio?: number;
  artifactCompleteness?: number;
  fixLoopSucceeded?: boolean;
  humanIntervention?: boolean;
  failingTestsStart?: number;
  failingTestsEnd?: number;
  maxIntermediateFailingTests?: number;
  indexFreshnessSmallMs?: number;
  indexFreshnessBatchMs?: number;
  checkpointIntegrity?: boolean;
  nonDestructive?: boolean;
  prReadinessScore?: number;
  reviewerPrecision?: number;
  decisionLogCoverage?: number;
  inlineSuggestionLatencyMs?: number;
};

export type RegressionBudgetReport = {
  applicable: number;
  withinBudget: number;
  adherenceRate: number;
  violations: Array<{
    taskId: string;
    failingTestsEnd: number;
    maxIntermediateFailingTests: number;
  }>;
};

export type KpiGate = {
  name: string;
  value: number;
  target: number;
  comparator: "gte" | "lte";
  meetsTarget: boolean;
  unit: string;
};

export type TrendAlert = {
  metricName: string;
  severity: "warning" | "critical";
  direction: "increase" | "decrease";
  deltaPercent: number;
  baseline: number;
  current: number;
  message: string;
};

export type ScoreCard = {
  total: number;
  passRate: number;
  avgDuration: number;
  avgRetries: number;
  avgToolCalls: number;
  avgDiffChurn: number;
  avgTimeToGreen: number;
  determinismRate: number;
  groundedEditRatio: number;
  fixLoopSuccessRate: number;
  artifactCompleteness: number;
  humanInterventionRate: number;
  crossFileRefactorSuccess30: number;
  crossFileRefactorSuccess100: number;
  regressionBudget: RegressionBudgetReport;
  kpis: KpiGate[];
  metrics: MetricRecord[];
};

export type BenchmarkGateResult = {
  pass: boolean;
  failing: KpiGate[];
};

const DEFAULT_TAGS = {
  org: "local",
  repo: "workspace",
  branch: "main",
  run_id: "benchmark"
};

type MetricTags = MetricRecord["tags"];

type ScoreOptions = {
  runId?: string;
  tags?: Partial<MetricTags>;
  now?: string;
};

type CorpusTemplate = {
  category: BenchmarkCategory;
  count: number;
  timeoutSec: number;
  scorer: string;
  prompt: string;
  expectation: string;
};

const CORPUS_TEMPLATES: CorpusTemplate[] = [
  {
    category: "greenfield_build",
    count: 6,
    timeoutSec: 900,
    scorer: "time_to_green",
    prompt: "Generate a Node microservice + Postgres stack with CI/docs",
    expectation: "Build pipeline green with required artifacts"
  },
  {
    category: "feature_add",
    count: 6,
    timeoutSec: 600,
    scorer: "feature_add",
    prompt: "Add feature with tests and docs",
    expectation: "Feature merged with all tests passing"
  },
  {
    category: "stacktrace_bugfix",
    count: 6,
    timeoutSec: 480,
    scorer: "bugfix",
    prompt: "Fix bug from stack trace and prevent regression",
    expectation: "Root cause fixed and regression test added"
  },
  {
    category: "refactor_30",
    count: 6,
    timeoutSec: 600,
    scorer: "refactor_30",
    prompt: "Execute cross-file rename across 30 files",
    expectation: "Refactor lands with no regressions"
  },
  {
    category: "refactor_100",
    count: 6,
    timeoutSec: 900,
    scorer: "refactor_100",
    prompt: "Execute cross-file rename across 100 files",
    expectation: "Refactor lands with no regressions"
  },
  {
    category: "replay_determinism",
    count: 6,
    timeoutSec: 300,
    scorer: "determinism",
    prompt: "Replay same task with same snapshot/settings",
    expectation: "Tool calls and diffs within determinism tolerance"
  }
];

export function loadDefaultTaskCorpus(): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];
  for (const template of CORPUS_TEMPLATES) {
    for (let index = 1; index <= template.count; index += 1) {
      const id = `${template.category}-${String(index).padStart(2, "0")}`;
      tasks.push({
        task_id: id,
        category: template.category,
        input: `${template.prompt} [scenario ${index}]`,
        expected_outcome: `${template.expectation} [scenario ${index}]`,
        timeout_sec: template.timeoutSec,
        scorer: template.scorer
      });
    }
  }
  return tasks;
}

export function validateTaskCorpus(tasks: BenchmarkTask[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (tasks.length < 30) {
    errors.push(`task corpus must contain at least 30 tasks (found ${tasks.length})`);
  }

  const requiredCategories: BenchmarkCategory[] = [
    "greenfield_build",
    "feature_add",
    "stacktrace_bugfix",
    "refactor_30",
    "refactor_100",
    "replay_determinism"
  ];

  for (const category of requiredCategories) {
    if (!tasks.some((task) => task.category === category)) {
      errors.push(`missing required category: ${category}`);
    }
  }

  for (const task of tasks) {
    const parsed = BenchmarkTaskSchema.safeParse(task);
    if (!parsed.success) {
      errors.push(`invalid task ${task.task_id}: ${parsed.error.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

function normalizedCategory(task: BenchmarkTask): BenchmarkCategory | null {
  const category = task.category as BenchmarkCategory;
  if (
    category === "greenfield_build" ||
    category === "feature_add" ||
    category === "stacktrace_bugfix" ||
    category === "refactor_30" ||
    category === "refactor_100" ||
    category === "replay_determinism"
  ) {
    return category;
  }
  return null;
}

function metric(name: string, value: number, tags: MetricTags, ts: string): MetricRecord {
  return {
    metric_name: name,
    ts,
    value,
    tags
  };
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(1, p));
  const index = Math.min(sorted.length - 1, Math.floor(clamped * (sorted.length - 1)));
  return sorted[index] ?? 0;
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function gate(
  name: string,
  value: number,
  target: number,
  comparator: "gte" | "lte",
  unit: string
): KpiGate {
  const meetsTarget = comparator === "gte" ? value >= target : value <= target;
  return {
    name,
    value,
    target,
    comparator,
    meetsTarget,
    unit
  };
}

export function scoreRegressionBudget(results: BenchmarkResult[]): RegressionBudgetReport {
  const applicable = results.filter(
    (result) =>
      typeof result.failingTestsEnd === "number" ||
      typeof result.maxIntermediateFailingTests === "number"
  );

  const violations = applicable
    .filter((result) => {
      const failingEnd = Math.max(0, result.failingTestsEnd ?? 0);
      const intermediate = Math.max(0, result.maxIntermediateFailingTests ?? 0);
      return failingEnd > 0 || intermediate > 1;
    })
    .map((result) => ({
      taskId: result.task.task_id,
      failingTestsEnd: Math.max(0, result.failingTestsEnd ?? 0),
      maxIntermediateFailingTests: Math.max(0, result.maxIntermediateFailingTests ?? 0)
    }));

  return {
    applicable: applicable.length,
    withinBudget: Math.max(0, applicable.length - violations.length),
    adherenceRate: ratio(applicable.length - violations.length, applicable.length),
    violations
  };
}

export function score(results: BenchmarkResult[], options: ScoreOptions = {}): ScoreCard {
  if (results.length === 0) {
    return {
      total: 0,
      passRate: 0,
      avgDuration: 0,
      avgRetries: 0,
      avgToolCalls: 0,
      avgDiffChurn: 0,
      avgTimeToGreen: 0,
      determinismRate: 0,
      groundedEditRatio: 0,
      fixLoopSuccessRate: 0,
      artifactCompleteness: 0,
      humanInterventionRate: 0,
      crossFileRefactorSuccess30: 0,
      crossFileRefactorSuccess100: 0,
      regressionBudget: {
        applicable: 0,
        withinBudget: 0,
        adherenceRate: 0,
        violations: []
      },
      kpis: [],
      metrics: []
    };
  }

  const total = results.length;
  const passed = results.filter((result) => result.passed).length;

  const greenfield = results.filter((result) => normalizedCategory(result.task) === "greenfield_build");
  const refactor30 = results.filter((result) => normalizedCategory(result.task) === "refactor_30");
  const refactor100 = results.filter((result) => normalizedCategory(result.task) === "refactor_100");
  const replay = results.filter((result) => normalizedCategory(result.task) === "replay_determinism");

  const determinismPasses = replay.filter((result) => {
    if (result.replayMatched === true) {
      return true;
    }
    return (result.determinismScore ?? 0) >= 0.95;
  }).length;

  const groundedRatio = average(
    results
      .map((result) => result.groundedEditRatio)
      .filter((value): value is number => typeof value === "number")
  );

  const fixLoopSuccessRate = ratio(
    results.filter((result) => result.fixLoopSucceeded === true).length,
    results.filter((result) => typeof result.fixLoopSucceeded === "boolean").length
  );

  const artifactCompleteness = average(
    results
      .map((result) => result.artifactCompleteness)
      .filter((value): value is number => typeof value === "number")
  );

  const humanInterventionRate = ratio(
    results.filter((result) => result.humanIntervention === true).length,
    total
  );

  const indexFreshnessSmallMs = average(
    results
      .map((result) => result.indexFreshnessSmallMs)
      .filter((value): value is number => typeof value === "number")
  );

  const indexFreshnessBatchMs = average(
    results
      .map((result) => result.indexFreshnessBatchMs)
      .filter((value): value is number => typeof value === "number")
  );

  const checkpointIntegrityRate = ratio(
    results.filter((result) => result.checkpointIntegrity !== false).length,
    total
  );

  const nonDestructiveRate = ratio(
    results.filter((result) => result.nonDestructive !== false).length,
    total
  );

  const prReadinessScore = average(
    results
      .map((result) => result.prReadinessScore)
      .filter((value): value is number => typeof value === "number")
  );

  const reviewerPrecision = average(
    results
      .map((result) => result.reviewerPrecision)
      .filter((value): value is number => typeof value === "number")
  );

  const decisionLogCoverage = average(
    results
      .map((result) => result.decisionLogCoverage)
      .filter((value): value is number => typeof value === "number")
  );

  const inlineSuggestionLatencyP95 = percentile(
    results
      .map((result) => result.inlineSuggestionLatencyMs)
      .filter((value): value is number => typeof value === "number"),
    0.95
  );

  const regressionBudget = scoreRegressionBudget(results);

  const scoreCard: ScoreCard = {
    total,
    passRate: ratio(passed, total),
    avgDuration: average(results.map((result) => result.durationSec)),
    avgRetries: average(results.map((result) => result.retries)),
    avgToolCalls: average(results.map((result) => result.toolCalls)),
    avgDiffChurn: average(results.map((result) => result.diffChurn)),
    avgTimeToGreen: average(
      results.map((result) => result.timeToGreenSec ?? result.durationSec)
    ),
    determinismRate: ratio(determinismPasses, replay.length),
    groundedEditRatio: groundedRatio,
    fixLoopSuccessRate,
    artifactCompleteness,
    humanInterventionRate,
    crossFileRefactorSuccess30: ratio(
      refactor30.filter((result) => result.passed).length,
      refactor30.length
    ),
    crossFileRefactorSuccess100: ratio(
      refactor100.filter((result) => result.passed).length,
      refactor100.length
    ),
    regressionBudget,
    kpis: [],
    metrics: []
  };

  scoreCard.kpis = [
    gate("repo_to_production_readiness_time", average(greenfield.map((result) => result.durationSec)), 480, "lte", "seconds"),
    gate("green_pipeline_guarantee_rate", scoreCard.passRate, 0.9, "gte", "ratio"),
    gate("artifact_completeness", scoreCard.artifactCompleteness, 1, "gte", "ratio"),
    gate("fix_loop_success_rate", scoreCard.fixLoopSuccessRate, 0.8, "gte", "ratio"),
    gate("cross_file_refactor_success_30", scoreCard.crossFileRefactorSuccess30, 0.9, "gte", "ratio"),
    gate("cross_file_refactor_success_100", scoreCard.crossFileRefactorSuccess100, 0.75, "gte", "ratio"),
    gate("grounded_edit_ratio", scoreCard.groundedEditRatio, 0.98, "gte", "ratio"),
    gate("regression_budget_adherence", scoreCard.regressionBudget.adherenceRate, 0.95, "gte", "ratio"),
    gate("replay_determinism_rate", scoreCard.determinismRate, 0.95, "gte", "ratio"),
    gate("checkpoint_integrity", checkpointIntegrityRate, 1, "gte", "ratio"),
    gate("non_destructive_rate", nonDestructiveRate, 0.999, "gte", "ratio"),
    gate("pr_readiness_score", prReadinessScore, 0.95, "gte", "ratio"),
    gate("reviewer_mode_precision", reviewerPrecision, 0.9, "gte", "ratio"),
    gate("decision_log_coverage", decisionLogCoverage, 0.9, "gte", "ratio"),
    gate("index_freshness_small_ms", indexFreshnessSmallMs, 200, "lte", "milliseconds"),
    gate("index_freshness_batch_ms", indexFreshnessBatchMs, 2000, "lte", "milliseconds"),
    gate("inline_suggestion_latency_p95", inlineSuggestionLatencyP95, 250, "lte", "milliseconds"),
    gate("human_intervention_rate", scoreCard.humanInterventionRate, 0.15, "lte", "ratio"),
    gate("agent_task_completion_time", scoreCard.avgDuration, 300, "lte", "seconds")
  ];

  const now = options.now ?? new Date().toISOString();
  const tags: MetricTags = {
    ...DEFAULT_TAGS,
    ...(options.tags ?? {}),
    run_id: options.runId ?? options.tags?.run_id ?? DEFAULT_TAGS.run_id
  };

  scoreCard.metrics.push(
    metric("green_pipeline_guarantee_rate", scoreCard.passRate, tags, now),
    metric("agent_task_completion_time", scoreCard.avgDuration, tags, now),
    metric("tool_calls_per_task", scoreCard.avgToolCalls, tags, now),
    metric("diff_churn", scoreCard.avgDiffChurn, tags, now),
    metric("replay_determinism_rate", scoreCard.determinismRate, tags, now),
    metric("grounded_edit_ratio", scoreCard.groundedEditRatio, tags, now),
    metric("fix_loop_success_rate", scoreCard.fixLoopSuccessRate, tags, now),
    metric("artifact_completeness", scoreCard.artifactCompleteness, tags, now),
    metric("checkpoint_integrity", checkpointIntegrityRate, tags, now),
    metric("non_destructive_rate", nonDestructiveRate, tags, now),
    metric("pr_readiness_score", prReadinessScore, tags, now),
    metric("reviewer_mode_precision", reviewerPrecision, tags, now),
    metric("decision_log_coverage", decisionLogCoverage, tags, now),
    metric("index_freshness_small_ms", indexFreshnessSmallMs, tags, now),
    metric("index_freshness_batch_ms", indexFreshnessBatchMs, tags, now),
    metric("inline_suggestion_latency_p95", inlineSuggestionLatencyP95, tags, now),
    metric("human_intervention_rate", scoreCard.humanInterventionRate, tags, now),
    metric("regression_budget_adherence", scoreCard.regressionBudget.adherenceRate, tags, now)
  );

  return scoreCard;
}

export function evaluateRegressionGate(scoreCard: ScoreCard): BenchmarkGateResult {
  const failing = scoreCard.kpis.filter((kpi) => !kpi.meetsTarget);
  return {
    pass: failing.length === 0,
    failing
  };
}

export async function appendMetricsStore(path: string, records: MetricRecord[]): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const payload = records.map((record) => JSON.stringify(record)).join("\n");
  const prefix = payload.length > 0 ? `${payload}\n` : "";
  await writeFile(path, prefix, { encoding: "utf8", flag: "a" });
}

export async function readMetricsStore(path: string): Promise<MetricRecord[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as MetricRecord);
  } catch {
    return [];
  }
}

function directionForMetric(metricName: string): "increase" | "decrease" {
  if (
    metricName.includes("rate") ||
    metricName.includes("ratio") ||
    metricName.includes("completeness") ||
    metricName.includes("determinism")
  ) {
    return "decrease";
  }
  return "increase";
}

export function buildTrendAlerts(
  records: MetricRecord[],
  options: { warningPercent?: number; criticalPercent?: number } = {}
): TrendAlert[] {
  const warning = options.warningPercent ?? 0.1;
  const critical = options.criticalPercent ?? 0.2;
  const grouped = new Map<string, MetricRecord[]>();

  for (const record of records) {
    const bucket = grouped.get(record.metric_name) ?? [];
    bucket.push(record);
    grouped.set(record.metric_name, bucket);
  }

  const alerts: TrendAlert[] = [];

  for (const [metricName, bucket] of grouped.entries()) {
    const ordered = [...bucket].sort((a, b) => a.ts.localeCompare(b.ts));
    if (ordered.length < 6) {
      continue;
    }

    const split = Math.floor(ordered.length / 2);
    const baseline = average(ordered.slice(0, split).map((entry) => entry.value));
    const current = average(ordered.slice(split).map((entry) => entry.value));

    if (baseline === 0) {
      continue;
    }

    const delta = (current - baseline) / Math.abs(baseline);
    const direction = directionForMetric(metricName);
    const regression = direction === "increase" ? delta > 0 : delta < 0;

    if (!regression) {
      continue;
    }

    const magnitude = Math.abs(delta);
    if (magnitude < warning) {
      continue;
    }

    alerts.push({
      metricName,
      severity: magnitude >= critical ? "critical" : "warning",
      direction,
      deltaPercent: magnitude,
      baseline,
      current,
      message: `${metricName} regressed by ${(magnitude * 100).toFixed(1)}%`
    });
  }

  return alerts.sort((a, b) => b.deltaPercent - a.deltaPercent);
}

function seededRandom(seed: number): () => number {
  let state = Math.max(1, seed >>> 0);
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function simulateResults(tasks: BenchmarkTask[], seed = 1337): BenchmarkResult[] {
  const random = seededRandom(seed);
  return tasks.map((task) => {
    const category = normalizedCategory(task);
    const passThreshold = category === "refactor_100" ? 0.92 : 0.96;
    const passed = random() <= passThreshold;
    const durationBase =
      category === "greenfield_build"
        ? 360
        : category === "feature_add"
          ? 220
          : category === "stacktrace_bugfix"
            ? 170
            : category === "refactor_30"
              ? 250
              : category === "refactor_100"
                ? 320
                : 140;
    const variance = Math.floor(random() * 40);
    const duration = durationBase + variance;
    const intermediateFailures = passed ? (random() < 0.85 ? 1 : 0) : 1;

    return {
      task,
      passed,
      durationSec: duration,
      timeToGreenSec: duration,
      retries: passed ? Math.floor(random() * 2) : 3,
      toolCalls: 8 + Math.floor(random() * 12),
      diffChurn: 20 + Math.floor(random() * 120),
      filesTouched:
        category === "refactor_30" ? 30 : category === "refactor_100" ? 100 : 8 + Math.floor(random() * 12),
      determinismScore: category === "replay_determinism" ? 0.92 + random() * 0.08 : undefined,
      replayMatched: category === "replay_determinism" ? random() > 0.06 : undefined,
      groundedEditRatio: 0.97 + random() * 0.03,
      artifactCompleteness: random() > 0.02 ? 1 : 0.98,
      fixLoopSucceeded: random() > 0.08,
      humanIntervention: random() > 0.96,
      failingTestsStart: 2,
      failingTestsEnd: 0,
      maxIntermediateFailingTests: intermediateFailures,
      indexFreshnessSmallMs: 120 + Math.floor(random() * 70),
      indexFreshnessBatchMs: 1200 + Math.floor(random() * 700),
      checkpointIntegrity: true,
      nonDestructive: random() > 0.002,
      prReadinessScore: 0.95 + random() * 0.05,
      reviewerPrecision: 0.9 + random() * 0.1,
      decisionLogCoverage: 0.9 + random() * 0.1,
      inlineSuggestionLatencyMs: 170 + Math.floor(random() * 70)
    } as BenchmarkResult;
  });
}
