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
  runApprovedCommand: (root: string, command: string): Promise<TerminalResult> =>
    ipcRenderer.invoke("terminal:run-approved", root, command),
  replayTerminal: (limit: number): Promise<Array<{ runId: string; command: string; status: string; output: string }>> =>
    ipcRenderer.invoke("terminal:replay", limit),
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
