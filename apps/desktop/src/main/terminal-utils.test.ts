import { describe, expect, it } from "vitest";
import { detectCommandRisk, parseTestOutput } from "./terminal-utils.js";

describe("terminal utils", () => {
  it("parses vitest output", () => {
    const summary = parseTestOutput(
      "npm run test",
      `
 RUN  v2.1.9 /repo
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  450ms
`,
      ""
    );

    expect(summary).not.toBeNull();
    expect(summary?.framework).toBe("unknown");
    expect(summary?.passed).toBe(3);
    expect(summary?.failed).toBe(0);
    expect(summary?.durationMs).toBe(450);
  });

  it("parses pytest output", () => {
    const summary = parseTestOutput(
      "pytest",
      "================ 12 passed, 1 failed, 2 skipped in 4.21s ================",
      ""
    );
    expect(summary?.framework).toBe("pytest");
    expect(summary?.total).toBe(15);
    expect(summary?.failed).toBe(1);
    expect(summary?.durationMs).toBe(4210);
  });

  it("detects risky command categories", () => {
    const risk = detectCommandRisk("npm install lodash && curl https://example.com");
    expect(risk.requiresApproval).toBe(true);
    expect(risk.categories).toContain("dependency");
    expect(risk.categories).toContain("network");
    expect(risk.prompt).toContain("Approval required");
  });
});
