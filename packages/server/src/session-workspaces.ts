import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFile, rename, writeFile } from "node:fs/promises";

import { ensureDir, exists, shortId } from "./utils.js";
import { copyWorkspaceConfigTemplate } from "./workspace-template.js";

type PermissionAction = "allow" | "deny" | "ask";

type PermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

export type PermissionRuleset = PermissionRule[];

type SessionWorkspaceStore = {
  schemaVersion: 1;
  updatedAt: number;
  workspaces: Record<string, SessionWorkspaceEntry>;
};

export type SessionWorkspaceEntry = {
  runtimeId: string;
  runtimeDir: string;
  createdAt: number;
};

function expandHome(value: string): string {
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function resolveOpenworkDataDir(): string {
  const override = process.env.OPENWORK_DATA_DIR?.trim();
  if (override) return expandHome(override);
  return join(homedir(), ".openwork", "openwork-server");
}

function resolveSessionWorkspacePath(workspaceId: string): string {
  return join(resolveOpenworkDataDir(), "session-workspaces", `${workspaceId}.json`);
}

async function readStore(path: string): Promise<SessionWorkspaceStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), workspaces: {} };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SessionWorkspaceStore>;
    const source = parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {};
    const workspaces: Record<string, SessionWorkspaceEntry> = {};
    for (const [sessionId, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Partial<SessionWorkspaceEntry>;
      const runtimeId = typeof record.runtimeId === "string" ? record.runtimeId.trim() : "";
      const runtimeDir = typeof record.runtimeDir === "string" ? record.runtimeDir.trim() : "";
      const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
      if (!sessionId.trim() || !runtimeId || !runtimeDir) continue;
      workspaces[sessionId] = { runtimeId, runtimeDir, createdAt };
    }
    return { schemaVersion: 1, updatedAt: Date.now(), workspaces };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), workspaces: {} };
  }
}

async function writeStore(path: string, workspaces: Record<string, SessionWorkspaceEntry>) {
  await ensureDir(dirname(path));
  const payload: SessionWorkspaceStore = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    workspaces,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export async function provisionSessionWorkspace(workspacePath: string): Promise<{ runtimeId: string; runtimeDir: string }> {
  const runtimeId = shortId().replace(/-/g, "");
  const runtimeDir = join(workspacePath, "documents", "sessions", runtimeId);
  await ensureDir(runtimeDir);
  await copyWorkspaceConfigTemplate(workspacePath, runtimeDir);
  return { runtimeId, runtimeDir };
}

export function buildSessionPermissionRules(): PermissionRuleset {
  return [{ permission: "external_directory", pattern: "*", action: "deny" }];
}

export function sessionDirectoryBelongsToWorkspace(workspacePath: string, sessionDirectory: string | null | undefined): boolean {
  const sessionDir = (sessionDirectory ?? "").trim();
  if (!sessionDir) return false;
  const prefix = join(workspacePath, "documents", "sessions");
  return sessionDir === workspacePath || sessionDir === prefix || sessionDir.startsWith(`${prefix}/`);
}

export class SessionWorkspaceService {
  private cache = new Map<string, SessionWorkspaceStore>();

  private async ensureLoaded(workspaceId: string) {
    const key = workspaceId.trim();
    if (!key) {
      return { schemaVersion: 1, updatedAt: Date.now(), workspaces: {} } satisfies SessionWorkspaceStore;
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    const store = await readStore(resolveSessionWorkspacePath(key));
    this.cache.set(key, store);
    return store;
  }

  async setWorkspace(workspaceId: string, sessionId: string, entry: SessionWorkspaceEntry): Promise<void> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const store = await this.ensureLoaded(ws);
    store.workspaces[sid] = {
      runtimeId: entry.runtimeId,
      runtimeDir: entry.runtimeDir,
      createdAt: entry.createdAt,
    };
    await writeStore(resolveSessionWorkspacePath(ws), store.workspaces);
  }

  async getWorkspace(workspaceId: string, sessionId: string): Promise<SessionWorkspaceEntry | null> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return null;
    const store = await this.ensureLoaded(ws);
    return store.workspaces[sid] ?? null;
  }

  async removeWorkspace(workspaceId: string, sessionId: string): Promise<void> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const store = await this.ensureLoaded(ws);
    if (!store.workspaces[sid]) return;
    delete store.workspaces[sid];
    await writeStore(resolveSessionWorkspacePath(ws), store.workspaces);
  }

  async resolveDocumentsDir(workspaceId: string, workspacePath: string, sessionId: string | null | undefined): Promise<string> {
    const sid = (sessionId ?? "").trim();
    if (!sid) return join(workspacePath, "documents");
    const entry = await this.getWorkspace(workspaceId, sid);
    return entry?.runtimeDir ?? join(workspacePath, "documents", "sessions", sid);
  }
}
