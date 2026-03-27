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
  openworkPreferredView?: string | null;
  openworkPreferredAgent?: string | null;
  openworkPreferredAgentLock?: string | null;
};

const SESSION_ID_PATTERN = /^ses_[A-Za-z0-9_-]+$/;
const RUNTIME_PROFILE_RELATIVE_PATH = ".opencode/openwork-runtime-profile.json";

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizePreferredView(value: unknown): "session" | "document-agent" | "document-writer" | null {
  switch (normalizeOptionalString(value)?.toLowerCase()) {
    case "session":
      return "session";
    case "document-agent":
      return "document-agent";
    case "document-writer":
      return "document-writer";
    default:
      return null;
  }
}

function resolvePreferenceDefaults(view: "session" | "document-agent" | "document-writer" | null): {
  openworkPreferredView: string | null;
  openworkPreferredAgent: string | null;
  openworkPreferredAgentLock: string | null;
} {
  if (view === "document-agent") {
    return {
      openworkPreferredView: "document-agent",
      openworkPreferredAgent: "common-work",
      openworkPreferredAgentLock: "common-work",
    };
  }
  if (view === "document-writer") {
    return {
      openworkPreferredView: "document-writer",
      openworkPreferredAgent: "document-writer",
      openworkPreferredAgentLock: "document-writer",
    };
  }
  if (view === "session") {
    return {
      openworkPreferredView: "session",
      openworkPreferredAgent: null,
      openworkPreferredAgentLock: null,
    };
  }
  return {
    openworkPreferredView: null,
    openworkPreferredAgent: null,
    openworkPreferredAgentLock: null,
  };
}

function extractStoredPreferenceMetadata(value: unknown): {
  openworkPreferredView: string | null;
  openworkPreferredAgent: string | null;
  openworkPreferredAgentLock: string | null;
} {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : null;
  const normalizedView = normalizePreferredView(record?.view);
  const defaults = resolvePreferenceDefaults(normalizedView);
  return {
    openworkPreferredView: defaults.openworkPreferredView,
    openworkPreferredAgent: normalizeOptionalString(record?.agent) ?? defaults.openworkPreferredAgent,
    openworkPreferredAgentLock: normalizeOptionalString(record?.agentLock) ?? defaults.openworkPreferredAgentLock,
  };
}

async function readSessionIdsFromOpenworkConfig(configPath: string): Promise<{
  ids: string[];
  updatedAt: number | null;
  preferencesById: Record<string, {
    openworkPreferredView: string | null;
    openworkPreferredAgent: string | null;
    openworkPreferredAgentLock: string | null;
  }>;
}> {
  if (!(await exists(configPath))) {
    return { ids: [], updatedAt: null, preferencesById: {} };
  }
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as StoredSessionPrefs;
    const sessions = parsed.sessions && typeof parsed.sessions === "object" ? parsed.sessions : {};
    const ids = Object.keys(sessions)
      .map((value) => value.trim())
      .filter((value) => SESSION_ID_PATTERN.test(value));
    const preferencesById = Object.fromEntries(
      ids.map((id) => [id, extractStoredPreferenceMetadata((sessions as Record<string, unknown>)[id])]),
    );
    const info = await stat(configPath);
    return { ids, updatedAt: info.mtimeMs, preferencesById };
  } catch {
    return { ids: [], updatedAt: null, preferencesById: {} };
  }
}

export async function readRuntimeProfilePreferences(runtimeDir: string): Promise<{
  openworkPreferredView: string | null;
  openworkPreferredAgent: string | null;
  openworkPreferredAgentLock: string | null;
}> {
  const profilePath = join(runtimeDir, RUNTIME_PROFILE_RELATIVE_PATH);
  if (!(await exists(profilePath))) {
    return resolvePreferenceDefaults(null);
  }
  try {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as Record<string, unknown>;
    return resolvePreferenceDefaults(normalizePreferredView(raw.id));
  } catch {
    return resolvePreferenceDefaults(null);
  }
}

export async function recoverWorkspaceSessionRecords(workspacePath: string): Promise<RecoveredSessionRecord[]> {
  const records = new Map<string, RecoveredSessionRecord>();
  const sessionRoot = join(workspacePath, "documents", "sessions");
  const rootConfigPath = join(workspacePath, ".opencode", "openwork.json");
  const rootConfig = await readSessionIdsFromOpenworkConfig(rootConfigPath);

  const register = (
    id: string,
    directory: string | null,
    updatedAt: number | null,
    preferences?: {
      openworkPreferredView: string | null;
      openworkPreferredAgent: string | null;
      openworkPreferredAgentLock: string | null;
    } | null,
  ) => {
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
      openworkPreferredView: existing?.openworkPreferredView ?? preferences?.openworkPreferredView ?? null,
      openworkPreferredAgent: existing?.openworkPreferredAgent ?? preferences?.openworkPreferredAgent ?? null,
      openworkPreferredAgentLock:
        existing?.openworkPreferredAgentLock ?? preferences?.openworkPreferredAgentLock ?? null,
    });
  };

  for (const id of rootConfig.ids) {
    register(id, workspacePath, rootConfig.updatedAt, rootConfig.preferencesById[id] ?? null);
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
      register(id, runtimeDir, runtimeConfig.updatedAt, runtimeConfig.preferencesById[id] ?? null);
    }
    const runtimeProfilePreferences = await readRuntimeProfilePreferences(runtimeDir);
    if (runtimeProfilePreferences.openworkPreferredView && SESSION_ID_PATTERN.test(entry.name.trim())) {
      register(entry.name.trim(), runtimeDir, runtimeConfig.updatedAt, runtimeProfilePreferences);
    }
  }

  return Array.from(records.values()).sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
}
