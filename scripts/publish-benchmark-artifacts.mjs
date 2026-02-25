#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token || !token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : "true";
    flags[key] = value;

    if (value !== "true") {
      index += 1;
    }
  }
  return flags;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env
  });

  if (result.status !== 0) {
    throw new Error(`command failed: ${command} ${args.join(" ")}`);
  }
}

function formatNumber(value, digits = 2) {
  return Number(value.toFixed(digits)).toString();
}

function formatPercent(value, digits = 2) {
  return `${formatNumber(value * 100, digits)}%`;
}

function formatUnit(value, unit) {
  if (unit === "ratio") {
    return formatPercent(value);
  }

  if (unit === "milliseconds") {
    return `${formatNumber(value)}ms`;
  }

  if (unit === "seconds") {
    return `${formatNumber(value)}s`;
  }

  return formatNumber(value);
}

function threshold(kpi) {
  const operator = kpi.comparator === "lte" ? "<=" : ">=";
  return `${operator} ${formatUnit(kpi.target, kpi.unit)}`;
}

function replaceMarkedSection(content, startMarker, endMarker, replacement) {
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`failed to find marker section: ${startMarker} ... ${endMarker}`);
  }

  const prefix = content.slice(0, start + startMarker.length);
  const suffix = content.slice(end);
  return `${prefix}\n${replacement}\n${suffix}`;
}

function requireKpi(report, name) {
  const match = report.scoreCard.kpis.find((kpi) => kpi.name === name);
  if (!match) {
    throw new Error(`missing KPI in report: ${name}`);
  }
  return match;
}

function utcTimestampCompact() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function main() {
  const rootDir = process.cwd();
  const flags = parseFlags(process.argv.slice(2));

  const seed = Number(flags.seed ?? "1337");
  if (!Number.isFinite(seed)) {
    throw new Error("seed must be a finite number");
  }

  const runIdPrefix = flags["run-id-prefix"] ?? "ga";
  const runId = flags["run-id"] ?? `${runIdPrefix}-${utcTimestampCompact()}-seed${seed}`;

  const tempDir = join(rootDir, ".tmp-benchmark-publish", runId);
  const docsArtifactsRoot = join(rootDir, "public-docs", "benchmark-artifacts");
  const docsRunDir = join(docsArtifactsRoot, runId);
  const reportPath = join(tempDir, "latest-report.json");
  const resultsPath = join(tempDir, "latest-results.json");
  const corpusPath = join(tempDir, "default-corpus.json");
  const historyPath = join(tempDir, "metrics-history.jsonl");
  const fixturesHistoryPath = join(rootDir, "packages", "benchmark", "fixtures", "metrics-history.jsonl");
  const benchmarkCliPath = join(rootDir, "packages", "benchmark", "dist", "cli.js");

  if (!existsSync(benchmarkCliPath)) {
    throw new Error("missing benchmark CLI build output. Run: npm run build --workspace @ide/benchmark");
  }

  await mkdir(tempDir, { recursive: true });
  await mkdir(docsRunDir, { recursive: true });

  if (existsSync(fixturesHistoryPath)) {
    await copyFile(fixturesHistoryPath, historyPath);
  } else {
    await writeFile(historyPath, "", "utf8");
  }

  run("node", [benchmarkCliPath, "corpus", "--out", corpusPath], rootDir);
  run("node", [benchmarkCliPath, "simulate", "--seed", String(seed), "--out", resultsPath], rootDir);
  run(
    "node",
    [
      benchmarkCliPath,
      "score",
      resultsPath,
      "--history",
      historyPath,
      "--run-id",
      runId,
      "--out",
      reportPath
    ],
    rootDir
  );
  run("node", [benchmarkCliPath, "gate", reportPath], rootDir);

  await Promise.all([
    copyFile(reportPath, join(docsRunDir, "latest-report.json")),
    copyFile(resultsPath, join(docsRunDir, "latest-results.json")),
    copyFile(corpusPath, join(docsRunDir, "default-corpus.json")),
    copyFile(historyPath, join(docsRunDir, "metrics-history.jsonl")),
    writeFile(join(docsArtifactsRoot, "latest-run.txt"), `${runId}\n`, "utf8")
  ]);

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const latestSection = [
    "      <section class=\"card\">",
    "        <h2>Latest Published Run</h2>",
    `        <p>Run ID: <code>${runId}</code></p>`,
    `        <p>Generated at: <code>${report.generatedAt}</code></p>`,
    `        <p>Gate status: <strong>${report.gate.pass ? "PASS" : "FAIL"}</strong></p>`,
    "        <ul>",
    `          <li><a href="./benchmark-artifacts/${runId}/latest-report.json">latest-report.json</a></li>`,
    `          <li><a href="./benchmark-artifacts/${runId}/latest-results.json">latest-results.json</a></li>`,
    `          <li><a href="./benchmark-artifacts/${runId}/metrics-history.jsonl">metrics-history.jsonl</a></li>`,
    `          <li><a href="./benchmark-artifacts/${runId}/default-corpus.json">default-corpus.json</a></li>`,
    "        </ul>",
    "      </section>"
  ].join("\n");

  const repoToProd = requireKpi(report, "repo_to_production_readiness_time");
  const greenPipeline = requireKpi(report, "green_pipeline_guarantee_rate");
  const replay = requireKpi(report, "replay_determinism_rate");
  const grounded = requireKpi(report, "grounded_edit_ratio");
  const indexSmall = requireKpi(report, "index_freshness_small_ms");
  const indexBatch = requireKpi(report, "index_freshness_batch_ms");
  const inlineLatency = requireKpi(report, "inline_suggestion_latency_p95");
  const humanIntervention = requireKpi(report, "human_intervention_rate");

  const kpiSection = [
    "      <section class=\"card\">",
    "        <h2>KPI Snapshot</h2>",
    "        <ul>",
    `          <li>Repo-to-production readiness: ${formatUnit(repoToProd.value, repoToProd.unit)} (target ${threshold(repoToProd)})</li>`,
    `          <li>Green pipeline guarantee: ${formatUnit(greenPipeline.value, greenPipeline.unit)} (target ${threshold(greenPipeline)})</li>`,
    `          <li>Replay determinism: ${formatUnit(replay.value, replay.unit)} (target ${threshold(replay)})</li>`,
    `          <li>Grounded edit ratio: ${formatUnit(grounded.value, grounded.unit)} (target ${threshold(grounded)})</li>`,
    `          <li>Index freshness: ${formatUnit(indexSmall.value, indexSmall.unit)} small / ${formatUnit(indexBatch.value, indexBatch.unit)} batch (targets ${threshold(indexSmall)} / ${threshold(indexBatch)})</li>`,
    `          <li>Inline suggestion latency P95: ${formatUnit(inlineLatency.value, inlineLatency.unit)} (target ${threshold(inlineLatency)})</li>`,
    `          <li>Human intervention rate: ${formatUnit(humanIntervention.value, humanIntervention.unit)} (target ${threshold(humanIntervention)})</li>`,
    "        </ul>",
    "      </section>"
  ].join("\n");

  const benchmarksHtmlPath = join(rootDir, "public-docs", "benchmarks.html");
  const currentBenchmarksHtml = await readFile(benchmarksHtmlPath, "utf8");
  const withLatest = replaceMarkedSection(
    currentBenchmarksHtml,
    "<!-- LATEST_RUN_START -->",
    "<!-- LATEST_RUN_END -->",
    latestSection
  );
  const updatedBenchmarksHtml = replaceMarkedSection(
    withLatest,
    "<!-- KPI_SNAPSHOT_START -->",
    "<!-- KPI_SNAPSHOT_END -->",
    kpiSection
  );
  await writeFile(benchmarksHtmlPath, updatedBenchmarksHtml, "utf8");

  process.stdout.write(`published benchmark artifacts for ${runId}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
