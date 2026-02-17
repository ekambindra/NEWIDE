import type { BenchmarkTask, MetricRecord } from "@ide/shared";

export type BenchmarkResult = {
  task: BenchmarkTask;
  passed: boolean;
  durationSec: number;
  retries: number;
  toolCalls: number;
  diffChurn: number;
};

export type ScoreCard = {
  total: number;
  passRate: number;
  avgDuration: number;
  avgRetries: number;
  avgToolCalls: number;
  avgDiffChurn: number;
  metrics: MetricRecord[];
};

export function score(results: BenchmarkResult[]): ScoreCard {
  if (results.length === 0) {
    return {
      total: 0,
      passRate: 0,
      avgDuration: 0,
      avgRetries: 0,
      avgToolCalls: 0,
      avgDiffChurn: 0,
      metrics: []
    };
  }

  const total = results.length;
  const passCount = results.filter((r) => r.passed).length;
  const aggregate = results.reduce(
    (acc, cur) => {
      acc.duration += cur.durationSec;
      acc.retries += cur.retries;
      acc.toolCalls += cur.toolCalls;
      acc.diffChurn += cur.diffChurn;
      return acc;
    },
    { duration: 0, retries: 0, toolCalls: 0, diffChurn: 0 }
  );

  const scoreCard: ScoreCard = {
    total,
    passRate: passCount / total,
    avgDuration: aggregate.duration / total,
    avgRetries: aggregate.retries / total,
    avgToolCalls: aggregate.toolCalls / total,
    avgDiffChurn: aggregate.diffChurn / total,
    metrics: []
  };

  scoreCard.metrics.push(
    metric("green_pipeline_guarantee_rate", scoreCard.passRate),
    metric("agent_task_completion_time", scoreCard.avgDuration),
    metric("tool_calls_per_task", scoreCard.avgToolCalls),
    metric("diff_churn", scoreCard.avgDiffChurn)
  );

  return scoreCard;
}

function metric(name: string, value: number): MetricRecord {
  return {
    metric_name: name,
    ts: new Date().toISOString(),
    value,
    tags: {
      org: "local",
      repo: "workspace",
      branch: "main",
      run_id: "benchmark"
    }
  };
}
