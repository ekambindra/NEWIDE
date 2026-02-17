import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentRuntime } from "./index.js";

describe("agent runtime", () => {
  it("writes checkpoint artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-"));
    const runtime = new AgentRuntime({ checkpointRoot: root, model: "local-test" });

    runtime.registerTool({
      name: "echo",
      run: async () => ({ exitCode: 0 })
    });

    const summary = await runtime.runTask({
      taskType: "task",
      goal: "create artifacts",
      acceptanceCriteria: ["writes plan"],
      requirements: { language: "typescript" }
    });

    expect(summary.status).toBe("success");

    const planPath = join(root, summary.runId, "step-1", "plan.json");
    const plan = await readFile(planPath, "utf8");
    expect(plan.includes("create artifacts")).toBe(true);

    const requirementsPath = join(root, summary.runId, "requirements.json");
    const requirements = await readFile(requirementsPath, "utf8");
    expect(requirements.includes("typescript")).toBe(true);

    const finalizationPath = join(root, summary.runId, "finalization.json");
    const finalization = await readFile(finalizationPath, "utf8");
    expect(finalization.includes("task completed successfully")).toBe(true);

    const runs = await runtime.listRuns();
    expect(runs.some((run) => run.runId === summary.runId)).toBe(true);

    const resumed = await runtime.resumeRun(summary.runId);
    expect(resumed.runId).toBe(summary.runId);

    const rollback = await runtime.rollbackRun(summary.runId, "test rollback");
    expect(rollback.ok).toBe(true);
  });

  it("runs multiple agents concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "runtime-multi-"));
    const runtime = new AgentRuntime({ checkpointRoot: root, model: "local-test" });

    runtime.registerTool({
      name: "echo",
      run: async () => ({ exitCode: 0 })
    });

    const summary = await runtime.runMultiAgentTask({
      goal: "Build a feature in parallel",
      acceptanceCriteria: ["tests pass", "docs updated"],
      agents: [
        { id: "planner", focus: "plan + schema updates" },
        { id: "implementer", focus: "code changes" },
        { id: "reviewer", focus: "validation and edge cases" }
      ]
    });

    expect(summary.agentRuns).toHaveLength(3);
    expect(summary.overallStatus).toBe("success");
    expect(summary.coordinatorRunId.startsWith("multi-")).toBe(true);
  });
});
