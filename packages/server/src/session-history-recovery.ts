import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { exists } from "./utils.js";

type StoredSessionPrefs = {
  sessions?: Record<string, unknown> | null;
};

export type RecoveredSessionRecord = {
  id: string;
  title: string;
  slug: string | null;
  directory: string | null;
  createdAt: number | null;
  updatedAt: number | null;
};

const SESSION_ID_PATTERN = /^ses_[A-Za-z0-9_-]+$/;

async function readSessionIdsFromOpenworkConfig(configPath: string): Promise<{ ids: string[]; updatedAt: number | null }> {
  if (!(await exists(configPath))) {
    return { ids: [], updatedAt: null };
  }
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as StoredSessionPrefs;
    const sessions = parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
    const ids = Object.keys(sessions)
      .map((value) => value.trim())
      .filter((value) => SESSION_ID_PATTERN.test(value));
    const info = await stat(configPath);
    return { ids, updatedAt: info.mtimeMs };
  } catch {
    return { ids: [], updatedAt: null };
  }
}

export async function recoverWorkspaceSessionRecords(workspacePath: string): Promise<RecoveredSessionRecord[]> {
  const records = new Map<string, RecoveredSessionRecord>();
  const sessionRoot = join(workspacePath, "documents", "sessions");
  const rootConfigPath = join(workspacePath, ".opencode", "openwork.json");
  const rootConfig = await readSessionIdsFromOpenworkConfig(rootConfigPath);

  const register = (id: string, directory: string | null, updatedAt: number | null) => {
    const trimmed = id.trim();
    if (!SESSION_ID_PATTERN.test(trimmed)) return;
    const existing = records.get(trimmed);
    const nextUpdatedAt = Math.max(existing?.updatedAt ?? 0, updatedAt ?? 0) || null;
    records.set(trimmed, {
      id: trimmed,
      title: `历史会话 ${trimmed.slice(0, 12)}`,
      slug: null,
      directory: existing?.directory ?? directory ?? workspacePath,
      createdAt: existing?.createdAt ?? nextUpdatedAt,
      updatedAt: nextUpdatedAt,
    });
  };

  for (const id of rootConfig.ids) {
    register(id, workspacePath, rootConfig.updatedAt);
  }

  if (!(await exists(sessionRoot))) {
    return Array.from(records.values()).sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  }

  const entries = await readdir(sessionRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runtimeDir = join(sessionRoot, entry.name);
    let updatedAt: number | null = null;
    try {
      updatedAt = (await stat(runtimeDir)).mtimeMs;
    } catch {
      updatedAt = null;
    }
    if (SESSION_ID_PATTERN.test(entry.name)) {
      register(entry.name, runtimeDir, updatedAt);
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runtimeDir = join(sessionRoot, entry.name);
    const runtimeConfig = await readSessionIdsFromOpenworkConfig(join(runtimeDir, ".opencode", "openwork.json"));
    for (const id of runtimeConfig.ids) {
      register(id, runtimeDir, runtimeConfig.updatedAt);
    }
  }

  return Array.from(records.values()).sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}
