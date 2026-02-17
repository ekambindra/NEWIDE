import { describe, expect, it } from "vitest";
import { defaultBalancedPolicy } from "@ide/shared";
import { evaluateCommand, evaluateEditSummary, evaluateNetwork } from "./index.js";

describe("policy engine", () => {
  it("blocks explicitly denied command", () => {
    const decision = evaluateCommand(defaultBalancedPolicy, "rm -rf foo");
    expect(decision.decision).toBe("deny");
  });

  it("gates unknown network domain", () => {
    const decision = evaluateNetwork(defaultBalancedPolicy, "example.com");
    expect(decision.decision).toBe("require_approval");
  });

  it("gates dependency edits", () => {
    const decision = evaluateEditSummary(defaultBalancedPolicy, {
      path: "package.json",
      additions: 10,
      deletions: 2,
      touchesDependencies: true
    });
    expect(decision.decision).toBe("require_approval");
  });
});
