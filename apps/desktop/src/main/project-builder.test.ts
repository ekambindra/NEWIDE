import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildProjectTemplate } from "./project-builder.js";

describe("project builder", () => {
  it("generates node microservices + postgres template with required artifacts", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "atlas-builder-"));
    const checkpointRoot = join(workspaceRoot, ".atlas-checkpoints");

    const result = await buildProjectTemplate({
      request: {
        workspaceRoot,
        projectName: "Atlas Meridian Sample"
      },
      checkpointRoot
    });

    expect(result.template).toBe("node_microservices_postgres");
    expect(result.generatedFiles.length).toBeGreaterThan(10);
    expect(result.services.api).toBe(true);
    expect(result.services.worker).toBe(true);
    expect(result.services.postgres).toBe(true);
    expect(result.completeness.completenessPercent).toBe(100);
    expect(result.completeness.missing).toHaveLength(0);

    const projectPackagePath = join(result.projectRoot, "package.json");
    const projectPackage = await readFile(projectPackagePath, "utf8");
    expect(projectPackage.includes("\"workspaces\"")).toBe(true);

    const apiSource = await readFile(join(result.projectRoot, "services/api/src/server.ts"), "utf8");
    expect(apiSource.includes("createServer")).toBe(true);

    const workerSource = await readFile(join(result.projectRoot, "services/worker/src/worker.ts"), "utf8");
    expect(workerSource.includes("setInterval")).toBe(true);

    const sql = await readFile(join(result.projectRoot, "db/init/001_init.sql"), "utf8");
    expect(sql.includes("CREATE TABLE IF NOT EXISTS jobs")).toBe(true);

    const stepDir = join(result.checkpointPath, "step-1");
    const stepFiles = await readdir(stepDir);
    expect(stepFiles).toContain("plan.json");
    expect(stepFiles).toContain("patch.diff");
    expect(stepFiles).toContain("tool_calls.jsonl");
    expect(stepFiles).toContain("results.json");
  });

  it("blocks generation into a non-empty target directory", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "atlas-builder-non-empty-"));
    const target = join(workspaceRoot, "generated-projects", "existing");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "already.txt"), "existing", "utf8");

    await expect(
      buildProjectTemplate({
        request: {
          workspaceRoot,
          projectName: "Existing",
          outputDir: "generated-projects/existing"
        },
        checkpointRoot: join(workspaceRoot, ".atlas-checkpoints")
      })
    ).rejects.toThrow(/not empty/i);
  });
});
