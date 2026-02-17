import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { relative } from "node:path";
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

  async indexFile(workspaceRoot: string, filePath: string): Promise<IndexSymbol[]> {
    const source = await readFile(filePath, "utf8");
    const hash = createHash("sha1").update(source).digest("hex");
    if (this.fileHashes.get(filePath) === hash) {
      return this.symbolsByFile.get(filePath) ?? [];
    }

    const symbols = this.extractWithTreeSitterPipeline(source, relative(workspaceRoot, filePath));
    this.fileHashes.set(filePath, hash);
    this.symbolsByFile.set(filePath, symbols);
    return symbols;
  }

  getFileSymbols(filePath: string): IndexSymbol[] {
    return this.symbolsByFile.get(filePath) ?? [];
  }

  invalidate(filePath: string): void {
    this.fileHashes.delete(filePath);
    this.symbolsByFile.delete(filePath);
  }

  repoMap(): RepoMapEntry[] {
    return [...this.symbolsByFile.entries()].map(([file, symbols]) => ({
      file,
      symbols: symbols.length,
      imports: symbols.filter((s) => s.kind === "import").map((s) => s.name)
    }));
  }

  private extractWithTreeSitterPipeline(source: string, file: string): IndexSymbol[] {
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

      const importMatch = line.match(/import\s+.*from\s+['\"]([^'\"]+)['\"]/);
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
