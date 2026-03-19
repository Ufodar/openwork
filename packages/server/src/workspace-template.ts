import { copyFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { ensureDir, exists } from "./utils.js";

const ROOT_TEMPLATE_FILES = ["opencode.json", "opencode.jsonc"];
const OPENCODE_SKIP_DIRS = new Set(["openwork", "node_modules"]);
const OPENCODE_SKIP_FILES = new Set(["bun.lock", "bun.lockb"]);

async function copyFileIfMissing(sourcePath: string, targetPath: string) {
  if (await exists(targetPath)) return;
  await ensureDir(dirname(targetPath));
  await copyFile(sourcePath, targetPath);
}

async function copyDirectoryRecursive(sourceDir: string, targetDir: string) {
  await ensureDir(targetDir);
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);
    if (entry.isDirectory()) {
      if (OPENCODE_SKIP_DIRS.has(entry.name)) continue;
      await copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (OPENCODE_SKIP_FILES.has(entry.name)) continue;
    await copyFileIfMissing(sourcePath, targetPath);
  }
}

export async function workspaceTemplateLooksUsable(root: string): Promise<boolean> {
  const normalized = root.trim();
  if (!normalized) return false;
  return (
    await exists(join(normalized, ".opencode")) ||
    await exists(join(normalized, "opencode.json")) ||
    await exists(join(normalized, "opencode.jsonc"))
  );
}

export async function workspaceTemplateHasOpencodeDir(root: string): Promise<boolean> {
  const normalized = root.trim();
  if (!normalized) return false;
  return await exists(join(normalized, ".opencode"));
}

export async function copyWorkspaceConfigTemplate(sourceRoot: string, targetRoot: string): Promise<void> {
  await ensureDir(targetRoot);

  for (const filename of ROOT_TEMPLATE_FILES) {
    const sourcePath = join(sourceRoot, filename);
    if (!(await exists(sourcePath))) continue;
    await copyFileIfMissing(sourcePath, join(targetRoot, filename));
  }

  const sourceOpencode = join(sourceRoot, ".opencode");
  if (await exists(sourceOpencode)) {
    await copyDirectoryRecursive(sourceOpencode, join(targetRoot, ".opencode"));
  }
}
