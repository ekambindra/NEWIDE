export type SessionLeftTab = "files" | "search";
export type SessionPanelTab = "agent" | "plan" | "diff" | "checkpoints";
export type SessionBottomTab = "terminal" | "tests" | "logs";
export type SessionAutoSaveMode = "manual" | "afterDelay" | "onBlur";

export type SessionTabSnapshot = {
  path: string;
  binary: boolean;
  dirty: boolean;
  content: string;
  originalContent: string;
};

export type SessionSnapshot = {
  version: 1;
  updatedAt: string;
  workspaceRoot: string | null;
  tabs: SessionTabSnapshot[];
  activeTab: string | null;
  secondTab: string | null;
  splitEnabled: boolean;
  leftTab: SessionLeftTab;
  panelTab: SessionPanelTab;
  bottomTab: SessionBottomTab;
  autoSaveMode: SessionAutoSaveMode;
  searchText: string;
  terminalInput: string;
  workflowHistory: string[];
  quickChipFavorites: string[];
};

export const SESSION_STORAGE_KEY = "atlas-meridian-session-v1";

const MAX_TABS = 30;
const MAX_TAB_TEXT_LENGTH = 120_000;
const MAX_SEARCH_LENGTH = 1000;
const MAX_COMMAND_LENGTH = 2000;
const MAX_WORKFLOW_HISTORY = 60;
const MAX_WORKFLOW_ENTRY_LENGTH = 500;
const MAX_QUICK_CHIP_FAVORITES = 16;
const MAX_QUICK_CHIP_LENGTH = 120;

const leftTabs: SessionLeftTab[] = ["files", "search"];
const panelTabs: SessionPanelTab[] = ["agent", "plan", "diff", "checkpoints"];
const bottomTabs: SessionBottomTab[] = ["terminal", "tests", "logs"];
const autoSaveModes: SessionAutoSaveMode[] = ["manual", "afterDelay", "onBlur"];

const defaultSnapshot: SessionSnapshot = {
  version: 1,
  updatedAt: "",
  workspaceRoot: null,
  tabs: [],
  activeTab: null,
  secondTab: null,
  splitEnabled: false,
  leftTab: "files",
  panelTab: "agent",
  bottomTab: "terminal",
  autoSaveMode: "manual",
  searchText: "",
  terminalInput: "npm run test",
  workflowHistory: [],
  quickChipFavorites: []
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function normalizeStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function normalizeEnum<T extends string>(value: unknown, accepted: readonly T[], fallback: T): T {
  return typeof value === "string" && accepted.includes(value as T) ? (value as T) : fallback;
}

function normalizeWorkflowHistory(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const sanitized = value
    .map((item) => normalizeText(item, MAX_WORKFLOW_ENTRY_LENGTH).trim())
    .filter((item) => item.length > 0);
  if (sanitized.length <= MAX_WORKFLOW_HISTORY) {
    return sanitized;
  }
  return sanitized.slice(sanitized.length - MAX_WORKFLOW_HISTORY);
}

function normalizeQuickChipFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<string>();
  for (const raw of value) {
    const normalized = normalizeText(raw, MAX_QUICK_CHIP_LENGTH).trim();
    if (!normalized) {
      continue;
    }
    unique.add(normalized);
    if (unique.size >= MAX_QUICK_CHIP_FAVORITES) {
      break;
    }
  }
  return [...unique];
}

function normalizeTab(raw: unknown): SessionTabSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }
  const path = normalizeText(raw.path, MAX_COMMAND_LENGTH);
  if (!path) {
    return null;
  }

  const dirty = raw.dirty === true;
  const binary = raw.binary === true;
  const content = normalizeText(raw.content, MAX_TAB_TEXT_LENGTH);
  const originalContent = normalizeText(raw.originalContent, MAX_TAB_TEXT_LENGTH);

  return {
    path,
    dirty,
    binary,
    content,
    originalContent
  };
}

export function normalizeSessionSnapshot(raw: unknown): SessionSnapshot | null {
  if (!isRecord(raw)) {
    return null;
  }

  const tabsRaw = Array.isArray(raw.tabs) ? raw.tabs : [];
  const deduped = new Map<string, SessionTabSnapshot>();
  for (const tabRaw of tabsRaw) {
    const normalized = normalizeTab(tabRaw);
    if (!normalized) {
      continue;
    }
    deduped.set(normalized.path, normalized);
    if (deduped.size >= MAX_TABS) {
      break;
    }
  }
  const tabs = [...deduped.values()];
  const tabPaths = new Set(tabs.map((tab) => tab.path));

  const activeTabCandidate = normalizeStringOrNull(raw.activeTab);
  const secondTabCandidate = normalizeStringOrNull(raw.secondTab);

  return {
    ...defaultSnapshot,
    updatedAt: new Date().toISOString(),
    workspaceRoot: normalizeStringOrNull(raw.workspaceRoot),
    tabs,
    activeTab: activeTabCandidate && tabPaths.has(activeTabCandidate) ? activeTabCandidate : null,
    secondTab: secondTabCandidate && tabPaths.has(secondTabCandidate) ? secondTabCandidate : null,
    splitEnabled: raw.splitEnabled === true,
    leftTab: normalizeEnum(raw.leftTab, leftTabs, defaultSnapshot.leftTab),
    panelTab: normalizeEnum(raw.panelTab, panelTabs, defaultSnapshot.panelTab),
    bottomTab: normalizeEnum(raw.bottomTab, bottomTabs, defaultSnapshot.bottomTab),
    autoSaveMode: normalizeEnum(raw.autoSaveMode, autoSaveModes, defaultSnapshot.autoSaveMode),
    searchText: normalizeText(raw.searchText, MAX_SEARCH_LENGTH),
    terminalInput: normalizeText(raw.terminalInput, MAX_COMMAND_LENGTH) || defaultSnapshot.terminalInput,
    workflowHistory: normalizeWorkflowHistory(raw.workflowHistory),
    quickChipFavorites: normalizeQuickChipFavorites(raw.quickChipFavorites)
  };
}

export function loadSessionSnapshot(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return normalizeSessionSnapshot(parsed);
  } catch {
    return null;
  }
}

export function saveSessionSnapshot(snapshot: SessionSnapshot): void {
  const normalized = normalizeSessionSnapshot(snapshot);
  if (!normalized) {
    return;
  }
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalized));
}

export function clearSessionSnapshot(): void {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}
