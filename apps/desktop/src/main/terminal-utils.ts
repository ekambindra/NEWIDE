export type ParsedTestSummary = {
  framework: "vitest" | "jest" | "pytest" | "junit" | "unknown";
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number | null;
  rawSignal: string;
};

export type CommandRiskAssessment = {
  requiresApproval: boolean;
  categories: string[];
  reasons: string[];
  prompt: string | null;
};

function parseNumericSignals(output: string): {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
} {
  const scan = (label: string): number => {
    const regex = new RegExp(`(\\d+)\\s+${label}`, "ig");
    const matches = [...output.matchAll(regex)];
    if (matches.length === 0) {
      return 0;
    }
    return Number(matches[matches.length - 1]?.[1] ?? 0);
  };

  const passed = scan("passed");
  const failed = scan("failed");
  const skipped = scan("skipped");
  const totalFromLabel = scan("total");
  const total = totalFromLabel > 0 ? totalFromLabel : passed + failed + skipped;
  return { passed, failed, skipped, total };
}

function parseDurationMs(output: string): number | null {
  const msMatch = [...output.matchAll(/(?:Duration|duration)[^\n]*?(\d+(?:\.\d+)?)\s*ms/gi)].at(-1);
  if (msMatch?.[1]) {
    return Math.round(Number(msMatch[1]));
  }
  const secMatch = [...output.matchAll(/\bin\s+(\d+(?:\.\d+)?)s\b/gi)].at(-1);
  if (secMatch?.[1]) {
    return Math.round(Number(secMatch[1]) * 1000);
  }
  return null;
}

function parseJUnit(output: string): ParsedTestSummary | null {
  const match = output.match(
    /<testsuite[^>]*\btests="(\d+)"[^>]*\bfailures="(\d+)"[^>]*\berrors="(\d+)"[^>]*\bskipped="(\d+)"[^>]*\btime="([\d.]+)"/i
  );
  if (!match) {
    return null;
  }
  const total = Number(match[1] ?? 0);
  const failures = Number(match[2] ?? 0);
  const errors = Number(match[3] ?? 0);
  const skipped = Number(match[4] ?? 0);
  const failed = failures + errors;
  const passed = Math.max(0, total - failed - skipped);
  const durationMs = Math.round(Number(match[5] ?? 0) * 1000);
  return {
    framework: "junit",
    total,
    passed,
    failed,
    skipped,
    durationMs,
    rawSignal: "xml-testsuite"
  };
}

function likelyTestCommand(command: string): boolean {
  return /\b(test|vitest|jest|pytest|junit)\b/i.test(command);
}

export function parseTestOutput(
  command: string,
  stdout: string,
  stderr: string
): ParsedTestSummary | null {
  const output = `${stdout}\n${stderr}`.trim();
  if (!output && !likelyTestCommand(command)) {
    return null;
  }

  const junit = parseJUnit(output);
  if (junit) {
    return junit;
  }

  const framework =
    /\bvitest\b/i.test(output) || /\bvitest\b/i.test(command) ? "vitest"
    : /\bjest\b/i.test(output) || /\bjest\b/i.test(command) ? "jest"
    : /\bpytest\b/i.test(output) || /\bpytest\b/i.test(command) ? "pytest"
    : likelyTestCommand(command) ? "unknown"
    : "unknown";

  const numeric = parseNumericSignals(output);
  if (
    framework === "unknown" &&
    numeric.total === 0 &&
    numeric.passed === 0 &&
    numeric.failed === 0 &&
    numeric.skipped === 0
  ) {
    return null;
  }

  return {
    framework,
    total: numeric.total,
    passed: numeric.passed,
    failed: numeric.failed,
    skipped: numeric.skipped,
    durationMs: parseDurationMs(output),
    rawSignal: framework
  };
}

export function detectCommandRisk(command: string): CommandRiskAssessment {
  const categories = new Set<string>();
  const reasons: string[] = [];
  const trimmed = command.trim();

  if (/\b(curl|wget|invoke-webrequest)\b/i.test(trimmed)) {
    categories.add("network");
    reasons.push("network download command detected");
  }
  if (/\b(npm|pnpm|yarn)\s+(install|add|update|upgrade|up)\b/i.test(trimmed)) {
    categories.add("dependency");
    reasons.push("dependency graph mutation detected");
  }
  if (/\b(rm\s+-rf|del\s+\/s|format)\b/i.test(trimmed)) {
    categories.add("destructive");
    reasons.push("destructive filesystem command detected");
  }
  if (/\b(sudo|chmod|chown)\b/i.test(trimmed)) {
    categories.add("privileged");
    reasons.push("privileged command detected");
  }
  if (/\b(terraform|kubectl|helm|aws|gcloud|az)\b/i.test(trimmed)) {
    categories.add("infra");
    reasons.push("infrastructure command detected");
  }

  const list = [...categories];
  return {
    requiresApproval: list.length > 0,
    categories: list,
    reasons,
    prompt:
      list.length > 0
        ? `Approval required for high-risk command (${list.join(", ")}): ${trimmed}`
        : null
  };
}
