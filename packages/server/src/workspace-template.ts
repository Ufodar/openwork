import { copyFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { readJsoncFile, writeJsoncFile } from "./jsonc.js";
import { ensureDir, exists } from "./utils.js";

const ROOT_TEMPLATE_FILES = ["opencode.json", "opencode.jsonc"];
const OPENCODE_SKIP_DIRS = new Set(["openwork", "node_modules"]);
const OPENCODE_SKIP_FILES = new Set(["bun.lock", "bun.lockb"]);

async function copyFileFromTemplate(sourcePath: string, targetPath: string, overwrite = false) {
  if (!overwrite && (await exists(targetPath))) return;
  await ensureDir(dirname(targetPath));
  await copyFile(sourcePath, targetPath);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeTemplateValue(targetValue: unknown, sourceValue: unknown): unknown {
  if (Array.isArray(sourceValue)) return [...sourceValue];
  if (!isPlainObject(sourceValue)) return sourceValue;

  const next: Record<string, unknown> = isPlainObject(targetValue) ? { ...targetValue } : {};
  for (const [key, value] of Object.entries(sourceValue)) {
    next[key] = mergeTemplateValue(next[key], value);
  }
  return next;
}

async function syncRootTemplateConfig(sourcePath: string, targetPath: string) {
  if (!(await exists(targetPath))) {
    await copyFileFromTemplate(sourcePath, targetPath);
    return;
  }

  const { data: sourceConfig } = await readJsoncFile<Record<string, unknown>>(sourcePath, {});
  const { data: targetConfig } = await readJsoncFile<Record<string, unknown>>(targetPath, {});
  const merged = mergeTemplateValue(targetConfig, sourceConfig);
  await writeJsoncFile(targetPath, merged);
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
    await copyFileFromTemplate(sourcePath, targetPath, true);
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
    await syncRootTemplateConfig(sourcePath, join(targetRoot, filename));
  }

  const sourceOpencode = join(sourceRoot, ".opencode");
  if (await exists(sourceOpencode)) {
    await copyDirectoryRecursive(sourceOpencode, join(targetRoot, ".opencode"));
  }
}
