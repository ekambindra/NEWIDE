import { describe, expect, it } from "vitest";
import { StepPlanSchema, defaultBalancedPolicy } from "./index.js";

describe("shared schemas", () => {
  it("validates step plan", () => {
    const plan = StepPlanSchema.parse({
      run_id: "run-1",
      step_id: "step-1",
      goal: "Generate baseline",
      acceptance_criteria: ["lint passes"],
      risks: ["none"],
      policy_context: {},
      deterministic_seed: "seed"
    });
    expect(plan.goal).toBe("Generate baseline");
  });

  it("exports balanced policy", () => {
    expect(defaultBalancedPolicy.overwrite_limit).toBe(500);
  });
});
