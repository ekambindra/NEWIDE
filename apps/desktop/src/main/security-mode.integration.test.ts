import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEnterpriseSettingsManager } from "./enterprise-settings.js";
import { evaluateTerminalPolicy } from "./terminal-policy.js";

describe("security mode integration flow", () => {
  it("propagates strict mode from enterprise settings into terminal policy decisions", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-security-mode-flow-"));
    const manager = createEnterpriseSettingsManager(root);
    await manager.initialize();

    const balancedSettings = await manager.getSettings();
    const balancedDecision = evaluateTerminalPolicy(
      "curl https://example.com",
      balancedSettings.security.mode
    );
    expect(balancedDecision.policy.decision).toBe("require_approval");

    const strictSettings = await manager.updateSecurityMode("strict");
    expect(strictSettings.security.mode).toBe("strict");

    const strictDecision = evaluateTerminalPolicy(
      "curl https://example.com",
      strictSettings.security.mode
    );
    expect(strictDecision.policy.decision).toBe("deny");
    expect(strictDecision.policy.reason).toMatch(/strict security mode/i);
  });
});
