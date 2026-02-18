import { useEffect, useMemo, useRef, useState } from "react";
import { defaultLayout, loadLayout, saveLayout, type LayoutState } from "./layout";
import {
  loadSessionSnapshot,
  saveSessionSnapshot,
  type SessionSnapshot,
  type SessionTabSnapshot
} from "./session";

type TreeNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: TreeNode[];
  gitStatus?: string;
};

type Tab = {
  path: string;
  content: string;
  originalContent: string;
  dirty: boolean;
  binary: boolean;
};

type SearchHit = {
  file: string;
  line: number;
  text: string;
};

type PanelTab = "agent" | "plan" | "diff" | "checkpoints";
type BottomTab = "terminal" | "tests" | "logs";
type LeftTab = "files" | "search";

type DiffChunk = {
  id: string;
  start: number;
  end: number;
  original: string[];
  current: string[];
  status: "pending" | "accepted" | "rejected";
};

type DiffQueueItem = {
  id: string;
  file: string;
  chunkId: string;
  decision: "accepted" | "rejected";
  rationale: string;
  timestamp: string;
};

type DiffChurnStats = {
  additions: number;
  deletions: number;
  changedLines: number;
  changedChunks: number;
  pendingChunks: number;
  acceptedChunks: number;
  rejectedChunks: number;
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

type ParsedTestSummary = {
  framework: "vitest" | "jest" | "pytest" | "junit" | "unknown";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  rawSignal: string;
};

type PipelineStageResult = {
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
  parsedTest: ParsedTestSummary | null;
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
  stages: PipelineStageResult[];
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
  highRisk: {
    requiresApproval: boolean;
    categories: string[];
    reasons: string[];
    prompt: string | null;
  } | null;
  reason: string;
};

type TerminalSessionSnapshot = {
  sessionId: string;
  status: "running" | "exited" | "failed" | "stopped";
  exitCode: number | null;
  output: string;
  startedAt: string;
  endedAt: string | null;
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

type DiffApplyResult = {
  ok: boolean;
  conflict: boolean;
  checkpointId: string | null;
  reason: string | null;
  secretFindings?: number;
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

type AuthRole = "viewer" | "developer" | "admin" | "security_admin";

type SsoProvider = {
  id: string;
  name: string;
  protocol: "oidc" | "saml";
  issuer: string;
  entrypoint: string;
  clientId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type AuthSession = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  providerId: string;
  protocol: "oidc" | "saml";
  roles: AuthRole[];
  issuedAt: string;
  expiresAt: string;
};

type TelemetryConsent = "unknown" | "granted" | "denied";
type ControlPlaneMode = "disabled" | "managed" | "self_hosted";

type EnterpriseSettings = {
  version: 1;
  updatedAt: string;
  telemetry: {
    consent: TelemetryConsent;
    enabled: boolean;
    privacyMode: boolean;
    consentedAt: string | null;
    lastUpdated: string;
  };
  controlPlane: {
    mode: ControlPlaneMode;
    baseUrl: string;
    requireTls: boolean;
    allowInsecureLocalhost: boolean;
    apiToken: string | null;
    orgId: string | null;
    workspaceId: string | null;
    lastUpdated: string;
  };
};

type ControlPlaneHealthResult = {
  ok: boolean;
  mode: ControlPlaneMode;
  url: string | null;
  statusCode: number | null;
  reason: string | null;
};

type ControlPlanePushResult = {
  sent: boolean;
  accepted: number;
  url: string | null;
  statusCode: number | null;
  reason: string | null;
};

type ReleaseChannel = "stable" | "beta";

type UpdateCheckResult = {
  skipped: boolean;
  channel: ReleaseChannel;
  reason: string | null;
  updateInfo: {
    version: string;
    files: number;
    releaseDate: string | null;
  } | null;
};

type BenchmarkTask = {
  task_id: string;
  category: string;
  input: string;
  expected_outcome: string;
  timeout_sec: number;
  scorer: string;
};

type BenchmarkResult = {
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

type BenchmarkDashboardReport = {
  generatedAt: string;
  corpusSize: number;
  scoreCard: {
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
    kpis: Array<{
      name: string;
      value: number;
      target: number;
      comparator: "gte" | "lte";
      meetsTarget: boolean;
      unit: string;
    }>;
  };
  gate: {
    pass: boolean;
    failing: string[];
  };
  alerts: Array<{
    metricName: string;
    severity: "warning" | "critical";
    direction: "increase" | "decrease";
    deltaPercent: number;
    baseline: number;
    current: number;
    message: string;
  }>;
  metricsHistoryCount: number;
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

type MultiFileRefactorResult = {
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
  files: Array<{
    file: string;
    matches: number;
    declarationMatches: number;
    referenceMatches: number;
    collisionMatches: number;
    lines: number[];
    sensitive: boolean;
    beforeHash: string;
    afterHash: string;
  }>;
  checkpointPath: string;
  grounding: {
    relatedEdges: Array<{
      file: string;
      from: string;
      to: string;
      line: number;
    }>;
    edgeCount: number;
  };
};

const panelTabs: PanelTab[] = ["agent", "plan", "diff", "checkpoints"];
const bottomTabs: BottomTab[] = ["terminal", "tests", "logs"];
const leftTabs: LeftTab[] = ["files", "search"];

function usePersistentLayout(): [LayoutState, (next: LayoutState) => void] {
  const [layout, setLayout] = useState<LayoutState>(() => {
    if (typeof localStorage === "undefined") {
      return defaultLayout;
    }
    return loadLayout();
  });

  const update = (next: LayoutState) => {
    setLayout(next);
    saveLayout(next);
  };

  return [layout, update];
}

function renderTree(nodes: TreeNode[], onOpen: (path: string) => void) {
  return (
    <ul className="tree-list">
      {nodes.map((node) => (
        <li key={node.path}>
          {node.type === "directory" ? (
            <details open>
              <summary>
                <span className="tree-node folder">{node.name}</span>
              </summary>
              {node.children ? renderTree(node.children, onOpen) : null}
            </details>
          ) : (
            <button className="tree-leaf" onClick={() => onOpen(node.path)}>
              <span className="tree-node">{node.name}</span>
              {node.gitStatus ? <span className="git-pill">{node.gitStatus}</span> : null}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function computeDiffChunks(
  originalContent: string,
  currentContent: string,
  decisions: Record<string, "accepted" | "rejected"> | undefined
): DiffChunk[] {
  const original = originalContent.split("\n");
  const current = currentContent.split("\n");
  const max = Math.max(original.length, current.length);
  const chunks: DiffChunk[] = [];

  let start: number | null = null;
  for (let i = 0; i < max; i += 1) {
    const before = original[i] ?? "";
    const after = current[i] ?? "";
    const changed = before !== after;

    if (changed && start === null) {
      start = i;
    }

    if (!changed && start !== null) {
      const end = i - 1;
      const id = `${start}:${end}`;
      chunks.push({
        id,
        start,
        end,
        original: original.slice(start, end + 1),
        current: current.slice(start, end + 1),
        status: decisions?.[id] ?? "pending"
      });
      start = null;
    }
  }

  if (start !== null) {
    const end = max - 1;
    const id = `${start}:${end}`;
    chunks.push({
      id,
      start,
      end,
      original: original.slice(start, end + 1),
      current: current.slice(start, end + 1),
      status: decisions?.[id] ?? "pending"
    });
  }

  return chunks;
}

function rejectChunkContent(currentContent: string, originalContent: string, chunk: DiffChunk): string {
  const current = currentContent.split("\n");
  const original = originalContent.split("\n");
  current.splice(chunk.start, chunk.end - chunk.start + 1, ...original.slice(chunk.start, chunk.end + 1));
  return current.join("\n");
}

function computeDiffChurnStats(chunks: DiffChunk[]): DiffChurnStats {
  const stats: DiffChurnStats = {
    additions: 0,
    deletions: 0,
    changedLines: 0,
    changedChunks: chunks.length,
    pendingChunks: 0,
    acceptedChunks: 0,
    rejectedChunks: 0
  };

  for (const chunk of chunks) {
    if (chunk.status === "accepted") {
      stats.acceptedChunks += 1;
    } else if (chunk.status === "rejected") {
      stats.rejectedChunks += 1;
    } else {
      stats.pendingChunks += 1;
    }

    const max = Math.max(chunk.original.length, chunk.current.length);
    for (let i = 0; i < max; i += 1) {
      const before = chunk.original[i];
      const after = chunk.current[i];
      if (before !== after) {
        stats.changedLines += 1;
        if (before !== undefined) {
          stats.deletions += 1;
        }
        if (after !== undefined) {
          stats.additions += 1;
        }
      }
    }
  }

  return stats;
}

function detectSensitivePathSignals(path: string): string[] {
  const normalized = path.toLowerCase();
  const signals: string[] = [];

  const includesSegment = (segment: string): boolean =>
    normalized.includes(`/${segment}/`) ||
    normalized.startsWith(`${segment}/`) ||
    normalized.endsWith(`/${segment}`);

  if (includesSegment("infra") || includesSegment("infrastructure") || normalized.includes("terraform")) {
    signals.push("infra");
  }
  if (
    includesSegment("security") ||
    includesSegment("auth") ||
    normalized.includes("/iam/") ||
    normalized.endsWith("/iam.ts")
  ) {
    signals.push("security/auth");
  }
  if (
    normalized.includes(".github/workflows") ||
    normalized.endsWith("dockerfile") ||
    normalized.endsWith("docker-compose.yml")
  ) {
    signals.push("deployment");
  }
  if (normalized.endsWith(".env") || normalized.includes("secrets")) {
    signals.push("secret-adjacent");
  }

  return signals;
}

function toSessionTabSnapshot(tab: Tab): SessionTabSnapshot {
  return {
    path: tab.path,
    binary: tab.binary,
    dirty: tab.dirty,
    content: tab.dirty ? tab.content : "",
    originalContent: tab.dirty ? tab.originalContent : ""
  };
}

function buildSessionSnapshot(input: {
  workspaceRoot: string | null;
  tabs: Tab[];
  activeTab: string | null;
  secondTab: string | null;
  splitEnabled: boolean;
  leftTab: LeftTab;
  panelTab: PanelTab;
  bottomTab: BottomTab;
  autoSaveMode: "manual" | "afterDelay" | "onBlur";
  searchText: string;
  terminalInput: string;
}): SessionSnapshot {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    workspaceRoot: input.workspaceRoot,
    tabs: input.tabs.map(toSessionTabSnapshot),
    activeTab: input.activeTab,
    secondTab: input.secondTab,
    splitEnabled: input.splitEnabled,
    leftTab: input.leftTab,
    panelTab: input.panelTab,
    bottomTab: input.bottomTab,
    autoSaveMode: input.autoSaveMode,
    searchText: input.searchText,
    terminalInput: input.terminalInput
  };
}

export function App() {
  const [workspaceRoot, setWorkspaceRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [secondTab, setSecondTab] = useState<string | null>(null);
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [leftTab, setLeftTab] = useState<LeftTab>("files");
  const [panelTab, setPanelTab] = useState<PanelTab>("agent");
  const [bottomTab, setBottomTab] = useState<BottomTab>("terminal");
  const [layout, setLayout] = usePersistentLayout();
  const [searchText, setSearchText] = useState("");
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [terminalInput, setTerminalInput] = useState("npm run test");
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(null);
  const [terminalSessionStatus, setTerminalSessionStatus] = useState<
    "running" | "exited" | "failed" | "stopped" | "idle"
  >("idle");
  const [terminalSessionInput, setTerminalSessionInput] = useState("");
  const [testOutput, setTestOutput] = useState<string[]>([]);
  const [testSummaries, setTestSummaries] = useState<ParsedTestSummary[]>([]);
  const [pipelineResult, setPipelineResult] = useState<PipelineResult | null>(null);
  const [pipelineLintCommand, setPipelineLintCommand] = useState("npm run lint");
  const [pipelineTypecheckCommand, setPipelineTypecheckCommand] = useState("npm run typecheck");
  const [pipelineTestCommand, setPipelineTestCommand] = useState("npm run test");
  const [pipelineBuildCommand, setPipelineBuildCommand] = useState("npm run build");
  const [logs, setLogs] = useState<string[]>([]);
  const [checkpoints, setCheckpoints] = useState<Array<{ runId: string; path: string }>>([]);
  const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(null);
  const [checkpointDetail, setCheckpointDetail] = useState<{
    runId: string;
    path: string;
    manifest: Record<string, unknown> | null;
    steps: Array<{ stepId: string; files: string[]; preview: Record<string, string> }>;
  } | null>(null);
  const [terminalReplay, setTerminalReplay] = useState<Array<{ runId: string; command: string; status: string; output: string }>>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [pendingApprovalCommand, setPendingApprovalCommand] = useState<string | null>(null);
  const [pendingApprovalReason, setPendingApprovalReason] = useState<string | null>(null);
  const [teamMemory, setTeamMemory] = useState<TeamMemoryEntry[]>([]);
  const [memorySearchResults, setMemorySearchResults] = useState<ScoredTeamMemoryEntry[]>([]);
  const [memorySearchQuery, setMemorySearchQuery] = useState("");
  const [memorySearchTags, setMemorySearchTags] = useState("");
  const [decisionLogs, setDecisionLogs] = useState<DecisionLogEntry[]>([]);
  const [reviewerFindings, setReviewerFindings] = useState<ReviewerFinding[]>([]);
  const [memoryTitle, setMemoryTitle] = useState("Decision context");
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryTags, setMemoryTags] = useState("context,architecture");
  const [decisionTitle, setDecisionTitle] = useState("Adopt change strategy");
  const [decisionContext, setDecisionContext] = useState("");
  const [decisionOptions, setDecisionOptions] = useState("option-a\\noption-b");
  const [decisionChosen, setDecisionChosen] = useState("option-a");
  const [decisionConsequences, setDecisionConsequences] = useState("faster delivery\\nrequires monitoring");
  const [decisionFiles, setDecisionFiles] = useState("");
  const [reviewerFiles, setReviewerFiles] = useState("");
  const [ownershipFiles, setOwnershipFiles] = useState("");
  const [ownershipMap, setOwnershipMap] = useState<OwnershipMatch[]>([]);
  const [ownershipAssignments, setOwnershipAssignments] = useState(
    "agent-1: apps/desktop/src/renderer/App.tsx\nagent-2: apps/desktop/src/main/main.ts"
  );
  const [ownershipConflicts, setOwnershipConflicts] = useState<OwnershipConflictReport | null>(null);
  const [changelogSinceRef, setChangelogSinceRef] = useState("");
  const [changelogDraft, setChangelogDraft] = useState<ChangelogDraft | null>(null);
  const [releaseVersion, setReleaseVersion] = useState("v0.1.0");
  const [releaseHighlights, setReleaseHighlights] = useState("");
  const [releaseNotesDraft, setReleaseNotesDraft] = useState<ReleaseNotesDraft | null>(null);
  const [multiAgentGoal, setMultiAgentGoal] = useState(
    "Implement feature increment with docs, tests, and risk checks"
  );
  const [multiAgentCount, setMultiAgentCount] = useState(3);
  const [multiAgentSummary, setMultiAgentSummary] = useState<{
    coordinatorRunId: string;
    overallStatus: "success" | "failed";
    agentRuns: Array<{
      runId: string;
      status: "success" | "failed" | "blocked";
      steps: number;
      agentId: string;
      focus: string;
    }>;
  } | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [replaceNeedle, setReplaceNeedle] = useState("");
  const [replaceValue, setReplaceValue] = useState("");
  const [replacePreview, setReplacePreview] = useState<Array<{ file: string; count: number }>>([]);
  const [chunkRationale, setChunkRationale] = useState("keep meaningful behavior and preserve tests");
  const [chunkDecisions, setChunkDecisions] = useState<Record<string, Record<string, "accepted" | "rejected">>>({});
  const [patchQueue, setPatchQueue] = useState<DiffQueueItem[]>([]);
  const [diffCheckpoints, setDiffCheckpoints] = useState<DiffCheckpointRecord[]>([]);
  const [allowFullRewriteApply, setAllowFullRewriteApply] = useState(false);
  const [indexReport, setIndexReport] = useState<WorkspaceIndexReport | null>(null);
  const [indexLimit, setIndexLimit] = useState("1200");
  const [indexQuery, setIndexQuery] = useState("agent runtime checkpoints");
  const [indexTokenBudget, setIndexTokenBudget] = useState("4000");
  const [indexRenameFrom, setIndexRenameFrom] = useState("runTask");
  const [indexRenameTo, setIndexRenameTo] = useState("executeTask");
  const [artifactReport, setArtifactReport] = useState<ArtifactCompletenessReport | null>(null);
  const [greenPipelineReport, setGreenPipelineReport] = useState<GreenPipelineReport | null>(null);
  const [builderProjectName, setBuilderProjectName] = useState("Atlas Meridian Service Stack");
  const [builderOutputDir, setBuilderOutputDir] = useState("generated-projects/atlas-meridian-service-stack");
  const [builderResult, setBuilderResult] = useState<ProjectBuilderResult | null>(null);
  const [builderRunning, setBuilderRunning] = useState(false);
  const [refactorFrom, setRefactorFrom] = useState("runTask");
  const [refactorTo, setRefactorTo] = useState("executeTask");
  const [refactorMaxFiles, setRefactorMaxFiles] = useState("1200");
  const [refactorPreviewOnly, setRefactorPreviewOnly] = useState(true);
  const [refactorAllowSensitive, setRefactorAllowSensitive] = useState(false);
  const [refactorRunning, setRefactorRunning] = useState(false);
  const [refactorResult, setRefactorResult] = useState<MultiFileRefactorResult | null>(null);
  const [authSession, setAuthSession] = useState<AuthSession | null>(null);
  const [authProviders, setAuthProviders] = useState<SsoProvider[]>([]);
  const [authRoles, setAuthRoles] = useState<AuthRole[]>([]);
  const [authProviderId, setAuthProviderId] = useState("oidc-default");
  const [authEmail, setAuthEmail] = useState("developer@atlasmeridian.local");
  const [authDisplayName, setAuthDisplayName] = useState("Local Developer");
  const [authSelectedRoles, setAuthSelectedRoles] = useState<AuthRole[]>(["developer"]);
  const [providerEditor, setProviderEditor] = useState({
    id: "oidc-corp",
    name: "Corp OIDC",
    protocol: "oidc" as "oidc" | "saml",
    issuer: "https://id.corp.local",
    entrypoint: "https://id.corp.local/auth",
    clientId: "atlas-corp",
    enabled: true
  });
  const [enterpriseSettings, setEnterpriseSettings] = useState<EnterpriseSettings | null>(null);
  const [enterpriseDraft, setEnterpriseDraft] = useState({
    consent: "unknown" as TelemetryConsent,
    telemetryEnabled: false,
    privacyMode: false,
    mode: "disabled" as ControlPlaneMode,
    baseUrl: "https://control.atlasmeridian.dev",
    requireTls: true,
    allowInsecureLocalhost: false,
    apiToken: "",
    orgId: "",
    workspaceId: ""
  });
  const [controlPlaneHealth, setControlPlaneHealth] = useState<ControlPlaneHealthResult | null>(null);
  const [controlPlanePushResult, setControlPlanePushResult] = useState<ControlPlanePushResult | null>(null);
  const [releaseChannel, setReleaseChannel] = useState<ReleaseChannel>("stable");
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [benchmarkDashboard, setBenchmarkDashboard] = useState<BenchmarkDashboardReport | null>(null);
  const [benchmarkCorpusSize, setBenchmarkCorpusSize] = useState(0);
  const [benchmarkSeed, setBenchmarkSeed] = useState("1337");
  const [benchmarkRunning, setBenchmarkRunning] = useState(false);
  const [autoSaveMode, setAutoSaveMode] = useState<"manual" | "afterDelay" | "onBlur">("manual");
  const [showLeftPane, setShowLeftPane] = useState(false);
  const [showRightPane, setShowRightPane] = useState(false);
  const [showBottomPane, setShowBottomPane] = useState(false);
  const [ideReady, setIdeReady] = useState(
    () => typeof window !== "undefined" && typeof window.ide !== "undefined"
  );
  const dragRef = useRef<null | "left" | "right" | "bottom">(null);
  const sessionHydratedRef = useRef(false);

  const active = useMemo(() => tabs.find((tab) => tab.path === activeTab) ?? null, [tabs, activeTab]);
  const secondary = useMemo(() => tabs.find((tab) => tab.path === secondTab) ?? null, [tabs, secondTab]);

  const diffChunks = useMemo(() => {
    if (!active || active.binary) {
      return [];
    }
    return computeDiffChunks(active.originalContent, active.content, chunkDecisions[active.path]);
  }, [active, chunkDecisions]);
  const diffChurn = useMemo(() => computeDiffChurnStats(diffChunks), [diffChunks]);
  const sensitivePathSignals = useMemo(
    () => (active ? detectSensitivePathSignals(active.path) : []),
    [active]
  );
  const accessibilityStatus = useMemo(() => logs[0] ?? "Atlas Meridian ready", [logs]);

  const toggleLeftFeature = (tab: LeftTab) => {
    if (showLeftPane && leftTab === tab) {
      setShowLeftPane(false);
      return;
    }
    setLeftTab(tab);
    setShowLeftPane(true);
  };

  const toggleRightFeature = (tab: PanelTab) => {
    if (showRightPane && panelTab === tab) {
      setShowRightPane(false);
      return;
    }
    setPanelTab(tab);
    setShowRightPane(true);
  };

  const toggleBottomFeature = (tab: BottomTab) => {
    if (showBottomPane && bottomTab === tab) {
      setShowBottomPane(false);
      return;
    }
    setBottomTab(tab);
    setShowBottomPane(true);
  };

  const focusEditorOnly = () => {
    setShowLeftPane(false);
    setShowRightPane(false);
    setShowBottomPane(false);
  };

  const retryPreloadBridge = () => {
    setIdeReady(typeof window !== "undefined" && typeof window.ide !== "undefined");
  };

  const refreshTree = async (root: string) => {
    const [nodes, statuses] = await Promise.all([window.ide.getTree(root), window.ide.gitStatus(root)]);
    const statusMap = new Map(
      statuses.map((item: { file: string; status: string }) => [item.file, item.status])
    );

    const hydrate = (nodesToHydrate: TreeNode[]): TreeNode[] =>
      nodesToHydrate.map((node) => ({
        ...node,
        gitStatus: statusMap.get(node.path),
        children: node.children ? hydrate(node.children) : undefined
      }));

    setTree(hydrate(nodes));
  };

  const refreshAudit = async () => {
    const entries = await window.ide.getRecentAudit(60);
    setAuditEvents(entries);
  };

  const refreshCheckpoints = async () => {
    const items = await window.ide.listCheckpoints();
    setCheckpoints(items);
  };

  const refreshDiffCheckpoints = async () => {
    const items = await window.ide.listDiffCheckpoints(120);
    setDiffCheckpoints(items);
  };

  const refreshIndexDiagnostics = async () => {
    if (!workspaceRoot) {
      return;
    }
    const report = await window.ide.getWorkspaceIndexDiagnostics(workspaceRoot);
    setIndexReport(report as WorkspaceIndexReport);
  };

  const refreshTeamData = async () => {
    const [memory, decisions] = await Promise.all([
      window.ide.listTeamMemory(),
      window.ide.listDecisionLogs()
    ]);
    setTeamMemory(memory);
    setMemorySearchResults(memory.map((entry) => ({ ...entry, score: 1 })));
    setDecisionLogs(decisions);
  };

  const refreshAuthState = async () => {
    const [providers, roles, session] = await Promise.all([
      window.ide.listAuthProviders(),
      window.ide.listAuthRoles(),
      window.ide.getAuthSession()
    ]);
    setAuthProviders(providers);
    setAuthRoles(roles);
    setAuthSession(session);
    if (providers.length > 0 && !providers.some((provider) => provider.id === authProviderId)) {
      setAuthProviderId(providers[0]?.id ?? "oidc-default");
    }
  };

  const refreshEnterpriseSettings = async () => {
    const settings = await window.ide.getEnterpriseSettings();
    setEnterpriseSettings(settings);
    setEnterpriseDraft({
      consent: settings.telemetry.consent,
      telemetryEnabled: settings.telemetry.enabled,
      privacyMode: settings.telemetry.privacyMode,
      mode: settings.controlPlane.mode,
      baseUrl: settings.controlPlane.baseUrl,
      requireTls: settings.controlPlane.requireTls,
      allowInsecureLocalhost: settings.controlPlane.allowInsecureLocalhost,
      apiToken: settings.controlPlane.apiToken ?? "",
      orgId: settings.controlPlane.orgId ?? "",
      workspaceId: settings.controlPlane.workspaceId ?? ""
    });
  };

  const refreshReleaseChannel = async () => {
    const result = await window.ide.getReleaseChannel();
    setReleaseChannel(result.channel);
  };

  const refreshBenchmarkDashboard = async () => {
    const [dashboard, corpus] = await Promise.all([
      window.ide.getBenchmarkDashboard(),
      window.ide.getBenchmarkCorpus()
    ]);
    setBenchmarkDashboard(dashboard);
    setBenchmarkCorpusSize(corpus.length);
  };

  useEffect(() => {
    if (ideReady) {
      return;
    }
    const interval = window.setInterval(() => {
      if (typeof window.ide !== "undefined") {
        setIdeReady(true);
      }
    }, 180);
    const timeout = window.setTimeout(() => {
      window.clearInterval(interval);
    }, 9000);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [ideReady]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveActive();
      }
    };

    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [activeTab, tabs, workspaceRoot]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (tabs.some((tab) => tab.dirty)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [tabs]);

  useEffect(() => {
    if (!ideReady) {
      return;
    }
    if (!workspaceRoot) {
      return;
    }

    void refreshTree(workspaceRoot);
    void refreshAudit();
    void refreshCheckpoints();
    void refreshDiffCheckpoints();
    void refreshIndexDiagnostics();
    void refreshTeamData();
    void refreshAuthState();
    void refreshEnterpriseSettings();
    void refreshReleaseChannel();
    void refreshBenchmarkDashboard();
    void window.ide.startWatch(workspaceRoot);
    const unsubscribe = window.ide.onWorkspaceChanged(async () => {
      await refreshTree(workspaceRoot);
      setLogs((prev) => [`[watch] workspace changed ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 200));
    });

    return () => {
      unsubscribe();
      void window.ide.stopWatch(workspaceRoot);
    };
  }, [workspaceRoot, ideReady]);

  useEffect(() => {
    if (!ideReady) {
      return;
    }
    void refreshCheckpoints();
    void refreshDiffCheckpoints();
    void refreshIndexDiagnostics();
    void refreshAudit();
    void refreshTeamData();
    void refreshAuthState();
    void refreshEnterpriseSettings();
    void refreshReleaseChannel();
    void refreshBenchmarkDashboard();
  }, [ideReady]);

  useEffect(() => {
    if (!ideReady) {
      return;
    }
    if (sessionHydratedRef.current) {
      return;
    }
    sessionHydratedRef.current = true;
    const snapshot = loadSessionSnapshot();
    if (!snapshot) {
      return;
    }

    setSplitEnabled(snapshot.splitEnabled);
    setLeftTab(snapshot.leftTab);
    setPanelTab(snapshot.panelTab);
    setBottomTab(snapshot.bottomTab);
    setAutoSaveMode(snapshot.autoSaveMode);
    setSearchText(snapshot.searchText);
    setTerminalInput(snapshot.terminalInput);

    const root = snapshot.workspaceRoot;
    if (!root) {
      return;
    }

    void (async () => {
      try {
        await window.ide.getTree(root);
      } catch {
        setLogs((prev) => [`[session] skipped stale workspace ${root}`, ...prev].slice(0, 200));
        return;
      }

      setWorkspaceRoot(root);

      const restoredTabs: Tab[] = [];
      for (const savedTab of snapshot.tabs) {
        try {
          const file = await window.ide.readFile(root, savedTab.path);
          if (file.content === null && !file.binary) {
            continue;
          }
          if (file.binary) {
            restoredTabs.push({
              path: savedTab.path,
              content: "",
              originalContent: "",
              dirty: false,
              binary: true
            });
            continue;
          }
          const diskContent = file.content ?? "";
          const content = savedTab.dirty ? savedTab.content : diskContent;
          const originalContent = savedTab.dirty ? savedTab.originalContent || diskContent : diskContent;
          restoredTabs.push({
            path: savedTab.path,
            content,
            originalContent,
            dirty: savedTab.dirty && content !== originalContent,
            binary: false
          });
        } catch {
          continue;
        }
      }

      setTabs(restoredTabs);
      const tabPathSet = new Set(restoredTabs.map((tab) => tab.path));
      const restoredActive =
        snapshot.activeTab && tabPathSet.has(snapshot.activeTab)
          ? snapshot.activeTab
          : (restoredTabs[0]?.path ?? null);
      const restoredSecond =
        snapshot.secondTab && tabPathSet.has(snapshot.secondTab)
          ? snapshot.secondTab
          : (restoredTabs[1]?.path ?? restoredTabs[0]?.path ?? null);
      setActiveTab(restoredActive);
      setSecondTab(restoredSecond);
      setLogs((prev) => [`[session] restored ${restoredTabs.length} tabs`, ...prev].slice(0, 200));
    })();
  }, [ideReady]);

  useEffect(() => {
    if (!sessionHydratedRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      saveSessionSnapshot(
        buildSessionSnapshot({
          workspaceRoot,
          tabs,
          activeTab,
          secondTab,
          splitEnabled,
          leftTab,
          panelTab,
          bottomTab,
          autoSaveMode,
          searchText,
          terminalInput
        })
      );
    }, 180);
    return () => window.clearTimeout(timer);
  }, [
    workspaceRoot,
    tabs,
    activeTab,
    secondTab,
    splitEnabled,
    leftTab,
    panelTab,
    bottomTab,
    autoSaveMode,
    searchText,
    terminalInput
  ]);

  useEffect(() => {
    if (!workspaceRoot || autoSaveMode !== "afterDelay" || !active || !active.dirty || active.binary) {
      return;
    }

    const timer = setTimeout(() => {
      void saveActive();
    }, 1200);
    return () => clearTimeout(timer);
  }, [autoSaveMode, workspaceRoot, active?.path, active?.content, active?.dirty]);

  useEffect(() => {
    if (!ideReady) {
      return;
    }
    if (!terminalSessionId || terminalSessionStatus !== "running") {
      return;
    }
    const interval = setInterval(() => {
      void (async () => {
        const snapshot = await window.ide.readTerminalSession(terminalSessionId);
        if (!snapshot) {
          setTerminalSessionStatus("failed");
          return;
        }
        if (snapshot.output) {
          setTerminalOutput((prev) => [snapshot.output, ...prev].slice(0, 400));
        }
        if (snapshot.status !== "running") {
          setTerminalSessionStatus(snapshot.status);
          setLogs((prev) => [
            `[pty] session ${snapshot.sessionId} ${snapshot.status} exit=${snapshot.exitCode ?? "none"}`,
            ...prev
          ]);
        }
      })();
    }, 300);
    return () => clearInterval(interval);
  }, [terminalSessionId, terminalSessionStatus, ideReady]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current) {
        return;
      }
      if (dragRef.current === "left") {
        setLayout({ ...layout, leftWidth: Math.max(220, Math.min(520, event.clientX)) });
      }
      if (dragRef.current === "right") {
        const rightWidth = Math.max(280, Math.min(600, window.innerWidth - event.clientX));
        setLayout({ ...layout, rightWidth });
      }
      if (dragRef.current === "bottom") {
        const bottomHeight = Math.max(160, Math.min(420, window.innerHeight - event.clientY));
        setLayout({ ...layout, bottomHeight });
      }
    };

    const onUp = () => {
      dragRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [layout]);

  const openWorkspace = async () => {
    const root = await window.ide.openWorkspace();
    if (!root) {
      return;
    }
    setTabs([]);
    setActiveTab(null);
    setSecondTab(null);
    setSearchHits([]);
    setWorkspaceRoot(root);
    setShowLeftPane(true);
    setLeftTab("files");
    setLogs((prev) => [`[workspace] opened ${root}`, ...prev]);
  };

  const openFile = async (relPath: string) => {
    if (!workspaceRoot) {
      return;
    }
    const file = await window.ide.readFile(workspaceRoot, relPath);
    const tab: Tab = {
      path: relPath,
      content: file.content ?? "",
      originalContent: file.content ?? "",
      dirty: false,
      binary: file.binary
    };

    setTabs((current) => {
      const existing = current.find((candidate) => candidate.path === relPath);
      if (existing) {
        return current;
      }
      return [...current, tab];
    });
    setActiveTab(relPath);
    if (!secondTab) {
      setSecondTab(relPath);
    }
  };

  const saveActive = async () => {
    if (!workspaceRoot || !activeTab) {
      return;
    }
    const target = tabs.find((tab) => tab.path === activeTab);
    if (!target || target.binary) {
      return;
    }
    await window.ide.writeFile(workspaceRoot, target.path, target.content);
    setTabs((current) =>
      current.map((tab) =>
        tab.path === target.path
          ? { ...tab, dirty: false, originalContent: tab.content }
          : tab
      )
    );
    setLogs((prev) => [`[save] ${target.path}`, ...prev]);
    await refreshAudit();
  };

  const runProjectSearch = async () => {
    if (!workspaceRoot) {
      return;
    }
    const hits = await window.ide.searchProject(workspaceRoot, searchText);
    setSearchHits(hits);
    setLeftTab("search");
    setShowLeftPane(true);
  };

  const runCommand = async () => {
    if (!workspaceRoot || !terminalInput.trim()) {
      return;
    }
    const result = await window.ide.runCommand(workspaceRoot, terminalInput.trim());
    const riskLabel = result.highRisk?.categories.length ? ` risk=${result.highRisk.categories.join(",")}` : "";
    setTerminalOutput((prev) => [`$ ${result.command}`, result.stdout, result.stderr, ...prev].slice(0, 400));
    setLogs((prev) => [`[terminal] ${result.policy.decision} ${result.command}${riskLabel}`, ...prev]);
    if (result.parsedTest) {
      setTestSummaries((prev) => [result.parsedTest as ParsedTestSummary, ...prev].slice(0, 80));
      setTestOutput((prev) => [`${result.stdout}${result.stderr}`.trim(), ...prev].slice(0, 100));
      setBottomTab("tests");
      setShowBottomPane(true);
    } else if (/test/.test(result.command)) {
      setTestOutput((prev) => [`${result.stdout}${result.stderr}`.trim(), ...prev].slice(0, 100));
      setBottomTab("tests");
      setShowBottomPane(true);
    }
    if (result.policy.decision === "require_approval") {
      setPendingApprovalCommand(result.command);
      setPendingApprovalReason(result.highRisk?.prompt ?? result.policy.reason);
      setPanelTab("plan");
      setShowRightPane(true);
    }
    if (result.policy.decision !== "require_approval") {
      setPendingApprovalReason(null);
    }
    if (result.artifactPath) {
      await refreshCheckpoints();
    }
    await refreshAudit();
  };

  const runApprovedCommand = async () => {
    if (!workspaceRoot || !pendingApprovalCommand) {
      return;
    }
    const result = await window.ide.runApprovedCommand(workspaceRoot, pendingApprovalCommand);
    setTerminalOutput((prev) => [`$ [approved] ${result.command}`, result.stdout, result.stderr, ...prev].slice(0, 400));
    setLogs((prev) => [`[terminal-approved] ${result.command}`, ...prev]);
    setPendingApprovalCommand(null);
    setPendingApprovalReason(null);
    if (result.parsedTest) {
      setTestSummaries((prev) => [result.parsedTest as ParsedTestSummary, ...prev].slice(0, 80));
      setTestOutput((prev) => [`${result.stdout}${result.stderr}`.trim(), ...prev].slice(0, 100));
      setBottomTab("tests");
      setShowBottomPane(true);
    }
    if (result.artifactPath) {
      await refreshCheckpoints();
    }
    await refreshAudit();
  };

  const startPtySession = async () => {
    if (!workspaceRoot || !terminalInput.trim()) {
      return;
    }
    const result = (await window.ide.startTerminalSession(
      workspaceRoot,
      terminalInput.trim()
    )) as TerminalSessionStartResult;
    if (result.status === "running" && result.sessionId) {
      setTerminalSessionId(result.sessionId);
      setTerminalSessionStatus("running");
      setTerminalOutput((prev) => [`$ [pty] ${terminalInput.trim()}`, ...prev].slice(0, 400));
      setBottomTab("terminal");
      setShowBottomPane(true);
      setLogs((prev) => [`[pty] started ${result.sessionId}`, ...prev]);
      return;
    }

    if (result.status === "blocked") {
      setPendingApprovalCommand(terminalInput.trim());
      setPendingApprovalReason(result.highRisk?.prompt ?? result.reason);
      setPanelTab("plan");
      setShowRightPane(true);
      setLogs((prev) => [`[pty] blocked ${result.reason}`, ...prev]);
      return;
    }

    setLogs((prev) => [`[pty] denied ${result.reason}`, ...prev]);
  };

  const sendPtyInput = async () => {
    if (!terminalSessionId || !terminalSessionInput) {
      return;
    }
    const result = await window.ide.writeTerminalSession(terminalSessionId, terminalSessionInput);
    if (result.ok) {
      setTerminalOutput((prev) => [`> ${terminalSessionInput}`, ...prev].slice(0, 400));
      setTerminalSessionInput("");
    }
  };

  const stopPtySession = async () => {
    if (!terminalSessionId) {
      return;
    }
    const result = await window.ide.stopTerminalSession(terminalSessionId);
    if (result.ok) {
      setTerminalSessionStatus("stopped");
      setLogs((prev) => [`[pty] stopped ${terminalSessionId}`, ...prev]);
    }
  };

  const runPipeline = async () => {
    if (!workspaceRoot) {
      return;
    }
    const result = await window.ide.runPipeline(workspaceRoot, {
      lint: pipelineLintCommand,
      typecheck: pipelineTypecheckCommand,
      test: pipelineTestCommand,
      build: pipelineBuildCommand
    });
    setPipelineResult(result as PipelineResult);
    const stageLog = result.stages
      .map((stage) => `$ [${stage.stage}] ${stage.command}\n${stage.stdout}\n${stage.stderr}`)
      .join("\n");
    setTerminalOutput((prev) => [stageLog.trim(), ...prev].slice(0, 400));
    setLogs((prev) => [
      `[pipeline] ${result.status} lint=${result.checks.lint} typecheck=${result.checks.typecheck} test=${result.checks.test} build=${result.checks.build}`,
      ...prev
    ]);
    setBottomTab("terminal");
    setShowBottomPane(true);

    const parsed = result.stages
      .map((stage) => stage.parsedTest)
      .filter((summary): summary is ParsedTestSummary => summary !== null);
    if (parsed.length > 0) {
      setTestSummaries((prev) => [...parsed, ...prev].slice(0, 80));
      setTestOutput((prev) => [
        ...parsed.map(
          (summary) =>
            `[${summary.framework}] total=${summary.total} passed=${summary.passed} failed=${summary.failed} skipped=${summary.skipped}`
        ),
        ...prev
      ].slice(0, 100));
      setBottomTab("tests");
      setShowBottomPane(true);
    }

    if (result.blockedStage) {
      const blocked = result.stages.find((stage) => stage.stage === result.blockedStage);
      setPendingApprovalCommand(blocked?.command ?? null);
      setPendingApprovalReason(blocked?.highRisk?.prompt ?? blocked?.policy.reason ?? "pipeline blocked");
      setPanelTab("plan");
      setShowRightPane(true);
    } else {
      setPendingApprovalReason(null);
    }

    if (result.artifactPath) {
      await refreshCheckpoints();
    }
    await refreshAudit();
  };

  const runWorkspaceIndexScan = async () => {
    if (!workspaceRoot) {
      return;
    }
    const limit = Math.max(50, Math.min(5000, Number(indexLimit) || 1200));
    const tokenBudget = Math.max(300, Math.min(12000, Number(indexTokenBudget) || 4000));
    const report = await window.ide.runWorkspaceIndex({
      root: workspaceRoot,
      limit,
      query: indexQuery.trim(),
      tokenBudget,
      renameFrom: indexRenameFrom.trim(),
      renameTo: indexRenameTo.trim()
    });
    setIndexReport(report as WorkspaceIndexReport);
    setLogs((prev) => [
      `[indexer] files=${report.diagnostics.indexedFiles} symbols=${report.diagnostics.totalSymbols} errors=${report.diagnostics.parseErrors} freshness_target=${report.freshnessTargets.meetsTarget ? "pass" : "fail"} call_edges=${report.callGraph.edges.length}`,
      ...prev
    ]);
    await refreshAudit();
  };

  const runArtifactCompletenessCheck = async () => {
    if (!workspaceRoot) {
      return;
    }
    const report = await window.ide.checkArtifactCompleteness(workspaceRoot);
    setArtifactReport(report as ArtifactCompletenessReport);
    setLogs((prev) => [
      `[artifact-check] completeness=${report.completenessPercent}% missing=${report.missing.length}`,
      ...prev
    ]);
    await refreshAudit();
  };

  const runGreenPipelineCheck = async () => {
    const report = await window.ide.checkGreenPipeline({
      limit: 40,
      targetPercent: 90
    });
    setGreenPipelineReport(report as GreenPipelineReport);
    setLogs((prev) => [
      `[green-pipeline] rate=${report.passRatePercent}% (${report.passedRuns}/${report.totalRuns})`,
      ...prev
    ]);
    await refreshAudit();
  };

  const updateActiveContent = (content: string) => {
    if (!activeTab) {
      return;
    }
    setTabs((current) =>
      current.map((tab) => {
        if (tab.path !== activeTab) {
          return tab;
        }
        const dirty = content !== tab.originalContent;
        return { ...tab, content, dirty };
      })
    );
  };

  const runReplacePreview = () => {
    if (!replaceNeedle.trim()) {
      setReplacePreview([]);
      return;
    }
    const preview = tabs
      .map((tab) => ({
        file: tab.path,
        count: tab.content.split(replaceNeedle).length - 1
      }))
      .filter((item) => item.count > 0);
    setReplacePreview(preview);
  };

  const applyReplaceCurrent = () => {
    if (!activeTab || !replaceNeedle) {
      return;
    }
    setTabs((current) =>
      current.map((tab) => {
        if (tab.path !== activeTab) {
          return tab;
        }
        const next = tab.content.split(replaceNeedle).join(replaceValue);
        return {
          ...tab,
          content: next,
          dirty: next !== tab.originalContent
        };
      })
    );
  };

  const applyReplaceAllOpen = () => {
    if (!replaceNeedle) {
      return;
    }
    setTabs((current) =>
      current.map((tab) => {
        const next = tab.content.split(replaceNeedle).join(replaceValue);
        return {
          ...tab,
          content: next,
          dirty: next !== tab.originalContent
        };
      })
    );
  };

  const applyChunkDecision = (chunk: DiffChunk, decision: "accepted" | "rejected") => {
    if (!active) {
      return;
    }

    setChunkDecisions((current) => ({
      ...current,
      [active.path]: {
        ...(current[active.path] ?? {}),
        [chunk.id]: decision
      }
    }));

    if (decision === "rejected") {
      setTabs((current) =>
        current.map((tab) => {
          if (tab.path !== active.path) {
            return tab;
          }
          const content = rejectChunkContent(tab.content, tab.originalContent, chunk);
          return {
            ...tab,
            content,
            dirty: content !== tab.originalContent
          };
        })
      );
    }

    setPatchQueue((current) => [
      {
        id: `${active.path}-${chunk.id}-${Date.now()}`,
        file: active.path,
        chunkId: chunk.id,
        decision,
        rationale: chunkRationale,
        timestamp: new Date().toISOString()
      },
      ...current
    ].slice(0, 100));
  };

  const applyPatchQueue = async () => {
    if (!workspaceRoot || !active || active.binary) {
      return;
    }
    const appliedChunks = patchQueue
      .filter((item) => item.file === active.path && item.decision === "accepted")
      .map((item) => item.chunkId);
    const result = await window.ide.applyDiffQueue({
      root: workspaceRoot,
      path: active.path,
      baseContent: active.originalContent,
      nextContent: active.content,
      appliedChunks,
      allowFullRewrite: allowFullRewriteApply
    });

    if (!result.ok) {
      setLogs((prev) => [
        `[diff-apply] failed ${active.path}: ${result.reason ?? "unknown"}`,
        ...prev
      ]);
      return;
    }

    setTabs((current) =>
      current.map((tab) =>
        tab.path === active.path
          ? { ...tab, originalContent: tab.content, dirty: false }
          : tab
      )
    );
    setChunkDecisions((current) => ({
      ...current,
      [active.path]: {}
    }));
    setPatchQueue((current) => current.filter((item) => item.file !== active.path));
    setLogs((prev) => [
      `[diff-apply] applied ${active.path} checkpoint=${result.checkpointId ?? "none"}`,
      ...prev
    ]);
    setAllowFullRewriteApply(false);
    await refreshAudit();
    await refreshDiffCheckpoints();
  };

  const verifyDiffCheckpointSignature = async (checkpointId: string) => {
    const result = await window.ide.verifyDiffCheckpointSignature(checkpointId);
    setLogs((prev) => [
      `[diff-signature] ${checkpointId} ${result.valid ? "valid" : `invalid: ${result.reason ?? "unknown"}`}`,
      ...prev
    ]);
    await refreshAudit();
    await refreshDiffCheckpoints();
  };

  const revertDiffFromCheckpoint = async (checkpointId: string) => {
    const result = await window.ide.revertDiffCheckpoint(checkpointId);
    if (!result.ok || !result.checkpoint) {
      setLogs((prev) => [`[diff-revert] failed ${checkpointId}: ${result.reason ?? "unknown"}`, ...prev]);
      return;
    }
    const checkpoint = result.checkpoint;
    if (workspaceRoot && checkpoint.root === workspaceRoot) {
      const file = await window.ide.readFile(workspaceRoot, checkpoint.path);
      if (!file.binary && file.content !== null) {
        setTabs((current) =>
          current.map((tab) =>
            tab.path === checkpoint.path
              ? {
                  ...tab,
                  content: file.content ?? "",
                  originalContent: file.content ?? "",
                  dirty: false
                }
              : tab
          )
        );
      }
    }
    setLogs((prev) => [
      `[diff-revert] restored ${checkpoint.path} from ${checkpointId}`,
      ...prev
    ]);
    await refreshAudit();
    await refreshDiffCheckpoints();
  };

  const runPaletteCommand = async (command: string) => {
    setCommandPaletteOpen(false);
    if (command === "Open Workspace") {
      await openWorkspace();
    } else if (command === "Toggle Split Editor") {
      setSplitEnabled((flag) => !flag);
    } else if (command === "Run Tests") {
      setTerminalInput("npm test");
      await runCommand();
    } else if (command === "Focus Agent") {
      setPanelTab("agent");
      setShowRightPane(true);
    } else if (command === "Export Audit") {
      const result = await window.ide.exportAudit();
      setLogs((prev) => [`[audit-export] ${result.path} (${result.count} events)`, ...prev]);
    }
  };

  const loadCheckpointDetail = async (runId: string) => {
    setSelectedCheckpoint(runId);
    const detail = await window.ide.getCheckpointDetail(runId);
    setCheckpointDetail(detail);
  };

  const loadTerminalReplay = async () => {
    const replay = await window.ide.replayTerminal(20);
    setTerminalReplay(replay);
    setBottomTab("terminal");
    setShowBottomPane(true);
    setLogs((prev) => [`[replay] loaded ${replay.length} terminal runs`, ...prev]);
  };

  const runMultiAgentMode = async () => {
    if (!multiAgentGoal.trim()) {
      return;
    }
    const summary = await window.ide.runMultiAgentTask({
      goal: multiAgentGoal.trim(),
      acceptanceCriteria: [
        "all checks pass",
        "artifacts updated",
        "risk notes documented"
      ],
      agentCount: multiAgentCount
    });
    setMultiAgentSummary(summary);
    setPanelTab("agent");
    setShowRightPane(true);
    await refreshCheckpoints();
    await refreshAudit();
    setLogs((prev) => [
      `[multi-agent] ${summary.coordinatorRunId} ${summary.overallStatus}`,
      ...prev
    ]);
  };

  const runProjectBuilderMode = async () => {
    if (!workspaceRoot || !builderProjectName.trim() || builderRunning) {
      return;
    }
    setBuilderRunning(true);
    try {
      const result = await window.ide.runProjectBuilder({
        workspaceRoot,
        projectName: builderProjectName.trim(),
        outputDir: builderOutputDir.trim() || undefined
      });
      setBuilderResult(result);
      await refreshTree(workspaceRoot);
      await refreshCheckpoints();
      await refreshAudit();
      setLogs((prev) => [
        `[project-builder] ${result.runId} files=${result.generatedFiles.length} completeness=${result.completeness.completenessPercent}%`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "project builder failed";
      setLogs((prev) => [`[project-builder] error: ${message}`, ...prev]);
    } finally {
      setBuilderRunning(false);
    }
  };

  const runMultiFileRefactorMode = async () => {
    if (!workspaceRoot || !refactorFrom.trim() || !refactorTo.trim() || refactorRunning) {
      return;
    }
    setRefactorRunning(true);
    try {
      const result = await window.ide.runMultiFileRefactor({
        root: workspaceRoot,
        from: refactorFrom.trim(),
        to: refactorTo.trim(),
        previewOnly: refactorPreviewOnly,
        allowSensitive: refactorAllowSensitive,
        maxFiles: Math.max(20, Math.min(5000, Number(refactorMaxFiles) || 1200))
      });
      setRefactorResult(result);
      await refreshCheckpoints();
      await refreshAudit();
      if (!result.previewOnly && result.status === "applied") {
        await refreshTree(workspaceRoot);
      }
      setLogs((prev) => [
        `[multi-refactor] ${result.status} ${result.from}->${result.to} files=${result.filesTouched} matches=${result.totalMatches}`,
        ...prev
      ]);
      setPanelTab("plan");
      setShowRightPane(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "multi-file refactor failed";
      setLogs((prev) => [`[multi-refactor] error: ${message}`, ...prev]);
    } finally {
      setRefactorRunning(false);
    }
  };

  const loginAuth = async () => {
    if (!authProviderId.trim() || !authEmail.trim()) {
      return;
    }
    try {
      const session = await window.ide.loginAuthSession({
        providerId: authProviderId.trim(),
        email: authEmail.trim(),
        displayName: authDisplayName.trim() || undefined,
        roles: authSelectedRoles
      });
      setAuthSession(session);
      await refreshAudit();
      setLogs((prev) => [
        `[auth] logged in ${session.email} roles=${session.roles.join(",")}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "login failed";
      setLogs((prev) => [`[auth] login error: ${message}`, ...prev]);
    }
  };

  const logoutAuth = async () => {
    await window.ide.logoutAuthSession();
    setAuthSession(null);
    await refreshAudit();
    setLogs((prev) => ["[auth] logged out", ...prev]);
  };

  const upsertProvider = async () => {
    try {
      const provider = await window.ide.upsertAuthProvider(providerEditor);
      await refreshAuthState();
      setLogs((prev) => [
        `[auth] provider upserted ${provider.id} (${provider.protocol})`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider update failed";
      setLogs((prev) => [`[auth] provider error: ${message}`, ...prev]);
    }
  };

  const saveEnterpriseSettings = async () => {
    try {
      await window.ide.setPrivacyMode(enterpriseDraft.privacyMode);
      await window.ide.updateTelemetrySettings({
        consent: enterpriseDraft.consent,
        enabled: enterpriseDraft.telemetryEnabled
      });
      await window.ide.updateControlPlaneSettings({
        mode: enterpriseDraft.mode,
        baseUrl: enterpriseDraft.baseUrl.trim(),
        requireTls: enterpriseDraft.requireTls,
        allowInsecureLocalhost: enterpriseDraft.allowInsecureLocalhost,
        apiToken: enterpriseDraft.apiToken.trim() || null,
        orgId: enterpriseDraft.orgId.trim() || null,
        workspaceId: enterpriseDraft.workspaceId.trim() || null
      });
      await Promise.all([refreshEnterpriseSettings(), refreshAudit()]);
      setLogs((prev) => [
        `[enterprise] settings saved mode=${enterpriseDraft.mode} consent=${enterpriseDraft.consent} privacy=${enterpriseDraft.privacyMode}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to save enterprise settings";
      setLogs((prev) => [`[enterprise] settings error: ${message}`, ...prev]);
    }
  };

  const runControlPlaneHealthCheck = async () => {
    try {
      const result = await window.ide.controlPlaneHealthCheck();
      setControlPlaneHealth(result);
      await refreshAudit();
      setLogs((prev) => [
        `[control-plane] health ok=${result.ok} mode=${result.mode} status=${result.statusCode ?? "none"}${result.reason ? ` reason=${result.reason}` : ""}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "control-plane health check failed";
      setLogs((prev) => [`[control-plane] health error: ${message}`, ...prev]);
    }
  };

  const pushControlPlaneMetric = async () => {
    const repoName = workspaceRoot
      ? workspaceRoot.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "workspace"
      : "workspace";
    const payload = [
      {
        metric_name: "manual_control_plane_ping",
        ts: new Date().toISOString(),
        value: 1,
        tags: {
          org: enterpriseDraft.orgId.trim() || "local-org",
          repo: repoName,
          branch: "main",
          run_id: `manual-${Date.now()}`
        }
      }
    ];
    try {
      const result = await window.ide.pushControlPlaneMetrics(payload);
      setControlPlanePushResult(result);
      await refreshAudit();
      setLogs((prev) => [
        `[control-plane] metric push sent=${result.sent} accepted=${result.accepted}${result.reason ? ` reason=${result.reason}` : ""}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "metric push failed";
      setLogs((prev) => [`[control-plane] metric push error: ${message}`, ...prev]);
    }
  };

  const pushControlPlaneAudit = async () => {
    try {
      const result = await window.ide.pushControlPlaneAudit(20);
      setControlPlanePushResult(result);
      await refreshAudit();
      setLogs((prev) => [
        `[control-plane] audit push sent=${result.sent} accepted=${result.accepted}${result.reason ? ` reason=${result.reason}` : ""}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "audit push failed";
      setLogs((prev) => [`[control-plane] audit push error: ${message}`, ...prev]);
    }
  };

  const saveReleaseChannel = async () => {
    try {
      const result = await window.ide.setReleaseChannel(releaseChannel);
      setReleaseChannel(result.channel);
      await refreshAudit();
      setLogs((prev) => [`[updates] release channel set to ${result.channel}`, ...prev]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "failed to set release channel";
      setLogs((prev) => [`[updates] channel error: ${message}`, ...prev]);
    }
  };

  const runUpdateCheck = async () => {
    try {
      const result = await window.ide.checkForUpdates();
      setUpdateCheckResult(result);
      await refreshAudit();
      setLogs((prev) => [
        `[updates] check channel=${result.channel} skipped=${result.skipped}${result.reason ? ` reason=${result.reason}` : ""}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "update check failed";
      setLogs((prev) => [`[updates] check error: ${message}`, ...prev]);
    }
  };

  const runSimulatedBenchmark = async () => {
    if (benchmarkRunning) {
      return;
    }
    setBenchmarkRunning(true);
    try {
      const seed = Number(benchmarkSeed);
      const report = await window.ide.runSimulatedBenchmark({
        seed: Number.isFinite(seed) ? seed : 1337,
        runId: `ui-benchmark-${Date.now()}`
      });
      setBenchmarkDashboard(report);
      await refreshAudit();
      setLogs((prev) => [
        `[benchmark] total=${report.scoreCard.total} passRate=${(report.scoreCard.passRate * 100).toFixed(1)}% gate=${report.gate.pass ? "pass" : "fail"} alerts=${report.alerts.length}`,
        ...prev
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "benchmark run failed";
      setLogs((prev) => [`[benchmark] run error: ${message}`, ...prev]);
    } finally {
      setBenchmarkRunning(false);
    }
  };

  const toggleAuthRole = (role: AuthRole) => {
    setAuthSelectedRoles((current) => {
      if (current.includes(role)) {
        const next = current.filter((item) => item !== role);
        return next.length > 0 ? next : ["viewer"];
      }
      return [...current, role];
    });
  };

  const createMemoryEntry = async () => {
    if (!memoryTitle.trim() || !memoryContent.trim()) {
      return;
    }
    await window.ide.addTeamMemory({
      title: memoryTitle.trim(),
      content: memoryContent.trim(),
      tags: memoryTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    });
    await refreshTeamData();
    await refreshAudit();
    setMemoryContent("");
    setLogs((prev) => [`[team-memory] added ${memoryTitle}`, ...prev]);
  };

  const searchMemoryEntries = async () => {
    const results = await window.ide.searchTeamMemory({
      query: memorySearchQuery,
      tags: memorySearchTags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      limit: 80
    });
    setMemorySearchResults(results);
    setLogs((prev) => [`[team-memory] search results ${results.length}`, ...prev]);
  };

  const createDecisionLog = async () => {
    if (!decisionTitle.trim() || !decisionContext.trim() || !decisionChosen.trim()) {
      return;
    }
    await window.ide.addDecisionLog({
      title: decisionTitle.trim(),
      context: decisionContext.trim(),
      options: decisionOptions
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      chosen: decisionChosen.trim(),
      consequences: decisionConsequences
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      relatedFiles: decisionFiles
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    });
    await refreshTeamData();
    await refreshAudit();
    setDecisionContext("");
    setDecisionFiles("");
    setLogs((prev) => [`[decision-log] added ${decisionTitle}`, ...prev]);
  };

  const runReviewer = async () => {
    if (!workspaceRoot) {
      return;
    }
    const files = reviewerFiles
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    const findings = await window.ide.runReviewerMode({
      root: workspaceRoot,
      files
    });
    setReviewerFindings(findings);
    await refreshAudit();
    setLogs((prev) => [`[reviewer] ${findings.length} findings`, ...prev]);
  };

  const runOwnershipMapping = async () => {
    if (!workspaceRoot) {
      return;
    }
    const files = ownershipFiles
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);
    if (files.length === 0) {
      setOwnershipMap([]);
      return;
    }
    const mapping = await window.ide.mapOwnership({
      root: workspaceRoot,
      files
    });
    setOwnershipMap(mapping);
    await refreshAudit();
    setLogs((prev) => [`[ownership] mapped ${mapping.length} files`, ...prev]);
  };

  const runOwnershipConflictDetection = async () => {
    if (!workspaceRoot) {
      return;
    }
    const assignments = ownershipAssignments
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf(":");
        if (separator === -1) {
          return null;
        }
        const agentId = line.slice(0, separator).trim();
        const files = line
          .slice(separator + 1)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (!agentId || files.length === 0) {
          return null;
        }
        return { agentId, files };
      })
      .filter((entry): entry is { agentId: string; files: string[] } => entry !== null);

    if (assignments.length === 0) {
      setOwnershipConflicts({
        fileConflicts: [],
        ownerConflicts: []
      });
      return;
    }

    const report = await window.ide.detectOwnershipConflicts({
      root: workspaceRoot,
      assignments
    });
    setOwnershipConflicts(report);
    await refreshAudit();
    setLogs((prev) => [
      `[ownership-conflicts] files=${report.fileConflicts.length} owners=${report.ownerConflicts.length}`,
      ...prev
    ]);
  };

  const runChangelogDraft = async () => {
    if (!workspaceRoot) {
      return;
    }
    const draft = await window.ide.draftChangelog({
      root: workspaceRoot,
      sinceRef: changelogSinceRef.trim() || undefined
    });
    setChangelogDraft(draft);
    await refreshAudit();
    setLogs((prev) => [`[changelog] generated ${draft.sections.length} sections`, ...prev]);
  };

  const runReleaseNotesDraft = async () => {
    if (!workspaceRoot) {
      return;
    }
    const draft = await window.ide.draftReleaseNotes({
      root: workspaceRoot,
      version: releaseVersion.trim() || "v0.1.0",
      highlights: releaseHighlights
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    });
    setReleaseNotesDraft(draft);
    await refreshAudit();
    setLogs((prev) => [`[release-notes] generated for ${draft.version}`, ...prev]);
  };

  const breadcrumbs = activeTab ? activeTab.split("/") : [];
  const leftWidth = showLeftPane ? layout.leftWidth : 0;
  const rightWidth = showRightPane ? layout.rightWidth : 0;
  const bottomHeight = showBottomPane ? layout.bottomHeight : 0;
  const leftSplitterWidth = showLeftPane ? 6 : 0;
  const rightSplitterWidth = showRightPane ? 6 : 0;
  const bottomSplitterHeight = showBottomPane ? 6 : 0;

  if (!ideReady) {
    return (
      <div className="app-crash-fallback">
        <div className="app-crash-card">
          <h1>Atlas Meridian is waiting for desktop preload</h1>
          <p>The UI will become available as soon as the secure bridge is ready.</p>
          <code>preload api pending</code>
          <div className="inline-search">
            <button onClick={retryPreloadBridge}>Retry Bridge Check</button>
            <button onClick={() => window.location.reload()}>Reload UI</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell simple-ui" aria-label="Atlas Meridian">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{accessibilityStatus}</div>
      <header className="topbar">
        <div className="logo-wrap">
          <span className="logo-dot" />
          <strong>Atlas Meridian</strong>
        </div>
        <div className="header-actions">
          <button onClick={openWorkspace} aria-label="Open workspace folder">Open Workspace</button>
          <button onClick={() => setCommandPaletteOpen(true)} aria-haspopup="dialog" aria-expanded={commandPaletteOpen}>
            Command Palette
          </button>
          <button
            className={!showLeftPane && !showRightPane && !showBottomPane ? "active" : ""}
            onClick={focusEditorOnly}
          >
            Editor
          </button>
          <button
            className={showLeftPane && leftTab === "files" ? "active" : ""}
            onClick={() => toggleLeftFeature("files")}
          >
            Files
          </button>
          <button
            className={showLeftPane && leftTab === "search" ? "active" : ""}
            onClick={() => toggleLeftFeature("search")}
          >
            Search
          </button>
          <button
            className={showRightPane && panelTab === "agent" ? "active" : ""}
            onClick={() => toggleRightFeature("agent")}
          >
            Agent
          </button>
          <button
            className={showRightPane && panelTab === "plan" ? "active" : ""}
            onClick={() => toggleRightFeature("plan")}
          >
            Plan
          </button>
          <button
            className={showRightPane && panelTab === "diff" ? "active" : ""}
            onClick={() => toggleRightFeature("diff")}
          >
            Diff
          </button>
          <button
            className={showRightPane && panelTab === "checkpoints" ? "active" : ""}
            onClick={() => toggleRightFeature("checkpoints")}
          >
            Checkpoints
          </button>
          <button
            className={showBottomPane && bottomTab === "terminal" ? "active" : ""}
            onClick={() => toggleBottomFeature("terminal")}
          >
            Terminal
          </button>
          <button
            className={showBottomPane && bottomTab === "tests" ? "active" : ""}
            onClick={() => toggleBottomFeature("tests")}
          >
            Tests
          </button>
          <button
            className={showBottomPane && bottomTab === "logs" ? "active" : ""}
            onClick={() => toggleBottomFeature("logs")}
          >
            Logs
          </button>
          <button onClick={() => setSplitEnabled((flag) => !flag)}>{splitEnabled ? "Single" : "Split"} Editor</button>
          <label className="sr-only" htmlFor="autosave-mode">Auto-save mode</label>
          <select
            id="autosave-mode"
            aria-label="Auto-save mode"
            value={autoSaveMode}
            onChange={(event) => setAutoSaveMode(event.target.value as "manual" | "afterDelay" | "onBlur")}
          >
            <option value="manual">Save: Manual</option>
            <option value="afterDelay">Save: Delay</option>
            <option value="onBlur">Save: Blur</option>
          </select>
        </div>
      </header>

      <div
        id="main-content"
        className="main-grid"
        role="main"
        aria-label="Atlas Meridian workspace"
        style={{
        gridTemplateColumns: `${leftWidth}px ${leftSplitterWidth}px minmax(420px, 1fr) ${rightSplitterWidth}px ${rightWidth}px`,
        gridTemplateRows: `minmax(280px, 1fr) ${bottomSplitterHeight}px ${bottomHeight}px`
        }}
      >
        <aside className="pane pane-left" style={{ display: showLeftPane ? "flex" : "none" }}>
          <div className="tab-row" role="tablist" aria-label="Left panel tabs">
            {leftTabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={leftTab === tab}
                className={leftTab === tab ? "active" : ""}
                onClick={() => toggleLeftFeature(tab)}
              >
                {tab}
              </button>
            ))}
            <button onClick={() => setShowLeftPane(false)}>Hide</button>
          </div>
          {leftTab === "files" ? (
            <div className="left-content">
              <div className="inline-search">
                <input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="Search project"
                  aria-label="Search project"
                />
                <button onClick={runProjectSearch}>Go</button>
              </div>
              {workspaceRoot ? renderTree(tree, openFile) : <p className="empty">Select a workspace to begin.</p>}
            </div>
          ) : (
            <div className="left-content">
              <h4>Search Results</h4>
              {searchHits.map((hit) => (
                <button key={`${hit.file}:${hit.line}`} className="search-hit" onClick={() => openFile(hit.file)}>
                  <code>{hit.file}:{hit.line}</code>
                  <span>{hit.text}</span>
                </button>
              ))}
              {searchHits.length === 0 ? <p className="empty">No search hits yet.</p> : null}
            </div>
          )}
        </aside>

        <div
          className="splitter vertical"
          style={{ display: showLeftPane ? "block" : "none" }}
          onMouseDown={() => { dragRef.current = "left"; }}
          role="separator"
          aria-label="Resize left panel"
        />

        <section className="pane pane-editor">
          <div className="breadcrumbs">
            {breadcrumbs.length ? breadcrumbs.join(" / ") : "No file selected"}
          </div>
          <div className="tab-row tabs-files" role="tablist" aria-label="Open file tabs">
            {tabs.map((tab) => (
              <button
                key={tab.path}
                role="tab"
                aria-selected={activeTab === tab.path}
                className={activeTab === tab.path ? "active" : ""}
                onClick={() => setActiveTab(tab.path)}
              >
                {tab.path}{tab.dirty ? " *" : ""}
              </button>
            ))}
            <button onClick={saveActive}>Save</button>
          </div>
          <div className={`editor-zone ${splitEnabled ? "split" : "single"}`}>
            <div className="editor-wrap">
              {active ? (
                active.binary ? (
                  <p className="empty">Binary files cannot be edited inline.</p>
                ) : (
                  <textarea
                    value={active.content}
                    onChange={(event) => updateActiveContent(event.target.value)}
                    onBlur={() => {
                      if (autoSaveMode === "onBlur") {
                        void saveActive();
                      }
                    }}
                    aria-label="Editor"
                  />
                )
              ) : (
                <p className="empty">Open a file from the tree.</p>
              )}
            </div>
            {splitEnabled ? (
              <div className="editor-wrap second">
                {secondary ? (
                  secondary.binary ? (
                    <p className="empty">Binary files cannot be edited inline.</p>
                  ) : (
                    <textarea
                      value={secondary.content}
                      onChange={(event) => {
                        const next = event.target.value;
                        setTabs((current) =>
                          current.map((tab) => {
                            if (tab.path !== secondary.path) {
                              return tab;
                            }
                            return {
                              ...tab,
                              content: next,
                              dirty: next !== tab.originalContent
                            };
                          })
                        );
                      }}
                      aria-label="Secondary editor"
                    />
                  )
                ) : (
                  <p className="empty">Choose a second tab.</p>
                )}
                <div className="secondary-selector">
                  <label htmlFor="second-tab">Second pane</label>
                  <select id="second-tab" value={secondTab ?? ""} onChange={(event) => setSecondTab(event.target.value)}>
                    {tabs.map((tab) => (
                      <option key={tab.path} value={tab.path}>{tab.path}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}
          </div>
          <div className="replace-row">
            <input
              value={replaceNeedle}
              onChange={(event) => setReplaceNeedle(event.target.value)}
              placeholder="Find"
              aria-label="Find text"
            />
            <input
              value={replaceValue}
              onChange={(event) => setReplaceValue(event.target.value)}
              placeholder="Replace"
              aria-label="Replacement text"
            />
            <button onClick={runReplacePreview}>Preview</button>
            <button onClick={applyReplaceCurrent}>Replace Current</button>
            <button onClick={applyReplaceAllOpen}>Replace Open Tabs</button>
          </div>
          {replacePreview.length > 0 ? (
            <div className="replace-preview">
              {replacePreview.map((item) => (
                <span key={item.file}>{item.file}: {item.count}</span>
              ))}
            </div>
          ) : null}
        </section>

        <div
          className="splitter vertical"
          style={{ display: showRightPane ? "block" : "none" }}
          onMouseDown={() => { dragRef.current = "right"; }}
          role="separator"
          aria-label="Resize right panel"
        />

        <aside className="pane pane-right" style={{ display: showRightPane ? "flex" : "none" }}>
          <div className="tab-row" role="tablist" aria-label="Right panel tabs">
            {panelTabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={panelTab === tab}
                className={panelTab === tab ? "active" : ""}
                onClick={() => toggleRightFeature(tab)}
              >
                {tab}
              </button>
            ))}
            <button onClick={() => setShowRightPane(false)}>Hide</button>
          </div>
          {panelTab === "agent" ? (
            <div className="panel-scroll">
              <h4>Agent</h4>
              <p>Grounded chat mode and task orchestration surface.</p>
              <p>Current workspace: <code>{workspaceRoot ?? "none"}</code></p>
              <p>Patch queue depth: <strong>{patchQueue.length}</strong></p>
              <div className="checkpoint-card">
                <strong>Parallel Multi-Agent Mode</strong>
                <input
                  value={multiAgentGoal}
                  onChange={(event) => setMultiAgentGoal(event.target.value)}
                  placeholder="Coordinator goal"
                />
                <div className="inline-search">
                  <label htmlFor="agent-count">Agents</label>
                  <select
                    id="agent-count"
                    value={multiAgentCount}
                    onChange={(event) => setMultiAgentCount(Number(event.target.value))}
                  >
                    {[2, 3, 4, 5, 6, 7, 8].map((count) => (
                      <option key={count} value={count}>{count}</option>
                    ))}
                  </select>
                  <button onClick={() => { void runMultiAgentMode(); }}>Launch</button>
                </div>
              </div>
              <div className="checkpoint-card">
                <strong>Project Builder (Node Microservices + Postgres)</strong>
                <input
                  value={builderProjectName}
                  onChange={(event) => setBuilderProjectName(event.target.value)}
                  placeholder="Project name"
                />
                <input
                  value={builderOutputDir}
                  onChange={(event) => setBuilderOutputDir(event.target.value)}
                  placeholder="Output directory (workspace-relative)"
                />
                <div className="inline-search">
                  <button
                    onClick={() => { void runProjectBuilderMode(); }}
                    disabled={builderRunning}
                  >
                    {builderRunning ? "Building..." : "Build Template"}
                  </button>
                </div>
                {builderResult ? (
                  <>
                    <code>run: {builderResult.runId}</code>
                    <code>root: {builderResult.projectRoot}</code>
                    <code>
                      services: api={String(builderResult.services.api)} worker={String(builderResult.services.worker)} postgres={String(builderResult.services.postgres)}
                    </code>
                    <code>
                      completeness: {builderResult.completeness.completenessPercent}% (missing: {builderResult.completeness.missing.join(", ") || "none"})
                    </code>
                    <code>generated files: {builderResult.generatedFiles.length}</code>
                  </>
                ) : null}
              </div>
              <div className="checkpoint-card">
                <strong>Multi-file Refactor Mode</strong>
                <div className="inline-search">
                  <input
                    value={refactorFrom}
                    onChange={(event) => setRefactorFrom(event.target.value)}
                    placeholder="Rename from"
                  />
                  <input
                    value={refactorTo}
                    onChange={(event) => setRefactorTo(event.target.value)}
                    placeholder="Rename to"
                  />
                </div>
                <div className="inline-search">
                  <input
                    value={refactorMaxFiles}
                    onChange={(event) => setRefactorMaxFiles(event.target.value)}
                    placeholder="Max files to scan"
                  />
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={refactorPreviewOnly}
                      onChange={(event) => setRefactorPreviewOnly(event.target.checked)}
                    />
                    Preview only
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={refactorAllowSensitive}
                      onChange={(event) => setRefactorAllowSensitive(event.target.checked)}
                    />
                    Allow sensitive
                  </label>
                </div>
                <div className="inline-search">
                  <button
                    onClick={() => { void runMultiFileRefactorMode(); }}
                    disabled={refactorRunning}
                  >
                    {refactorRunning ? "Running..." : "Run Refactor"}
                  </button>
                </div>
                {refactorResult ? (
                  <>
                    <code>run: {refactorResult.runId}</code>
                    <code>
                      status: {refactorResult.status} | files={refactorResult.filesTouched} | matches={refactorResult.totalMatches}
                    </code>
                    <code>
                      sensitive touched: {refactorResult.sensitiveTouched} | blocked: {refactorResult.blockedSensitive.join(", ") || "none"}
                    </code>
                    <code>grounding edges: {refactorResult.grounding.edgeCount}</code>
                    {refactorResult.files.slice(0, 6).map((item) => (
                      <code key={`refactor-${item.file}`}>
                        {item.file} | matches={item.matches} | decl={item.declarationMatches} | ref={item.referenceMatches} | collisions={item.collisionMatches}
                      </code>
                    ))}
                  </>
                ) : null}
              </div>
              {multiAgentSummary ? (
                <div className="checkpoint-card">
                  <strong>Coordinator: {multiAgentSummary.coordinatorRunId}</strong>
                  <span>Status: {multiAgentSummary.overallStatus}</span>
                  {multiAgentSummary.agentRuns.map((run) => (
                    <code key={run.runId}>
                      {run.agentId} [{run.focus}] {" -> "} {run.status} ({run.runId})
                    </code>
                  ))}
                </div>
              ) : (
                <p className="empty">No multi-agent run yet.</p>
              )}
            </div>
          ) : null}
          {panelTab === "plan" ? (
            <div className="panel-scroll">
              <h4>Plan & Approvals</h4>
              <div className="checkpoint-card">
                <strong>Enterprise Auth (OIDC + SAML + RBAC)</strong>
                <div className="inline-search">
                  <select
                    value={authProviderId}
                    onChange={(event) => setAuthProviderId(event.target.value)}
                  >
                    {authProviders.map((provider) => (
                      <option key={provider.id} value={provider.id}>
                        {provider.name} [{provider.protocol}]
                      </option>
                    ))}
                  </select>
                  <input
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    placeholder="user email"
                  />
                </div>
                <input
                  value={authDisplayName}
                  onChange={(event) => setAuthDisplayName(event.target.value)}
                  placeholder="display name"
                />
                <div className="inline-search">
                  {authRoles.map((role) => (
                    <label key={`role-${role}`} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={authSelectedRoles.includes(role)}
                        onChange={() => toggleAuthRole(role)}
                      />
                      {role}
                    </label>
                  ))}
                </div>
                <div className="inline-search">
                  <button onClick={() => { void loginAuth(); }}>Login</button>
                  <button onClick={() => { void logoutAuth(); }}>Logout</button>
                  <button onClick={() => { void refreshAuthState(); }}>Refresh Auth</button>
                </div>
                {authSession ? (
                  <>
                    <code>session: {authSession.email} ({authSession.protocol})</code>
                    <code>roles: {authSession.roles.join(", ")}</code>
                    <code>provider: {authSession.providerId} | expires: {authSession.expiresAt}</code>
                  </>
                ) : (
                  <p className="empty">No active auth session.</p>
                )}
                <details>
                  <summary>Provider Upsert (Admin/Security Admin)</summary>
                  <input
                    value={providerEditor.id}
                    onChange={(event) => setProviderEditor((current) => ({ ...current, id: event.target.value }))}
                    placeholder="provider id"
                  />
                  <input
                    value={providerEditor.name}
                    onChange={(event) => setProviderEditor((current) => ({ ...current, name: event.target.value }))}
                    placeholder="provider name"
                  />
                  <div className="inline-search">
                    <select
                      value={providerEditor.protocol}
                      onChange={(event) =>
                        setProviderEditor((current) => ({
                          ...current,
                          protocol: event.target.value as "oidc" | "saml"
                        }))
                      }
                    >
                      <option value="oidc">oidc</option>
                      <option value="saml">saml</option>
                    </select>
                    <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={providerEditor.enabled}
                        onChange={(event) =>
                          setProviderEditor((current) => ({ ...current, enabled: event.target.checked }))
                        }
                      />
                      enabled
                    </label>
                  </div>
                  <input
                    value={providerEditor.issuer}
                    onChange={(event) => setProviderEditor((current) => ({ ...current, issuer: event.target.value }))}
                    placeholder="issuer"
                  />
                  <input
                    value={providerEditor.entrypoint}
                    onChange={(event) =>
                      setProviderEditor((current) => ({ ...current, entrypoint: event.target.value }))
                    }
                    placeholder="entrypoint"
                  />
                  <input
                    value={providerEditor.clientId}
                    onChange={(event) =>
                      setProviderEditor((current) => ({ ...current, clientId: event.target.value }))
                    }
                    placeholder="client id"
                  />
                  <button onClick={() => { void upsertProvider(); }}>Upsert Provider</button>
                </details>
              </div>
              <div className="checkpoint-card">
                <strong>Enterprise Telemetry, Privacy, and Gateway</strong>
                <div className="inline-search">
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    Consent
                    <select
                      value={enterpriseDraft.consent}
                      onChange={(event) =>
                        setEnterpriseDraft((current) => ({
                          ...current,
                          consent: event.target.value as TelemetryConsent
                        }))
                      }
                    >
                      <option value="unknown">unknown</option>
                      <option value="granted">granted</option>
                      <option value="denied">denied</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={enterpriseDraft.telemetryEnabled}
                      onChange={(event) =>
                        setEnterpriseDraft((current) => ({
                          ...current,
                          telemetryEnabled: event.target.checked
                        }))
                      }
                    />
                    Telemetry enabled
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={enterpriseDraft.privacyMode}
                      onChange={(event) =>
                        setEnterpriseDraft((current) => ({
                          ...current,
                          privacyMode: event.target.checked
                        }))
                      }
                    />
                    Privacy mode
                  </label>
                </div>
                <div className="inline-search">
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    Gateway mode
                    <select
                      value={enterpriseDraft.mode}
                      onChange={(event) =>
                        setEnterpriseDraft((current) => ({
                          ...current,
                          mode: event.target.value as ControlPlaneMode
                        }))
                      }
                    >
                      <option value="disabled">disabled</option>
                      <option value="managed">managed</option>
                      <option value="self_hosted">self_hosted</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={enterpriseDraft.requireTls}
                      onChange={(event) =>
                        setEnterpriseDraft((current) => ({
                          ...current,
                          requireTls: event.target.checked
                        }))
                      }
                    />
                    Require TLS
                  </label>
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={enterpriseDraft.allowInsecureLocalhost}
                      onChange={(event) =>
                        setEnterpriseDraft((current) => ({
                          ...current,
                          allowInsecureLocalhost: event.target.checked
                        }))
                      }
                    />
                    Allow localhost http
                  </label>
                </div>
                <input
                  value={enterpriseDraft.baseUrl}
                  onChange={(event) =>
                    setEnterpriseDraft((current) => ({ ...current, baseUrl: event.target.value }))
                  }
                  placeholder="control plane base URL"
                />
                <div className="inline-search">
                  <input
                    value={enterpriseDraft.orgId}
                    onChange={(event) =>
                      setEnterpriseDraft((current) => ({ ...current, orgId: event.target.value }))
                    }
                    placeholder="org id (optional)"
                  />
                  <input
                    value={enterpriseDraft.workspaceId}
                    onChange={(event) =>
                      setEnterpriseDraft((current) => ({ ...current, workspaceId: event.target.value }))
                    }
                    placeholder="workspace id (optional)"
                  />
                </div>
                <input
                  value={enterpriseDraft.apiToken}
                  onChange={(event) =>
                    setEnterpriseDraft((current) => ({ ...current, apiToken: event.target.value }))
                  }
                  placeholder="gateway api token (optional)"
                />
                <div className="inline-search">
                  <button onClick={() => { void saveEnterpriseSettings(); }}>Save Enterprise Settings</button>
                  <button onClick={() => { void refreshEnterpriseSettings(); }}>Refresh Settings</button>
                  <button onClick={() => { void runControlPlaneHealthCheck(); }}>Gateway Health</button>
                  <button onClick={() => { void pushControlPlaneMetric(); }}>Push Sample Metric</button>
                  <button onClick={() => { void pushControlPlaneAudit(); }}>Push Recent Audit</button>
                </div>
                {enterpriseSettings ? (
                  <>
                    <code>
                      consent: {enterpriseSettings.telemetry.consent} | enabled: {String(enterpriseSettings.telemetry.enabled)} | privacy: {String(enterpriseSettings.telemetry.privacyMode)}
                    </code>
                    <code>
                      gateway: {enterpriseSettings.controlPlane.mode} {enterpriseSettings.controlPlane.baseUrl}
                    </code>
                    <code>
                      tls: {String(enterpriseSettings.controlPlane.requireTls)} | localhost-http: {String(enterpriseSettings.controlPlane.allowInsecureLocalhost)}
                    </code>
                  </>
                ) : (
                  <p className="empty">No enterprise settings loaded yet.</p>
                )}
                {controlPlaneHealth ? (
                  <code>
                    health: ok={String(controlPlaneHealth.ok)} mode={controlPlaneHealth.mode} status={controlPlaneHealth.statusCode ?? "none"} reason={controlPlaneHealth.reason ?? "none"}
                  </code>
                ) : null}
                {controlPlanePushResult ? (
                  <code>
                    push: sent={String(controlPlanePushResult.sent)} accepted={controlPlanePushResult.accepted} status={controlPlanePushResult.statusCode ?? "none"} reason={controlPlanePushResult.reason ?? "none"}
                  </code>
                ) : null}
                <div className="inline-search">
                  <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    Release channel
                    <select
                      value={releaseChannel}
                      onChange={(event) => setReleaseChannel(event.target.value as ReleaseChannel)}
                    >
                      <option value="stable">stable</option>
                      <option value="beta">beta</option>
                    </select>
                  </label>
                  <button onClick={() => { void saveReleaseChannel(); }}>Save Channel</button>
                  <button onClick={() => { void runUpdateCheck(); }}>Check Updates</button>
                </div>
                {updateCheckResult ? (
                  <code>
                    update check: channel={updateCheckResult.channel} skipped={String(updateCheckResult.skipped)} version={updateCheckResult.updateInfo?.version ?? "none"} reason={updateCheckResult.reason ?? "none"}
                  </code>
                ) : null}
              </div>
              <div className="checkpoint-card">
                <strong>Benchmark Dashboard (KPI + Regression Gates)</strong>
                <div className="inline-search">
                  <input
                    value={benchmarkSeed}
                    onChange={(event) => setBenchmarkSeed(event.target.value)}
                    placeholder="Simulation seed"
                  />
                  <button
                    onClick={() => { void runSimulatedBenchmark(); }}
                    disabled={benchmarkRunning}
                  >
                    {benchmarkRunning ? "Running..." : "Run Simulated Benchmark"}
                  </button>
                  <button onClick={() => { void refreshBenchmarkDashboard(); }}>Refresh Dashboard</button>
                </div>
                {benchmarkDashboard ? (
                  <>
                    <code>
                      generated: {benchmarkDashboard.generatedAt} | corpus: {benchmarkCorpusSize || benchmarkDashboard.corpusSize} | metrics history: {benchmarkDashboard.metricsHistoryCount}
                    </code>
                    <code>
                      gate: {benchmarkDashboard.gate.pass ? "PASS" : "FAIL"} | failing: {benchmarkDashboard.gate.failing.join(", ") || "none"}
                    </code>
                    <code>
                      pass rate: {(benchmarkDashboard.scoreCard.passRate * 100).toFixed(1)}% | avg duration: {benchmarkDashboard.scoreCard.avgDuration.toFixed(1)}s | determinism: {(benchmarkDashboard.scoreCard.determinismRate * 100).toFixed(1)}%
                    </code>
                    <code>
                      grounded ratio: {(benchmarkDashboard.scoreCard.groundedEditRatio * 100).toFixed(2)}% | fix-loop success: {(benchmarkDashboard.scoreCard.fixLoopSuccessRate * 100).toFixed(1)}% | human intervention: {(benchmarkDashboard.scoreCard.humanInterventionRate * 100).toFixed(1)}%
                    </code>
                    {benchmarkDashboard.scoreCard.kpis.map((kpi) => (
                      <code key={`kpi-${kpi.name}`}>
                        {kpi.name}: {kpi.value.toFixed(4)} {kpi.unit} target {kpi.comparator} {kpi.target} [{kpi.meetsTarget ? "pass" : "fail"}]
                      </code>
                    ))}
                    {benchmarkDashboard.alerts.slice(0, 5).map((alert, index) => (
                      <code key={`alert-${index}-${alert.metricName}`}>
                        alert {alert.severity}: {alert.message} (baseline={alert.baseline.toFixed(4)} current={alert.current.toFixed(4)})
                      </code>
                    ))}
                  </>
                ) : (
                  <p className="empty">No benchmark dashboard yet.</p>
                )}
              </div>
              {pendingApprovalCommand ? (
                <div className="checkpoint-card">
                  <strong>Pending Command Approval</strong>
                  <code>{pendingApprovalCommand}</code>
                  {pendingApprovalReason ? <span>{pendingApprovalReason}</span> : null}
                  <div className="inline-search">
                    <button onClick={() => { void runApprovedCommand(); }}>Approve + Run</button>
                    <button
                      onClick={() => {
                        setPendingApprovalCommand(null);
                        setPendingApprovalReason(null);
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : (
                <p className="empty">No pending approvals.</p>
              )}

              <h4>Audit Feed</h4>
              <div className="inline-search" style={{ marginBottom: 8 }}>
                <button onClick={() => { void refreshAudit(); }}>Refresh Audit</button>
                <button onClick={async () => {
                  const result = await window.ide.exportAudit();
                  setLogs((prev) => [`[audit-export] ${result.path}`, ...prev]);
                }}>Export Audit</button>
              </div>
              {auditEvents.map((event) => (
                <div key={event.event_id} className="checkpoint-card">
                  <strong>{event.action}</strong>
                  <code>{event.target}</code>
                  <span>{event.decision} - {event.reason}</span>
                </div>
              ))}
              {auditEvents.length === 0 ? <p className="empty">No audit events yet.</p> : null}

              <h4>Index Diagnostics</h4>
              <div className="checkpoint-card">
                <div className="inline-search">
                  <input
                    value={indexLimit}
                    onChange={(event) => setIndexLimit(event.target.value)}
                    placeholder="Index file limit"
                  />
                  <input
                    value={indexTokenBudget}
                    onChange={(event) => setIndexTokenBudget(event.target.value)}
                    placeholder="Token budget"
                  />
                  <button onClick={() => { void runWorkspaceIndexScan(); }}>Run Index Scan</button>
                  <button onClick={() => { void refreshIndexDiagnostics(); }}>Refresh Diagnostics</button>
                </div>
                <div className="inline-search" style={{ marginBottom: 8 }}>
                  <input
                    value={indexQuery}
                    onChange={(event) => setIndexQuery(event.target.value)}
                    placeholder="Retrieval query"
                  />
                </div>
                <div className="inline-search" style={{ marginBottom: 8 }}>
                  <input
                    value={indexRenameFrom}
                    onChange={(event) => setIndexRenameFrom(event.target.value)}
                    placeholder="Rename from"
                  />
                  <input
                    value={indexRenameTo}
                    onChange={(event) => setIndexRenameTo(event.target.value)}
                    placeholder="Rename to"
                  />
                </div>
                {indexReport ? (
                  <>
                    <code>generated: {indexReport.generatedAt}</code>
                    <code>pipeline: {indexReport.diagnostics.parserPipeline} | tree-sitter: {indexReport.diagnostics.treeSitterAvailable ? "available" : "fallback"}</code>
                    <code>files: {indexReport.diagnostics.indexedFiles} | symbols: {indexReport.diagnostics.totalSymbols} | errors: {indexReport.diagnostics.parseErrors}</code>
                    <code>freshness(ms): {indexReport.diagnostics.freshnessLatencyMs ?? 0} | batch(ms): {indexReport.diagnostics.batchLatencyMs ?? 0}</code>
                    <code>
                      freshness target: small&lt;={indexReport.freshnessTargets.smallTargetMs}ms ({String(indexReport.freshnessTargets.smallWithinTarget)}) | batch&lt;={indexReport.freshnessTargets.batchTargetMs}ms ({String(indexReport.freshnessTargets.batchWithinTarget)}) | overall={indexReport.freshnessTargets.meetsTarget ? "pass" : "fail"}
                    </code>
                    {indexReport.diagnostics.treeSitterReason ? <span>{indexReport.diagnostics.treeSitterReason}</span> : null}
                    {indexReport.topFiles.slice(0, 8).map((item) => (
                      <code key={`idx-${item.file}`}>
                        {item.file} | symbols={item.symbols} | parser={item.parserMode} | latency={item.latencyMs}ms
                      </code>
                    ))}
                    <code>
                      retrieval: query="{indexReport.retrieval.query}" | budget={indexReport.retrieval.budgetUsed}/{indexReport.retrieval.tokenBudget} | files={indexReport.retrieval.files.length}
                    </code>
                    {indexReport.retrieval.candidates.slice(0, 5).map((candidate) => (
                      <code key={`retr-${candidate.file}`}>
                        rank {candidate.file} | score={candidate.score.toFixed(2)} | terms={candidate.matchedTerms} | symbols={candidate.symbolCount}
                      </code>
                    ))}
                    {indexReport.moduleSummaries.slice(0, 4).map((summary) => (
                      <code key={`mod-${summary.file}`}>
                        module {summary.file} | {summary.summary}
                      </code>
                    ))}
                    <code>
                      call graph: nodes={indexReport.callGraph.nodes.length} edges={indexReport.callGraph.edges.length}
                    </code>
                    {indexReport.callGraph.topCallers.slice(0, 4).map((caller) => (
                      <code key={`caller-${caller.symbol}`}>
                        caller {caller.symbol} -&gt; {caller.count}
                      </code>
                    ))}
                    {indexReport.callGraph.edges.slice(0, 5).map((edge, idx) => (
                      <code key={`edge-${idx}-${edge.file}`}>
                        edge {edge.file}:{edge.line} {edge.from} -&gt; {edge.to}
                      </code>
                    ))}
                    {indexReport.renameImpact ? (
                      <>
                        <code>
                          rename impact: {indexReport.renameImpact.from} -&gt; {indexReport.renameImpact.to} | files={indexReport.renameImpact.filesTouched} | matches={indexReport.renameImpact.totalMatches} | declarations={indexReport.renameImpact.declarationMatches} | references={indexReport.renameImpact.referenceMatches}
                        </code>
                        {indexReport.renameImpact.impacts.slice(0, 5).map((impact) => (
                          <code key={`rename-${impact.file}`}>
                            {impact.file} | matches={impact.totalMatches} | collisions={impact.collisionMatches} | lines={impact.lines.join(", ") || "none"}
                          </code>
                        ))}
                      </>
                    ) : (
                      <code>rename impact: provide rename from/to and run scan</code>
                    )}
                  </>
                ) : (
                  <p className="empty">No index diagnostics yet.</p>
                )}
              </div>

              <h4>Autonomy Checks</h4>
              <div className="checkpoint-card">
                <div className="inline-search">
                  <button onClick={() => { void runArtifactCompletenessCheck(); }}>Artifact Completeness</button>
                  <button onClick={() => { void runGreenPipelineCheck(); }}>Green Pipeline Rate</button>
                </div>
                {artifactReport ? (
                  <>
                    <code>artifact completeness: {artifactReport.completenessPercent}%</code>
                    <code>present: {artifactReport.present.join(", ") || "none"}</code>
                    <code>missing: {artifactReport.missing.join(", ") || "none"}</code>
                  </>
                ) : null}
                {greenPipelineReport ? (
                  <code>
                    green pipeline: {greenPipelineReport.passRatePercent}% ({greenPipelineReport.passedRuns}/{greenPipelineReport.totalRuns}) target={greenPipelineReport.targetPercent}% status={greenPipelineReport.meetsTarget ? "pass" : "fail"}
                  </code>
                ) : null}
                {!artifactReport && !greenPipelineReport ? <p className="empty">No autonomy checks run yet.</p> : null}
              </div>

              <h4>Project Memory</h4>
              <div className="checkpoint-card">
                <input
                  value={memoryTitle}
                  onChange={(event) => setMemoryTitle(event.target.value)}
                  placeholder="Memory title"
                />
                <textarea
                  value={memoryContent}
                  onChange={(event) => setMemoryContent(event.target.value)}
                  placeholder="Capture architecture, constraints, and context"
                  style={{ minHeight: 90 }}
                />
                <input
                  value={memoryTags}
                  onChange={(event) => setMemoryTags(event.target.value)}
                  placeholder="tags comma-separated"
                />
                <button onClick={() => { void createMemoryEntry(); }}>Add Memory</button>
              </div>
              {teamMemory.map((entry) => (
                <div key={entry.id} className="checkpoint-card">
                  <strong>{entry.title}</strong>
                  <span>{entry.content}</span>
                  <code>{entry.tags.join(", ")}</code>
                </div>
              ))}
              {teamMemory.length === 0 ? <p className="empty">No memory entries yet.</p> : null}

              <h4>Memory Search</h4>
              <div className="checkpoint-card">
                <input
                  value={memorySearchQuery}
                  onChange={(event) => setMemorySearchQuery(event.target.value)}
                  placeholder="Search query"
                />
                <input
                  value={memorySearchTags}
                  onChange={(event) => setMemorySearchTags(event.target.value)}
                  placeholder="Filter tags (comma-separated)"
                />
                <div className="inline-search">
                  <button onClick={() => { void searchMemoryEntries(); }}>Search Memory</button>
                  <button onClick={() => {
                    setMemorySearchQuery("");
                    setMemorySearchTags("");
                    setMemorySearchResults(teamMemory.map((entry) => ({ ...entry, score: 1 })));
                  }}>Clear Filters</button>
                </div>
              </div>
              {memorySearchResults.map((entry) => (
                <div key={`${entry.id}-${entry.score}`} className="checkpoint-card">
                  <strong>{entry.title}</strong>
                  <span>{entry.content}</span>
                  <code>score: {entry.score} | tags: {entry.tags.join(", ")}</code>
                </div>
              ))}
              {memorySearchResults.length === 0 ? <p className="empty">No memory search results.</p> : null}

              <h4>Decision Logs (ADR)</h4>
              <div className="checkpoint-card">
                <input
                  value={decisionTitle}
                  onChange={(event) => setDecisionTitle(event.target.value)}
                  placeholder="Decision title"
                />
                <textarea
                  value={decisionContext}
                  onChange={(event) => setDecisionContext(event.target.value)}
                  placeholder="Context"
                  style={{ minHeight: 90 }}
                />
                <textarea
                  value={decisionOptions}
                  onChange={(event) => setDecisionOptions(event.target.value)}
                  placeholder="Options (one per line)"
                  style={{ minHeight: 80 }}
                />
                <input
                  value={decisionChosen}
                  onChange={(event) => setDecisionChosen(event.target.value)}
                  placeholder="Chosen option"
                />
                <textarea
                  value={decisionConsequences}
                  onChange={(event) => setDecisionConsequences(event.target.value)}
                  placeholder="Consequences (one per line)"
                  style={{ minHeight: 80 }}
                />
                <textarea
                  value={decisionFiles}
                  onChange={(event) => setDecisionFiles(event.target.value)}
                  placeholder="Related files (one per line)"
                  style={{ minHeight: 70 }}
                />
                <button onClick={() => { void createDecisionLog(); }}>Create Decision Log</button>
              </div>
              {decisionLogs.map((entry) => (
                <div key={entry.decision_id} className="checkpoint-card">
                  <strong>{entry.title}</strong>
                  <span>{entry.context}</span>
                  <code>chosen: {entry.chosen}</code>
                  <code>files: {entry.related_files.join(", ") || "none"}</code>
                </div>
              ))}
              {decisionLogs.length === 0 ? <p className="empty">No decision logs yet.</p> : null}

              <h4>Reviewer Mode</h4>
              <div className="checkpoint-card">
                <textarea
                  value={reviewerFiles}
                  onChange={(event) => setReviewerFiles(event.target.value)}
                  placeholder="Optional files to review (one per line)"
                  style={{ minHeight: 80 }}
                />
                <button onClick={() => { void runReviewer(); }}>Run Reviewer</button>
              </div>
              {reviewerFindings.map((finding) => (
                <div key={finding.id} className="checkpoint-card">
                  <strong>{finding.title}</strong>
                  <code>{finding.file}:{finding.line}</code>
                  <span>{finding.body}</span>
                  <code>{finding.severity} / {finding.confidence.toFixed(2)}</code>
                </div>
              ))}
              {reviewerFindings.length === 0 ? <p className="empty">No reviewer findings yet.</p> : null}

              <h4>Ownership Mapping</h4>
              <div className="checkpoint-card">
                <textarea
                  value={ownershipFiles}
                  onChange={(event) => setOwnershipFiles(event.target.value)}
                  placeholder="Files to map owners (one per line)"
                  style={{ minHeight: 80 }}
                />
                <button onClick={() => { void runOwnershipMapping(); }}>Map Owners</button>
              </div>
              {ownershipMap.map((entry) => (
                <div key={entry.file} className="checkpoint-card">
                  <strong>{entry.file}</strong>
                  <code>pattern: {entry.matchedPattern ?? "none"}</code>
                  <code>owners: {entry.owners.join(", ") || "unassigned"}</code>
                </div>
              ))}
              {ownershipMap.length === 0 ? <p className="empty">No ownership mapping yet.</p> : null}

              <h4>Ownership Conflict Detection</h4>
              <div className="checkpoint-card">
                <textarea
                  value={ownershipAssignments}
                  onChange={(event) => setOwnershipAssignments(event.target.value)}
                  placeholder="agent-1: path/a.ts, path/b.ts"
                  style={{ minHeight: 90 }}
                />
                <button onClick={() => { void runOwnershipConflictDetection(); }}>Detect Conflicts</button>
              </div>
              {ownershipConflicts ? (
                <>
                  <div className="checkpoint-card">
                    <strong>File Conflicts</strong>
                    <code>{ownershipConflicts.fileConflicts.length} files assigned to multiple agents</code>
                    {ownershipConflicts.fileConflicts.slice(0, 20).map((conflict) => (
                      <code key={`file-${conflict.file}`}>
                        {conflict.file} | agents: {conflict.agents.join(", ")} | owners: {conflict.owners.join(", ") || "unassigned"}
                      </code>
                    ))}
                  </div>
                  <div className="checkpoint-card">
                    <strong>Owner Conflicts</strong>
                    <code>{ownershipConflicts.ownerConflicts.length} owners touched by multiple agents</code>
                    {ownershipConflicts.ownerConflicts.slice(0, 20).map((conflict) => (
                      <code key={`owner-${conflict.owner}`}>
                        {conflict.owner} | agents: {conflict.agents.join(", ")} | files: {conflict.files.slice(0, 4).join(", ")}
                      </code>
                    ))}
                  </div>
                </>
              ) : (
                <p className="empty">No ownership conflict report yet.</p>
              )}

              <h4>Changelog Draft</h4>
              <div className="checkpoint-card">
                <input
                  value={changelogSinceRef}
                  onChange={(event) => setChangelogSinceRef(event.target.value)}
                  placeholder="Since git ref (optional, e.g. v0.1.0)"
                />
                <button onClick={() => { void runChangelogDraft(); }}>Generate Changelog</button>
              </div>
              {changelogDraft ? (
                <div className="checkpoint-card">
                  <strong>Range: {changelogDraft.range}</strong>
                  <code>Generated: {changelogDraft.generatedAt}</code>
                  <pre>{changelogDraft.markdown}</pre>
                </div>
              ) : (
                <p className="empty">No changelog draft generated yet.</p>
              )}

              <h4>Release Notes Draft</h4>
              <div className="checkpoint-card">
                <input
                  value={releaseVersion}
                  onChange={(event) => setReleaseVersion(event.target.value)}
                  placeholder="Release version (e.g. v0.2.0)"
                />
                <textarea
                  value={releaseHighlights}
                  onChange={(event) => setReleaseHighlights(event.target.value)}
                  placeholder="Highlights (one per line)"
                  style={{ minHeight: 80 }}
                />
                <button onClick={() => { void runReleaseNotesDraft(); }}>Generate Release Notes</button>
              </div>
              {releaseNotesDraft ? (
                <div className="checkpoint-card">
                  <strong>{releaseNotesDraft.version}</strong>
                  <code>Generated: {releaseNotesDraft.generatedAt}</code>
                  <pre>{releaseNotesDraft.markdown}</pre>
                </div>
              ) : (
                <p className="empty">No release notes draft generated yet.</p>
              )}
            </div>
          ) : null}
          {panelTab === "diff" ? (
            <div className="panel-scroll">
              <h4>Diff Approval</h4>
              {!active || active.binary ? <p className="empty">Open a text file to review diff chunks.</p> : null}
              {active && !active.binary ? (
                <>
                  <div className="checkpoint-card">
                    <strong>Diff Churn Statistics</strong>
                    <code>file: {active.path}</code>
                    <code>chunks: {diffChurn.changedChunks} | pending: {diffChurn.pendingChunks} | accepted: {diffChurn.acceptedChunks} | rejected: {diffChurn.rejectedChunks}</code>
                    <code>+{diffChurn.additions} / -{diffChurn.deletions} | changed lines: {diffChurn.changedLines}</code>
                  </div>
                  {sensitivePathSignals.length > 0 ? (
                    <div className="checkpoint-card warning">
                      <strong>Sensitive File Change</strong>
                      <code>{active.path}</code>
                      <span>Flags: {sensitivePathSignals.join(", ")}</span>
                    </div>
                  ) : null}
                  <div className="inline-search" style={{ marginBottom: 10 }}>
                    <button onClick={() => { void applyPatchQueue(); }}>Apply Patch Queue</button>
                    <button onClick={() => { void refreshDiffCheckpoints(); }}>Refresh Diff Checkpoints</button>
                  </div>
                  <label style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                    <input
                      type="checkbox"
                      checked={allowFullRewriteApply}
                      onChange={(event) => setAllowFullRewriteApply(event.target.checked)}
                    />
                    Allow full-file rewrite override (policy-gated)
                  </label>
                  <div className="inline-search" style={{ marginBottom: 10 }}>
                    <input
                      value={chunkRationale}
                      onChange={(event) => setChunkRationale(event.target.value)}
                      placeholder="Rationale for chunk decision"
                    />
                  </div>
                  {diffChunks.map((chunk) => (
                    <div key={chunk.id} className={`diff-chunk ${chunk.status}`}>
                      <div className="diff-head">
                        <strong>Chunk {chunk.id}</strong>
                        <span>{chunk.status}</span>
                      </div>
                      <pre className="diff-pre">
{chunk.original.map((line) => `- ${line}`).join("\n")}
{"\n"}
{chunk.current.map((line) => `+ ${line}`).join("\n")}
                      </pre>
                      <div className="inline-search">
                        <button onClick={() => applyChunkDecision(chunk, "accepted")}>Accept</button>
                        <button onClick={() => applyChunkDecision(chunk, "rejected")}>Reject</button>
                      </div>
                    </div>
                  ))}
                  {diffChunks.length === 0 ? <p className="empty">No diff chunks pending.</p> : null}

                  <h4>Patch Queue</h4>
                  {patchQueue.map((item) => (
                    <div key={item.id} className="checkpoint-card">
                      <strong>{item.file} [{item.chunkId}]</strong>
                      <span>{item.decision}</span>
                      <span>{item.rationale}</span>
                      <code>{item.timestamp}</code>
                    </div>
                  ))}
                  {patchQueue.length === 0 ? <p className="empty">No patch decisions queued yet.</p> : null}

                  <h4>Diff Checkpoints</h4>
                  {diffCheckpoints
                    .filter((record) => record.path === active.path)
                    .map((record) => (
                      <div key={record.id} className="checkpoint-card">
                        <strong>{record.id}</strong>
                        <code>{record.createdAt}</code>
                        <code>signature: {record.signatureValid === true ? "valid" : "invalid/unverified"}</code>
                        <code>key: {record.keyId || "n/a"}</code>
                        <code>chunks: {record.appliedChunks.join(", ") || "none"}</code>
                        <code>grounding evidence: {record.groundingEvidenceCount ?? 0}</code>
                        <div className="inline-search">
                          <button onClick={() => { void verifyDiffCheckpointSignature(record.id); }}>
                            Verify Signature
                          </button>
                          <button onClick={() => { void revertDiffFromCheckpoint(record.id); }}>
                            Revert To Checkpoint
                          </button>
                        </div>
                      </div>
                    ))}
                  {diffCheckpoints.filter((record) => record.path === active.path).length === 0 ? (
                    <p className="empty">No diff checkpoints for this file yet.</p>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
          {panelTab === "checkpoints" ? (
            <div className="panel-scroll">
              <h4>Checkpoints</h4>
              <div className="inline-search" style={{ marginBottom: 8 }}>
                <button onClick={() => { void refreshCheckpoints(); }}>Refresh</button>
                <button onClick={() => { void loadTerminalReplay(); }}>Replay Terminal</button>
              </div>
              {checkpoints.map((checkpoint) => (
                <div key={checkpoint.runId} className="checkpoint-card">
                  <strong>{checkpoint.runId}</strong>
                  <code>{checkpoint.path}</code>
                  <button onClick={() => { void loadCheckpointDetail(checkpoint.runId); }}>
                    Inspect
                  </button>
                </div>
              ))}
              {checkpoints.length === 0 ? <p className="empty">No checkpoints detected.</p> : null}

              {selectedCheckpoint && checkpointDetail ? (
                <div className="checkpoint-detail">
                  <h4>Selected: {selectedCheckpoint}</h4>
                  <code>{checkpointDetail.path}</code>
                  <pre>{JSON.stringify(checkpointDetail.manifest, null, 2)}</pre>
                  {checkpointDetail.steps.map((step) => (
                    <div key={step.stepId} className="checkpoint-card">
                      <strong>{step.stepId}</strong>
                      <span>{step.files.join(", ")}</span>
                      {Object.entries(step.preview).map(([file, content]) => (
                        <details key={file}>
                          <summary>{file}</summary>
                          <pre>{content}</pre>
                        </details>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}

              {terminalReplay.length > 0 ? (
                <div>
                  <h4>Terminal Replay</h4>
                  {terminalReplay.map((entry) => (
                    <div key={entry.runId} className="checkpoint-card">
                      <strong>{entry.command}</strong>
                      <span>{entry.status}</span>
                      <code>{entry.output}</code>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </aside>

        <section className="pane pane-bottom" style={{ gridColumn: "1 / -1", display: showBottomPane ? "flex" : "none" }}>
          <div className="tab-row" role="tablist" aria-label="Bottom panel tabs">
            {bottomTabs.map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={bottomTab === tab}
                className={bottomTab === tab ? "active" : ""}
                onClick={() => toggleBottomFeature(tab)}
              >
                {tab}
              </button>
            ))}
            <button onClick={() => setShowBottomPane(false)}>Hide</button>
          </div>
          {bottomTab === "terminal" ? (
            <div className="terminal-pane">
              <div className="inline-search">
                <input
                  value={terminalInput}
                  onChange={(event) => setTerminalInput(event.target.value)}
                  placeholder="Run command"
                  aria-label="Terminal command"
                />
                <button onClick={runCommand}>Run</button>
                <button onClick={() => { void startPtySession(); }}>Start PTY Session</button>
                <button onClick={() => { void stopPtySession(); }} disabled={!terminalSessionId || terminalSessionStatus !== "running"}>
                  Stop PTY Session
                </button>
                <button onClick={() => { void runPipeline(); }}>Run Pipeline</button>
                <button onClick={() => { void loadTerminalReplay(); }}>Replay</button>
              </div>
              <div className="checkpoint-card">
                <strong>PTY Session</strong>
                <code>id: {terminalSessionId ?? "none"} | status: {terminalSessionStatus}</code>
                <div className="inline-search">
                  <input
                    value={terminalSessionInput}
                    onChange={(event) => setTerminalSessionInput(event.target.value)}
                    placeholder="Send stdin to PTY"
                    aria-label="PTY stdin input"
                  />
                  <button onClick={() => { void sendPtyInput(); }} disabled={!terminalSessionId || terminalSessionStatus !== "running"}>
                    Send
                  </button>
                </div>
              </div>
              <div className="checkpoint-card">
                <strong>Pipeline Commands</strong>
                <input
                  value={pipelineLintCommand}
                  onChange={(event) => setPipelineLintCommand(event.target.value)}
                  placeholder="Lint command"
                  aria-label="Lint command"
                />
                <input
                  value={pipelineTypecheckCommand}
                  onChange={(event) => setPipelineTypecheckCommand(event.target.value)}
                  placeholder="Typecheck command"
                  aria-label="Typecheck command"
                />
                <input
                  value={pipelineTestCommand}
                  onChange={(event) => setPipelineTestCommand(event.target.value)}
                  placeholder="Test command"
                  aria-label="Test command"
                />
                <input
                  value={pipelineBuildCommand}
                  onChange={(event) => setPipelineBuildCommand(event.target.value)}
                  placeholder="Build command"
                  aria-label="Build command"
                />
                {pipelineResult ? (
                  <code>
                    last: {pipelineResult.status} | lint={pipelineResult.checks.lint} typecheck={pipelineResult.checks.typecheck} test={pipelineResult.checks.test} build={pipelineResult.checks.build}
                  </code>
                ) : null}
              </div>
              <pre>{terminalOutput.join("\n")}</pre>
            </div>
          ) : null}
          {bottomTab === "tests" ? (
            <div className="terminal-pane">
              <div className="inline-search">
                <button onClick={() => { setTerminalInput("npm test"); void runCommand(); }}>Rerun Failed Tests</button>
                <button onClick={() => { void runPipeline(); }}>Run Full Pipeline</button>
              </div>
              {testSummaries.map((summary, index) => (
                <div key={`${summary.framework}-${summary.total}-${index}`} className="checkpoint-card">
                  <strong>{summary.framework}</strong>
                  <code>
                    total={summary.total} passed={summary.passed} failed={summary.failed} skipped={summary.skipped}
                  </code>
                  <code>durationMs={summary.durationMs ?? 0}</code>
                </div>
              ))}
              <pre>{testOutput.join("\n\n") || "No test output yet."}</pre>
            </div>
          ) : null}
          {bottomTab === "logs" ? (
            <div className="terminal-pane">
              <pre>{logs.join("\n") || "No logs yet."}</pre>
            </div>
          ) : null}
        </section>

        <div
          className="splitter horizontal"
          style={{ display: showBottomPane ? "block" : "none" }}
          onMouseDown={() => { dragRef.current = "bottom"; }}
          role="separator"
          aria-label="Resize bottom panel"
        />
      </div>

      {commandPaletteOpen ? (
        <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
          <div className="palette-card">
            <h3>Command Palette</h3>
            {["Open Workspace", "Toggle Split Editor", "Run Tests", "Focus Agent", "Export Audit"].map((command) => (
              <button key={command} onClick={() => { void runPaletteCommand(command); }}>{command}</button>
            ))}
            <button onClick={() => setCommandPaletteOpen(false)}>Close</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
