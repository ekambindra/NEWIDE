import { describe, expect, it } from "vitest";

describe("control-plane smoke", () => {
  it("exposes endpoints contract at source level", async () => {
    const mod = await import("./server.js");
    expect(mod.app).toBeDefined();
  });
});
