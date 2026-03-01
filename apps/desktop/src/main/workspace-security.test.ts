import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveWorkspacePath } from "./workspace-security.js";

async function createSymlink(target: string, path: string, type: "file" | "dir"): Promise<void> {
  if (process.platform === "win32") {
    await symlink(target, path, type === "dir" ? "junction" : "file");
    return;
  }
  await symlink(target, path);
}

describe("workspace path security", () => {
  it("blocks relative traversal segments", async () => {
    const base = await mkdtemp(join(tmpdir(), "atlas-workspace-sec-traversal-"));
    const root = join(base, "root");
    await mkdir(root, { recursive: true });

    await expect(
      resolveWorkspacePath(root, "../outside.txt", { allowMissing: true })
    ).rejects.toThrow(/path traversal denied/i);
  });

  it("blocks absolute paths outside the workspace root", async () => {
    const base = await mkdtemp(join(tmpdir(), "atlas-workspace-sec-abs-"));
    const root = join(base, "root");
    const outside = join(base, "outside.txt");
    await mkdir(root, { recursive: true });
    await writeFile(outside, "outside", "utf8");

    await expect(resolveWorkspacePath(root, outside)).rejects.toThrow(/path traversal denied/i);
  });

  it("blocks file symlink escapes outside workspace root", async () => {
    const base = await mkdtemp(join(tmpdir(), "atlas-workspace-sec-file-"));
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    const outsideFile = join(outside, "secret.txt");
    await writeFile(outsideFile, "secret", "utf8");
    await createSymlink(outsideFile, join(root, "leak.txt"), "file");

    await expect(resolveWorkspacePath(root, "leak.txt")).rejects.toThrow(/symlink escape denied/i);
  });

  it("blocks directory symlink escapes for missing child paths", async () => {
    const base = await mkdtemp(join(tmpdir(), "atlas-workspace-sec-dir-"));
    const root = join(base, "root");
    const outside = join(base, "outside");
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    await createSymlink(outside, join(root, "linked-outside"), "dir");

    await expect(
      resolveWorkspacePath(root, "linked-outside/new-file.txt", { allowMissing: true })
    ).rejects.toThrow(/symlink escape denied/i);
  });

  it("allows normal workspace paths", async () => {
    const base = await mkdtemp(join(tmpdir(), "atlas-workspace-sec-ok-"));
    const root = join(base, "root");
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "index.ts"), "export {};\n", "utf8");

    const readPath = await resolveWorkspacePath(root, "src/index.ts");
    const writePath = await resolveWorkspacePath(root, "src/new-file.ts", { allowMissing: true });
    expect(readPath.endsWith("src/index.ts")).toBe(true);
    expect(writePath.endsWith("src/new-file.ts")).toBe(true);
  });
});
