#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import {
  appendMetricsStore,
  buildTrendAlerts,
  evaluateRegressionGate,
  loadDefaultTaskCorpus,
  readMetricsStore,
  score,
  simulateResults,
  type BenchmarkResult,
  type ScoreCard
} from "./index.js";

type BenchmarkReport = {
  generatedAt: string;
  scoreCard: ScoreCard;
  gate: {
    pass: boolean;
    failing: Array<{
      name: string;
      value: number;
      target: number;
      comparator: "gte" | "lte";
      unit: string;
    }>;
  };
  alerts: ReturnType<typeof buildTrendAlerts>;
};

function usage(): string {
  return [
    "usage:",
    "  ide-benchmark corpus [--out file]",
    "  ide-benchmark simulate [--seed number] [--out file]",
    "  ide-benchmark score <results.json> [--out file] [--history metrics.jsonl] [--run-id id]",
    "  ide-benchmark gate <report.json>",
    "  ide-benchmark trends <metrics.jsonl>"
  ].join("\n");
}

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const nextToken = args[index + 1];
    const value = nextToken && !nextToken.startsWith("--") ? nextToken : "true";
    flags[key] = value;
    if (value !== "true") {
      index += 1;
    }
  }
  return flags;
}

async function writeJsonIfRequested(path: string | undefined, payload: unknown): Promise<void> {
  if (!path) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function loadJson<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

function buildReport(scoreCard: ScoreCard, alerts: ReturnType<typeof buildTrendAlerts>): BenchmarkReport {
  const gate = evaluateRegressionGate(scoreCard);
  return {
    generatedAt: new Date().toISOString(),
    scoreCard,
    gate: {
      pass: gate.pass,
      failing: gate.failing.map((entry) => ({
        name: entry.name,
        value: entry.value,
        target: entry.target,
        comparator: entry.comparator,
        unit: entry.unit
      }))
    },
    alerts
  };
}

async function cmdCorpus(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const corpus = loadDefaultTaskCorpus();
  await writeJsonIfRequested(flags.out, corpus);
}

async function cmdSimulate(args: string[]): Promise<void> {
  const flags = parseFlags(args);
  const seed = Number(flags.seed ?? 1337);
  const corpus = loadDefaultTaskCorpus();
  const results = simulateResults(corpus, Number.isFinite(seed) ? seed : 1337);
  await writeJsonIfRequested(flags.out, results);
}

async function cmdScore(args: string[]): Promise<void> {
  const inputPath = args[0];
  if (!inputPath || inputPath.startsWith("--")) {
    throw new Error("score command requires <results.json>");
  }

  const flags = parseFlags(args.slice(1));
  const runId = flags["run-id"] ?? "benchmark-cli";

  const results = await loadJson<BenchmarkResult[]>(inputPath);
  const scoreCard = score(results, { runId });

  if (flags.history) {
    await appendMetricsStore(flags.history, scoreCard.metrics);
  }

  const history = flags.history ? await readMetricsStore(flags.history) : scoreCard.metrics;
  const alerts = buildTrendAlerts(history);
  const report = buildReport(scoreCard, alerts);

  await writeJsonIfRequested(flags.out, report);
}

async function cmdGate(args: string[]): Promise<void> {
  const inputPath = args[0];
  if (!inputPath) {
    throw new Error("gate command requires <report.json>");
  }
  const report = await loadJson<BenchmarkReport>(inputPath);
  if (report.gate.pass) {
    process.stdout.write("benchmark gate: PASS\n");
    return;
  }

  process.stderr.write("benchmark gate: FAIL\n");
  for (const failure of report.gate.failing) {
    process.stderr.write(
      `- ${failure.name} expected ${failure.comparator} ${failure.target} got ${failure.value} (${failure.unit})\n`
    );
  }
  process.exit(1);
}

async function cmdTrends(args: string[]): Promise<void> {
  const inputPath = args[0];
  if (!inputPath) {
    throw new Error("trends command requires <metrics.jsonl>");
  }
  const records = await readMetricsStore(inputPath);
  const alerts = buildTrendAlerts(records);
  await writeJsonIfRequested(undefined, alerts);
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (command === "corpus") {
    await cmdCorpus(args);
    return;
  }

  if (command === "simulate") {
    await cmdSimulate(args);
    return;
  }

  if (command === "score") {
    await cmdScore(args);
    return;
  }

  if (command === "gate") {
    await cmdGate(args);
    return;
  }

  if (command === "trends") {
    await cmdTrends(args);
    return;
  }

  throw new Error(`unknown command: ${command}\n${usage()}`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
