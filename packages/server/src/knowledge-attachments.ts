import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFile, rename, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "./utils.js";

export type KnowledgeAttachmentEntry = {
  runtimeId: string;
  knowledgeIds: string[];
  updatedAt: number;
};

type KnowledgeAttachmentStore = {
  schemaVersion: 1;
  updatedAt: number;
  attachments: Record<string, KnowledgeAttachmentEntry>;
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

function resolveKnowledgeAttachmentPath(workspaceId: string): string {
  return join(resolveOpenworkDataDir(), "knowledge-attachments", `${workspaceId}.json`);
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKnowledgeIds(values: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const candidate = normalizeString(value);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    next.push(candidate);
  }
  return next;
}

async function readStore(path: string): Promise<KnowledgeAttachmentStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), attachments: {} };
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<KnowledgeAttachmentStore>;
    const source = parsed.attachments && typeof parsed.attachments === "object" ? parsed.attachments : {};
    const attachments: Record<string, KnowledgeAttachmentEntry> = {};
    for (const [sessionId, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Partial<KnowledgeAttachmentEntry>;
      const runtimeId = normalizeString(record.runtimeId);
      const knowledgeIds = Array.isArray(record.knowledgeIds) ? normalizeKnowledgeIds(record.knowledgeIds as string[]) : [];
      const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : Date.now();
      if (!sessionId.trim() || !runtimeId) continue;
      attachments[sessionId] = { runtimeId, knowledgeIds, updatedAt };
    }
    return { schemaVersion: 1, updatedAt: Date.now(), attachments };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), attachments: {} };
  }
}

async function writeStore(path: string, attachments: Record<string, KnowledgeAttachmentEntry>) {
  await ensureDir(dirname(path));
  const payload: KnowledgeAttachmentStore = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    attachments,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export class KnowledgeAttachmentService {
  private cache = new Map<string, KnowledgeAttachmentStore>();

  private async ensureLoaded(workspaceId: string) {
    const key = normalizeString(workspaceId);
    if (!key) {
      return { schemaVersion: 1, updatedAt: Date.now(), attachments: {} } satisfies KnowledgeAttachmentStore;
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    const store = await readStore(resolveKnowledgeAttachmentPath(key));
    this.cache.set(key, store);
    return store;
  }

  async getEntry(workspaceId: string, sessionId: string): Promise<KnowledgeAttachmentEntry | null> {
    const ws = normalizeString(workspaceId);
    const sid = normalizeString(sessionId);
    if (!ws || !sid) return null;
    const store = await this.ensureLoaded(ws);
    return store.attachments[sid] ?? null;
  }

  async get(workspaceId: string, sessionId: string): Promise<string[]> {
    return (await this.getEntry(workspaceId, sessionId))?.knowledgeIds ?? [];
  }

  async set(workspaceId: string, sessionId: string, runtimeId: string, knowledgeIds: string[]): Promise<void> {
    const ws = normalizeString(workspaceId);
    const sid = normalizeString(sessionId);
    const rid = normalizeString(runtimeId);
    if (!ws || !sid || !rid) return;
    const store = await this.ensureLoaded(ws);
    store.attachments[sid] = {
      runtimeId: rid,
      knowledgeIds: normalizeKnowledgeIds(knowledgeIds),
      updatedAt: Date.now(),
    };
    await writeStore(resolveKnowledgeAttachmentPath(ws), store.attachments);
  }

  async remove(workspaceId: string, sessionId: string): Promise<void> {
    const ws = normalizeString(workspaceId);
    const sid = normalizeString(sessionId);
    if (!ws || !sid) return;
    const store = await this.ensureLoaded(ws);
    if (!store.attachments[sid]) return;
    delete store.attachments[sid];
    await writeStore(resolveKnowledgeAttachmentPath(ws), store.attachments);
  }
}
