import { existsSync, promises as fs } from "node:fs";
import { dirname, relative, resolve } from "node:path";

function isWithin(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !resolve(root, rel).startsWith(".."));
}

async function nearestExistingPath(path: string): Promise<string | null> {
  let current = path;
  while (true) {
    if (existsSync(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export async function resolveWorkspacePath(
  root: string,
  relPath: string,
  options?: { allowMissing?: boolean }
): Promise<string> {
  if (!relPath || relPath.includes("\0")) {
    throw new Error("path traversal denied");
  }

  const rootReal = await fs.realpath(root);
  const target = resolve(rootReal, relPath);
  if (!isWithin(rootReal, target)) {
    throw new Error("path traversal denied");
  }

  const allowMissing = options?.allowMissing === true;
  if (existsSync(target)) {
    const targetReal = await fs.realpath(target);
    if (!isWithin(rootReal, targetReal)) {
      throw new Error("symlink escape denied");
    }
    return target;
  }

  if (!allowMissing) {
    throw new Error("path not found");
  }

  const nearestExisting = await nearestExistingPath(dirname(target));
  if (!nearestExisting) {
    throw new Error("path traversal denied");
  }
  const nearestExistingReal = await fs.realpath(nearestExisting);
  if (!isWithin(rootReal, nearestExistingReal)) {
    throw new Error("symlink escape denied");
  }

  return target;
}
