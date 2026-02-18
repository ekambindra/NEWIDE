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
});

