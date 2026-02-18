import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
import ts from "typescript";
import {
  detectCommandRisk,
  parseTestOutput,
  type CommandRiskAssessment,
  type ParsedTestSummary
} from "./terminal-utils.js";

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
  highRisk: CommandRiskAssessment | null;
  parsedTest: ParsedTestSummary | null;
  artifactPath: string | null;
};

type CheckStatus = "pass" | "fail" | "skip";
type PipelineStageName = "lint" | "typecheck" | "test" | "build";

type PipelineStageResult = {
  stage: PipelineStageName;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  status: "pass" | "fail" | "skip" | "blocked";
  policy: PolicyResult;
  highRisk: CommandRiskAssessment | null;
  parsedTest: ParsedTestSummary | null;
};

type PipelineRunResult = {
  id: string;
  status: "success" | "failed" | "blocked";
  checks: {
    lint: CheckStatus;
    typecheck: CheckStatus;
    test: CheckStatus;
    build: CheckStatus;
  };
  stages: PipelineStageResult[];
  blockedStage: PipelineStageName | null;
  artifactPath: string | null;
};

type TerminalSessionState = "running" | "exited" | "failed" | "stopped";

type TerminalSession = {
  id: string;
  root: string;
  command: string;
  process: ChildProcessWithoutNullStreams;
  buffer: string[];
  status: TerminalSessionState;
  exitCode: number | null;
  startedAt: string;
  endedAt: string | null;
};

type TerminalSessionStartResult = {
  sessionId: string | null;
  status: TerminalSessionState | "blocked" | "denied";
  policy: PolicyResult;
  highRisk: CommandRiskAssessment | null;
  reason: string;
};

type TerminalSessionSnapshot = {
  sessionId: string;
  status: TerminalSessionState;
  exitCode: number | null;
  output: string;
  startedAt: string;
  endedAt: string | null;
};

type DiffApplyResult = {
  ok: boolean;
  conflict: boolean;
  checkpointId: string | null;
  reason: string | null;
};

type DiffPatchManifest = {
  version: number;
  checkpointId: string;
  createdAt: string;
  root: string;
  path: string;
  baseHash: string;
  afterHash: string;
  appliedChunks: string[];
  payloadHash: string;
  keyId: string;
  signature: string;
};

type DiffCheckpointRecord = {
  id: string;
  createdAt: string;
  root: string;
  path: string;
  baseHash: string;
  beforeContent: string;
  afterContent: string;
  appliedChunks: string[];
  keyId: string;
  manifestPath: string;
  signature: string;
  signatureValid?: boolean;
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

type OwnershipMatch = {
  file: string;
  owners: string[];
  matchedPattern: string | null;
};

type OwnershipConflictReport = {
  fileConflicts: Array<{
    file: string;
    agents: string[];
    owners: string[];
  }>;
  ownerConflicts: Array<{
    owner: string;
    agents: string[];
    files: string[];
  }>;
};

type ChangelogDraft = {
  range: string;
  generatedAt: string;
  sections: Array<{ title: string; items: string[] }>;
  markdown: string;
};

type ReleaseNotesDraft = {
  version: string;
  generatedAt: string;
  markdown: string;
};

const watchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null }>();
const terminalSessions = new Map<string, TerminalSession>();
const MAX_FILE_BYTES = 1024 * 1024 * 2;

function nowIso(): string {
  return new Date().toISOString();
}

function runtimeDataRoot(): string {
  return join(app.getPath("userData"), "atlas-meridian");
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

function diffCheckpointRoot(): string {
  return join(runtimeDataRoot(), "diff-checkpoints");
}

function patchSigningKeyPath(): string {
  return join(runtimeDataRoot(), "security", "patch-signing.key");
}

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !resolve(root, rel).startsWith(".."));
}

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

let cachedPatchSigningSecret: string | null = null;

async function getPatchSigningSecret(): Promise<string> {
  if (cachedPatchSigningSecret) {
    return cachedPatchSigningSecret;
  }
  const file = patchSigningKeyPath();
  await fs.mkdir(dirname(file), { recursive: true });
  if (existsSync(file)) {
    cachedPatchSigningSecret = (await fs.readFile(file, "utf8")).trim();
    if (cachedPatchSigningSecret) {
      return cachedPatchSigningSecret;
    }
  }
  cachedPatchSigningSecret = randomBytes(32).toString("hex");
  await fs.writeFile(file, `${cachedPatchSigningSecret}\n`, "utf8");
  return cachedPatchSigningSecret;
}

function patchManifestPath(checkpointId: string): string {
  return join(diffCheckpointRoot(), `${checkpointId}.manifest.json`);
}

function canonicalManifestPayload(manifest: Omit<DiffPatchManifest, "payloadHash" | "keyId" | "signature">): string {
  return JSON.stringify({
    version: manifest.version,
    checkpointId: manifest.checkpointId,
    createdAt: manifest.createdAt,
    root: manifest.root,
    path: manifest.path,
    baseHash: manifest.baseHash,
    afterHash: manifest.afterHash,
    appliedChunks: manifest.appliedChunks
  });
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

function defaultPipelineCommands(): Record<PipelineStageName, string> {
  return {
    lint: "npm run lint",
    typecheck: "npm run typecheck",
    test: "npm run test",
    build: "npm run build"
  };
}

function emptyChecks(): {
  lint: CheckStatus;
  typecheck: CheckStatus;
  test: CheckStatus;
  build: CheckStatus;
} {
  return {
    lint: "skip",
    typecheck: "skip",
    test: "skip",
    build: "skip"
  };
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

async function searchTeamMemory(input: {
  query: string;
  tags: string[];
  limit: number;
}): Promise<Array<TeamMemoryEntry & { score: number }>> {
  const entries = await listTeamMemory();
  const queryTokens = input.query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const tagFilters = input.tags.map((tag) => tag.toLowerCase().trim()).filter(Boolean);

  const scored = entries
    .map((entry) => {
      const haystack = `${entry.title} ${entry.content}`.toLowerCase();
      const tags = entry.tags.map((tag) => tag.toLowerCase());

      let score = 0;
      for (const token of queryTokens) {
        if (entry.title.toLowerCase().includes(token)) {
          score += 4;
        } else if (haystack.includes(token)) {
          score += 2;
        }
      }
      for (const tag of tagFilters) {
        if (tags.includes(tag)) {
          score += 5;
        }
      }
      if (queryTokens.length === 0 && tagFilters.length === 0) {
        score = 1;
      }
      return { ...entry, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.ts.localeCompare(a.ts));

  return scored.slice(0, Math.max(1, Math.min(input.limit, 200)));
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
  const isReviewableFile = (file: string): boolean => {
    const normalized = normalizeRepoPath(file);
    if (
      normalized.includes("/node_modules/") ||
      normalized.includes("/dist/") ||
      normalized.includes("/coverage/") ||
      normalized.includes("/checkpoints/")
    ) {
      return false;
    }
    return /\.(ts|tsx|js|jsx|mts|cts)$/i.test(normalized);
  };

  const explicitFiles = onlyFiles
    .map((file) => normalizeRepoPath(file))
    .filter(Boolean)
    .filter(isReviewableFile);

  let filesToReview: string[] = [];
  if (explicitFiles.length > 0) {
    filesToReview = explicitFiles;
  } else {
    try {
      const { stdout } = await execFileAsync("rg", ["--files"], { cwd: workspaceRoot });
      filesToReview = stdout
        .split("\n")
        .filter(Boolean)
        .map((file) => normalizeRepoPath(file))
        .filter(isReviewableFile)
        .slice(0, 300);
    } catch {
      filesToReview = [];
    }
  }

  const findings: ReviewerFinding[] = [];
  const seen = new Set<string>();

  const addFinding = (finding: ReviewerFinding): void => {
    const key = `${finding.file}:${finding.line}:${finding.title}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    findings.push(finding);
  };

  const severityRank: Record<ReviewerFinding["severity"], number> = {
    high: 3,
    medium: 2,
    low: 1
  };

  for (const relFile of filesToReview) {
    const absPath = resolve(workspaceRoot, relFile);
    if (!existsSync(absPath)) {
      continue;
    }
    const source = await fs.readFile(absPath, "utf8");
    const lines = source.split("\n");
    const indexToLine = (index: number): number => source.slice(0, Math.max(0, index)).split("\n").length;
    const isTestFile = /(^|\/)(__tests__|tests?)\/|(\.|_)(test|spec)\.[tj]sx?$/i.test(relFile);

    const suppressionPattern = /@ts-ignore|eslint-disable/g;
    for (const match of source.matchAll(suppressionPattern)) {
      addFinding({
        id: randomUUID(),
        file: relFile,
        line: indexToLine(match.index ?? 0),
        title: "Suppressed static checks",
        body: "Suppression directives should include justification and an expiration cleanup plan.",
        severity: "high",
        confidence: 0.85
      });
    }

    const todoPattern = /\bTODO\b|\bFIXME\b/g;
    for (const match of source.matchAll(todoPattern)) {
      const line = indexToLine(match.index ?? 0);
      const snippet = lines[line - 1]?.trim() ?? "";
      addFinding({
        id: randomUUID(),
        file: relFile,
        line,
        title: "Unresolved TODO/FIXME",
        body: `TODO/FIXME markers usually indicate incomplete behavior. Snippet: ${snippet.slice(0, 140)}`,
        severity: "medium",
        confidence: 0.79
      });
    }

    const kind =
      relFile.endsWith(".tsx") ? ts.ScriptKind.TSX
      : relFile.endsWith(".ts") ? ts.ScriptKind.TS
      : relFile.endsWith(".jsx") ? ts.ScriptKind.JSX
      : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(absPath, source, ts.ScriptTarget.Latest, true, kind);

    const walk = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword && !relFile.endsWith(".d.ts")) {
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const snippet = lines[line - 1]?.trim() ?? "";
        addFinding({
          id: randomUUID(),
          file: relFile,
          line,
          title: "Potential type-safety gap",
          body: `Use of \`any\` reduces static guarantees. Prefer explicit unions or narrowed interfaces. Snippet: ${snippet.slice(0, 140)}`,
          severity: "medium",
          confidence: 0.77
        });
      }

      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        if (
          ts.isPropertyAccessExpression(expression) &&
          expression.expression.getText(sourceFile) === "console" &&
          ["log", "debug", "info"].includes(expression.name.getText(sourceFile))
        ) {
          if (!isTestFile) {
            const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
            const snippet = lines[line - 1]?.trim() ?? "";
            addFinding({
              id: randomUUID(),
              file: relFile,
              line,
              title: "Debug logging in runtime path",
              body: `Debug logging can leak context or create noisy production logs. Snippet: ${snippet.slice(0, 140)}`,
              severity: "low",
              confidence: 0.7
            });
          }
        }

        if (
          ts.isIdentifier(expression) &&
          (expression.text === "eval" || expression.text === "Function")
        ) {
          const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
          addFinding({
            id: randomUUID(),
            file: relFile,
            line,
            title: "Dynamic code execution",
            body: "Avoid `eval`/`Function` in application code; use explicit parsing/execution paths.",
            severity: "high",
            confidence: 0.86
          });
        }
      }

      ts.forEachChild(node, walk);
    };

    walk(sourceFile);
  }

  return findings
    .sort((a, b) => {
      if (severityRank[b.severity] !== severityRank[a.severity]) {
        return severityRank[b.severity] - severityRank[a.severity];
      }
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      return a.file.localeCompare(b.file) || a.line - b.line;
    })
    .slice(0, 120);
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function globToRegex(pattern: string): RegExp {
  const normalized = pattern
    .trim()
    .replace(/^\/+/, "")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "::DOUBLE_STAR::")
    .replace(/\*/g, "[^/]*")
    .replace(/::DOUBLE_STAR::/g, ".*")
    .replace(/\?/g, ".");

  if (!pattern.includes("/")) {
    return new RegExp(`(^|.*/)${normalized}$`);
  }
  if (pattern.endsWith("/")) {
    return new RegExp(`^${normalized}.*$`);
  }
  return new RegExp(`^${normalized}$`);
}

async function parseCodeowners(root: string): Promise<Array<{ pattern: string; owners: string[]; regex: RegExp }>> {
  const candidatePaths = [
    join(root, ".github", "CODEOWNERS"),
    join(root, "CODEOWNERS"),
    join(root, "docs", "CODEOWNERS")
  ];
  let sourcePath: string | null = null;
  for (const path of candidatePaths) {
    if (existsSync(path)) {
      sourcePath = path;
      break;
    }
  }
  if (!sourcePath) {
    return [];
  }

  const body = await fs.readFile(sourcePath, "utf8");
  const entries: Array<{ pattern: string; owners: string[]; regex: RegExp }> = [];
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const tokens = trimmed.split(/\s+/);
    const pattern = tokens[0] ?? "";
    const owners = tokens.slice(1).filter(Boolean);
    if (!pattern || owners.length === 0) {
      continue;
    }
    entries.push({
      pattern,
      owners,
      regex: globToRegex(pattern)
    });
  }
  return entries;
}

async function mapOwnership(root: string, files: string[]): Promise<OwnershipMatch[]> {
  const entries = await parseCodeowners(root);
  return files.map((file) => {
    const normalized = normalizeRepoPath(file);
    let owners: string[] = [];
    let matchedPattern: string | null = null;
    for (const entry of entries) {
      if (entry.regex.test(normalized)) {
        owners = entry.owners;
        matchedPattern = entry.pattern;
      }
    }
    return {
      file: normalized,
      owners,
      matchedPattern
    };
  });
}

async function detectOwnershipConflicts(
  root: string,
  assignments: Array<{ agentId: string; files: string[] }>
): Promise<OwnershipConflictReport> {
  const fileAgentMap = new Map<string, Set<string>>();
  const allFiles: string[] = [];
  for (const assignment of assignments) {
    for (const rawFile of assignment.files) {
      const file = normalizeRepoPath(rawFile);
      if (!file) continue;
      allFiles.push(file);
      if (!fileAgentMap.has(file)) {
        fileAgentMap.set(file, new Set());
      }
      fileAgentMap.get(file)?.add(assignment.agentId);
    }
  }

  const ownership = await mapOwnership(root, [...new Set(allFiles)]);
  const ownershipByFile = new Map(ownership.map((entry) => [entry.file, entry]));

  const fileConflicts: OwnershipConflictReport["fileConflicts"] = [];
  for (const [file, agentsSet] of fileAgentMap.entries()) {
    const agents = [...agentsSet];
    if (agents.length > 1) {
      fileConflicts.push({
        file,
        agents,
        owners: ownershipByFile.get(file)?.owners ?? []
      });
    }
  }

  const ownerToAgents = new Map<string, Set<string>>();
  const ownerToFiles = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    for (const rawFile of assignment.files) {
      const file = normalizeRepoPath(rawFile);
      if (!file) continue;
      const owners = ownershipByFile.get(file)?.owners ?? [];
      for (const owner of owners) {
        if (!ownerToAgents.has(owner)) {
          ownerToAgents.set(owner, new Set());
          ownerToFiles.set(owner, new Set());
        }
        ownerToAgents.get(owner)?.add(assignment.agentId);
        ownerToFiles.get(owner)?.add(file);
      }
    }
  }

  const ownerConflicts: OwnershipConflictReport["ownerConflicts"] = [];
  for (const [owner, agentsSet] of ownerToAgents.entries()) {
    const agents = [...agentsSet];
    if (agents.length > 1) {
      ownerConflicts.push({
        owner,
        agents,
        files: [...(ownerToFiles.get(owner) ?? new Set())]
      });
    }
  }

  return {
    fileConflicts: fileConflicts.sort((a, b) => b.agents.length - a.agents.length),
    ownerConflicts: ownerConflicts.sort((a, b) => b.agents.length - a.agents.length)
  };
}

async function generateChangelogDraft(root: string, sinceRef?: string): Promise<ChangelogDraft> {
  const range = sinceRef?.trim() ? `${sinceRef.trim()}..HEAD` : "HEAD~40..HEAD";
  const args = ["log", "--pretty=format:%h|%s", range];
  let stdout = "";
  try {
    const result = await execFileAsync("git", args, { cwd: root });
    stdout = result.stdout;
  } catch (error) {
    const anyErr = error as { stdout?: string; stderr?: string };
    stdout = anyErr.stdout ?? "";
    if (!stdout) {
      throw new Error(anyErr.stderr ?? "unable to generate changelog");
    }
  }

  const categoryMap: Record<string, string> = {
    feat: "Features",
    fix: "Fixes",
    docs: "Documentation",
    refactor: "Refactors",
    perf: "Performance",
    test: "Tests",
    chore: "Chores"
  };
  const sectionBuckets = new Map<string, string[]>();
  const otherKey = "Other";

  for (const line of stdout.split("\n").filter(Boolean)) {
    const separator = line.indexOf("|");
    if (separator === -1) {
      continue;
    }
    const hash = line.slice(0, separator);
    const subject = line.slice(separator + 1).trim();
    const conventional = subject.match(/^([a-zA-Z]+)(\([^)]+\))?:\s*(.+)$/);
    const rawType = conventional?.[1]?.toLowerCase();
    const section = (rawType && categoryMap[rawType]) || otherKey;
    const message = conventional?.[3] ?? subject;
    const list = sectionBuckets.get(section) ?? [];
    list.push(`- ${message} (${hash})`);
    sectionBuckets.set(section, list);
  }

  const sections = [...sectionBuckets.entries()].map(([title, items]) => ({ title, items }));
  sections.sort((a, b) => {
    if (a.title === otherKey) return 1;
    if (b.title === otherKey) return -1;
    return a.title.localeCompare(b.title);
  });

  const markdownLines = [`# Changelog Draft`, "", `Range: \`${range}\``, ""];
  for (const section of sections) {
    markdownLines.push(`## ${section.title}`);
    markdownLines.push(...section.items);
    markdownLines.push("");
  }
  if (sections.length === 0) {
    markdownLines.push("No commits found for the selected range.");
  }

  return {
    range,
    generatedAt: nowIso(),
    sections,
    markdown: markdownLines.join("\n")
  };
}

async function generateReleaseNotesDraft(
  root: string,
  version: string,
  highlights: string[]
): Promise<ReleaseNotesDraft> {
  const changelog = await generateChangelogDraft(root);
  const notes: string[] = [];
  notes.push(`# Atlas Meridian ${version}`);
  notes.push(`Release date: ${new Date().toISOString().slice(0, 10)}`);
  notes.push("");
  notes.push("## Highlights");
  const cleanHighlights = highlights.map((item) => item.trim()).filter(Boolean);
  if (cleanHighlights.length === 0) {
    notes.push("- Stability, performance, and workflow improvements.");
  } else {
    for (const item of cleanHighlights) {
      notes.push(`- ${item}`);
    }
  }
  notes.push("");
  notes.push("## Changes");
  for (const section of changelog.sections) {
    notes.push(`### ${section.title}`);
    notes.push(...section.items.slice(0, 12));
    notes.push("");
  }
  if (changelog.sections.length === 0) {
    notes.push("- No changelog entries available.");
  }

  return {
    version,
    generatedAt: nowIso(),
    markdown: notes.join("\n")
  };
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

function evaluateTerminalPolicy(command: string): {
  policy: PolicyResult;
  highRisk: CommandRiskAssessment;
} {
  const highRisk = detectCommandRisk(command);
  let policy = commandPolicy(command);
  if (policy.decision === "allow" && highRisk.requiresApproval) {
    policy = {
      decision: "require_approval",
      reason: highRisk.prompt ?? "high-risk command requires approval"
    };
  }
  return { policy, highRisk };
}

async function startTerminalSession(
  root: string,
  command: string
): Promise<TerminalSessionStartResult> {
  const trimmed = command.trim();
  if (!trimmed) {
    return {
      sessionId: null,
      status: "denied",
      policy: { decision: "deny", reason: "empty command" },
      highRisk: null,
      reason: "command is empty"
    };
  }

  const { policy, highRisk } = evaluateTerminalPolicy(trimmed);
  if (policy.decision === "deny") {
    return {
      sessionId: null,
      status: "denied",
      policy,
      highRisk,
      reason: policy.reason
    };
  }
  if (policy.decision === "require_approval") {
    return {
      sessionId: null,
      status: "blocked",
      policy,
      highRisk,
      reason: policy.reason
    };
  }

  const sessionId = `pty-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const child = spawn("zsh", ["-lc", trimmed], {
    cwd: root,
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env
  });

  const session: TerminalSession = {
    id: sessionId,
    root,
    command: trimmed,
    process: child,
    buffer: [],
    status: "running",
    exitCode: null,
    startedAt: nowIso(),
    endedAt: null
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string | Buffer) => {
    session.buffer.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  child.stderr.on("data", (chunk: string | Buffer) => {
    session.buffer.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
  });
  child.on("error", (error) => {
    session.status = "failed";
    session.exitCode = 1;
    session.endedAt = nowIso();
    session.buffer.push(`\n[session-error] ${error.message}\n`);
  });
  child.on("close", (code) => {
    if (session.status === "stopped") {
      session.exitCode = code ?? null;
      session.endedAt = session.endedAt ?? nowIso();
      return;
    }
    session.status = (code ?? 1) === 0 ? "exited" : "failed";
    session.exitCode = code ?? 1;
    session.endedAt = nowIso();
  });

  terminalSessions.set(sessionId, session);
  return {
    sessionId,
    status: "running",
    policy,
    highRisk,
    reason: "session started"
  };
}

function readTerminalSession(sessionId: string): TerminalSessionSnapshot | null {
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return null;
  }
  const output = session.buffer.join("");
  session.buffer = [];
  return {
    sessionId: session.id,
    status: session.status,
    exitCode: session.exitCode,
    output,
    startedAt: session.startedAt,
    endedAt: session.endedAt
  };
}

function writeTerminalSession(sessionId: string, input: string): boolean {
  const session = terminalSessions.get(sessionId);
  if (!session || session.status !== "running") {
    return false;
  }
  session.process.stdin.write(input);
  return true;
}

function stopTerminalSession(sessionId: string): boolean {
  const session = terminalSessions.get(sessionId);
  if (!session) {
    return false;
  }
  if (session.status === "running") {
    session.status = "stopped";
    session.endedAt = nowIso();
    session.process.kill("SIGTERM");
  }
  return true;
}

function computeLineChangeStats(baseContent: string, nextContent: string): {
  changedLines: number;
  totalLines: number;
} {
  const before = normalizeLf(baseContent).split("\n");
  const after = normalizeLf(nextContent).split("\n");
  const totalLines = Math.max(before.length, after.length);
  let changedLines = 0;
  for (let i = 0; i < totalLines; i += 1) {
    if ((before[i] ?? "") !== (after[i] ?? "")) {
      changedLines += 1;
    }
  }
  return { changedLines, totalLines };
}

async function writeDiffCheckpoint(record: DiffCheckpointRecord): Promise<void> {
  await fs.mkdir(diffCheckpointRoot(), { recursive: true });
  await fs.writeFile(
    join(diffCheckpointRoot(), `${record.id}.json`),
    `${JSON.stringify(record, null, 2)}\n`,
    "utf8"
  );
}

async function writeSignedPatchManifest(record: DiffCheckpointRecord): Promise<DiffPatchManifest> {
  const unsigned = {
    version: 1,
    checkpointId: record.id,
    createdAt: record.createdAt,
    root: record.root,
    path: record.path,
    baseHash: record.baseHash,
    afterHash: hashText(normalizeLf(record.afterContent)),
    appliedChunks: record.appliedChunks
  };
  const payload = canonicalManifestPayload(unsigned);
  const payloadHash = hashText(payload);
  const secret = await getPatchSigningSecret();
  const keyId = hashText(secret).slice(0, 16);
  const signature = createHmac("sha256", secret).update(payloadHash).digest("hex");
  const manifest: DiffPatchManifest = {
    ...unsigned,
    payloadHash,
    keyId,
    signature
  };
  await fs.writeFile(
    patchManifestPath(record.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  return manifest;
}

async function readPatchManifest(checkpointId: string): Promise<DiffPatchManifest | null> {
  const path = patchManifestPath(checkpointId);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as DiffPatchManifest;
  } catch {
    return null;
  }
}

async function verifyPatchManifest(checkpointId: string): Promise<{
  valid: boolean;
  reason: string | null;
  manifest: DiffPatchManifest | null;
}> {
  const manifest = await readPatchManifest(checkpointId);
  if (!manifest) {
    return {
      valid: false,
      reason: "manifest not found",
      manifest: null
    };
  }
  const checkpoint = await readDiffCheckpoint(checkpointId);
  if (!checkpoint) {
    return {
      valid: false,
      reason: "checkpoint not found",
      manifest
    };
  }

  const canonical = canonicalManifestPayload({
    version: manifest.version,
    checkpointId: manifest.checkpointId,
    createdAt: manifest.createdAt,
    root: manifest.root,
    path: manifest.path,
    baseHash: manifest.baseHash,
    afterHash: manifest.afterHash,
    appliedChunks: manifest.appliedChunks
  });
  const expectedPayloadHash = hashText(canonical);
  if (expectedPayloadHash !== manifest.payloadHash) {
    return {
      valid: false,
      reason: "manifest payload hash mismatch",
      manifest
    };
  }

  const secret = await getPatchSigningSecret();
  const expectedSignature = createHmac("sha256", secret).update(manifest.payloadHash).digest("hex");
  if (expectedSignature !== manifest.signature) {
    return {
      valid: false,
      reason: "manifest signature mismatch",
      manifest
    };
  }

  const checkpointAfterHash = hashText(normalizeLf(checkpoint.afterContent));
  if (checkpoint.baseHash !== manifest.baseHash || checkpointAfterHash !== manifest.afterHash) {
    return {
      valid: false,
      reason: "checkpoint hash mismatch",
      manifest
    };
  }

  return {
    valid: true,
    reason: null,
    manifest
  };
}

async function readDiffCheckpoint(checkpointId: string): Promise<DiffCheckpointRecord | null> {
  const path = join(diffCheckpointRoot(), `${checkpointId}.json`);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as DiffCheckpointRecord;
  } catch {
    return null;
  }
}

async function listDiffCheckpoints(limit: number): Promise<DiffCheckpointRecord[]> {
  const root = diffCheckpointRoot();
  if (!existsSync(root)) {
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const records: DiffCheckpointRecord[] = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      !entry.name.endsWith(".json") ||
      entry.name.endsWith(".manifest.json")
    ) {
      continue;
    }
    const loaded = await readDiffCheckpoint(entry.name.replace(/\.json$/i, ""));
    if (loaded) {
      const verification = await verifyPatchManifest(loaded.id);
      records.push({
        ...loaded,
        signatureValid: verification.valid
      });
    }
  }
  return records
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(1, Math.min(limit, 400)));
}

async function applyDiffQueue(input: {
  root: string;
  path: string;
  baseContent: string;
  nextContent: string;
  appliedChunks: string[];
  allowFullRewrite?: boolean;
}): Promise<DiffApplyResult> {
  const current = await safeRead(input.root, input.path);
  if (current.binary || current.content === null) {
    return {
      ok: false,
      conflict: true,
      checkpointId: null,
      reason: "binary files are not supported for diff queue apply"
    };
  }

  const disk = normalizeLf(current.content);
  const base = normalizeLf(input.baseContent);
  if (disk !== base) {
    return {
      ok: false,
      conflict: true,
      checkpointId: null,
      reason: "file changed on disk since diff baseline"
    };
  }

  const { changedLines, totalLines } = computeLineChangeStats(base, input.nextContent);
  const fullRewrite = totalLines > 0 && changedLines === totalLines;
  if (fullRewrite && input.allowFullRewrite !== true) {
    return {
      ok: false,
      conflict: false,
      checkpointId: null,
      reason: "full-file rewrite blocked by policy (explicit override required)"
    };
  }

  await safeWrite(input.root, input.path, input.nextContent);
  const recordBase: DiffCheckpointRecord = {
    id: `diff-${Date.now()}-${randomUUID().slice(0, 8)}`,
    createdAt: nowIso(),
    root: input.root,
    path: input.path,
    baseHash: hashText(base),
    beforeContent: input.baseContent,
    afterContent: input.nextContent,
    appliedChunks: input.appliedChunks,
    keyId: "",
    manifestPath: "",
    signature: "",
    signatureValid: true
  };
  const manifest = await writeSignedPatchManifest(recordBase);
  const record: DiffCheckpointRecord = {
    ...recordBase,
    keyId: manifest.keyId,
    manifestPath: patchManifestPath(recordBase.id),
    signature: manifest.signature,
    signatureValid: true
  };
  await writeDiffCheckpoint(record);
  return {
    ok: true,
    conflict: false,
    checkpointId: record.id,
    reason: null
  };
}

async function revertDiffCheckpoint(checkpointId: string): Promise<{
  ok: boolean;
  checkpoint: DiffCheckpointRecord | null;
  reason: string | null;
}> {
  const checkpoint = await readDiffCheckpoint(checkpointId);
  if (!checkpoint) {
    return {
      ok: false,
      checkpoint: null,
      reason: "checkpoint not found"
    };
  }
  const verification = await verifyPatchManifest(checkpointId);
  if (!verification.valid) {
    return {
      ok: false,
      checkpoint: null,
      reason: `manifest verification failed: ${verification.reason ?? "unknown"}`
    };
  }
  await safeWrite(checkpoint.root, checkpoint.path, checkpoint.beforeContent);
  return {
    ok: true,
    checkpoint,
    reason: null
  };
}

function inferChecksFromCommand(
  command: string,
  exitCode: number | null,
  parsedTest: ParsedTestSummary | null
): {
  lint: CheckStatus;
  typecheck: CheckStatus;
  test: CheckStatus;
  build: CheckStatus;
} {
  const checks = emptyChecks();
  const checkStatus: CheckStatus =
    exitCode === null ? "skip" : exitCode === 0 ? "pass" : "fail";

  if (/\blint\b/i.test(command)) {
    checks.lint = checkStatus;
  }
  if (/\b(typecheck|tsc)\b/i.test(command)) {
    checks.typecheck = checkStatus;
  }
  if (/\b(test|vitest|jest|pytest)\b/i.test(command)) {
    checks.test = parsedTest ? (parsedTest.failed > 0 ? "fail" : "pass") : checkStatus;
  }
  if (/\bbuild\b/i.test(command)) {
    checks.build = checkStatus;
  }
  return checks;
}

async function writeTerminalCheckpoint(input: {
  command: string;
  result: {
    exitCode: number | null;
    stdout: string;
    stderr: string;
    policy: PolicyResult;
    highRisk: CommandRiskAssessment | null;
    parsedTest: ParsedTestSummary | null;
  };
}): Promise<string> {
  const { command, result } = input;
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
        checks: inferChecksFromCommand(command, result.exitCode, result.parsedTest),
        failures: result.exitCode === 0 ? [] : [result.stderr || result.policy.reason],
        metrics: {
          stdout_length: result.stdout.length,
          stderr_length: result.stderr.length,
          high_risk_categories: result.highRisk?.categories.length ?? 0,
          parsed_test_total: result.parsedTest?.total ?? 0,
          parsed_test_failed: result.parsedTest?.failed ?? 0
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

async function writePipelineCheckpoint(input: {
  stages: PipelineStageResult[];
  checks: {
    lint: CheckStatus;
    typecheck: CheckStatus;
    test: CheckStatus;
    build: CheckStatus;
  };
  status: "success" | "failed" | "blocked";
}): Promise<string> {
  const runId = `pipeline-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const runRoot = join(checkpointsRoot(), runId);
  const stepRoot = join(runRoot, "step-1");
  await fs.mkdir(stepRoot, { recursive: true });
  const startedAt = nowIso();

  await fs.writeFile(
    join(runRoot, "manifest.json"),
    `${JSON.stringify(
      {
        run_id: runId,
        task_type: "terminal_pipeline",
        repo_snapshot: "workspace",
        model: "local-shell",
        policy_version: "balanced-v1",
        started_at: startedAt,
        ended_at: nowIso(),
        final_status: input.status
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
        goal: "run validation pipeline",
        acceptance_criteria: ["lint/typecheck/test/build executed", "structured test parsing captured"],
        risks: ["policy block", "command failure", "missing script"],
        policy_context: { mode: "balanced", stages: input.stages.map((stage) => stage.stage) },
        deterministic_seed: createHash("sha1")
          .update(input.stages.map((stage) => `${stage.stage}:${stage.command}`).join("|"))
          .digest("hex")
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  const calls = input.stages.map((stage) => ({
    id: randomUUID(),
    step_id: "step-1",
    tool: "terminal",
    args: { stage: stage.stage, command: stage.command },
    started_at: startedAt,
    ended_at: nowIso(),
    exit_code: stage.exitCode,
    status:
      stage.status === "pass" || stage.status === "skip"
        ? "success"
        : stage.status === "blocked"
          ? "blocked"
          : "error",
    output_ref: null
  }));
  await fs.writeFile(
    join(stepRoot, "tool_calls.jsonl"),
    `${calls.map((call) => JSON.stringify(call)).join("\n")}\n`,
    "utf8"
  );

  const failures = input.stages
    .filter((stage) => stage.status === "fail" || stage.status === "blocked")
    .map((stage) => `${stage.stage}: ${stage.stderr || stage.policy.reason}`);

  await fs.writeFile(
    join(stepRoot, "results.json"),
    `${JSON.stringify(
      {
        status: input.status,
        checks: input.checks,
        failures,
        metrics: {
          stages: input.stages.length,
          failed_stages: input.stages.filter((stage) => stage.status === "fail").length,
          blocked_stages: input.stages.filter((stage) => stage.status === "blocked").length,
          parsed_test_failed: input.stages
            .map((stage) => stage.parsedTest?.failed ?? 0)
            .reduce((sum, value) => sum + value, 0)
        },
        next_action: input.status === "blocked" ? "approval" : input.status === "failed" ? "repair" : null
      },
      null,
      2
    )}\n`,
    "utf8"
  );
  await fs.writeFile(join(stepRoot, "patch.diff"), "\n", "utf8");

  return runRoot;
}

async function runPipeline(
  root: string,
  commands?: Partial<Record<PipelineStageName, string>>
): Promise<PipelineRunResult> {
  const defaults = defaultPipelineCommands();
  const orderedStages: PipelineStageName[] = ["lint", "typecheck", "test", "build"];
  const stages: PipelineStageResult[] = [];
  const checks = emptyChecks();
  let blockedStage: PipelineStageName | null = null;

  for (const stage of orderedStages) {
    const command = (commands?.[stage] ?? defaults[stage]).trim();
    if (!command) {
      stages.push({
        stage,
        command,
        exitCode: 0,
        stdout: "",
        stderr: "",
        status: "skip",
        policy: { decision: "allow", reason: "stage skipped by empty command" },
        highRisk: null,
        parsedTest: null
      });
      checks[stage] = "skip";
      continue;
    }

    const highRisk = detectCommandRisk(command);
    let policy = commandPolicy(command);
    if (policy.decision === "allow" && highRisk.requiresApproval) {
      policy = {
        decision: "require_approval",
        reason: highRisk.prompt ?? "high-risk command requires approval"
      };
    }

    if (policy.decision === "deny") {
      stages.push({
        stage,
        command,
        exitCode: 1,
        stdout: "",
        stderr: policy.reason,
        status: "fail",
        policy,
        highRisk,
        parsedTest: null
      });
      checks[stage] = "fail";
      break;
    }

    if (policy.decision === "require_approval") {
      blockedStage = stage;
      stages.push({
        stage,
        command,
        exitCode: null,
        stdout: "",
        stderr: policy.reason,
        status: "blocked",
        policy,
        highRisk,
        parsedTest: null
      });
      checks[stage] = "skip";
      break;
    }

    const run = await executeCommand(root, command);
    const parsedTest =
      stage === "test" ? parseTestOutput(command, run.stdout, run.stderr) : null;
    const stageStatus = run.exitCode === 0 ? "pass" : "fail";
    checks[stage] =
      stage === "test" && parsedTest ? (parsedTest.failed > 0 ? "fail" : "pass") : stageStatus;

    stages.push({
      stage,
      command,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      status: stageStatus,
      policy,
      highRisk,
      parsedTest
    });

    if (stageStatus === "fail" || checks[stage] === "fail") {
      break;
    }
  }

  const status: PipelineRunResult["status"] =
    blockedStage ? "blocked"
    : stages.some((stage) => stage.status === "fail" || stage.status === "blocked")
      ? "failed"
      : "success";

  const artifactPath = await writePipelineCheckpoint({
    stages,
    checks,
    status
  });

  return {
    id: randomUUID(),
    status,
    checks,
    stages,
    blockedStage,
    artifactPath
  };
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

  ipcMain.handle(
    "diff:apply-queue",
    async (
      _event,
      payload: {
        root: string;
        path: string;
        baseContent: string;
        nextContent: string;
        appliedChunks: string[];
        allowFullRewrite?: boolean;
      }
    ): Promise<DiffApplyResult> => {
      const result = await applyDiffQueue({
        root: payload.root,
        path: payload.path,
        baseContent: payload.baseContent,
        nextContent: payload.nextContent,
        appliedChunks: payload.appliedChunks ?? [],
        allowFullRewrite: payload.allowFullRewrite === true
      });
      await appendAuditEvent({
        action: "diff.apply_queue",
        target: payload.path,
        decision:
          result.ok
            ? "executed"
            : result.reason?.includes("override required")
              ? "require_approval"
              : result.conflict
                ? "error"
                : "deny",
        reason: result.ok ? "diff queue applied" : (result.reason ?? "diff queue apply failed"),
        metadata: {
          root: payload.root,
          checkpoint_id: result.checkpointId,
          chunk_count: payload.appliedChunks?.length ?? 0,
          allow_full_rewrite: payload.allowFullRewrite === true
        }
      });
      return result;
    }
  );

  ipcMain.handle("diff:list-checkpoints", async (_event, limit = 80) => {
    return listDiffCheckpoints(Math.max(1, Math.min(300, Number(limit) || 80)));
  });

  ipcMain.handle("diff:revert-checkpoint", async (_event, checkpointId: string) => {
    const result = await revertDiffCheckpoint(checkpointId);
    await appendAuditEvent({
      action: "diff.revert_checkpoint",
      target: checkpointId,
      decision: result.ok ? "executed" : "error",
      reason: result.ok ? "diff checkpoint reverted" : (result.reason ?? "checkpoint revert failed"),
      metadata: {
        path: result.checkpoint?.path ?? null,
        root: result.checkpoint?.root ?? null
      }
    });
    return result;
  });

  ipcMain.handle("diff:verify-checkpoint-signature", async (_event, checkpointId: string) => {
    const result = await verifyPatchManifest(checkpointId);
    await appendAuditEvent({
      action: "diff.verify_signature",
      target: checkpointId,
      decision: result.valid ? "executed" : "error",
      reason: result.valid ? "diff checkpoint signature verified" : (result.reason ?? "signature verification failed")
    });
    return result;
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

  ipcMain.handle(
    "terminal:session:start",
    async (_event, root: string, command: string): Promise<TerminalSessionStartResult> => {
      const result = await startTerminalSession(root, command);
      await appendAuditEvent({
        action: "terminal.session.start",
        target: command,
        decision:
          result.status === "running"
            ? "executed"
            : result.status === "blocked"
              ? "require_approval"
              : "deny",
        reason: result.reason,
        metadata: {
          root,
          session_id: result.sessionId,
          high_risk: result.highRisk?.categories ?? []
        }
      });
      return result;
    }
  );

  ipcMain.handle("terminal:session:read", async (_event, sessionId: string) => {
    return readTerminalSession(sessionId);
  });

  ipcMain.handle("terminal:session:write", async (_event, sessionId: string, input: string) => {
    const ok = writeTerminalSession(sessionId, input);
    if (ok) {
      await appendAuditEvent({
        action: "terminal.session.write",
        target: sessionId,
        decision: "executed",
        reason: "stdin forwarded to session",
        metadata: { bytes: input.length }
      });
    }
    return { ok };
  });

  ipcMain.handle("terminal:session:stop", async (_event, sessionId: string) => {
    const ok = stopTerminalSession(sessionId);
    await appendAuditEvent({
      action: "terminal.session.stop",
      target: sessionId,
      decision: ok ? "executed" : "error",
      reason: ok ? "session stopped" : "session not found"
    });
    return { ok };
  });

  ipcMain.handle("terminal:run", async (_event, root: string, command: string): Promise<TerminalResult> => {
    const { highRisk, policy } = evaluateTerminalPolicy(command);

    if (policy.decision === "deny") {
      await appendAuditEvent({
        action: "terminal.run",
        target: command,
        decision: "deny",
        reason: policy.reason,
        metadata: { root, highRisk: highRisk.categories }
      });
      const artifactPath = await writeTerminalCheckpoint({
        command,
        result: {
          exitCode: 1,
          stdout: "",
          stderr: policy.reason,
          policy,
          highRisk,
          parsedTest: null
        }
      });
      return {
        id: randomUUID(),
        command,
        exitCode: 1,
        stdout: "",
        stderr: policy.reason,
        policy,
        highRisk,
        parsedTest: null,
        artifactPath
      };
    }

    if (policy.decision === "require_approval") {
      await appendAuditEvent({
        action: "terminal.run",
        target: command,
        decision: "require_approval",
        reason: policy.reason,
        metadata: { root, highRisk: highRisk.categories }
      });
      const artifactPath = await writeTerminalCheckpoint({
        command,
        result: {
          exitCode: null,
          stdout: "",
          stderr: policy.reason,
          policy,
          highRisk,
          parsedTest: null
        }
      });
      return {
        id: randomUUID(),
        command,
        exitCode: null,
        stdout: "",
        stderr: policy.reason,
        policy,
        highRisk,
        parsedTest: null,
        artifactPath
      };
    }

    const run = await executeCommand(root, command);
    const parsedTest = parseTestOutput(command, run.stdout, run.stderr);
    const artifactPath = await writeTerminalCheckpoint({
      command,
      result: {
        exitCode: run.exitCode,
        stdout: run.stdout,
        stderr: run.stderr,
        policy,
        highRisk,
        parsedTest
      }
    });

    await appendAuditEvent({
      action: "terminal.run",
      target: command,
      decision: run.exitCode === 0 ? "executed" : "error",
      reason: run.exitCode === 0 ? "command succeeded" : "command failed",
      metadata: {
        root,
        exitCode: run.exitCode,
        artifactPath,
        highRisk: highRisk.categories,
        parsedTestFailed: parsedTest?.failed ?? 0
      }
    });

    return {
      id: randomUUID(),
      command,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      policy,
      highRisk,
      parsedTest,
      artifactPath
    };
  });

  ipcMain.handle("terminal:run-approved", async (_event, root: string, command: string): Promise<TerminalResult> => {
    const { highRisk } = evaluateTerminalPolicy(command);
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
        highRisk,
        parsedTest: null,
        artifactPath: null
      };
    }

    const run = await executeCommand(root, command);
    const parsedTest = parseTestOutput(command, run.stdout, run.stderr);
    const artifactPath = await writeTerminalCheckpoint({
      command,
      result: {
        exitCode: run.exitCode,
        stdout: run.stdout,
        stderr: run.stderr,
        policy: { decision: "allow", reason: "approved by user" },
        highRisk,
        parsedTest
      }
    });
    await appendAuditEvent({
      action: "terminal.approved_run",
      target: command,
      decision: run.exitCode === 0 ? "executed" : "error",
      reason: "command executed via approval flow",
      metadata: {
        root,
        artifactPath,
        exitCode: run.exitCode,
        highRisk: highRisk.categories,
        parsedTestFailed: parsedTest?.failed ?? 0
      }
    });

    return {
      id: randomUUID(),
      command,
      exitCode: run.exitCode,
      stdout: run.stdout,
      stderr: run.stderr,
      policy: { decision: "allow", reason: "approved by user" },
      highRisk,
      parsedTest,
      artifactPath
    };
  });

  ipcMain.handle(
    "terminal:run-pipeline",
    async (
      _event,
      root: string,
      commands?: Partial<Record<PipelineStageName, string>>
    ): Promise<PipelineRunResult> => {
      const result = await runPipeline(root, commands);
      await appendAuditEvent({
        action: "terminal.pipeline.run",
        target: root,
        decision:
          result.status === "success"
            ? "executed"
            : result.status === "blocked"
              ? "require_approval"
              : "error",
        reason: `pipeline ${result.status}`,
        metadata: {
          checks: result.checks,
          blocked_stage: result.blockedStage,
          stages: result.stages.map((stage) => ({
            stage: stage.stage,
            status: stage.status,
            exitCode: stage.exitCode
          })),
          artifactPath: result.artifactPath
        }
      });
      return result;
    }
  );

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
    "team:memory:search",
    async (
      _event,
      payload: { query: string; tags: string[]; limit?: number }
    ) => {
      return searchTeamMemory({
        query: payload.query ?? "",
        tags: payload.tags ?? [],
        limit: payload.limit ?? 50
      });
    }
  );

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

  ipcMain.handle(
    "team:ownership:map",
    async (
      _event,
      payload: { root: string; files: string[] }
    ) => {
      const mapping = await mapOwnership(payload.root, payload.files);
      await appendAuditEvent({
        action: "team.ownership.map",
        target: payload.root,
        decision: "executed",
        reason: "ownership mapping generated",
        metadata: { files: payload.files.length, mapped: mapping.length }
      });
      return mapping;
    }
  );

  ipcMain.handle(
    "team:ownership:conflicts",
    async (
      _event,
      payload: {
        root: string;
        assignments: Array<{ agentId: string; files: string[] }>;
      }
    ) => {
      const report = await detectOwnershipConflicts(payload.root, payload.assignments);
      await appendAuditEvent({
        action: "team.ownership.conflicts",
        target: payload.root,
        decision: "executed",
        reason: "ownership conflict report generated",
        metadata: {
          file_conflicts: report.fileConflicts.length,
          owner_conflicts: report.ownerConflicts.length
        }
      });
      return report;
    }
  );

  ipcMain.handle(
    "team:changelog:draft",
    async (
      _event,
      payload: { root: string; sinceRef?: string }
    ) => {
      const draft = await generateChangelogDraft(payload.root, payload.sinceRef);
      await appendAuditEvent({
        action: "team.changelog.draft",
        target: payload.root,
        decision: "executed",
        reason: "changelog draft generated",
        metadata: { range: draft.range, sections: draft.sections.length }
      });
      return draft;
    }
  );

  ipcMain.handle(
    "team:release-notes:draft",
    async (
      _event,
      payload: { root: string; version: string; highlights: string[] }
    ) => {
      const draft = await generateReleaseNotesDraft(
        payload.root,
        payload.version,
        payload.highlights
      );
      await appendAuditEvent({
        action: "team.release_notes.draft",
        target: payload.root,
        decision: "executed",
        reason: "release notes draft generated",
        metadata: { version: draft.version }
      });
      return draft;
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
  for (const session of terminalSessions.values()) {
    if (session.status === "running") {
      session.status = "stopped";
      session.endedAt = nowIso();
      session.process.kill("SIGTERM");
    }
  }
  terminalSessions.clear();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
