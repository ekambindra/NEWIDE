import { describe, expect, it } from "vitest";
import {
  hasSecrets,
  redactAuditValue,
  redactSecrets,
  scanSecretFindings
} from "./security-utils.js";

describe("security utils", () => {
  it("detects secrets in content", () => {
    const text = [
      "const key = \"safe\";",
      "AWS_KEY=AKIA1234567890ABCDEF",
      "token = \"supersecretvalue123\"",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz.123456"
    ].join("\n");
    const findings = scanSecretFindings(text);
    expect(findings.length).toBeGreaterThan(0);
    expect(hasSecrets(text)).toBe(true);
  });

  it("redacts secret values in strings", () => {
    const raw =
      "password=\"hunter2value\" ghp_abcdefghijklmnopqrstuvwxyz123456 Bearer abcdefghijklmnop";
    const redacted = redactSecrets(raw);
    expect(redacted.includes("hunter2value")).toBe(false);
    expect(redacted.includes("ghp_")).toBe(false);
    expect(redacted.includes("Bearer [REDACTED_TOKEN]")).toBe(true);
  });

  it("redacts audit payload recursively", () => {
    const payload = {
      command: "curl -H 'Authorization: Bearer abcdefghijklmnop' https://example.com",
      api_key: "abc123",
      nested: {
        token: "xyz",
        safe: "hello"
      }
    };
    const redacted = redactAuditValue(payload) as {
      command: string;
      api_key: string;
      nested: { token: string; safe: string };
    };
    expect(redacted.command.includes("Bearer [REDACTED_TOKEN]")).toBe(true);
    expect(redacted.api_key).toBe("[REDACTED]");
    expect(redacted.nested.token).toBe("[REDACTED]");
    expect(redacted.nested.safe).toBe("hello");
  });
});
