import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFile, rename, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "./utils.js";

type SessionOwnerStore = {
  schemaVersion: 1;
  updatedAt: number;
  owners: Record<string, { ownerKey: string; updatedAt: number }>;
};

export type SessionOwnerEntry = {
  ownerKey: string;
  updatedAt: number;
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

function resolveSessionOwnerPath(workspaceId: string): string {
  return join(resolveOpenworkDataDir(), "session-owners", `${workspaceId}.json`);
}

function normalizeOwnerKey(value: string): string {
  return value.trim();
}

async function readStore(path: string): Promise<SessionOwnerStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), owners: {} };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SessionOwnerStore>;
    const owners: Record<string, { ownerKey: string; updatedAt: number }> = {};
    const source = parsed.owners && typeof parsed.owners === "object" ? parsed.owners : {};
    for (const [sessionId, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const ownerKey = normalizeOwnerKey(typeof (value as any).ownerKey === "string" ? (value as any).ownerKey : "");
      if (!sessionId.trim() || !ownerKey) continue;
      const updatedAt = typeof (value as any).updatedAt === "number" ? (value as any).updatedAt : Date.now();
      owners[sessionId] = { ownerKey, updatedAt };
    }
    return { schemaVersion: 1, updatedAt: Date.now(), owners };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), owners: {} };
  }
}

async function writeStore(path: string, owners: SessionOwnerStore["owners"]) {
  await ensureDir(dirname(path));
  const payload: SessionOwnerStore = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    owners,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export class SessionOwnershipService {
  private cache = new Map<string, SessionOwnerStore>();

  private async ensureLoaded(workspaceId: string) {
    const key = workspaceId.trim();
    if (!key) {
      return { schemaVersion: 1, updatedAt: Date.now(), owners: {} } satisfies SessionOwnerStore;
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    const path = resolveSessionOwnerPath(key);
    const store = await readStore(path);
    this.cache.set(key, store);
    return store;
  }

  async getOwner(workspaceId: string, sessionId: string): Promise<string | null> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return null;
    const store = await this.ensureLoaded(ws);
    const owner = store.owners[sid];
    return owner?.ownerKey ?? null;
  }

  async setOwner(workspaceId: string, sessionId: string, ownerKey: string): Promise<void> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    const owner = normalizeOwnerKey(ownerKey);
    if (!ws || !sid || !owner) return;
    const store = await this.ensureLoaded(ws);
    store.owners[sid] = { ownerKey: owner, updatedAt: Date.now() };
    const path = resolveSessionOwnerPath(ws);
    await writeStore(path, store.owners);
  }

  async removeOwner(workspaceId: string, sessionId: string): Promise<void> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const store = await this.ensureLoaded(ws);
    if (!store.owners[sid]) return;
    delete store.owners[sid];
    const path = resolveSessionOwnerPath(ws);
    await writeStore(path, store.owners);
  }

  async filterVisibleSessionIds(workspaceId: string, sessionIds: string[], ownerKey: string): Promise<Set<string>> {
    const ws = workspaceId.trim();
    const owner = normalizeOwnerKey(ownerKey);
    const visible = new Set<string>();
    if (!ws || !owner) return visible;
    const store = await this.ensureLoaded(ws);
    for (const sessionId of sessionIds) {
      const sid = sessionId.trim();
      if (!sid) continue;
      if (store.owners[sid]?.ownerKey === owner) {
        visible.add(sid);
      }
    }
    return visible;
  }

  async listEntries(workspaceId: string): Promise<Record<string, SessionOwnerEntry>> {
    const ws = workspaceId.trim();
    if (!ws) return {};
    const store = await this.ensureLoaded(ws);
    return { ...store.owners };
  }
}
