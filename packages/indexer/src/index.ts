import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, relative } from "node:path";
import ts from "typescript";
import type { GroundingEvidence, IndexSymbol } from "@ide/shared";

export type SearchMatch = {
  file: string;
  line: number;
  text: string;
};

export type RepoMapEntry = {
  file: string;
  symbols: number;
  imports: string[];
};

export type ModuleSummary = {
  file: string;
  symbolCount: number;
  importCount: number;
  topKinds: string[];
  topSymbols: string[];
  summary: string;
};

export type FreshnessTargetReport = {
  smallTargetMs: number;
  batchTargetMs: number;
  observedSmallMs: number | null;
  observedBatchMs: number | null;
  smallWithinTarget: boolean | null;
  batchWithinTarget: boolean | null;
  meetsTarget: boolean;
};

export type RetrievalCandidate = {
  file: string;
  score: number;
  matchedTerms: number;
  symbolCount: number;
  parseHealthy: boolean;
};

export type RetrievalContextReport = {
  query: string;
  tokenBudget: number;
  selected: ContextSelection;
  candidates: RetrievalCandidate[];
};

export type CallGraphEdge = {
  file: string;
  from: string;
  to: string;
  line: number;
};

export type CallGraphReport = {
  nodes: string[];
  edges: CallGraphEdge[];
  topCallers: Array<{ symbol: string; count: number }>;
  topCallees: Array<{ symbol: string; count: number }>;
};

export type RenameImpactEntry = {
  file: string;
  totalMatches: number;
  declarationMatches: number;
  referenceMatches: number;
  collisionMatches: number;
  lines: number[];
};

export type RenameImpactReport = {
  from: string;
  to: string;
  filesTouched: number;
  totalMatches: number;
  declarationMatches: number;
  referenceMatches: number;
  collisionMatches: number;
  impacts: RenameImpactEntry[];
};

export type ParserMode = "tree_sitter" | "typescript_ast" | "regex_fallback";

export type FileIndexDiagnostics = {
  file: string;
  absolutePath: string;
  parserMode: ParserMode;
  symbols: number;
  latencyMs: number;
  indexedAt: string;
  fromCache: boolean;
  error: string | null;
};

export type IndexerDiagnostics = {
  parserPipeline: "tree_sitter" | "fallback";
  treeSitterAvailable: boolean;
  treeSitterReason: string | null;
  indexedFiles: number;
  totalSymbols: number;
  parseErrors: number;
  freshnessLatencyMs: number | null;
  batchLatencyMs: number | null;
  files: FileIndexDiagnostics[];
};

type TreeSitterRuntime = {
  ParserCtor: new () => {
    setLanguage: (lang: unknown) => void;
    parse: (source: string) => { rootNode: TreeSitterNode };
  };
  javascriptLanguage: unknown | null;
  typescriptLanguage: unknown | null;
  tsxLanguage: unknown | null;
};

type TreeSitterNode = {
  type: string;
  namedChildren?: TreeSitterNode[];
  startPosition?: { row: number };
  endPosition?: { row: number };
  startIndex?: number;
  endIndex?: number;
  childForFieldName?: (field: string) => TreeSitterNode | null;
};

const require = createRequire(import.meta.url);

function nowIso(): string {
  return new Date().toISOString();
}

function safeNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function normalizeRepoPath(path: string): string {
  return path.replaceAll("\\", "/");
}

export class LexicalSearch {
  async search(cwd: string, pattern: string): Promise<SearchMatch[]> {
    const args = ["--line-number", "--no-heading", pattern, cwd];
    const chunks: string[] = [];

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("rg", args, { cwd });
      proc.stdout.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
      proc.stderr.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
      proc.on("error", reject);
      proc.on("exit", () => resolve());
    });

    return chunks
      .join("")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const first = line.indexOf(":");
        const second = line.indexOf(":", first + 1);
        if (first === -1 || second === -1) {
          return null;
        }
        return {
          file: line.slice(0, first),
          line: Number(line.slice(first + 1, second)),
          text: line.slice(second + 1)
        };
      })
      .filter((entry): entry is SearchMatch => entry !== null);
  }
}

export class SymbolIndexer {
  private readonly fileHashes = new Map<string, string>();
  private readonly symbolsByFile = new Map<string, IndexSymbol[]>();
  private readonly sourceByFile = new Map<string, string>();
  private readonly fileDiagnosticsByPath = new Map<string, FileIndexDiagnostics>();
  private lastBatchLatencyMs: number | null = null;
  private lastFreshnessLatencyMs: number | null = null;

  private treeSitterChecked = false;
  private treeSitterRuntime: TreeSitterRuntime | null = null;
  private treeSitterReason: string | null = null;

  async indexFile(workspaceRoot: string, filePath: string): Promise<IndexSymbol[]> {
    const source = await readFile(filePath, "utf8");
    const hash = createHash("sha1").update(source).digest("hex");
    if (this.fileHashes.get(filePath) === hash) {
      const existing = this.fileDiagnosticsByPath.get(filePath);
      if (existing) {
        this.fileDiagnosticsByPath.set(filePath, {
          ...existing,
          fromCache: true,
          indexedAt: nowIso()
        });
      }
      return this.symbolsByFile.get(filePath) ?? [];
    }

    const started = Date.now();
    const relFile = relative(workspaceRoot, filePath);
    const parsed = this.extractWithParserPipeline(source, relFile);
    const latencyMs = Date.now() - started;

    this.fileHashes.set(filePath, hash);
    this.symbolsByFile.set(filePath, parsed.symbols);
    this.sourceByFile.set(filePath, source);
    this.fileDiagnosticsByPath.set(filePath, {
      file: relFile,
      absolutePath: filePath,
      parserMode: parsed.parserMode,
      symbols: parsed.symbols.length,
      latencyMs,
      indexedAt: nowIso(),
      fromCache: false,
      error: parsed.error
    });
    this.lastFreshnessLatencyMs = latencyMs;
    return parsed.symbols;
  }

  async indexFiles(workspaceRoot: string, files: string[]): Promise<{
    indexedFiles: number;
    symbols: number;
    batchLatencyMs: number;
  }> {
    const started = Date.now();
    let symbols = 0;
    for (const filePath of files) {
      const indexed = await this.indexFile(workspaceRoot, filePath);
      symbols += indexed.length;
    }
    this.lastBatchLatencyMs = Date.now() - started;
    return {
      indexedFiles: files.length,
      symbols,
      batchLatencyMs: this.lastBatchLatencyMs
    };
  }

  getFileSymbols(filePath: string): IndexSymbol[] {
    return this.symbolsByFile.get(filePath) ?? [];
  }

  fileDiagnostics(): FileIndexDiagnostics[] {
    return [...this.fileDiagnosticsByPath.values()].sort((a, b) => b.indexedAt.localeCompare(a.indexedAt));
  }

  diagnostics(): IndexerDiagnostics {
    const files = this.fileDiagnostics();
    return {
      parserPipeline: this.treeSitterRuntime ? "tree_sitter" : "fallback",
      treeSitterAvailable: this.treeSitterRuntime !== null,
      treeSitterReason: this.treeSitterReason,
      indexedFiles: files.length,
      totalSymbols: files.reduce((sum, file) => sum + file.symbols, 0),
      parseErrors: files.filter((file) => file.error !== null).length,
      freshnessLatencyMs: this.lastFreshnessLatencyMs,
      batchLatencyMs: this.lastBatchLatencyMs,
      files
    };
  }

  invalidate(filePath: string): void {
    this.fileHashes.delete(filePath);
    this.symbolsByFile.delete(filePath);
    this.sourceByFile.delete(filePath);
    this.fileDiagnosticsByPath.delete(filePath);
  }

  repoMap(): RepoMapEntry[] {
    return [...this.symbolsByFile.entries()].map(([filePath, symbols]) => ({
      file: symbols[0]?.file ?? normalizeRepoPath(filePath),
      symbols: symbols.length,
      imports: symbols.filter((symbol) => symbol.kind === "import").map((symbol) => symbol.name)
    }));
  }

  moduleSummaries(limit = 100): ModuleSummary[] {
    const summaries = [...this.symbolsByFile.entries()].map(([filePath, symbols]) => {
      const file = symbols[0]?.file ?? normalizeRepoPath(filePath);
      const byKind = new Map<string, number>();
      for (const symbol of symbols) {
        byKind.set(symbol.kind, (byKind.get(symbol.kind) ?? 0) + 1);
      }
      const topKinds = [...byKind.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([kind, count]) => `${kind}:${count}`);
      const topSymbols = symbols
        .filter((symbol) => symbol.kind !== "import")
        .slice(0, 4)
        .map((symbol) => symbol.name);
      const importCount = symbols.filter((symbol) => symbol.kind === "import").length;

      return {
        file,
        symbolCount: symbols.length,
        importCount,
        topKinds,
        topSymbols,
        summary: `${file} has ${symbols.length} symbols, ${importCount} imports; dominant kinds: ${
          topKinds.join(", ") || "none"
        }`
      };
    });

    return summaries
      .sort((a, b) => b.symbolCount - a.symbolCount)
      .slice(0, Math.max(1, limit));
  }

  retrievalContext(query: string, tokenBudget: number, limit = 20): RetrievalContextReport {
    const terms = tokenizeQuery(query);
    const diagnostics = new Map(
      this.fileDiagnostics().map((diag) => [normalizeRepoPath(diag.file), diag])
    );

    const candidates = this.moduleSummaries(500).map((summary) => {
      const diag = diagnostics.get(normalizeRepoPath(summary.file));
      const parseHealthy = diag?.error === null;
      const searchText = `${summary.file} ${summary.topSymbols.join(" ")} ${summary.topKinds.join(" ")}`.toLowerCase();
      const matchedTerms = terms.reduce((count, term) => count + (searchText.includes(term) ? 1 : 0), 0);
      const score =
        matchedTerms * 3 +
        Math.log1p(summary.symbolCount) +
        Math.min(2, summary.importCount * 0.15) +
        (parseHealthy ? 1 : 0.25);

      return {
        file: summary.file,
        score: Number(score.toFixed(4)),
        matchedTerms,
        symbolCount: summary.symbolCount,
        parseHealthy
      };
    });

    const ranked = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit));

    const symbolOrder = new Map(
      ranked.map((candidate, idx) => [normalizeRepoPath(candidate.file), idx])
    );
    const rankedSymbols = [...this.symbolsByFile.values()]
      .flat()
      .sort((a, b) => {
        const aRank = symbolOrder.get(normalizeRepoPath(a.file)) ?? Number.MAX_SAFE_INTEGER;
        const bRank = symbolOrder.get(normalizeRepoPath(b.file)) ?? Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) {
          return aRank - bRank;
        }
        return a.range.start - b.range.start;
      });

    return {
      query,
      tokenBudget,
      selected: buildContext(rankedSymbols, tokenBudget),
      candidates: ranked
    };
  }

  callGraph(limitEdges = 500): CallGraphReport {
    const edges: CallGraphEdge[] = [];
    const nodes = new Set<string>();

    for (const [filePath, source] of this.sourceByFile.entries()) {
      const relFile = this.symbolsByFile.get(filePath)?.[0]?.file ?? normalizeRepoPath(filePath);
      const ext = extname(relFile).toLowerCase();
      if (!isCodeExt(ext)) {
        continue;
      }

      try {
        const sourceFile = ts.createSourceFile(
          relFile,
          source,
          ts.ScriptTarget.Latest,
          true,
          scriptKindForExt(ext)
        );
        const moduleNode = `<module:${relFile}>`;
        const fnStack: string[] = [moduleNode];
        nodes.add(moduleNode);

        const walk = (node: ts.Node): void => {
          if (isNamedFunctionLike(node)) {
            fnStack.push(functionLikeName(node));
            nodes.add(fnStack[fnStack.length - 1] ?? "<anonymous>");
          }

          if (ts.isCallExpression(node)) {
            const from = fnStack[fnStack.length - 1] ?? "<anonymous>";
            const to = callTargetName(node.expression);
            const line = sourceFile.getLineAndCharacterOfPosition(
              node.expression.getStart(sourceFile)
            ).line + 1;
            nodes.add(from);
            nodes.add(to);
            edges.push({
              file: relFile,
              from,
              to,
              line
            });
          }

          ts.forEachChild(node, walk);
          if (isNamedFunctionLike(node)) {
            fnStack.pop();
          }
        };
        walk(sourceFile);
      } catch {
        continue;
      }
    }

    const limited = edges.slice(0, Math.max(1, limitEdges));
    return {
      nodes: [...nodes].sort(),
      edges: limited,
      topCallers: topFrequency(limited.map((edge) => edge.from), 12),
      topCallees: topFrequency(limited.map((edge) => edge.to), 12)
    };
  }

  analyzeRenameImpact(from: string, to: string, limit = 100): RenameImpactReport {
    const target = from.trim();
    const replacement = to.trim();
    if (!target) {
      return {
        from: target,
        to: replacement,
        filesTouched: 0,
        totalMatches: 0,
        declarationMatches: 0,
        referenceMatches: 0,
        collisionMatches: 0,
        impacts: []
      };
    }

    const escapedTarget = escapeRegExp(target);
    const escapedReplacement = escapeRegExp(replacement);
    const matchPattern = new RegExp(`\\b${escapedTarget}\\b`, "g");
    const collisionPattern = replacement ? new RegExp(`\\b${escapedReplacement}\\b`, "g") : null;
    const impacts: RenameImpactEntry[] = [];

    for (const [filePath, source] of this.sourceByFile.entries()) {
      const relFile = this.symbolsByFile.get(filePath)?.[0]?.file ?? normalizeRepoPath(filePath);
      const lines = normalizeLf(source).split("\n");
      const hitLines: number[] = [];
      let totalMatches = 0;

      for (let idx = 0; idx < lines.length; idx += 1) {
        const line = lines[idx] ?? "";
        const matches = line.match(matchPattern);
        if (matches && matches.length > 0) {
          totalMatches += matches.length;
          hitLines.push(idx + 1);
        }
      }

      if (totalMatches === 0) {
        continue;
      }

      const declarationMatches = (this.symbolsByFile.get(filePath) ?? []).filter(
        (symbol) => symbol.name === target
      ).length;
      const referenceMatches = Math.max(0, totalMatches - declarationMatches);
      const collisionMatches = collisionPattern
        ? (normalizeLf(source).match(collisionPattern)?.length ?? 0)
        : 0;

      impacts.push({
        file: relFile,
        totalMatches,
        declarationMatches,
        referenceMatches,
        collisionMatches,
        lines: hitLines.slice(0, 16)
      });
    }

    const sorted = impacts
      .sort((a, b) => b.totalMatches - a.totalMatches)
      .slice(0, Math.max(1, limit));

    return {
      from: target,
      to: replacement,
      filesTouched: sorted.length,
      totalMatches: sorted.reduce((sum, item) => sum + item.totalMatches, 0),
      declarationMatches: sorted.reduce((sum, item) => sum + item.declarationMatches, 0),
      referenceMatches: sorted.reduce((sum, item) => sum + item.referenceMatches, 0),
      collisionMatches: sorted.reduce((sum, item) => sum + item.collisionMatches, 0),
      impacts: sorted
    };
  }

  private extractWithParserPipeline(
    source: string,
    file: string
  ): {
    parserMode: ParserMode;
    symbols: IndexSymbol[];
    error: string | null;
  } {
    const treeSitter = this.tryTreeSitterExtraction(source, file);
    if (treeSitter) {
      return treeSitter;
    }

    const tsAst = this.tryTypeScriptAstExtraction(source, file);
    if (tsAst) {
      return tsAst;
    }

    return {
      parserMode: "regex_fallback",
      symbols: this.extractWithRegex(source, file),
      error: "type-aware parser unavailable; regex fallback used"
    };
  }

  private ensureTreeSitterRuntime(): void {
    if (this.treeSitterChecked) {
      return;
    }
    this.treeSitterChecked = true;
    try {
      const parserMod = require("tree-sitter") as { default?: unknown };
      const jsMod = require("tree-sitter-javascript") as { default?: unknown };
      const tsMod = require("tree-sitter-typescript") as { default?: unknown };

      const ParserCtor = (parserMod.default ?? parserMod) as TreeSitterRuntime["ParserCtor"];
      const javascriptLanguage = (jsMod.default ?? jsMod) as unknown;
      const tsPkg = (tsMod.default ?? tsMod) as Record<string, unknown>;

      this.treeSitterRuntime = {
        ParserCtor,
        javascriptLanguage,
        typescriptLanguage: (tsPkg.typescript as unknown) ?? null,
        tsxLanguage: (tsPkg.tsx as unknown) ?? null
      };
      this.treeSitterReason = null;
    } catch (error) {
      this.treeSitterRuntime = null;
      this.treeSitterReason =
        error instanceof Error
          ? `tree-sitter unavailable: ${error.message}`
          : "tree-sitter unavailable in current runtime";
    }
  }

  private treeSitterLanguageForFile(file: string): unknown | null {
    if (!this.treeSitterRuntime) {
      return null;
    }
    const ext = extname(file).toLowerCase();
    if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
      return this.treeSitterRuntime.javascriptLanguage;
    }
    if (ext === ".tsx") {
      return this.treeSitterRuntime.tsxLanguage ?? this.treeSitterRuntime.typescriptLanguage;
    }
    if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
      return this.treeSitterRuntime.typescriptLanguage ?? this.treeSitterRuntime.tsxLanguage;
    }
    return null;
  }

  private tryTreeSitterExtraction(
    source: string,
    file: string
  ): {
    parserMode: ParserMode;
    symbols: IndexSymbol[];
    error: string | null;
  } | null {
    this.ensureTreeSitterRuntime();
    if (!this.treeSitterRuntime) {
      return null;
    }

    const language = this.treeSitterLanguageForFile(file);
    if (!language) {
      return null;
    }

    try {
      const parser = new this.treeSitterRuntime.ParserCtor();
      parser.setLanguage(language);
      const tree = parser.parse(source);
      const symbols: IndexSymbol[] = [];
      const toLine = (node: TreeSitterNode, which: "start" | "end"): number => {
        const position = which === "start" ? node.startPosition : node.endPosition;
        return safeNumber(position?.row, 0) + 1;
      };
      const nodeText = (node: TreeSitterNode): string =>
        source.slice(safeNumber(node.startIndex), safeNumber(node.endIndex));
      const push = (kind: string, name: string, node: TreeSitterNode, signature: string): void => {
        symbols.push({
          symbol_id: `${file}:${toLine(node, "start")}:${kind}:${name}`,
          file,
          kind,
          name,
          range: { start: toLine(node, "start"), end: toLine(node, "end") },
          signature: signature.trim().slice(0, 240),
          references: []
        });
      };

      const walk = (node: TreeSitterNode): void => {
        if (node.type === "import_statement") {
          const text = nodeText(node);
          const match = text.match(/from\s+["']([^"']+)["']/);
          if (match?.[1]) {
            push("import", match[1], node, text);
          }
        }

        if (
          node.type === "function_declaration" ||
          node.type === "class_declaration" ||
          node.type === "interface_declaration" ||
          node.type === "enum_declaration" ||
          node.type === "type_alias_declaration" ||
          node.type === "method_definition"
        ) {
          const nameNode = node.childForFieldName?.("name");
          const name = nameNode ? nodeText(nameNode).trim() : "";
          if (name) {
            const kind = node.type.replace(/_declaration$/, "");
            push(kind, name, node, nodeText(node));
          }
        }

        if (node.type === "variable_declarator") {
          const value = node.childForFieldName?.("value");
          const nameNode = node.childForFieldName?.("name");
          const name = nameNode ? nodeText(nameNode).trim() : "";
          const valueType = value?.type ?? "";
          if (
            name &&
            (valueType.includes("function") || valueType === "arrow_function")
          ) {
            push("function", name, node, nodeText(node));
          }
        }

        for (const child of node.namedChildren ?? []) {
          walk(child);
        }
      };

      walk(tree.rootNode);
      return {
        parserMode: "tree_sitter",
        symbols,
        error: null
      };
    } catch (error) {
      return {
        parserMode: "regex_fallback",
        symbols: this.extractWithRegex(source, file),
        error: error instanceof Error ? `tree-sitter parse failed: ${error.message}` : "tree-sitter parse failed"
      };
    }
  }

  private tryTypeScriptAstExtraction(
    source: string,
    file: string
  ): {
    parserMode: ParserMode;
    symbols: IndexSymbol[];
    error: string | null;
  } | null {
    const ext = extname(file).toLowerCase();
    if (![".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(ext)) {
      return null;
    }

    try {
      const kind =
        ext === ".tsx" ? ts.ScriptKind.TSX
        : ext === ".ts" || ext === ".mts" || ext === ".cts" ? ts.ScriptKind.TS
        : ext === ".jsx" ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
      const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
      const symbols: IndexSymbol[] = [];
      const push = (kindName: string, name: string, node: ts.Node, signature: string): void => {
        const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
        const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
        symbols.push({
          symbol_id: `${file}:${start}:${kindName}:${name}`,
          file,
          kind: kindName,
          name,
          range: { start, end },
          signature: signature.trim().slice(0, 240),
          references: []
        });
      };

      const walk = (node: ts.Node): void => {
        if (ts.isImportDeclaration(node)) {
          const spec = node.moduleSpecifier.getText(sourceFile).replace(/^['"]|['"]$/g, "");
          push("import", spec, node, node.getText(sourceFile));
        }

        if (ts.isFunctionDeclaration(node) && node.name?.text) {
          push("function", node.name.text, node, node.getText(sourceFile));
        }
        if (ts.isClassDeclaration(node) && node.name?.text) {
          push("class", node.name.text, node, node.getText(sourceFile));
        }
        if (ts.isInterfaceDeclaration(node)) {
          push("interface", node.name.text, node, node.getText(sourceFile));
        }
        if (ts.isEnumDeclaration(node)) {
          push("enum", node.name.text, node, node.getText(sourceFile));
        }
        if (ts.isTypeAliasDeclaration(node)) {
          push("type_alias", node.name.text, node, node.getText(sourceFile));
        }
        if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
          push("method", node.name.text, node, node.getText(sourceFile));
        }
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
          if (
            node.initializer &&
            (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
          ) {
            push("function", node.name.text, node, node.getText(sourceFile));
          }
        }

        ts.forEachChild(node, walk);
      };
      walk(sourceFile);

      return {
        parserMode: "typescript_ast",
        symbols,
        error: null
      };
    } catch (error) {
      return {
        parserMode: "regex_fallback",
        symbols: this.extractWithRegex(source, file),
        error:
          error instanceof Error
            ? `typescript parser failed: ${error.message}`
            : "typescript parser failed"
      };
    }
  }

  private extractWithRegex(source: string, file: string): IndexSymbol[] {
    const lines = source.split("\n");
    const symbols: IndexSymbol[] = [];

    lines.forEach((line, idx) => {
      const exportFn = line.match(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/);
      if (exportFn?.[1]) {
        symbols.push({
          symbol_id: `${file}:${idx + 1}:${exportFn[1]}`,
          file,
          kind: "function",
          name: exportFn[1],
          range: { start: idx + 1, end: idx + 1 },
          signature: line.trim(),
          references: []
        });
      }

      const importMatch = line.match(/import\s+.*from\s+['"]([^'"]+)['"]/);
      if (importMatch?.[1]) {
        symbols.push({
          symbol_id: `${file}:${idx + 1}:import:${importMatch[1]}`,
          file,
          kind: "import",
          name: importMatch[1],
          range: { start: idx + 1, end: idx + 1 },
          signature: line.trim(),
          references: []
        });
      }
    });

    return symbols;
  }
}

export type ContextSelection = {
  files: string[];
  symbols: IndexSymbol[];
  budgetUsed: number;
};

export function evaluateFreshnessTargets(
  diagnostics: Pick<IndexerDiagnostics, "freshnessLatencyMs" | "batchLatencyMs">,
  smallTargetMs = 200,
  batchTargetMs = 2000
): FreshnessTargetReport {
  const observedSmallMs = diagnostics.freshnessLatencyMs;
  const observedBatchMs = diagnostics.batchLatencyMs;
  const smallWithinTarget =
    typeof observedSmallMs === "number" ? observedSmallMs <= smallTargetMs : null;
  const batchWithinTarget =
    typeof observedBatchMs === "number" ? observedBatchMs <= batchTargetMs : null;

  return {
    smallTargetMs,
    batchTargetMs,
    observedSmallMs,
    observedBatchMs,
    smallWithinTarget,
    batchWithinTarget,
    meetsTarget: smallWithinTarget !== false && batchWithinTarget !== false
  };
}

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

function isCodeExt(ext: string): boolean {
  return [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"].includes(ext);
}

function scriptKindForExt(ext: string): ts.ScriptKind {
  return ext === ".tsx" ? ts.ScriptKind.TSX
  : ext === ".ts" || ext === ".mts" || ext === ".cts" ? ts.ScriptKind.TS
  : ext === ".jsx" ? ts.ScriptKind.JSX
  : ts.ScriptKind.JS;
}

function isNamedFunctionLike(node: ts.Node): node is
  ts.FunctionDeclaration |
  ts.MethodDeclaration |
  ts.FunctionExpression |
  ts.ArrowFunction {
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    return true;
  }
  if (ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
    return node.parent !== undefined;
  }
  return false;
}

function functionLikeName(
  node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.FunctionExpression | ts.ArrowFunction
): string {
  if (ts.isFunctionDeclaration(node) && node.name?.text) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if ((ts.isFunctionExpression(node) || ts.isArrowFunction(node)) && node.parent) {
    if (ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
      return node.parent.name.text;
    }
    if (ts.isPropertyAssignment(node.parent) && ts.isIdentifier(node.parent.name)) {
      return node.parent.name.text;
    }
  }
  return "<anonymous>";
}

function callTargetName(expression: ts.LeftHandSideExpression): string {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  if (ts.isElementAccessExpression(expression)) {
    return expression.getText().slice(0, 80);
  }
  return expression.getText().slice(0, 80);
}

function topFrequency(values: string[], limit: number): Array<{ symbol: string; count: number }> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, limit))
    .map(([symbol, count]) => ({ symbol, count }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildContext(symbols: IndexSymbol[], tokenBudget: number): ContextSelection {
  let budget = 0;
  const selected: IndexSymbol[] = [];
  const fileSet = new Set<string>();

  for (const symbol of symbols) {
    const cost = Math.max(8, symbol.name.length + (symbol.signature?.length ?? 0));
    if (budget + cost > tokenBudget) {
      break;
    }
    selected.push(symbol);
    fileSet.add(symbol.file);
    budget += cost;
  }

  return {
    files: [...fileSet],
    symbols: selected,
    budgetUsed: budget
  };
}

function changedLineNumbers(baseContent: string, nextContent: string): number[] {
  const before = normalizeLf(baseContent).split("\n");
  const after = normalizeLf(nextContent).split("\n");
  const max = Math.max(before.length, after.length);
  const changed: number[] = [];
  for (let idx = 0; idx < max; idx += 1) {
    if ((before[idx] ?? "") !== (after[idx] ?? "")) {
      changed.push(idx + 1);
    }
  }
  return changed;
}

export function buildGroundingEvidence(input: {
  editId: string;
  file: string;
  baseContent: string;
  nextContent: string;
  symbols: IndexSymbol[];
  maxEntries?: number;
}): GroundingEvidence[] {
  const file = normalizeRepoPath(input.file);
  const targetSymbols = input.symbols.filter((symbol) => normalizeRepoPath(symbol.file) === file);
  const nextLines = normalizeLf(input.nextContent).split("\n");
  const changed = changedLineNumbers(input.baseContent, input.nextContent);
  const limit = Math.max(1, input.maxEntries ?? 200);

  return changed.slice(0, limit).map((line) => {
    const symbolHit = targetSymbols.find((symbol) => symbol.range.start <= line && symbol.range.end >= line);
    const excerpt = nextLines[line - 1] ?? "";
    return {
      edit_id: input.editId,
      file,
      line,
      evidence_type: symbolHit ? "symbol" : "search",
      excerpt_hash: createHash("sha1").update(`${file}:${line}:${excerpt}`).digest("hex")
    };
  });
}
