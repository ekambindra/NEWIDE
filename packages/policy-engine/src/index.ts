import { minimatch } from "minimatch";
import type { PolicyConfig } from "@ide/shared";

export type PolicyDecision = {
  decision: "allow" | "deny" | "require_approval";
  reason: string;
};

export type EditSummary = {
  path: string;
  additions: number;
  deletions: number;
  touchesDependencies: boolean;
};

export function evaluateCommand(policy: PolicyConfig, command: string): PolicyDecision {
  for (const rule of policy.command_rules) {
    if (minimatch(command, rule.pattern, { nocase: true })) {
      if (rule.allowed) {
        return { decision: "allow", reason: rule.reason ?? "matched allow rule" };
      }
      return { decision: "deny", reason: rule.reason ?? "matched deny rule" };
    }
  }
  return { decision: "require_approval", reason: "no explicit command rule" };
}

export function evaluatePath(policy: PolicyConfig, path: string): PolicyDecision {
  for (const rule of policy.path_rules) {
    if (minimatch(path, rule.glob, { dot: true })) {
      if (!rule.writable) {
        return {
          decision: rule.requires_approval ? "require_approval" : "deny",
          reason: "path is protected"
        };
      }
      if (rule.requires_approval) {
        return { decision: "require_approval", reason: "path requires approval" };
      }
      return { decision: "allow", reason: "path allowed" };
    }
  }
  return { decision: "require_approval", reason: "no path rule" };
}

export function evaluateNetwork(policy: PolicyConfig, domain: string): PolicyDecision {
  if (policy.network_rules.default_allow) {
    return { decision: "allow", reason: "network allow by default" };
  }
  if (policy.network_rules.allow_domains.includes(domain)) {
    return { decision: "allow", reason: "domain allowlist" };
  }
  return { decision: "require_approval", reason: "network domain not allowlisted" };
}

export function evaluateEditSummary(policy: PolicyConfig, edit: EditSummary): PolicyDecision {
  if (edit.additions > policy.overwrite_limit || edit.deletions > policy.delete_limit) {
    return { decision: "require_approval", reason: "edit exceeds line limits" };
  }

  if (edit.touchesDependencies && policy.dep_change_gate) {
    return { decision: "require_approval", reason: "dependency change gate" };
  }

  const pathDecision = evaluatePath(policy, edit.path);
  if (pathDecision.decision !== "allow") {
    return pathDecision;
  }

  return { decision: "allow", reason: "edit within limits" };
}

export function listSensitiveTouches(policy: PolicyConfig, paths: string[]): string[] {
  return paths.filter((path) =>
    policy.sensitive_paths.some((glob) => minimatch(path, glob, { dot: true }))
  );
}
