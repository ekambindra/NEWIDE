import { contextBridge, ipcRenderer } from "electron";

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  gitStatus?: string;
};

type SearchHit = {
  file: string;
  line: number;
  text: string;
};

type TerminalResult = {
  id: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  policy: {
    decision: "allow" | "deny" | "require_approval";
    reason: string;
  };
  highRisk: {
    requiresApproval: boolean;
    categories: string[];
    reasons: string[];
    prompt: string | null;
  } | null;
  parsedTest: {
    framework: "vitest" | "jest" | "pytest" | "junit" | "unknown";
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    durationMs: number | null;
    rawSignal: string;
  } | null;
  artifactPath: string | null;
};

type PipelineResult = {
  id: string;
  status: "success" | "failed" | "blocked";
  checks: {
    lint: "pass" | "fail" | "skip";
    typecheck: "pass" | "fail" | "skip";
    test: "pass" | "fail" | "skip";
    build: "pass" | "fail" | "skip";
  };
  stages: Array<{
    stage: "lint" | "typecheck" | "test" | "build";
    command: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    status: "pass" | "fail" | "skip" | "blocked";
    policy: {
      decision: "allow" | "deny" | "require_approval";
      reason: string;
    };
    highRisk: {
      requiresApproval: boolean;
      categories: string[];
      reasons: string[];
      prompt: string | null;
    } | null;
    parsedTest: TerminalResult["parsedTest"];
  }>;
  blockedStage: "lint" | "typecheck" | "test" | "build" | null;
  artifactPath: string | null;
};

type TerminalSessionStartResult = {
  sessionId: string | null;
  status: "running" | "exited" | "failed" | "stopped" | "blocked" | "denied";
  policy: {
    decision: "allow" | "deny" | "require_approval";
    reason: string;
  };
  highRisk: TerminalResult["highRisk"];
  reason: string;
};

type TerminalSessionSnapshot = {
  sessionId: string;
  status: "running" | "exited" | "failed" | "stopped";
  exitCode: number | null;
  output: string;
  startedAt: string;
  endedAt: string | null;
} | null;

type DiffApplyResult = {
  ok: boolean;
  conflict: boolean;
  checkpointId: string | null;
  reason: string | null;
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
  groundingEvidenceCount?: number;
  groundingPath?: string | null;
  signatureValid?: boolean;
};

type WorkspaceIndexReport = {
  root: string;
  generatedAt: string;
  diagnostics: {
    parserPipeline: "tree_sitter" | "fallback";
    treeSitterAvailable: boolean;
    treeSitterReason: string | null;
    indexedFiles: number;
    totalSymbols: number;
    parseErrors: number;
    freshnessLatencyMs: number | null;
    batchLatencyMs: number | null;
    files: Array<{
      file: string;
      absolutePath: string;
      parserMode: "tree_sitter" | "typescript_ast" | "regex_fallback";
      symbols: number;
      latencyMs: number;
      indexedAt: string;
      fromCache: boolean;
      error: string | null;
    }>;
  };
  freshnessTargets: {
    smallTargetMs: number;
    batchTargetMs: number;
    observedSmallMs: number | null;
    observedBatchMs: number | null;
    smallWithinTarget: boolean | null;
    batchWithinTarget: boolean | null;
    meetsTarget: boolean;
  };
  repoMap: Array<{
    file: string;
    symbols: number;
    imports: string[];
  }>;
  moduleSummaries: Array<{
    file: string;
    symbolCount: number;
    importCount: number;
    topKinds: string[];
    topSymbols: string[];
    summary: string;
  }>;
  retrieval: {
    query: string;
    tokenBudget: number;
    budgetUsed: number;
    files: string[];
    candidates: Array<{
      file: string;
      score: number;
      matchedTerms: number;
      symbolCount: number;
      parseHealthy: boolean;
    }>;
  };
  callGraph: {
    nodes: string[];
    edges: Array<{
      file: string;
      from: string;
      to: string;
      line: number;
    }>;
    topCallers: Array<{ symbol: string; count: number }>;
    topCallees: Array<{ symbol: string; count: number }>;
  };
  renameImpact: {
    from: string;
    to: string;
    filesTouched: number;
    totalMatches: number;
    declarationMatches: number;
    referenceMatches: number;
    collisionMatches: number;
    impacts: Array<{
      file: string;
      totalMatches: number;
      declarationMatches: number;
      referenceMatches: number;
      collisionMatches: number;
      lines: number[];
    }>;
  } | null;
  topFiles: Array<{
    file: string;
    symbols: number;
    latencyMs: number;
    parserMode: string;
    error: string | null;
  }>;
};

type ArtifactCompletenessReport = {
  root: string;
  generatedAt: string;
  required: string[];
  present: string[];
  missing: string[];
  completenessPercent: number;
};

type GreenPipelineReport = {
  generatedAt: string;
  totalRuns: number;
  passedRuns: number;
  passRatePercent: number;
  targetPercent: number;
  meetsTarget: boolean;
};

type ProjectBuilderResult = {
  runId: string;
  template: "node_microservices_postgres";
  projectName: string;
  projectRoot: string;
  generatedAt: string;
  generatedFiles: string[];
  services: {
    api: boolean;
    worker: boolean;
    postgres: boolean;
  };
  completeness: {
    required: string[];
    present: string[];
    missing: string[];
    completenessPercent: number;
  };
  checkpointPath: string;
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

type MultiAgentSummary = {
  coordinatorRunId: string;
  overallStatus: "success" | "failed";
  agentRuns: Array<{
    runId: string;
    status: "success" | "failed" | "blocked";
    steps: number;
    agentId: string;
    focus: string;
  }>;
};

type TeamMemoryEntry = {
  id: string;
  ts: string;
  title: string;
  content: string;
  tags: string[];
};

type ScoredTeamMemoryEntry = TeamMemoryEntry & { score: number };

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

const api = {
  openWorkspace: (): Promise<string | null> => ipcRenderer.invoke("workspace:open"),
  getTree: (root: string): Promise<TreeNode[]> => ipcRenderer.invoke("workspace:tree", root),
  startWatch: (root: string): Promise<boolean> => ipcRenderer.invoke("workspace:watch:start", root),
  stopWatch: (root: string): Promise<boolean> => ipcRenderer.invoke("workspace:watch:stop", root),
  readFile: (root: string, relPath: string) => ipcRenderer.invoke("file:read", root, relPath),
  writeFile: (root: string, relPath: string, content: string) =>
    ipcRenderer.invoke("file:write", root, relPath, content),
  createPath: (root: string, relPath: string, isDirectory: boolean) =>
    ipcRenderer.invoke("file:create", root, relPath, isDirectory),
  renamePath: (root: string, fromPath: string, toPath: string) =>
    ipcRenderer.invoke("file:rename", root, fromPath, toPath),
  deletePath: (root: string, relPath: string) => ipcRenderer.invoke("file:delete", root, relPath),
  searchProject: (root: string, query: string): Promise<SearchHit[]> =>
    ipcRenderer.invoke("search:project", root, query),
  gitStatus: (root: string): Promise<Array<{ file: string; status: string }>> =>
    ipcRenderer.invoke("git:status", root),
  runCommand: (root: string, command: string): Promise<TerminalResult> =>
    ipcRenderer.invoke("terminal:run", root, command),
  startTerminalSession: (root: string, command: string): Promise<TerminalSessionStartResult> =>
    ipcRenderer.invoke("terminal:session:start", root, command),
  readTerminalSession: (sessionId: string): Promise<TerminalSessionSnapshot> =>
    ipcRenderer.invoke("terminal:session:read", sessionId),
  writeTerminalSession: (sessionId: string, input: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal:session:write", sessionId, input),
  stopTerminalSession: (sessionId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke("terminal:session:stop", sessionId),
  runApprovedCommand: (root: string, command: string): Promise<TerminalResult> =>
    ipcRenderer.invoke("terminal:run-approved", root, command),
  runPipeline: (
    root: string,
    commands?: Partial<Record<"lint" | "typecheck" | "test" | "build", string>>
  ): Promise<PipelineResult> => ipcRenderer.invoke("terminal:run-pipeline", root, commands),
  replayTerminal: (limit: number): Promise<Array<{ runId: string; command: string; status: string; output: string }>> =>
    ipcRenderer.invoke("terminal:replay", limit),
  applyDiffQueue: (payload: {
    root: string;
    path: string;
    baseContent: string;
    nextContent: string;
    appliedChunks: string[];
    allowFullRewrite?: boolean;
  }): Promise<DiffApplyResult> => ipcRenderer.invoke("diff:apply-queue", payload),
  listDiffCheckpoints: (limit = 80): Promise<DiffCheckpointRecord[]> =>
    ipcRenderer.invoke("diff:list-checkpoints", limit),
  revertDiffCheckpoint: (checkpointId: string): Promise<{
    ok: boolean;
    checkpoint: DiffCheckpointRecord | null;
    reason: string | null;
  }> => ipcRenderer.invoke("diff:revert-checkpoint", checkpointId),
  verifyDiffCheckpointSignature: (checkpointId: string): Promise<{
    valid: boolean;
    reason: string | null;
    manifest: {
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
    } | null;
  }> => ipcRenderer.invoke("diff:verify-checkpoint-signature", checkpointId),
  runWorkspaceIndex: (payload: {
    root: string;
    limit?: number;
    query?: string;
    tokenBudget?: number;
    renameFrom?: string;
    renameTo?: string;
  }): Promise<WorkspaceIndexReport> => ipcRenderer.invoke("indexer:run", payload),
  getWorkspaceIndexDiagnostics: (root: string): Promise<WorkspaceIndexReport> =>
    ipcRenderer.invoke("indexer:diagnostics", root),
  checkArtifactCompleteness: (root: string): Promise<ArtifactCompletenessReport> =>
    ipcRenderer.invoke("auto:artifact-completeness", root),
  checkGreenPipeline: (payload?: {
    limit?: number;
    targetPercent?: number;
  }): Promise<GreenPipelineReport> => ipcRenderer.invoke("auto:green-pipeline", payload),
  runProjectBuilder: (payload: {
    workspaceRoot: string;
    projectName: string;
    outputDir?: string;
  }): Promise<ProjectBuilderResult> => ipcRenderer.invoke("auto:project-builder", payload),
  runMultiAgentTask: (
    payload: { goal: string; acceptanceCriteria: string[]; agentCount: number }
  ): Promise<MultiAgentSummary> => ipcRenderer.invoke("agent:run-multi", payload),
  listCheckpoints: (): Promise<Array<{ runId: string; path: string }>> => ipcRenderer.invoke("checkpoints:list"),
  getCheckpointDetail: (
    runId: string
  ): Promise<{
    runId: string;
    path: string;
    manifest: Record<string, unknown> | null;
    steps: Array<{ stepId: string; files: string[]; preview: Record<string, string> }>;
  }> => ipcRenderer.invoke("checkpoints:detail", runId),
  getRecentAudit: (limit: number): Promise<AuditEvent[]> => ipcRenderer.invoke("audit:recent", limit),
  exportAudit: (): Promise<{ path: string; count: number }> => ipcRenderer.invoke("audit:export"),
  listTeamMemory: (): Promise<TeamMemoryEntry[]> => ipcRenderer.invoke("team:memory:list"),
  searchTeamMemory: (payload: {
    query: string;
    tags: string[];
    limit?: number;
  }): Promise<ScoredTeamMemoryEntry[]> => ipcRenderer.invoke("team:memory:search", payload),
  addTeamMemory: (payload: {
    title: string;
    content: string;
    tags: string[];
  }): Promise<TeamMemoryEntry> => ipcRenderer.invoke("team:memory:add", payload),
  listDecisionLogs: (): Promise<DecisionLogEntry[]> => ipcRenderer.invoke("team:decision:list"),
  addDecisionLog: (payload: {
    title: string;
    context: string;
    options: string[];
    chosen: string;
    consequences: string[];
    relatedFiles: string[];
  }): Promise<DecisionLogEntry> => ipcRenderer.invoke("team:decision:add", payload),
  runReviewerMode: (payload: { root: string; files?: string[] }): Promise<ReviewerFinding[]> =>
    ipcRenderer.invoke("team:review:run", payload),
  mapOwnership: (payload: { root: string; files: string[] }): Promise<OwnershipMatch[]> =>
    ipcRenderer.invoke("team:ownership:map", payload),
  detectOwnershipConflicts: (payload: {
    root: string;
    assignments: Array<{ agentId: string; files: string[] }>;
  }): Promise<OwnershipConflictReport> =>
    ipcRenderer.invoke("team:ownership:conflicts", payload),
  draftChangelog: (payload: { root: string; sinceRef?: string }): Promise<ChangelogDraft> =>
    ipcRenderer.invoke("team:changelog:draft", payload),
  draftReleaseNotes: (payload: {
    root: string;
    version: string;
    highlights: string[];
  }): Promise<ReleaseNotesDraft> => ipcRenderer.invoke("team:release-notes:draft", payload),
  onWorkspaceChanged: (listener: (payload: { root: string; path: string; ts: number }) => void): (() => void) => {
    const wrapped = (_event: unknown, payload: { root: string; path: string; ts: number }) => listener(payload);
    ipcRenderer.on("workspace:changed", wrapped);
    return () => ipcRenderer.off("workspace:changed", wrapped);
  }
};

contextBridge.exposeInMainWorld("ide", api);

export type PreloadApi = typeof api;
