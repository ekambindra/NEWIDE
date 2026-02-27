import {
  detectCommandRisk,
  validateCommandInput,
  type CommandRiskAssessment
} from "./terminal-utils.js";

export type PolicyResult = {
  decision: "allow" | "deny" | "require_approval";
  reason: string;
};

export type SecurityMode = "balanced" | "strict";

function commandPolicy(command: string): PolicyResult {
  if (/rm\s+-rf/i.test(command) || /:\(\)\s*\{/i.test(command) || /\bmkfs\b/i.test(command)) {
    return { decision: "deny", reason: "destructive command blocked" };
  }
  if (/curl|wget|npm\s+install|pnpm\s+add|yarn\s+add/i.test(command)) {
    return {
      decision: "require_approval",
      reason: "network or dependency action requires approval"
    };
  }
  return { decision: "allow", reason: "allowed by balanced policy" };
}

export function evaluateTerminalPolicy(
  command: string,
  securityMode: SecurityMode = "balanced"
): {
  policy: PolicyResult;
  highRisk: CommandRiskAssessment;
} {
  const validation = validateCommandInput(command);
  if (!validation.valid) {
    const reason = validation.reason ?? "invalid command";
    return {
      policy: {
        decision: "deny",
        reason
      },
      highRisk: {
        requiresApproval: false,
        categories: ["invalid_input"],
        reasons: [reason],
        prompt: null
      }
    };
  }

  const highRisk = detectCommandRisk(command);
  let policy = commandPolicy(command);

  if (
    securityMode === "strict" &&
    (highRisk.categories.includes("network") || highRisk.categories.includes("dependency"))
  ) {
    policy = {
      decision: "deny",
      reason: "strict security mode blocks network/dependency commands"
    };
  } else if (policy.decision === "allow" && highRisk.requiresApproval) {
    policy = {
      decision: "require_approval",
      reason: highRisk.prompt ?? "high-risk command requires approval"
    };
  }

  return { policy, highRisk };
}
