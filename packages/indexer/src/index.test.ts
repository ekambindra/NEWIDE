import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  SymbolIndexer,
  buildContext,
  buildGroundingEvidence,
  evaluateFreshnessTargets
} from "./index.js";

describe("indexer", () => {
  it("indexes symbols incrementally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "indexer-"));
    const file = join(dir, "a.ts");
    await writeFile(file, "import x from 'y'\nexport function demo() {}\n", "utf8");

    const indexer = new SymbolIndexer();
    const first = await indexer.indexFile(dir, file);
    const second = await indexer.indexFile(dir, file);

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(first.length);
    const diagnostics = indexer.diagnostics();
    expect(diagnostics.indexedFiles).toBe(1);
    expect(diagnostics.totalSymbols).toBeGreaterThan(0);
    expect(diagnostics.files[0]?.parserMode).toMatch(/tree_sitter|typescript_ast|regex_fallback/);

    const context = buildContext(first, 1000);
    expect(context.files.length).toBe(1);

    const summaries = indexer.moduleSummaries(10);
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0]?.file).toBe("a.ts");

    const retrieval = indexer.retrievalContext("demo function", 400, 5);
    expect(retrieval.selected.files.includes("a.ts")).toBe(true);
    expect(retrieval.candidates.length).toBeGreaterThan(0);

    const freshness = evaluateFreshnessTargets(diagnostics);
    expect(freshness.meetsTarget).toBe(true);
  });

  it("builds call graph and rename impact analysis", async () => {
    const dir = await mkdtemp(join(tmpdir(), "indexer-call-"));
    const alpha = join(dir, "alpha.ts");
    const beta = join(dir, "beta.ts");
    await writeFile(
      alpha,
      "export function alpha(){ beta(); }\nexport function beta(){ return 1; }\n",
      "utf8"
    );
    await writeFile(beta, "export function consumer(){ alpha(); }\n", "utf8");

    const indexer = new SymbolIndexer();
    await indexer.indexFiles(dir, [alpha, beta]);

    const graph = indexer.callGraph(50);
    expect(graph.edges.some((edge) => edge.from.includes("alpha") && edge.to === "beta")).toBe(true);
    expect(graph.nodes.length).toBeGreaterThan(0);

    const impact = indexer.analyzeRenameImpact("alpha", "alphaRenamed", 20);
    expect(impact.filesTouched).toBeGreaterThan(0);
    expect(impact.totalMatches).toBeGreaterThan(0);
    expect(impact.impacts.some((entry) => entry.file === "beta.ts")).toBe(true);
  });

  it("builds grounding evidence for changed lines", () => {
    const symbols = [
      {
        symbol_id: "a.ts:1:function:demo",
        file: "a.ts",
        kind: "function",
        name: "demo",
        range: { start: 1, end: 1 },
        signature: "export function demo() {}",
        references: []
      }
    ];

    const evidence = buildGroundingEvidence({
      editId: "edit-1",
      file: "a.ts",
      baseContent: "export function demo() {}\nconst value = 1;\n",
      nextContent: "export function demo() {}\nconst value = 2;\n",
      symbols
    });

    expect(evidence.length).toBe(1);
    expect(evidence[0]?.edit_id).toBe("edit-1");
    expect(evidence[0]?.file).toBe("a.ts");
    expect(evidence[0]?.line).toBe(2);
    expect(evidence[0]?.evidence_type).toBe("search");
    expect(evidence[0]?.excerpt_hash.length).toBe(40);
  });

  it("marks freshness target miss when latency exceeds thresholds", () => {
    const report = evaluateFreshnessTargets(
      { freshnessLatencyMs: 450, batchLatencyMs: 4100 },
      200,
      2000
    );
    expect(report.smallWithinTarget).toBe(false);
    expect(report.batchWithinTarget).toBe(false);
    expect(report.meetsTarget).toBe(false);
  });
});
