import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendMetricsStore,
  buildTrendAlerts,
  evaluateRegressionGate,
  loadDefaultTaskCorpus,
  readMetricsStore,
  score,
  scoreRegressionBudget,
  simulateResults,
  validateTaskCorpus
} from "./index.js";

describe("benchmark", () => {
  it("provides a >=30 task corpus with required categories", () => {
    const corpus = loadDefaultTaskCorpus();
    const validation = validateTaskCorpus(corpus);
    expect(corpus.length).toBeGreaterThanOrEqual(30);
    expect(validation.valid).toBe(true);
  });

  it("scores simulated benchmark results and evaluates gates", () => {
    const results = simulateResults(loadDefaultTaskCorpus(), 42);
    const card = score(results, { runId: "test-run" });

    expect(card.total).toBe(results.length);
    expect(card.metrics.length).toBeGreaterThan(0);
    expect(card.kpis.length).toBeGreaterThan(5);

    const gate = evaluateRegressionGate(card);
    expect(typeof gate.pass).toBe("boolean");
  });

  it("scores regression budget violations", () => {
    const [task] = loadDefaultTaskCorpus();
    if (!task) {
      throw new Error("missing corpus task");
    }

    const report = scoreRegressionBudget([
      {
        task,
        passed: false,
        durationSec: 100,
        retries: 2,
        toolCalls: 8,
        diffChurn: 20,
        failingTestsStart: 3,
        failingTestsEnd: 1,
        maxIntermediateFailingTests: 2
      }
    ]);

    expect(report.applicable).toBe(1);
    expect(report.withinBudget).toBe(0);
    expect(report.violations.length).toBe(1);
  });

  it("writes and reads metric history and emits trend alerts", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atlas-benchmark-"));
    const path = join(dir, "metrics.jsonl");

    await appendMetricsStore(path, [
      {
        metric_name: "agent_task_completion_time",
        ts: "2026-02-18T00:00:00.000Z",
        value: 120,
        tags: { org: "o", repo: "r", branch: "b", run_id: "1" }
      },
      {
        metric_name: "agent_task_completion_time",
        ts: "2026-02-18T00:01:00.000Z",
        value: 130,
        tags: { org: "o", repo: "r", branch: "b", run_id: "2" }
      },
      {
        metric_name: "agent_task_completion_time",
        ts: "2026-02-18T00:02:00.000Z",
        value: 145,
        tags: { org: "o", repo: "r", branch: "b", run_id: "3" }
      },
      {
        metric_name: "agent_task_completion_time",
        ts: "2026-02-18T00:03:00.000Z",
        value: 190,
        tags: { org: "o", repo: "r", branch: "b", run_id: "4" }
      },
      {
        metric_name: "agent_task_completion_time",
        ts: "2026-02-18T00:04:00.000Z",
        value: 210,
        tags: { org: "o", repo: "r", branch: "b", run_id: "5" }
      },
      {
        metric_name: "agent_task_completion_time",
        ts: "2026-02-18T00:05:00.000Z",
        value: 220,
        tags: { org: "o", repo: "r", branch: "b", run_id: "6" }
      }
    ]);

    const records = await readMetricsStore(path);
    const alerts = buildTrendAlerts(records, { warningPercent: 0.1, criticalPercent: 0.2 });

    expect(records.length).toBe(6);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]?.severity).toMatch(/warning|critical/);
  });
});
