import { describe, expect, it } from "vitest";
import { defaultLayout } from "./layout";

describe("layout defaults", () => {
  it("has stable starter layout", () => {
    expect(defaultLayout.leftWidth).toBeGreaterThan(200);
    expect(defaultLayout.bottomHeight).toBeGreaterThan(100);
  });
});
