import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SymbolIndexer, buildContext } from "./index.js";

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

    const context = buildContext(first, 1000);
    expect(context.files.length).toBe(1);
  });
});
