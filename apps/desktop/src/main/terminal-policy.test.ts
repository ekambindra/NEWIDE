import { describe, expect, it } from "vitest";
import { evaluateTerminalPolicy } from "./terminal-policy.js";

describe("terminal policy", () => {
  it("requires approval for network/dependency commands in balanced mode", () => {
    const result = evaluateTerminalPolicy("npm install lodash", "balanced");
    expect(result.policy.decision).toBe("require_approval");
  });

  it("denies network/dependency commands in strict mode", () => {
    const result = evaluateTerminalPolicy("curl https://example.com", "strict");
    expect(result.policy.decision).toBe("deny");
    expect(result.policy.reason).toMatch(/strict security mode/i);
  });

  it("denies multiline command payloads", () => {
    const result = evaluateTerminalPolicy("npm run lint\nrm -rf /", "balanced");
    expect(result.policy.decision).toBe("deny");
    expect(result.policy.reason).toMatch(/multiline/i);
  });
});
