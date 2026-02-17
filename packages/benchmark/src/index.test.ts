import { describe, expect, it } from "vitest";
import { score } from "./index.js";

describe("benchmark", () => {
  it("scores benchmark results", () => {
    const card = score([
      {
        task: {
          task_id: "t1",
          category: "greenfield",
          input: "x",
          expected_outcome: "y",
          timeout_sec: 120,
          scorer: "default"
        },
        passed: true,
        durationSec: 10,
        retries: 0,
        toolCalls: 4,
        diffChurn: 20
      }
    ]);

    expect(card.passRate).toBe(1);
    expect(card.total).toBe(1);
    expect(card.metrics.length).toBeGreaterThan(0);
  });
});
