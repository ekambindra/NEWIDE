import { createHash, randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export type RefactorImpact = {
  file: string;
  totalMatches: number;
  declarationMatches: number;
  referenceMatches: number;
  collisionMatches: number;
  lines: number[];
};

export type RefactorCallGraphEdge = {
  file: string;
  from: string;
  to: string;
  line: number;
};

export type MultiFileRefactorRequest = {
  root: string;
  from: string;
  to: string;
  impacts: RefactorImpact[];
  previewOnly: boolean;
  allowSensitive: boolean;
  checkpointRoot: string;
  relatedEdges: RefactorCallGraphEdge[];
};

export type RefactorFileResult = {
  file: string;
  matches: number;
  declarationMatches: number;
  referenceMatches: number;
  collisionMatches: number;
  lines: number[];
  sensitive: boolean;
  beforeHash: string;
  afterHash: string;
};

export type MultiFileRefactorResult = {
  runId: string;
  status: "preview" | "applied" | "blocked" | "failed";
  from: string;
  to: string;
  previewOnly: boolean;
  allowSensitive: boolean;
  generatedAt: string;
  filesTouched: number;
  totalMatches: number;
  sensitiveTouched: number;
  blockedSensitive: string[];
  files: RefactorFileResult[];
  checkpointPath: string;
  grounding: {
    relatedEdges: RefactorCallGraphEdge[];
    edgeCount: number;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeLf(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function hash(value: string): string {
  return createHash("sha1").update(value).digest("hex");
}

function safeRegexLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !resolve(root, rel).startsWith(".."));
}

function sensitivePath(path: string): boolean {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  return (
    normalized.startsWith("infra/") ||
    normalized.includes("/security/") ||
    normalized.includes("/auth/") ||
    normalized.startsWith(".github/workflows/")
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function patchDiffFromFiles(files: RefactorFileResult[]): string {
  const lines: string[] = [];
  for (const file of files) {
    lines.push(`diff --git a/${file.file} b/${file.file}`);
    lines.push("--- a/" + file.file);
    lines.push("+++ b/" + file.file);
    lines.push(`@@ refactor @@`);
    lines.push(`-${file.beforeHash}`);
    lines.push(`+${file.afterHash}`);
  }
  return lines.join("\n");
}

export async function runMultiFileRefactor(
  request: MultiFileRefactorRequest
): Promise<MultiFileRefactorResult> {
  const from = request.from.trim();
  const to = request.to.trim();
  if (!from) {
    throw new Error("refactor source token is required");
  }
  if (!to) {
    throw new Error("refactor destination token is required");
  }
  if (from === to) {
    throw new Error("source and destination tokens must differ");
  }

  const regex = new RegExp(`\\b${safeRegexLiteral(from)}\\b`, "g");
  const generatedAt = nowIso();
  const runId = `refactor-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runRoot = join(request.checkpointRoot, runId);
  const stepRoot = join(runRoot, "step-1");

  const candidateFiles = request.impacts.filter((impact) => impact.totalMatches > 0);
  const blockedSensitive = request.allowSensitive
    ? []
    : candidateFiles.filter((impact) => sensitivePath(impact.file)).map((impact) => impact.file);

  if (!request.previewOnly && blockedSensitive.length > 0) {
    const blockedResult: MultiFileRefactorResult = {
      runId,
      status: "blocked",
      from,
      to,
      previewOnly: false,
      allowSensitive: request.allowSensitive,
      generatedAt,
      filesTouched: 0,
      totalMatches: 0,
      sensitiveTouched: blockedSensitive.length,
      blockedSensitive,
      files: [],
      checkpointPath: runRoot,
      grounding: {
        relatedEdges: request.relatedEdges.slice(0, 60),
        edgeCount: request.relatedEdges.length
      }
    };

    await writeJson(join(runRoot, "manifest.json"), {
      run_id: runId,
      task_type: "multi_file_refactor",
      repo_snapshot: "workspace",
      model: "desktop-refactor-engine",
      policy_version: "balanced-v1",
      started_at: generatedAt,
      ended_at: generatedAt,
      final_status: "blocked"
    });
    await writeJson(join(stepRoot, "plan.json"), {
      run_id: runId,
      step_id: "step-1",
      goal: `rename ${from} -> ${to}`,
      acceptance_criteria: ["sensitive paths require explicit approval"],
      risks: ["sensitive file touches"],
      policy_context: {
        mode: "balanced",
        preview_only: false,
        allow_sensitive: request.allowSensitive
      },
      deterministic_seed: hash(`${from}:${to}:blocked`)
    });
    await fs.writeFile(join(stepRoot, "patch.diff"), "\n", "utf8");
    await fs.writeFile(
      join(stepRoot, "tool_calls.jsonl"),
      `${JSON.stringify({
        id: randomUUID(),
        step_id: "step-1",
        tool: "refactor",
        args: { from, to, preview_only: false },
        started_at: generatedAt,
        ended_at: generatedAt,
        exit_code: null,
        status: "blocked",
        output_ref: null
      })}\n`,
      "utf8"
    );
    await writeJson(join(stepRoot, "results.json"), {
      status: "blocked",
      checks: { lint: "skip", typecheck: "skip", test: "skip", build: "skip" },
      failures: [`sensitive files require approval: ${blockedSensitive.join(", ")}`],
      metrics: {
        candidate_files: candidateFiles.length,
        blocked_sensitive: blockedSensitive.length
      },
      next_action: "approval"
    });
    await writeJson(join(runRoot, "refactor_report.json"), blockedResult);
    return blockedResult;
  }

  const files: RefactorFileResult[] = [];
  for (const impact of candidateFiles) {
    const absolute = resolve(request.root, impact.file);
    if (!isWithin(request.root, absolute) || !existsSync(absolute)) {
      continue;
    }
    const before = await fs.readFile(absolute, "utf8");
    const normalizedBefore = normalizeLf(before);
    const replaced = normalizedBefore.replace(regex, to);
    const matches = normalizedBefore.match(regex)?.length ?? 0;
    if (matches === 0) {
      continue;
    }
    if (!request.previewOnly) {
      await fs.writeFile(absolute, `${replaced}\n`.replace(/\n\n$/, "\n"), "utf8");
    }
    files.push({
      file: impact.file,
      matches,
      declarationMatches: impact.declarationMatches,
      referenceMatches: impact.referenceMatches,
      collisionMatches: impact.collisionMatches,
      lines: impact.lines.slice(0, 40),
      sensitive: sensitivePath(impact.file),
      beforeHash: hash(normalizedBefore),
      afterHash: hash(replaced)
    });
  }

  const totalMatches = files.reduce((sum, file) => sum + file.matches, 0);
  const sensitiveTouched = files.filter((file) => file.sensitive).length;
  const status: MultiFileRefactorResult["status"] = request.previewOnly ? "preview" : "applied";
  const result: MultiFileRefactorResult = {
    runId,
    status,
    from,
    to,
    previewOnly: request.previewOnly,
    allowSensitive: request.allowSensitive,
    generatedAt,
    filesTouched: files.length,
    totalMatches,
    sensitiveTouched,
    blockedSensitive,
    files,
    checkpointPath: runRoot,
    grounding: {
      relatedEdges: request.relatedEdges.slice(0, 60),
      edgeCount: request.relatedEdges.length
    }
  };

  await writeJson(join(runRoot, "manifest.json"), {
    run_id: runId,
    task_type: "multi_file_refactor",
    repo_snapshot: "workspace",
    model: "desktop-refactor-engine",
    policy_version: "balanced-v1",
    started_at: generatedAt,
    ended_at: generatedAt,
    final_status: status === "applied" || status === "preview" ? "success" : "failed"
  });
  await writeJson(join(stepRoot, "plan.json"), {
    run_id: runId,
    step_id: "step-1",
    goal: `rename ${from} -> ${to} across files`,
    acceptance_criteria: [
      "matched files identified",
      request.previewOnly ? "preview prepared" : "changes written"
    ],
    risks: ["collision with existing symbol name", "sensitive path updates"],
    policy_context: {
      mode: "balanced",
      preview_only: request.previewOnly,
      allow_sensitive: request.allowSensitive
    },
    deterministic_seed: hash(`${from}:${to}:${request.previewOnly ? "preview" : "apply"}`)
  });
  await fs.writeFile(join(stepRoot, "patch.diff"), `${patchDiffFromFiles(files)}\n`, "utf8");
  await fs.writeFile(
    join(stepRoot, "tool_calls.jsonl"),
    `${JSON.stringify({
      id: randomUUID(),
      step_id: "step-1",
      tool: "refactor",
      args: {
        from,
        to,
        preview_only: request.previewOnly,
        files: files.length
      },
      started_at: generatedAt,
      ended_at: generatedAt,
      exit_code: 0,
      status: "success",
      output_ref: null
    })}\n`,
    "utf8"
  );
  await writeJson(join(stepRoot, "results.json"), {
    status: "success",
    checks: { lint: "skip", typecheck: "skip", test: "skip", build: "skip" },
    failures: [],
    metrics: {
      files_touched: files.length,
      total_matches: totalMatches,
      sensitive_touched: sensitiveTouched,
      related_edges: request.relatedEdges.length
    },
    next_action: request.previewOnly ? "apply" : null
  });
  await writeJson(join(runRoot, "refactor_report.json"), result);
  return result;
}
