import { describe, expect, it } from "vitest";
import { normalizeSessionSnapshot } from "./session";

describe("session snapshot normalization", () => {
  it("applies defaults and clears invalid tab references", () => {
    const normalized = normalizeSessionSnapshot({
      workspaceRoot: "/tmp/workspace",
      tabs: [{ path: "src/a.ts", dirty: false, binary: false }],
      activeTab: "src/missing.ts",
      secondTab: "src/a.ts",
      leftTab: "search",
      panelTab: "diff",
      bottomTab: "logs",
      autoSaveMode: "onBlur",
      searchText: "indexer",
      terminalInput: "npm run lint"
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.workspaceRoot).toBe("/tmp/workspace");
    expect(normalized?.activeTab).toBeNull();
    expect(normalized?.secondTab).toBe("src/a.ts");
    expect(normalized?.leftTab).toBe("search");
    expect(normalized?.panelTab).toBe("diff");
    expect(normalized?.bottomTab).toBe("logs");
  });

  it("deduplicates tabs and bounds the tab list", () => {
    const tabs = Array.from({ length: 34 }, (_, index) => ({
      path: `src/file-${index % 20}.ts`,
      content: "x".repeat(200_000),
      originalContent: "y".repeat(200_000),
      dirty: true,
      binary: false
    }));

    const normalized = normalizeSessionSnapshot({
      tabs,
      terminalInput: "npm run test"
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.tabs.length).toBeLessThanOrEqual(30);
    expect(normalized?.tabs[0]?.content.length).toBeLessThanOrEqual(120_000);
    expect(normalized?.tabs[0]?.originalContent.length).toBeLessThanOrEqual(120_000);
  });

  it("normalizes workflow history and bounds size", () => {
    const history = Array.from({ length: 75 }, (_, index) =>
      index % 7 === 0 ? "   " : `command-${index}-${"x".repeat(800)}`
    );

    const normalized = normalizeSessionSnapshot({
      workflowHistory: history
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.workflowHistory.length).toBeLessThanOrEqual(60);
    expect(normalized?.workflowHistory.every((entry) => entry.length > 0)).toBe(true);
    expect(normalized?.workflowHistory.every((entry) => entry.length <= 500)).toBe(true);
  });

  it("normalizes quick chip favorites and removes duplicates", () => {
    const normalized = normalizeSessionSnapshot({
      quickChipFavorites: [
        "",
        " /pipeline ",
        "/pipeline",
        "/run npm run test",
        "/run npm run test",
        "x".repeat(300)
      ]
    });

    expect(normalized).not.toBeNull();
    expect(normalized?.quickChipFavorites.length).toBe(3);
    expect(normalized?.quickChipFavorites[0]).toBe("/pipeline");
    expect(normalized?.quickChipFavorites[1]).toBe("/run npm run test");
    expect(normalized?.quickChipFavorites[2]?.length).toBeLessThanOrEqual(120);
  });
});
