import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  existsSync,
  promises as fs,
  statSync,
  watch,
  type FSWatcher
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain } from "electron";
import ignore from "ignore";
import { AgentRuntime } from "@ide/agent-runtime";

const execFileAsync = promisify(execFile);

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  gitStatus?: string;
};

type ReadFileResult = {
  path: string;
  content: string | null;
  binary: boolean;
  truncated: boolean;
  size: number;
};

type PolicyResult = {
  decision: "allow" | "deny" | "require_approval";
  reason: string;
};

type TerminalResult = {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  policy: PolicyResult;
  artifactPath: string | null;
};

type AuditEvent = {
  event_id: string;
  ts: string;
  actor: string;
  action: string;
  target: string;
  decision: "allow" | "deny" | "require_approval" | "executed" | "error";
  reason: string;
  metadata: Record<string, unknown>;
  previous_checksum: string;
  checksum: string;
};

type TeamMemoryEntry = {
  id: string;
  ts: string;
  title: string;
  content: string;
  tags: string[];
};

type DecisionLogEntry = {
  decision_id: string;
  ts: string;
  title: string;
  context: string;
  options: string[];
  chosen: string;
  consequences: string[];
  related_files: string[];
};

type ReviewerFinding = {
  id: string;
  file: string;
  line: number;
  title: string;
  body: string;
  severity: "low" | "medium" | "high";
  confidence: number;
};

const watchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>();
const MAX_FILE_BYTES = 1024 * 1024 * 2;

function nowIso(): string {
  return new Date().toISOString();
}

function runtimeDataRoot(): string {
  return join(app.getPath("userData"), "enterprise-ai-ide");
}

function checkpointsRoot(): string {
  return join(runtimeDataRoot(), "checkpoints");
}

function auditFilePath(): string {
  return join(runtimeDataRoot(), "audit", "events.jsonl");
}

function teamMemoryPath(): string {
  return join(runtimeDataRoot(), "team", "memory.json");
}

function decisionLogPath(): string {
  return join(runtimeDataRoot(), "team", "decisions.json");
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !resolve(root, rel).startsWith(".."));
}

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function commandPolicy(command: string): PolicyResult {
  if (/rm\s+-rf/.test(command) || /:\(\)\s*\{/.test(command)) {
    return { decision: "deny", reason: "destructive command blocked" };
  }
  if (/curl|wget|npm\s+install|pnpm\s+add|yarn\s+add/.test(command)) {
    return {
      decision: "require_approval",
      reason: "network or dependency action requires approval"
    };
  }
  return { decision: "allow", reason: "allowed by balanced policy" };
}

async function appendAuditEvent(input: {
  actor?: string;
  action: string;
  target: string;
  decision: AuditEvent["decision"];
  reason: string;
  metadata?: Record<string, unknown>;
}): Promise<AuditEvent> {
  const file = auditFilePath();
  await fs.mkdir(dirname(file), { recursive: true });

  let previousChecksum = "root";
  if (existsSync(file)) {
    const raw = await fs.readFile(file, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1];
    if (last) {
      try {
        const parsed = JSON.parse(last) as { checksum?: string };
        if (parsed.checksum) {
          previousChecksum = parsed.checksum;
        }
      } catch {
        previousChecksum = "root";
      }
    }
  }

  const base = {
    event_id: randomUUID(),
    ts: nowIso(),
    actor: input.actor ?? "desktop-user",
    action: input.action,
    target: input.target,
    decision: input.decision,
    reason: input.reason,
    metadata: input.metadata ?? {}
  };

  const checksum = createHash("sha256")
    .update(previousChecksum)
    .update(JSON.stringify(base))
    .digest("hex");

  const event: AuditEvent = {
    ...base,
    previous_checksum: previousChecksum,
    checksum
  };

  await fs.appendFile(file, `${JSON.stringify(event)}\n`, "utf8");
  return event;
}

async function readRecentAudit(limit: number): Promise<AuditEvent[]> {
  const file = auditFilePath();
  if (!existsSync(file)) {
    return [];
  }
  const raw = await fs.readFile(file, "utf8");
  const lines = raw.trim().split("\n").filter(Boolean);
  return lines
    .slice(Math.max(0, lines.length - limit))
    .map((line) => {
      try {
        return JSON.parse(line) as AuditEvent;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is AuditEvent => entry !== null)
    .reverse();
}

async function exportAudit(): Promise<{ path: string; count: number }> {
  const file = auditFilePath();
  await fs.mkdir(join(runtimeDataRoot(), "exports"), { recursive: true });
  const targetPath = join(runtimeDataRoot(), "exports", `audit-${Date.now()}.jsonl`);
  if (!existsSync(file)) {
    await fs.writeFile(targetPath, "", "utf8");
    return { path: targetPath, count: 0 };
  }
  const content = await fs.readFile(file, "utf8");
  await fs.writeFile(targetPath, content, "utf8");
  const count = content.trim() ? content.trim().split("\n").length : 0;
  return { path: targetPath, count };
}

async function readJsonArray<T>(path: string): Promise<T[]> {
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed as T[];
  } catch {
    return [];
  }
}

async function writeJsonArray<T>(path: string, value: T[]): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function listTeamMemory(): Promise<TeamMemoryEntry[]> {
  const entries = await readJsonArray<TeamMemoryEntry>(teamMemoryPath());
  return entries.sort((a, b) => b.ts.localeCompare(a.ts));
}

async function addTeamMemory(input: {
  title: string;
  content: string;
  tags: string[];
}): Promise<TeamMemoryEntry> {
  const entries = await readJsonArray<TeamMemoryEntry>(teamMemoryPath());
  const next: TeamMemoryEntry = {
    id: randomUUID(),
    ts: nowIso(),
    title: input.title.trim(),
    content: input.content.trim(),
    tags: input.tags
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 12)
  };
  entries.unshift(next);
  await writeJsonArray(teamMemoryPath(), entries.slice(0, 400));
  return next;
}

async function listDecisionLogs(): Promise<DecisionLogEntry[]> {
  const entries = await readJsonArray<DecisionLogEntry>(decisionLogPath());
  return entries.sort((a, b) => b.ts.localeCompare(a.ts));
}

async function addDecisionLog(input: {
  title: string;
  context: string;
  options: string[];
  chosen: string;
  consequences: string[];
  relatedFiles: string[];
}): Promise<DecisionLogEntry> {
  const entries = await readJsonArray<DecisionLogEntry>(decisionLogPath());
  const next: DecisionLogEntry = {
    decision_id: randomUUID(),
    ts: nowIso(),
    title: input.title.trim(),
    context: input.context.trim(),
    options: input.options.map((option) => option.trim()).filter(Boolean),
    chosen: input.chosen.trim(),
    consequences: input.consequences
      .map((consequence) => consequence.trim())
      .filter(Boolean),
    related_files: input.relatedFiles.map((file) => file.trim()).filter(Boolean)
  };
  entries.unshift(next);
  await writeJsonArray(decisionLogPath(), entries.slice(0, 300));
  return next;
}

async function runReviewerMode(
  workspaceRoot: string,
  onlyFiles: string[] = []
): Promise<ReviewerFinding[]> {
  const allowed = new Set(onlyFiles.filter(Boolean));
  const findings: ReviewerFinding[] = [];
  const seen = new Set<string>();

  const addMatches = async (args: {
    pattern: string;
    title: string;
    body: string;
    severity: ReviewerFinding["severity"];
    confidence: number;
  }): Promise<void> => {
    try {
      const { stdout } = await execFileAsync("rg", [
        "--line-number",
        "--no-heading",
        args.pattern,
        workspaceRoot
      ]);
      for (const line of stdout.split("\n").filter(Boolean)) {
        const first = line.indexOf(":");
        const second = line.indexOf(":", first + 1);
        if (first === -1 || second === -1) {
          continue;
        }
        const file = relative(workspaceRoot, line.slice(0, first));
        if (allowed.size > 0 && !allowed.has(file)) {
          continue;
        }
        const lineNum = Number(line.slice(first + 1, second));
        const key = `${file}:${lineNum}:${args.title}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        findings.push({
          id: randomUUID(),
          file,
          line: lineNum,
          title: args.title,
          body: `${args.body} Matched snippet: ${line.slice(second + 1).trim().slice(0, 140)}`,
          severity: args.severity,
          confidence: args.confidence
        });
      }
    } catch (error) {
      const maybe = error as { code?: number };
      if (maybe.code === 1) {
        return;
      }
      throw error;
    }
  };

  await addMatches({
    pattern: "\\bTODO\\b|\\bFIXME\\b",
    title: "Unresolved TODO/FIXME",
    body: "Open TODO/FIXME markers can hide incomplete behavior and should be resolved or tracked.",
    severity: "medium",
    confidence: 0.78
  });
  await addMatches({
    pattern: "\\bany\\b",
    title: "Potential type-safety gap",
    body: "Use of `any` may reduce static guarantees; consider narrowing with explicit types.",
    severity: "medium",
    confidence: 0.72
  });
  await addMatches({
    pattern: "console\\.log\\(",
    title: "Debug logging in code path",
    body: "Console logging may leak sensitive context or create noisy runtime output.",
    severity: "low",
    confidence: 0.66
  });
  await addMatches({
    pattern: "@ts-ignore|eslint-disable",
    title: "Suppressed static checks",
    body: "Suppression directives should include justification and be periodically removed.",
    severity: "high",
    confidence: 0.81
  });

  return findings
    .sort((a, b) => {
      const severityRank: Record<ReviewerFinding["severity"], number> = {
        high: 3,
        medium: 2,
        low: 1
      };
      return severityRank[b.severity] - severityRank[a.severity] || a.file.localeCompare(b.file);
    })
    .slice(0, 80);
}

async function loadGitIgnore(root: string): Promise<ReturnType<typeof ignore>> {
  const ig = ignore();
  ig.add([".git", "node_modules", "dist", "coverage", "checkpoints"]);
  const gitIgnorePath = join(root, ".gitignore");
  if (existsSync(gitIgnorePath)) {
    const body = await fs.readFile(gitIgnorePath, "utf8");
    ig.add(body.split("\n"));
  }
  return ig;
}

async function listTree(root: string): Promise<TreeNode[]> {
  const ig = await loadGitIgnore(root);
  const statuses = await getGitStatuses(root);

  async function walk(current: string): Promise<TreeNode[]> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    const nodes: TreeNode[] = [];

    for (const entry of entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))) {
      const absolutePath = join(current, entry.name);
      const relPath = relative(root, absolutePath);
      if (!relPath) {
        continue;
      }
      if (ig.ignores(relPath)) {
        continue;
      }

      if (entry.isDirectory()) {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "directory",
          children: await walk(absolutePath),
          gitStatus: statuses.get(relPath)
        });
      } else {
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "file",
          gitStatus: statuses.get(relPath)
        });
      }
    }

    return nodes;
  }

  return walk(root);
}

function detectBinary(buffer: Buffer): boolean {
  for (let i = 0; i < Math.min(buffer.length, 8000); i += 1) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

async function safeRead(root: string, relPath: string): Promise<ReadFileResult> {
  const absolute = resolve(root, relPath);
  if (!isWithin(root, absolute)) {
    throw new Error("path traversal denied");
  }

  const stats = statSync(absolute);
  const fileSize = stats.size;
  const truncated = fileSize > MAX_FILE_BYTES;
  const raw = await fs.readFile(absolute);
  const slice = truncated ? raw.subarray(0, MAX_FILE_BYTES) : raw;

  if (detectBinary(slice)) {
    return {
      path: relPath,
      content: null,
      binary: true,
      truncated,
      size: fileSize
    };
  }

  return {
    path: relPath,
    content: slice.toString("utf8"),
    binary: false,
    truncated,
    size: fileSize
  };
}

async function safeWrite(root: string, relPath: string, content: string): Promise<void> {
  const absolute = resolve(root, relPath);
  if (!isWithin(root, absolute)) {
    throw new Error("path traversal denied");
  }

  await fs.mkdir(resolve(absolute, ".."), { recursive: true });
  await fs.writeFile(absolute, normalizeLf(content), "utf8");
}

async function searchProject(root: string, query: string): Promise<Array<{ file: string; line: number; text: string }>> {
  if (!query.trim()) {
    return [];
  }
  const { stdout } = await execFileAsync("rg", ["--line-number", "--no-heading", query, root]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const first = line.indexOf(":");
      const second = line.indexOf(":", first + 1);
      if (first === -1 || second === -1) {
        return null;
      }
      return {
        file: relative(root, line.slice(0, first)),
        line: Number(line.slice(first + 1, second)),
        text: line.slice(second + 1)
      };
    })
    .filter((item): item is { file: string; line: number; text: string } => item !== null);
}

async function getGitStatuses(root: string): Promise<Map<string, string>> {
  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd: root });
    const map = new Map<string, string>();
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const status = line.slice(0, 2).trim() || "??";
      const file = line.slice(3).trim();
      map.set(file, status);
    }
    return map;
  } catch {
    return new Map();
  }
}

function startWatcher(root: string, win: BrowserWindow): void {
  stopWatcher(root);

  let timer: NodeJS.Timeout | null = null;
  const watcher = watch(root, { recursive: process.platform !== "linux" }, (_eventType, filename) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      win.webContents.send("workspace:changed", {
        root,
        path: filename ?? "",
        ts: Date.now()
      });
    }, 175);
  });

  watchers.set(root, { watcher, timer });
}

function stopWatcher(root: string): void {
  const running = watchers.get(root);
  if (!running) {
    return;
  }
  if (running.timer) {
    clearTimeout(running.timer);
  }
  running.watcher.close();
  watchers.delete(root);
}

async function executeCommand(root: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("zsh", ["-lc", command], {
      cwd: root,
      timeout: 120000,
      maxBuffer: 2 * 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout,
      stderr
    };
  } catch (error) {
    const anyErr = error as { stdout?: string; stderr?: string; code?: number };
    return {
      exitCode: anyErr.code ?? 1,
      stdout: anyErr.stdout ?? "",
      stderr: anyErr.stderr ?? ""
    };
  }
}

async function writeTerminalCheckpoint(command: string, result: { exitCode: number | null; stdout: string; stderr: string; policy: PolicyResult }): Promise<string> {
  const runId = `terminal-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runRoot = join(checkpointsRoot(), runId);
  const stepRoot = join(runRoot, "step-1");
  await fs.mkdir(stepRoot, { recursive: true });

  const startedAt = nowIso();

  await fs.writeFile(
    join(runRoot, "manifest.json"),
    `${JSON.stringify(
      {
        run_id: runId,
        task_type: "terminal_command",
        repo_snapshot: "workspace",
        model: "local-shell",
        policy_version: "balanced-v1",
        started_at: startedAt,
        ended_at: nowIso(),
        final_status: result.exitCode === 0 ? "success" : result.exitCode === null ? "blocked" : "failed"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(
    join(stepRoot, "plan.json"),
    `${JSON.stringify(
      {
        run_id: runId,
        step_id: "step-1",
        goal: `execute terminal command ${command}`,
        acceptance_criteria: ["capture output", "enforce policy"],
        risks: ["command failure"],
        policy_context: result.policy,
        deterministic_seed: createHash("sha1").update(command).digest("hex")
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const toolCall = {
    id: randomUUID(),
    step_id: "step-1",
    tool: "terminal",
    args: { command },
    started_at: startedAt,
    ended_at: nowIso(),
    exit_code: result.exitCode,
    status:
      result.exitCode === 0
        ? "success"
        : result.exitCode === null
          ? "blocked"
          : "error",
    output_ref: null
  };

  await fs.writeFile(join(stepRoot, "tool_calls.jsonl"), `${JSON.stringify(toolCall)}\n`, "utf8");

  await fs.writeFile(
    join(stepRoot, "results.json"),
    `${JSON.stringify(
      {
        status: result.exitCode === 0 ? "success" : result.exitCode === null ? "blocked" : "failed",
        checks: { lint: "skip", typecheck: "skip", test: "skip", build: "skip" },
        failures: result.exitCode === 0 ? [] : [result.stderr || result.policy.reason],
        metrics: {
          stdout_length: result.stdout.length,
          stderr_length: result.stderr.length
        },
        next_action: result.exitCode === null ? "approval" : null
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await fs.writeFile(join(stepRoot, "patch.diff"), "\n", "utf8");

  return runRoot;
}

async function listCheckpoints(): Promise<Array<{ runId: string; path: string }>> {
  const root = checkpointsRoot();
  if (!existsSync(root)) {
    return [];
  }
  const runs = await fs.readdir(root, { withFileTypes: true });
  return runs
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({ runId: entry.name, path: join(root, entry.name) }))
    .sort((a, b) => b.runId.localeCompare(a.runId));
}

async function readCheckpointDetail(runId: string): Promise<{
  runId: string;
  path: string;
  manifest: Record<string, unknown> | null;
  steps: Array<{ stepId: string; files: string[]; preview: Record<string, string> }>;
}> {
  const runPath = join(checkpointsRoot(), runId);
  const manifestPath = join(runPath, "manifest.json");
  const manifest = existsSync(manifestPath)
    ? (JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>)
    : null;

  const entries = existsSync(runPath) ? await fs.readdir(runPath, { withFileTypes: true }) : [];
  const steps = [] as Array<{ stepId: string; files: string[]; preview: Record<string, string> }>;

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith("step-")) {
      continue;
    }
    const stepPath = join(runPath, entry.name);
    const files = await fs.readdir(stepPath);
    const preview: Record<string, string> = {};
    for (const file of files) {
      const full = join(stepPath, file);
      const content = await fs.readFile(full, "utf8");
      preview[file] = content.slice(0, 400);
    }
    steps.push({ stepId: entry.name, files, preview });
  }

  return { runId, path: runPath, manifest, steps };
}

async function replayTerminal(limit: number): Promise<Array<{ runId: string; command: string; status: string; output: string }>> {
  const checkpoints = await listCheckpoints();
  const terminalRuns = checkpoints.filter((entry) => entry.runId.startsWith("terminal-"));
  const replays: Array<{ runId: string; command: string; status: string; output: string }> = [];

  for (const run of terminalRuns.slice(0, limit)) {
    const manifestPath = join(run.path, "manifest.json");
    const toolPath = join(run.path, "step-1", "tool_calls.jsonl");
    const resultPath = join(run.path, "step-1", "results.json");
    if (!existsSync(manifestPath) || !existsSync(toolPath) || !existsSync(resultPath)) {
      continue;
    }

    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { final_status?: string };
    const toolRaw = await fs.readFile(toolPath, "utf8");
    const firstCall = toolRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { args?: { command?: string } })[0];
    const resultsRaw = await fs.readFile(resultPath, "utf8");
    const parsedResult = JSON.parse(resultsRaw) as { failures?: string[]; metrics?: { stdout_length?: number } };

    replays.push({
      runId: run.runId,
      command: firstCall?.args?.command ?? "unknown",
      status: manifest.final_status ?? "unknown",
      output: `stdout_len=${parsedResult.metrics?.stdout_length ?? 0} failures=${(parsedResult.failures ?? []).join(";")}`
    });
  }

  return replays;
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1150,
    minHeight: 700,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: join(app.getAppPath(), "dist/main/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
  } else {
    await win.loadFile(join(app.getAppPath(), "dist/renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  await fs.mkdir(checkpointsRoot(), { recursive: true });

  const runtime = new AgentRuntime({
    checkpointRoot: checkpointsRoot(),
    model: "desktop-local-agent"
  });

  runtime.registerTool({
    name: "echo",
    run: async (args) => {
      const artifactDir = join(runtimeDataRoot(), "agent-outputs");
      await fs.mkdir(artifactDir, { recursive: true });
      const outputRef = join(artifactDir, `${Date.now()}-${randomUUID().slice(0, 6)}.json`);
      await fs.writeFile(outputRef, `${JSON.stringify(args, null, 2)}\n`, "utf8");
      return {
        exitCode: 0,
        outputRef
      };
    }
  });

  ipcMain.handle("workspace:open", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    await appendAuditEvent({
      action: "workspace.open",
      target: result.filePaths[0] ?? "",
      decision: "executed",
      reason: "workspace opened"
    });
    return result.filePaths[0] ?? null;
  });

  ipcMain.handle("workspace:tree", async (_event, root: string) => {
    return listTree(root);
  });

  ipcMain.handle("workspace:watch:start", async (event, root: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return false;
    }
    startWatcher(root, win);
    return true;
  });

  ipcMain.handle("workspace:watch:stop", async (_event, root: string) => {
    stopWatcher(root);
    return true;
  });

  ipcMain.handle("file:read", async (_event, root: string, relPath: string) => {
    return safeRead(root, relPath);
  });

  ipcMain.handle("file:write", async (_event, root: string, relPath: string, content: string) => {
    await safeWrite(root, relPath, content);
    await appendAuditEvent({
      action: "file.write",
      target: relPath,
      decision: "executed",
      reason: "file write",
      metadata: { root, length: content.length }
    });
    return { ok: true };
  });

  ipcMain.handle("file:create", async (_event, root: string, relPath: string, isDirectory: boolean) => {
    const absolute = resolve(root, relPath);
    if (!isWithin(root, absolute)) {
      throw new Error("path traversal denied");
    }
    if (isDirectory) {
      await fs.mkdir(absolute, { recursive: true });
    } else {
      await fs.mkdir(resolve(absolute, ".."), { recursive: true });
      await fs.writeFile(absolute, "", "utf8");
    }
    await appendAuditEvent({
      action: "file.create",
      target: relPath,
      decision: "executed",
      reason: isDirectory ? "directory created" : "file created",
      metadata: { root }
    });
    return { ok: true };
  });

  ipcMain.handle("file:rename", async (_event, root: string, fromPath: string, toPath: string) => {
    const fromAbs = resolve(root, fromPath);
    const toAbs = resolve(root, toPath);
    if (!isWithin(root, fromAbs) || !isWithin(root, toAbs)) {
      throw new Error("path traversal denied");
    }
    await fs.mkdir(resolve(toAbs, ".."), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    await appendAuditEvent({
      action: "file.rename",
      target: `${fromPath} -> ${toPath}`,
      decision: "executed",
      reason: "path renamed",
      metadata: { root }
    });
    return { ok: true };
  });

  ipcMain.handle("file:delete", async (_event, root: string, relPath: string) => {
    const absolute = resolve(root, relPath);
    if (!isWithin(root, absolute)) {
      throw new Error("path traversal denied");
    }
    await fs.rm(absolute, { recursive: true, force: true });
    await appendAuditEvent({
      action: "file.delete",
      target: relPath,
      decision: "executed",
      reason: "path deleted",
      metadata: { root }
    });
    return { ok: true };
  });

  ipcMain.handle("search:project", async (_event, root: string, query: string) => {
    return searchProject(root, query);
  });

  ipcMain.handle("git:status", async (_event, root: string) => {
    const map = await getGitStatuses(root);
    return [...map.entries()].map(([file, status]) => ({ file, status }));
  });

  ipcMain.handle("terminal:run", async (_event, root: string, command: string): Promise<TerminalResult> => {
    const policy = commandPolicy(command);

    if (policy.decision === "deny") {
      await appendAuditEvent({
        action: "terminal.run",
        target: command,
        decision: "deny",
        reason: policy.reason,
        metadata: { root }
      });
      const artifactPath = await writeTerminalCheckpoint(command, {
        exitCode: 1,
        stdout: "",
        stderr: policy.reason,
        policy
      });
      return {
        id: randomUUID(),
        command,
        exitCode: 1,
        stdout: "",
        stderr: policy.reason,
        policy,
        artifactPath
      };
    }

    if (policy.decision === "require_approval") {
      await appendAuditEvent({
        action: "terminal.run",
        target: command,
        decision: "require_approval",
        reason: policy.reason,
        metadata: { root }
      });
      const artifactPath = await writeTerminalCheckpoint(command, {
        exitCode: null,
        stdout: "",
        stderr: policy.reason,
        policy
      });
      return {
        id: randomUUID(),
        command,
        exitCode: null,
        stdout: "",
        stderr: policy.reason,
        policy,
        artifactPath
      };
    }

    const run = await executeCommand(root, command);
    const artifactPath = await writeTerminalCheckpoint(command, {
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      policy
    });

    await appendAuditEvent({
      action: "terminal.run",
      target: command,
      decision: run.exitCode === 0 ? "executed" : "error",
      reason: run.exitCode === 0 ? "command succeeded" : "command failed",
      metadata: { root, exitCode: run.exitCode, artifactPath }
    });

    return {
      id: randomUUID(),
      command,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      policy,
      artifactPath
    };
  });

  ipcMain.handle("terminal:run-approved", async (_event, root: string, command: string): Promise<TerminalResult> => {
    const policy = commandPolicy(command);
    if (policy.decision === "deny") {
      await appendAuditEvent({
        action: "terminal.approved_run",
        target: command,
        decision: "deny",
        reason: "command denied even after approval request",
        metadata: { root }
      });
      return {
        id: randomUUID(),
        command,
        exitCode: 1,
        stdout: "",
        stderr: "command remains denied by policy",
        policy,
        artifactPath: null
      };
    }

    const run = await executeCommand(root, command);
    const artifactPath = await writeTerminalCheckpoint(command, {
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      policy: { decision: "allow", reason: "approved by user" }
    });
    await appendAuditEvent({
      action: "terminal.approved_run",
      target: command,
      decision: run.exitCode === 0 ? "executed" : "error",
      reason: "command executed via approval flow",
      metadata: { root, artifactPath, exitCode: run.exitCode }
    });

    return {
      id: randomUUID(),
      command,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      policy: { decision: "allow", reason: "approved by user" },
      artifactPath
    };
  });

  ipcMain.handle("terminal:replay", async (_event, limit = 20) => {
    return replayTerminal(Math.max(1, Math.min(200, Number(limit) || 20)));
  });

  ipcMain.handle(
    "agent:run-multi",
    async (
      _event,
      payload: { goal: string; acceptanceCriteria: string[]; agentCount: number }
    ) => {
      const count = Math.max(2, Math.min(8, Number(payload.agentCount) || 3));
      const profiles = Array.from({ length: count }).map((_, index) => ({
        id: `agent-${index + 1}`,
        focus:
          index === 0
            ? "planning and contracts"
            : index === count - 1
              ? "testing and risk review"
              : "implementation and integration"
      }));

      const result = await runtime.runMultiAgentTask({
        goal: payload.goal,
        acceptanceCriteria: payload.acceptanceCriteria,
        agents: profiles
      });

      await appendAuditEvent({
        action: "agent.multi_run",
        target: payload.goal,
        decision: result.overallStatus === "success" ? "executed" : "error",
        reason: `multi-agent run with ${profiles.length} agents`,
        metadata: {
          coordinator: result.coordinatorRunId,
          statuses: result.agentRuns.map((run) => ({ id: run.agentId, status: run.status }))
        }
      });

      return result;
    }
  );

  ipcMain.handle("checkpoints:list", async () => {
    return listCheckpoints();
  });

  ipcMain.handle("checkpoints:detail", async (_event, runId: string) => {
    return readCheckpointDetail(runId);
  });

  ipcMain.handle("audit:recent", async (_event, limit = 40) => {
    return readRecentAudit(Math.max(1, Math.min(500, Number(limit) || 40)));
  });

  ipcMain.handle("audit:export", async () => {
    return exportAudit();
  });

  ipcMain.handle("team:memory:list", async () => {
    return listTeamMemory();
  });

  ipcMain.handle(
    "team:memory:add",
    async (
      _event,
      payload: { title: string; content: string; tags: string[] }
    ) => {
      const entry = await addTeamMemory(payload);
      await appendAuditEvent({
        action: "team.memory.add",
        target: entry.title,
        decision: "executed",
        reason: "memory entry added",
        metadata: { id: entry.id, tags: entry.tags }
      });
      return entry;
    }
  );

  ipcMain.handle("team:decision:list", async () => {
    return listDecisionLogs();
  });

  ipcMain.handle(
    "team:decision:add",
    async (
      _event,
      payload: {
        title: string;
        context: string;
        options: string[];
        chosen: string;
        consequences: string[];
        relatedFiles: string[];
      }
    ) => {
      const entry = await addDecisionLog(payload);
      await appendAuditEvent({
        action: "team.decision.add",
        target: entry.title,
        decision: "executed",
        reason: "decision log created",
        metadata: { id: entry.decision_id, files: entry.related_files }
      });
      return entry;
    }
  );

  ipcMain.handle(
    "team:review:run",
    async (
      _event,
      payload: { root: string; files?: string[] }
    ) => {
      const findings = await runReviewerMode(payload.root, payload.files ?? []);
      await appendAuditEvent({
        action: "team.review.run",
        target: payload.root,
        decision: "executed",
        reason: "reviewer mode executed",
        metadata: { findings: findings.length }
      });
      return findings;
    }
  );

  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const root of watchers.keys()) {
    stopWatcher(root);
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});
