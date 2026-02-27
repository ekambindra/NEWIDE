import { describe, expect, it } from "vitest";
import { isAllowedRendererNavigation } from "./navigation-security.js";

describe("navigation security", () => {
  it("allows renderer navigation only to local app/dev origins", () => {
    expect(isAllowedRendererNavigation("file:///tmp/index.html")).toBe(true);
    expect(isAllowedRendererNavigation("about:blank")).toBe(true);
    expect(isAllowedRendererNavigation("https://example.com")).toBe(false);
    expect(isAllowedRendererNavigation("http://127.0.0.1:5173/path", "http://127.0.0.1:5173")).toBe(true);
    expect(isAllowedRendererNavigation("http://localhost:5173/path", "http://127.0.0.1:5173")).toBe(false);
  });
});
