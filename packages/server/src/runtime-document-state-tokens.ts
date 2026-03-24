import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { readFile, rename, writeFile } from "node:fs/promises";

import { ensureDir, exists, hashToken, shortId } from "./utils.js";

export type RuntimeDocumentStateTokenRecord = {
  tokenHash: string;
  workspaceId: string;
  sessionId: string;
  runtimeId: string;
  issuedAt: number;
  expiresAt: number;
};

type RuntimeDocumentStateTokenStore = {
  schemaVersion: 1;
  updatedAt: number;
  tokens: Record<string, RuntimeDocumentStateTokenRecord>;
};

type RuntimeDocumentStateTokenServiceOptions = {
  now?: () => number;
  defaultTtlMs?: number;
};

const DEFAULT_RUNTIME_TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function expandHome(value: string): string {
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function resolveOpenworkDataDir(): string {
  const override = process.env.OPENWORK_DATA_DIR?.trim();
  if (override) return expandHome(override);
  return join(homedir(), ".openwork", "openwork-server");
}

function resolveRuntimeDocumentStateTokenPath(): string {
  return join(resolveOpenworkDataDir(), "runtime-document-state-tokens", "tokens.json");
}

function normalizeString(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

async function readStore(path: string): Promise<RuntimeDocumentStateTokenStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), tokens: {} };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeDocumentStateTokenStore>;
    const source = parsed.tokens && typeof parsed.tokens === "object" ? parsed.tokens : {};
    const tokens: Record<string, RuntimeDocumentStateTokenRecord> = {};
    for (const [tokenHashKey, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const entry = value as Partial<RuntimeDocumentStateTokenRecord>;
      const tokenHashValue = normalizeString(entry.tokenHash ?? tokenHashKey);
      const workspaceId = normalizeString(entry.workspaceId);
      const sessionId = normalizeString(entry.sessionId);
      const runtimeId = normalizeString(entry.runtimeId);
      const issuedAt = typeof entry.issuedAt === "number" ? entry.issuedAt : Date.now();
      const expiresAt = typeof entry.expiresAt === "number" ? entry.expiresAt : issuedAt;
      if (!tokenHashValue || !workspaceId || !sessionId || !runtimeId) continue;
      tokens[tokenHashValue] = {
        tokenHash: tokenHashValue,
        workspaceId,
        sessionId,
        runtimeId,
        issuedAt,
        expiresAt,
      };
    }
    return { schemaVersion: 1, updatedAt: Date.now(), tokens };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), tokens: {} };
  }
}

async function writeStore(path: string, tokens: Record<string, RuntimeDocumentStateTokenRecord>) {
  await ensureDir(dirname(path));
  const payload: RuntimeDocumentStateTokenStore = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    tokens,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export class RuntimeDocumentStateTokenService {
  private store: RuntimeDocumentStateTokenStore | null = null;
  private readonly now: () => number;
  private readonly defaultTtlMs: number;

  constructor(options: RuntimeDocumentStateTokenServiceOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_RUNTIME_TOKEN_TTL_MS;
  }

  private async ensureLoaded() {
    if (this.store) return this.store;
    this.store = await readStore(resolveRuntimeDocumentStateTokenPath());
    return this.store;
  }

  private async persist() {
    if (!this.store) return;
    await writeStore(resolveRuntimeDocumentStateTokenPath(), this.store.tokens);
  }

  private async pruneExpired(store: RuntimeDocumentStateTokenStore) {
    const now = this.now();
    let dirty = false;
    for (const [tokenHashValue, record] of Object.entries(store.tokens)) {
      if (record.expiresAt > now) continue;
      delete store.tokens[tokenHashValue];
      dirty = true;
    }
    if (dirty) {
      await this.persist();
    }
  }

  async issue(input: { workspaceId: string; sessionId: string; runtimeId: string; ttlMs?: number }): Promise<{ token: string; expiresAt: number }> {
    const workspaceId = normalizeString(input.workspaceId);
    const sessionId = normalizeString(input.sessionId);
    const runtimeId = normalizeString(input.runtimeId);
    if (!workspaceId || !sessionId || !runtimeId) {
      throw new Error("workspaceId, sessionId, and runtimeId are required");
    }
    const ttlMs = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0
      ? input.ttlMs
      : this.defaultTtlMs;
    const issuedAt = this.now();
    const expiresAt = issuedAt + ttlMs;
    const token = `owdst_${shortId().replace(/-/g, "")}`;
    const tokenHashValue = hashToken(token);
    const store = await this.ensureLoaded();
    await this.pruneExpired(store);
    for (const [existingHash, record] of Object.entries(store.tokens)) {
      if (record.workspaceId === workspaceId && record.sessionId === sessionId && record.runtimeId === runtimeId) {
        delete store.tokens[existingHash];
      }
    }
    store.tokens[tokenHashValue] = {
      tokenHash: tokenHashValue,
      workspaceId,
      sessionId,
      runtimeId,
      issuedAt,
      expiresAt,
    };
    await this.persist();
    return { token, expiresAt };
  }

  async resolve(token: string): Promise<RuntimeDocumentStateTokenRecord | null> {
    const plaintext = normalizeString(token);
    if (!plaintext) return null;
    const store = await this.ensureLoaded();
    await this.pruneExpired(store);
    return store.tokens[hashToken(plaintext)] ?? null;
  }

  async revokeRuntime(workspaceId: string, sessionId: string, runtimeId: string): Promise<void> {
    const ws = normalizeString(workspaceId);
    const sid = normalizeString(sessionId);
    const rid = normalizeString(runtimeId);
    if (!ws || !sid || !rid) return;
    const store = await this.ensureLoaded();
    let dirty = false;
    for (const [tokenHashValue, record] of Object.entries(store.tokens)) {
      if (record.workspaceId !== ws || record.sessionId !== sid || record.runtimeId !== rid) continue;
      delete store.tokens[tokenHashValue];
      dirty = true;
    }
    if (dirty) {
      await this.persist();
    }
  }
}
