import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runMultiFileRefactor } from "./refactor-mode.js";

describe("multi-file refactor mode", () => {
  it("generates preview results without writing files", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-refactor-preview-"));
    const checkpoints = join(root, ".checkpoints");
    await writeFile(join(root, "a.ts"), "export function alpha(){ return alpha(); }\n", "utf8");

    const result = await runMultiFileRefactor({
      root,
      from: "alpha",
      to: "alphaRenamed",
      impacts: [
        {
          file: "a.ts",
          totalMatches: 2,
          declarationMatches: 1,
          referenceMatches: 1,
          collisionMatches: 0,
          lines: [1]
        }
      ],
      previewOnly: true,
      allowSensitive: false,
      checkpointRoot: checkpoints,
      relatedEdges: [{ file: "a.ts", from: "alpha", to: "alpha", line: 1 }]
    });

    expect(result.status).toBe("preview");
    expect(result.filesTouched).toBe(1);
    expect(result.totalMatches).toBe(2);
    expect(result.grounding.edgeCount).toBe(1);

    const source = await readFile(join(root, "a.ts"), "utf8");
    expect(source.includes("alphaRenamed")).toBe(false);
  });

  it("applies refactor and blocks sensitive paths without override", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-refactor-apply-"));
    const checkpoints = join(root, ".checkpoints");
    await writeFile(join(root, "feature.ts"), "export const token = token + 1;\n", "utf8");
    await mkdir(join(root, "infra"), { recursive: true });
    await writeFile(join(root, "infra/main.ts"), "export const token = 1;\n", "utf8");

    const blocked = await runMultiFileRefactor({
      root,
      from: "token",
      to: "tokenV2",
      impacts: [
        {
          file: "feature.ts",
          totalMatches: 2,
          declarationMatches: 1,
          referenceMatches: 1,
          collisionMatches: 0,
          lines: [1]
        },
        {
          file: "infra/main.ts",
          totalMatches: 1,
          declarationMatches: 1,
          referenceMatches: 0,
          collisionMatches: 0,
          lines: [1]
        }
      ],
      previewOnly: false,
      allowSensitive: false,
      checkpointRoot: checkpoints,
      relatedEdges: []
    });

    expect(blocked.status).toBe("blocked");
    expect(blocked.blockedSensitive).toContain("infra/main.ts");

    const applied = await runMultiFileRefactor({
      root,
      from: "token",
      to: "tokenV2",
      impacts: [
        {
          file: "feature.ts",
          totalMatches: 2,
          declarationMatches: 1,
          referenceMatches: 1,
          collisionMatches: 0,
          lines: [1]
        }
      ],
      previewOnly: false,
      allowSensitive: false,
      checkpointRoot: checkpoints,
      relatedEdges: []
    });

    expect(applied.status).toBe("applied");
    const feature = await readFile(join(root, "feature.ts"), "utf8");
    expect(feature.includes("tokenV2")).toBe(true);
  });
});
