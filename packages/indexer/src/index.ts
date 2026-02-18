import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname, relative } from "node:path";
import ts from "typescript";
import type { IndexSymbol } from "@ide/shared";

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
    this.fileDiagnosticsByPath.delete(filePath);
  }

  repoMap(): RepoMapEntry[] {
    return [...this.symbolsByFile.entries()].map(([file, symbols]) => ({
      file,
      symbols: symbols.length,
      imports: symbols.filter((symbol) => symbol.kind === "import").map((symbol) => symbol.name)
    }));
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
