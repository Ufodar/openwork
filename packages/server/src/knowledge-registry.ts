import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFile, rename, writeFile } from "node:fs/promises";

import { ensureDir, exists } from "./utils.js";

export type KnowledgeSource = "openwork" | "imported";
export type KnowledgeVisibility = "visible_to_all_users";
export type KnowledgeStatus = "ready" | "processing" | "degraded" | "deleted";

export type KnowledgeRegistryRecordInput = {
  knowledgeId: string;
  ragflowDatasetId: string;
  ownerUserId: string;
  ownerDisplayName: string;
  title: string;
  description?: string;
  source: KnowledgeSource;
  visibility: KnowledgeVisibility;
  ingestionPreset?: string | null;
  chunkMethod?: string | null;
  parserConfig?: Record<string, unknown> | null;
  embeddingModel?: string | null;
  status: KnowledgeStatus;
  documentCount?: number | null;
  chunkCount?: number | null;
};

export type KnowledgeRegistryRecord = KnowledgeRegistryRecordInput & {
  createdAt: number;
  updatedAt: number;
};

type KnowledgeRegistryStore = {
  schemaVersion: 1;
  updatedAt: number;
  items: Record<string, KnowledgeRegistryRecord>;
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

function resolveKnowledgeRegistryPath(): string {
  return join(resolveOpenworkDataDir(), "knowledge-registry", "registry.json");
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  const normalized = normalizeString(value);
  return normalized || null;
}

function normalizeCount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function normalizeParserConfig(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return { ...value };
}

function normalizeStatus(value: string | null | undefined): KnowledgeStatus {
  if (value === "processing" || value === "degraded" || value === "deleted") return value;
  return "ready";
}

async function readStore(path: string): Promise<KnowledgeRegistryStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), items: {} };
  }

  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<KnowledgeRegistryStore>;
    const source = parsed.items && typeof parsed.items === "object" ? parsed.items : {};
    const items: Record<string, KnowledgeRegistryRecord> = {};
    for (const [knowledgeId, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Partial<KnowledgeRegistryRecord>;
      const normalizedId = normalizeString(record.knowledgeId ?? knowledgeId);
      const ragflowDatasetId = normalizeString(record.ragflowDatasetId);
      const ownerUserId = normalizeString(record.ownerUserId);
      const ownerDisplayName = normalizeString(record.ownerDisplayName);
      const title = normalizeString(record.title);
      if (!normalizedId || !ragflowDatasetId || !ownerUserId || !ownerDisplayName || !title) continue;
      const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
      const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : createdAt;
      items[normalizedId] = {
        knowledgeId: normalizedId,
        ragflowDatasetId,
        ownerUserId,
        ownerDisplayName,
        title,
        description: normalizeOptionalString(record.description) ?? undefined,
        source: record.source === "imported" ? "imported" : "openwork",
        visibility: "visible_to_all_users",
        ingestionPreset: normalizeOptionalString(record.ingestionPreset) ?? undefined,
        chunkMethod: normalizeOptionalString(record.chunkMethod) ?? undefined,
        parserConfig: normalizeParserConfig(record.parserConfig),
        embeddingModel: normalizeOptionalString(record.embeddingModel) ?? undefined,
        status: normalizeStatus(record.status),
        documentCount: normalizeCount(record.documentCount),
        chunkCount: normalizeCount(record.chunkCount),
        createdAt,
        updatedAt,
      };
    }
    return { schemaVersion: 1, updatedAt: Date.now(), items };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), items: {} };
  }
}

async function writeStore(path: string, items: Record<string, KnowledgeRegistryRecord>) {
  await ensureDir(dirname(path));
  const payload: KnowledgeRegistryStore = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    items,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

function sortByUpdatedAtDesc(items: KnowledgeRegistryRecord[]): KnowledgeRegistryRecord[] {
  return [...items].sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
    return right.createdAt - left.createdAt;
  });
}

function nextUpdatedAt(items: Record<string, KnowledgeRegistryRecord>, existing: KnowledgeRegistryRecord | undefined): number {
  const now = Date.now();
  let minimum = existing ? existing.updatedAt + 1 : 0;
  if (!existing) {
    for (const item of Object.values(items)) {
      minimum = Math.max(minimum, item.updatedAt + 1);
    }
  }
  return Math.max(now, minimum);
}

export class KnowledgeRegistryService {
  private store: KnowledgeRegistryStore | null = null;

  private async ensureLoaded() {
    if (this.store) return this.store;
    this.store = await readStore(resolveKnowledgeRegistryPath());
    return this.store;
  }

  async get(knowledgeId: string): Promise<KnowledgeRegistryRecord | null> {
    const key = normalizeString(knowledgeId);
    if (!key) return null;
    const store = await this.ensureLoaded();
    return store.items[key] ?? null;
  }

  async upsert(input: KnowledgeRegistryRecordInput): Promise<KnowledgeRegistryRecord> {
    const knowledgeId = normalizeString(input.knowledgeId);
    const ragflowDatasetId = normalizeString(input.ragflowDatasetId);
    const ownerUserId = normalizeString(input.ownerUserId);
    const ownerDisplayName = normalizeString(input.ownerDisplayName);
    const title = normalizeString(input.title);
    if (!knowledgeId || !ragflowDatasetId || !ownerUserId || !ownerDisplayName || !title) {
      throw new Error("knowledgeId, ragflowDatasetId, ownerUserId, ownerDisplayName, and title are required");
    }

    const store = await this.ensureLoaded();
    const existing = store.items[knowledgeId];
    const updatedAt = nextUpdatedAt(store.items, existing);
    const record: KnowledgeRegistryRecord = {
      knowledgeId,
      ragflowDatasetId,
      ownerUserId,
      ownerDisplayName,
      title,
      description: normalizeOptionalString(input.description) ?? undefined,
      source: input.source === "imported" ? "imported" : "openwork",
      visibility: "visible_to_all_users",
      ingestionPreset: normalizeOptionalString(input.ingestionPreset) ?? undefined,
      chunkMethod: normalizeOptionalString(input.chunkMethod) ?? undefined,
      parserConfig: normalizeParserConfig(input.parserConfig),
      embeddingModel: normalizeOptionalString(input.embeddingModel) ?? undefined,
      status: normalizeStatus(input.status),
      documentCount: normalizeCount(input.documentCount),
      chunkCount: normalizeCount(input.chunkCount),
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt,
    };
    store.items[knowledgeId] = record;
    await writeStore(resolveKnowledgeRegistryPath(), store.items);
    return record;
  }

  async delete(knowledgeId: string): Promise<boolean> {
    const key = normalizeString(knowledgeId);
    if (!key) return false;
    const store = await this.ensureLoaded();
    if (!store.items[key]) return false;
    delete store.items[key];
    await writeStore(resolveKnowledgeRegistryPath(), store.items);
    return true;
  }

  async listMine(ownerUserId: string): Promise<KnowledgeRegistryRecord[]> {
    const owner = normalizeString(ownerUserId);
    if (!owner) return [];
    const store = await this.ensureLoaded();
    return sortByUpdatedAtDesc(Object.values(store.items).filter((item) => item.ownerUserId === owner));
  }

  async listOthers(ownerUserId: string): Promise<KnowledgeRegistryRecord[]> {
    const owner = normalizeString(ownerUserId);
    const store = await this.ensureLoaded();
    if (!owner) return sortByUpdatedAtDesc(Object.values(store.items));
    return sortByUpdatedAtDesc(Object.values(store.items).filter((item) => item.ownerUserId !== owner));
  }
}
