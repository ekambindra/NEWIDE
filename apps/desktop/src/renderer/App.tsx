import { useEffect, useMemo, useRef, useState } from "react";
import { defaultLayout, loadLayout, saveLayout, type LayoutState } from "./layout";

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

class AppErrorBoundary extends Error {
  constructor(public readonly original: unknown) {
    super("App crashed");
  }
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
  const [testOutput, setTestOutput] = useState<string[]>([]);
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
  const [teamMemory, setTeamMemory] = useState<TeamMemoryEntry[]>([]);
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
  const [autoSaveMode, setAutoSaveMode] = useState<"manual" | "afterDelay" | "onBlur">("manual");
  const dragRef = useRef<null | "left" | "right" | "bottom">(null);

  const active = useMemo(() => tabs.find((tab) => tab.path === activeTab) ?? null, [tabs, activeTab]);
  const secondary = useMemo(() => tabs.find((tab) => tab.path === secondTab) ?? null, [tabs, secondTab]);

  const diffChunks = useMemo(() => {
    if (!active || active.binary) {
      return [];
    }
    return computeDiffChunks(active.originalContent, active.content, chunkDecisions[active.path]);
  }, [active, chunkDecisions]);

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

  const refreshTeamData = async () => {
    const [memory, decisions] = await Promise.all([
      window.ide.listTeamMemory(),
      window.ide.listDecisionLogs()
    ]);
    setTeamMemory(memory);
    setDecisionLogs(decisions);
  };

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
    if (!workspaceRoot) {
      return;
    }

    void refreshTree(workspaceRoot);
    void refreshAudit();
    void refreshCheckpoints();
    void refreshTeamData();
    void window.ide.startWatch(workspaceRoot);
    const unsubscribe = window.ide.onWorkspaceChanged(async () => {
      await refreshTree(workspaceRoot);
      setLogs((prev) => [`[watch] workspace changed ${new Date().toLocaleTimeString()}`, ...prev].slice(0, 200));
    });

    return () => {
      unsubscribe();
      void window.ide.stopWatch(workspaceRoot);
    };
  }, [workspaceRoot]);

  useEffect(() => {
    void refreshCheckpoints();
    void refreshAudit();
    void refreshTeamData();
  }, []);

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
    setWorkspaceRoot(root);
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
  };

  const runCommand = async () => {
    if (!workspaceRoot || !terminalInput.trim()) {
      return;
    }
    const result = await window.ide.runCommand(workspaceRoot, terminalInput.trim());
    setTerminalOutput((prev) => [`$ ${result.command}`, result.stdout, result.stderr, ...prev].slice(0, 400));
    setLogs((prev) => [`[terminal] ${result.policy.decision} ${result.command}`, ...prev]);
    if (/test/.test(result.command)) {
      setTestOutput((prev) => [`${result.stdout}${result.stderr}`.trim(), ...prev].slice(0, 100));
      setBottomTab("tests");
    }
    if (result.policy.decision === "require_approval") {
      setPendingApprovalCommand(result.command);
      setPanelTab("plan");
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
    if (result.artifactPath) {
      await refreshCheckpoints();
    }
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
    await refreshCheckpoints();
    await refreshAudit();
    setLogs((prev) => [
      `[multi-agent] ${summary.coordinatorRunId} ${summary.overallStatus}`,
      ...prev
    ]);
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

  if (typeof window.ide === "undefined") {
    throw new AppErrorBoundary("preload api missing");
  }

  return (
    <div className="app-shell" aria-label="Atlas Meridian">
      <header className="topbar">
        <div className="logo-wrap">
          <span className="logo-dot" />
          <strong>Atlas Meridian</strong>
        </div>
        <div className="header-actions">
          <button onClick={openWorkspace}>Open Workspace</button>
          <button onClick={() => setCommandPaletteOpen(true)}>Command Palette</button>
          <button onClick={() => setSplitEnabled((flag) => !flag)}>{splitEnabled ? "Single" : "Split"} Editor</button>
          <select value={autoSaveMode} onChange={(event) => setAutoSaveMode(event.target.value as "manual" | "afterDelay" | "onBlur")}>
            <option value="manual">Save: Manual</option>
            <option value="afterDelay">Save: Delay</option>
            <option value="onBlur">Save: Blur</option>
          </select>
        </div>
      </header>

      <div className="main-grid" style={{
        gridTemplateColumns: `${layout.leftWidth}px 6px minmax(420px, 1fr) 6px ${layout.rightWidth}px`,
        gridTemplateRows: `minmax(280px, 1fr) 6px ${layout.bottomHeight}px`
      }}>
        <aside className="pane pane-left">
          <div className="tab-row">
            {leftTabs.map((tab) => (
              <button key={tab} className={leftTab === tab ? "active" : ""} onClick={() => setLeftTab(tab)}>
                {tab}
              </button>
            ))}
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

        <div className="splitter vertical" onMouseDown={() => { dragRef.current = "left"; }} role="separator" aria-label="Resize left panel" />

        <section className="pane pane-editor">
          <div className="breadcrumbs">
            {breadcrumbs.length ? breadcrumbs.join(" / ") : "No file selected"}
          </div>
          <div className="tab-row tabs-files">
            {tabs.map((tab) => (
              <button key={tab.path} className={activeTab === tab.path ? "active" : ""} onClick={() => setActiveTab(tab.path)}>
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
            <input value={replaceNeedle} onChange={(event) => setReplaceNeedle(event.target.value)} placeholder="Find" />
            <input value={replaceValue} onChange={(event) => setReplaceValue(event.target.value)} placeholder="Replace" />
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

        <div className="splitter vertical" onMouseDown={() => { dragRef.current = "right"; }} role="separator" aria-label="Resize right panel" />

        <aside className="pane pane-right">
          <div className="tab-row">
            {panelTabs.map((tab) => (
              <button key={tab} className={panelTab === tab ? "active" : ""} onClick={() => setPanelTab(tab)}>
                {tab}
              </button>
            ))}
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
              {pendingApprovalCommand ? (
                <div className="checkpoint-card">
                  <strong>Pending Command Approval</strong>
                  <code>{pendingApprovalCommand}</code>
                  <div className="inline-search">
                    <button onClick={() => { void runApprovedCommand(); }}>Approve + Run</button>
                    <button onClick={() => setPendingApprovalCommand(null)}>Dismiss</button>
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

        <section className="pane pane-bottom" style={{ gridColumn: "1 / -1" }}>
          <div className="tab-row">
            {bottomTabs.map((tab) => (
              <button key={tab} className={bottomTab === tab ? "active" : ""} onClick={() => setBottomTab(tab)}>
                {tab}
              </button>
            ))}
          </div>
          {bottomTab === "terminal" ? (
            <div className="terminal-pane">
              <div className="inline-search">
                <input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} placeholder="Run command" />
                <button onClick={runCommand}>Run</button>
                <button onClick={() => { void loadTerminalReplay(); }}>Replay</button>
              </div>
              <pre>{terminalOutput.join("\n")}</pre>
            </div>
          ) : null}
          {bottomTab === "tests" ? (
            <div className="terminal-pane">
              <button onClick={() => { setTerminalInput("npm test"); void runCommand(); }}>Rerun Failed Tests</button>
              <pre>{testOutput.join("\n\n") || "No test output yet."}</pre>
            </div>
          ) : null}
          {bottomTab === "logs" ? (
            <div className="terminal-pane">
              <pre>{logs.join("\n") || "No logs yet."}</pre>
            </div>
          ) : null}
        </section>

        <div className="splitter horizontal" onMouseDown={() => { dragRef.current = "bottom"; }} role="separator" aria-label="Resize bottom panel" />
      </div>

      {commandPaletteOpen ? (
        <div className="command-palette" role="dialog" aria-label="Command palette">
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
