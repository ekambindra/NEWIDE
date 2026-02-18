import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type PolicyConfig,
  type StepPlan,
  type StepResult,
  type ToolCall,
  defaultBalancedPolicy
} from "@ide/shared";
import { evaluateCommand } from "@ide/policy-engine";

export type RuntimeTool = {
  name: string;
  run: (args: Record<string, unknown>) => Promise<{ exitCode: number; outputRef?: string }>;
};

export type RuntimeConfig = {
  checkpointRoot: string;
  policy?: PolicyConfig;
  model: string;
  maxRetries?: number;
};

export type TaskRequest = {
  taskType: string;
  goal: string;
  acceptanceCriteria: string[];
  requirements?: Record<string, unknown>;
};

export type AgentProfile = {
  id: string;
  focus: string;
};

export type MultiAgentTaskRequest = {
  goal: string;
  acceptanceCriteria: string[];
  agents: AgentProfile[];
};

export type RunSummary = {
  runId: string;
  status: "success" | "failed" | "blocked";
  steps: number;
};

export type RunCheckpoint = {
  runId: string;
  startedAt: string;
  endedAt: string | null;
  status: "running" | "success" | "failed" | "blocked";
  taskType: string;
};

export type MultiAgentSummary = {
  coordinatorRunId: string;
  overallStatus: "success" | "failed";
  agentRuns: Array<RunSummary & { agentId: string; focus: string }>;
};

type ApprovalPrompt = {
  id: string;
  category: string;
  target: string;
  reason: string;
  approved: boolean;
};

function nowIso(): string {
  return new Date().toISOString();
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function hashObject(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeApprovalPrompts(requirements?: Record<string, unknown>): ApprovalPrompt[] {
  const raw = requirements?.highRiskActions;
  if (!Array.isArray(raw)) {
    return [];
  }

  const prompts: ApprovalPrompt[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const target = item.trim();
      if (!target) continue;
      prompts.push({
        id: randomUUID(),
        category: "custom",
        target,
        reason: "high-risk action requires explicit approval",
        approved: false
      });
      continue;
    }

    if (!item || typeof item !== "object") {
      continue;
    }
    const action = item as {
      category?: unknown;
      target?: unknown;
      reason?: unknown;
      approved?: unknown;
    };
    const target = typeof action.target === "string" ? action.target.trim() : "";
    if (!target) {
      continue;
    }
    prompts.push({
      id: randomUUID(),
      category:
        typeof action.category === "string" && action.category.trim()
          ? action.category.trim()
          : "custom",
      target,
      reason:
        typeof action.reason === "string" && action.reason.trim()
          ? action.reason.trim()
          : "high-risk action requires explicit approval",
      approved: action.approved === true
    });
  }

  return prompts;
}

function approvalStats(prompts: ApprovalPrompt[]): {
  required: number;
  granted: number;
  pending: number;
} {
  const required = prompts.length;
  const granted = prompts.filter((prompt) => prompt.approved).length;
  return {
    required,
    granted,
    pending: Math.max(0, required - granted)
  };
}

async function writeFinalizationArtifacts(input: {
  runRoot: string;
  runId: string;
  status: "success" | "failed" | "blocked";
  summary: string;
  risks: string[];
  rollback: string;
  checks: StepResult["checks"];
  steps: number;
  toolCalls: number;
  attempts: number;
  approvals: ApprovalPrompt[];
}): Promise<void> {
  const generatedAt = nowIso();
  await writeJson(join(input.runRoot, "finalization.json"), {
    run_id: input.runId,
    status: input.status,
    summary: input.summary,
    risks: input.risks,
    rollback: input.rollback,
    generated_at: generatedAt
  });

  const approvals = approvalStats(input.approvals);
  await writeJson(join(input.runRoot, "finalization_bundle.json"), {
    run_id: input.runId,
    status: input.status,
    summary: input.summary,
    risks: input.risks,
    rollback: input.rollback,
    approvals: {
      ...approvals,
      prompts: input.approvals.map((prompt) => ({
        id: prompt.id,
        category: prompt.category,
        target: prompt.target,
        reason: prompt.reason
      }))
    },
    evidence: {
      steps: input.steps,
      tool_calls: input.toolCalls,
      attempts: input.attempts,
      checks: input.checks
    },
    generated_at: generatedAt
  });
}

export class AgentRuntime {
  private readonly tools = new Map<string, RuntimeTool>();
  private readonly policy: PolicyConfig;
  private readonly maxRetries: number;

  constructor(private readonly config: RuntimeConfig) {
    this.policy = config.policy ?? defaultBalancedPolicy;
    this.maxRetries = config.maxRetries ?? 3;
  }

  registerTool(tool: RuntimeTool): void {
    this.tools.set(tool.name, tool);
  }

  async runTask(task: TaskRequest): Promise<RunSummary> {
    const runId = randomUUID();
    const runRoot = join(this.config.checkpointRoot, runId);
    const deterministicSeed = createHash("sha1").update(task.goal).digest("hex");

    const manifest = {
      run_id: runId,
      task_type: task.taskType,
      repo_snapshot: "working-tree",
      model: this.config.model,
      policy_version: "balanced-v1",
      started_at: nowIso(),
      ended_at: null,
      final_status: "running" as const
    };

    await writeJson(join(runRoot, "manifest.json"), manifest);
    await writeJson(join(runRoot, "requirements.json"), {
      goal: task.goal,
      task_type: task.taskType,
      acceptance_criteria: task.acceptanceCriteria,
      requirements: task.requirements ?? {},
      generated_at: nowIso()
    });

    const stepId = "step-1";
    const stepRoot = join(runRoot, stepId);

    const plan: StepPlan = {
      run_id: runId,
      step_id: stepId,
      goal: task.goal,
      acceptance_criteria: task.acceptanceCriteria,
      risks: ["tool failure", "policy rejection"],
      policy_context: { mode: "balanced" },
      deterministic_seed: deterministicSeed
    };

    await writeJson(join(stepRoot, "plan.json"), plan);
    const approvalPrompts = normalizeApprovalPrompts(task.requirements);
    if (approvalPrompts.length > 0) {
      await writeJson(join(stepRoot, "approval_prompts.json"), approvalPrompts);
    }

    const pendingApprovals = approvalPrompts.filter((prompt) => !prompt.approved);
    if (pendingApprovals.length > 0) {
      const blocked: StepResult = {
        status: "blocked",
        checks: { lint: "skip", typecheck: "skip", test: "skip", build: "skip" },
        failures: pendingApprovals.map(
          (prompt) => `[${prompt.category}] ${prompt.target}: ${prompt.reason}`
        ),
        metrics: {
          required_approvals: pendingApprovals.length
        },
        next_action: "approval-required"
      };
      await writeJson(join(stepRoot, "results.json"), blocked);
      await writeFile(join(stepRoot, "patch.diff"), "", "utf8");
      await writeFile(join(stepRoot, "tool_calls.jsonl"), "", "utf8");
      await writeFinalizationArtifacts({
        runRoot,
        runId,
        status: "blocked",
        summary: "run blocked pending high-risk approvals",
        risks: pendingApprovals.map((prompt) => prompt.reason),
        rollback: "no edits applied",
        checks: blocked.checks,
        steps: 1,
        toolCalls: 0,
        attempts: 0,
        approvals: approvalPrompts
      });
      await this.finalizeManifest(runRoot, "blocked");
      return { runId, status: "blocked", steps: 1 };
    }

    const tool = this.tools.get("echo");
    if (!tool) {
      const failed: StepResult = {
        status: "failed",
        checks: { lint: "skip", typecheck: "skip", test: "skip", build: "skip" },
        failures: ["missing tool: echo"],
        metrics: {},
        next_action: null
      };
      await writeJson(join(stepRoot, "results.json"), failed);
      await writeFile(join(stepRoot, "patch.diff"), "", "utf8");
      await writeFile(join(stepRoot, "tool_calls.jsonl"), "", "utf8");
      await writeFinalizationArtifacts({
        runRoot,
        runId,
        status: "failed",
        summary: "run failed before execution",
        risks: ["missing required tool"],
        rollback: "no rollback required",
        checks: failed.checks,
        steps: 1,
        toolCalls: 0,
        attempts: 0,
        approvals: approvalPrompts
      });
      await this.finalizeManifest(runRoot, "failed");
      return { runId, status: "failed", steps: 1 };
    }

    const command = "node echo";
    const gate = evaluateCommand(this.policy, command);
    if (gate.decision !== "allow") {
      const blocked: StepResult = {
        status: "blocked",
        checks: { lint: "skip", typecheck: "skip", test: "skip", build: "skip" },
        failures: [gate.reason],
        metrics: {},
        next_action: "request approval"
      };
      await writeJson(join(stepRoot, "results.json"), blocked);
      await writeFile(join(stepRoot, "patch.diff"), "", "utf8");
      await writeFile(join(stepRoot, "tool_calls.jsonl"), "", "utf8");
      await writeFinalizationArtifacts({
        runRoot,
        runId,
        status: "blocked",
        summary: "run blocked by policy",
        risks: [gate.reason],
        rollback: "no edits applied",
        checks: blocked.checks,
        steps: 1,
        toolCalls: 0,
        attempts: 0,
        approvals: approvalPrompts
      });
      await this.finalizeManifest(runRoot, "blocked");
      return { runId, status: "blocked", steps: 1 };
    }

    let attempt = 0;
    let succeeded = false;
    let lastFailure: string | null = null;
    const toolCalls: ToolCall[] = [];

    while (attempt < this.maxRetries && !succeeded) {
      attempt += 1;
      const callId = randomUUID();
      const started = nowIso();
      try {
        const result = await tool.run({ goal: task.goal, attempt });
        const ended = nowIso();
        toolCalls.push({
          id: callId,
          step_id: stepId,
          tool: tool.name,
          args: { goal: task.goal, attempt },
          started_at: started,
          ended_at: ended,
          exit_code: result.exitCode,
          status: result.exitCode === 0 ? "success" : "error",
          output_ref: result.outputRef ?? null
        });
        succeeded = result.exitCode === 0;
        if (!succeeded) {
          lastFailure = `attempt ${attempt} failed`;
        }
      } catch (error) {
        const ended = nowIso();
        toolCalls.push({
          id: callId,
          step_id: stepId,
          tool: tool.name,
          args: { goal: task.goal, attempt },
          started_at: started,
          ended_at: ended,
          exit_code: 1,
          status: "error",
          output_ref: null
        });
        lastFailure = error instanceof Error ? error.message : "unknown tool failure";
      }
    }

    await writeFile(
      join(stepRoot, "tool_calls.jsonl"),
      `${toolCalls.map((call) => JSON.stringify(call)).join("\n")}\n`,
      "utf8"
    );

    const patchDiff = [
      "diff --git a/checkpoints/placeholder.txt b/checkpoints/placeholder.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/checkpoints/placeholder.txt",
      "@@ -0,0 +1 @@",
      `+run ${runId} deterministic ${deterministicSeed}`
    ].join("\n");
    await writeFile(join(stepRoot, "patch.diff"), `${patchDiff}\n`, "utf8");

    const result: StepResult = {
      status: succeeded ? "success" : "failed",
      checks: {
        lint: "skip",
        typecheck: "skip",
        test: "skip",
        build: "skip"
      },
      failures: succeeded ? [] : [lastFailure ?? "unknown failure"],
      metrics: {
        attempts: attempt,
        tool_calls: toolCalls.length,
        deterministic_hash_length: deterministicSeed.length
      },
      next_action: succeeded ? null : "repair"
    };

    await writeJson(join(stepRoot, "results.json"), result);

    const stepHash = hashObject({ plan, toolCalls, result, patchDiff });
    await writeJson(join(stepRoot, "integrity.json"), {
      step_id: stepId,
      hash: stepHash,
      previous_hash: null
    });

    await writeFinalizationArtifacts({
      runRoot,
      runId,
      status: succeeded ? "success" : "failed",
      summary: succeeded ? "task completed successfully" : "task failed after bounded retries",
      risks: succeeded ? [] : [lastFailure ?? "unknown failure"],
      rollback: "restore from previous checkpoint or revert patch.diff",
      checks: result.checks,
      steps: 1,
      toolCalls: toolCalls.length,
      attempts: attempt,
      approvals: approvalPrompts
    });

    await this.finalizeManifest(runRoot, succeeded ? "success" : "failed");

    return {
      runId,
      status: succeeded ? "success" : "failed",
      steps: 1
    };
  }

  async compareRuns(leftRunRoot: string, rightRunRoot: string): Promise<{ determinismScore: number; diffDelta: number; toolCallDelta: number }> {
    const left = await readFile(join(leftRunRoot, "step-1", "tool_calls.jsonl"), "utf8");
    const right = await readFile(join(rightRunRoot, "step-1", "tool_calls.jsonl"), "utf8");

    const leftLines = left.trim().split("\n").filter(Boolean);
    const rightLines = right.trim().split("\n").filter(Boolean);

    const toolCallDelta = Math.abs(leftLines.length - rightLines.length);

    const leftDiff = await readFile(join(leftRunRoot, "step-1", "patch.diff"), "utf8");
    const rightDiff = await readFile(join(rightRunRoot, "step-1", "patch.diff"), "utf8");
    const diffDelta = leftDiff === rightDiff ? 0 : 1;

    const determinismScore = diffDelta === 0 && toolCallDelta === 0 ? 1 : Math.max(0, 1 - (diffDelta + toolCallDelta) * 0.2);

    return {
      determinismScore,
      diffDelta,
      toolCallDelta
    };
  }

  async runMultiAgentTask(task: MultiAgentTaskRequest): Promise<MultiAgentSummary> {
    if (task.agents.length === 0) {
      throw new Error("at least one agent profile is required");
    }

    const coordinatorRunId = `multi-${randomUUID()}`;
    const coordinatorRoot = join(this.config.checkpointRoot, coordinatorRunId);
    await mkdir(coordinatorRoot, { recursive: true });
    await writeJson(join(coordinatorRoot, "requirements.json"), {
      mode: "multi_agent",
      goal: task.goal,
      acceptance_criteria: task.acceptanceCriteria,
      agents: task.agents,
      created_at: nowIso()
    });

    const runs = await Promise.all(
      task.agents.map(async (agent, index) => {
        const scopedGoal = `${task.goal}\n[agent ${agent.id}] focus: ${agent.focus}`;
        const result = await this.runTask({
          taskType: "multi_agent_subtask",
          goal: scopedGoal,
          acceptanceCriteria: task.acceptanceCriteria,
          requirements: {
            agent_id: agent.id,
            focus: agent.focus,
            sequence: index + 1,
            coordinator: coordinatorRunId
          }
        });
        return {
          ...result,
          agentId: agent.id,
          focus: agent.focus
        };
      })
    );

    const failed = runs.some((run) => run.status !== "success");
    const summary: MultiAgentSummary = {
      coordinatorRunId,
      overallStatus: failed ? "failed" : "success",
      agentRuns: runs
    };

    await writeJson(join(coordinatorRoot, "coordination.json"), summary);
    await writeJson(join(coordinatorRoot, "finalization.json"), {
      coordinator_run_id: coordinatorRunId,
      overall_status: summary.overallStatus,
      successful_agents: runs.filter((run) => run.status === "success").length,
      failed_agents: runs.filter((run) => run.status !== "success").length,
      generated_at: nowIso()
    });
    await writeJson(join(coordinatorRoot, "finalization_bundle.json"), {
      coordinator_run_id: coordinatorRunId,
      overall_status: summary.overallStatus,
      summary: summary.overallStatus === "success"
        ? "all agents completed successfully"
        : "one or more agents failed",
      risks: summary.overallStatus === "success"
        ? []
        : ["agent subtask failure detected"],
      rollback: "revert impacted agent run checkpoints",
      approvals: {
        required: 0,
        granted: 0,
        pending: 0,
        prompts: []
      },
      evidence: {
        agents: runs.length,
        successful_agents: runs.filter((run) => run.status === "success").length,
        failed_agents: runs.filter((run) => run.status !== "success").length
      },
      generated_at: nowIso()
    });

    return summary;
  }

  async listRuns(): Promise<RunCheckpoint[]> {
    await mkdir(this.config.checkpointRoot, { recursive: true });
    const entries = await readdir(this.config.checkpointRoot, { withFileTypes: true });
    const runs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const checkpoints: RunCheckpoint[] = [];

    for (const runId of runs) {
      const manifestPath = join(this.config.checkpointRoot, runId, "manifest.json");
      try {
        const manifestRaw = await readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestRaw) as {
          run_id: string;
          started_at: string;
          ended_at: string | null;
          final_status: "running" | "success" | "failed" | "blocked";
          task_type: string;
        };
        checkpoints.push({
          runId: manifest.run_id,
          startedAt: manifest.started_at,
          endedAt: manifest.ended_at,
          status: manifest.final_status,
          taskType: manifest.task_type
        });
      } catch {
        continue;
      }
    }

    return checkpoints.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  async resumeRun(runId: string): Promise<RunSummary> {
    const manifestPath = join(this.config.checkpointRoot, runId, "manifest.json");
    const manifestRaw = await readFile(manifestPath, "utf8");
    const manifest = JSON.parse(manifestRaw) as {
      final_status: "running" | "success" | "failed" | "blocked";
    };
    return {
      runId,
      status: manifest.final_status === "running" ? "failed" : manifest.final_status,
      steps: 1
    };
  }

  async rollbackRun(runId: string, reason: string): Promise<{ ok: true; runId: string }> {
    const rollbackPath = join(this.config.checkpointRoot, runId, "rollback.json");
    await writeJson(rollbackPath, {
      run_id: runId,
      requested_at: nowIso(),
      reason
    });
    return { ok: true, runId };
  }

  private async finalizeManifest(runRoot: string, status: "success" | "failed" | "blocked"): Promise<void> {
    const filePath = join(runRoot, "manifest.json");
    const manifestRaw = await readFile(filePath, "utf8");
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    manifest.final_status = status;
    manifest.ended_at = nowIso();
    await writeJson(filePath, manifest);
  }
}
