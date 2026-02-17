#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { score, type BenchmarkResult } from "./index.js";

async function main(): Promise<void> {
  const inputFile = process.argv[2];
  if (!inputFile) {
    throw new Error("usage: ide-benchmark <results.json>");
  }

  const raw = await readFile(inputFile, "utf8");
  const results = JSON.parse(raw) as BenchmarkResult[];
  const scored = score(results);
  process.stdout.write(`${JSON.stringify(scored, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
