import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import net from "node:net";
import { realpathSync, statSync } from "node:fs";

import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";

function normalizeOptionalString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function makeClient({ baseUrl, directory }) {
  return createOpencodeClient({
    baseUrl,
    directory,
    responseStyle: "data",
    throwOnError: true,
  });
}

export function buildHostedOpenworkClientOptions({ baseUrl, workspaceId, token }) {
  return {
    baseUrl: `${baseUrl.replace(/\/+$/, "")}/w/${encodeURIComponent(workspaceId)}/opencode`,
    headers: { Authorization: `Bearer ${token}` },
    responseStyle: "data",
    throwOnError: true,
  };
}

export function createHostedOpenworkClient(input) {
  return createOpencodeClient(buildHostedOpenworkClientOptions(input));
}

export function buildHostedSessionCreateBody({
  title,
  enableDocumentState = false,
  preferredView,
  preferredAgent,
  preferredAgentLock,
}) {
  const body = { title };

  if (enableDocumentState) {
    body.openworkEnableDocState = true;
  }

  const normalizedPreferredView = normalizeOptionalString(preferredView);
  if (normalizedPreferredView) {
    body.openworkPreferredView = normalizedPreferredView;
  }

  const normalizedPreferredAgent = normalizeOptionalString(preferredAgent);
  if (normalizedPreferredAgent) {
    body.openworkPreferredAgent = normalizedPreferredAgent;
  }

  const normalizedPreferredAgentLock = normalizeOptionalString(preferredAgentLock);
  if (normalizedPreferredAgentLock) {
    body.openworkPreferredAgentLock = normalizedPreferredAgentLock;
  }

  return body;
}

function buildHostedOpenworkSessionUrl({ baseUrl, workspaceId, directory }) {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, "")}/w/${encodeURIComponent(workspaceId)}/opencode/session`,
  );
  const normalizedDirectory = normalizeOptionalString(directory);
  if (normalizedDirectory) {
    url.searchParams.set("directory", normalizedDirectory);
  }
  return url.toString();
}

async function requestHostedOpenworkJson({
  baseUrl,
  workspaceId,
  token,
  method = "GET",
  body,
  directory,
}) {
  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (body !== undefined) headers.set("Content-Type", "application/json");

  const response = await fetch(buildHostedOpenworkSessionUrl({ baseUrl, workspaceId, directory }), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

export async function createHostedOpenworkSession({
  baseUrl,
  workspaceId,
  token,
  title,
  enableDocumentState = false,
  preferredView,
  preferredAgent,
  preferredAgentLock,
}) {
  return requestHostedOpenworkJson({
    baseUrl,
    workspaceId,
    token,
    method: "POST",
    body: buildHostedSessionCreateBody({
      title,
      enableDocumentState,
      preferredView,
      preferredAgent,
      preferredAgentLock,
    }),
  });
}

export function findHostedSessionRecord(payload, sessionId) {
  const items = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload)
      ? payload
      : [];
  return items.find((item) => item?.id === sessionId) ?? null;
}

function hostedSessionProfileMatches(record, expectations) {
  if (!record || !expectations || typeof expectations !== "object") return true;

  const checks = [
    ["openworkPreferredView", expectations.preferredView],
    ["openworkPreferredAgent", expectations.preferredAgent],
    ["openworkPreferredAgentLock", expectations.preferredAgentLock],
  ];

  for (const [key, expected] of checks) {
    const normalizedExpected = normalizeOptionalString(expected);
    if (!normalizedExpected) continue;
    if (normalizeOptionalString(record?.[key]) !== normalizedExpected) {
      return false;
    }
  }

  return true;
}

export async function fetchHostedSessionRecord({
  baseUrl,
  workspaceId,
  token,
  sessionId,
  workspacePath,
  preferredView,
  preferredAgent,
  preferredAgentLock,
  timeoutMs = 15_000,
  pollMs = 500,
}) {
  const startedAt = Date.now();
  let lastPayload = null;
  let lastRecord = null;

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await requestHostedOpenworkJson({
      baseUrl,
      workspaceId,
      token,
      method: "GET",
      directory: workspacePath,
    });
    lastPayload = payload;
    const record = findHostedSessionRecord(payload, sessionId);
    if (record) {
      lastRecord = record;
      if (hostedSessionProfileMatches(record, { preferredView, preferredAgent, preferredAgentLock })) {
        return record;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, pollMs));
  }

  throw new Error(
    `Timed out waiting for hosted session record ${sessionId}; last payload keys=${Object.keys(lastPayload ?? {}).join(",")} last record view=${normalizeOptionalString(lastRecord?.openworkPreferredView)} agent=${normalizeOptionalString(lastRecord?.openworkPreferredAgent)} lock=${normalizeOptionalString(lastRecord?.openworkPreferredAgentLock)}`,
  );
}

export async function findFreePort() {
  const server = net.createServer();
  server.unref();

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();

  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("Failed to allocate a free port");
  }

  const port = addr.port;
  server.close();
  return port;
}

export async function spawnOpencodeServe({
  directory,
  hostname = "127.0.0.1",
  port,
  corsOrigins = [],
}) {
  assert.ok(directory && directory.trim(), "directory is required");
  assert.ok(Number.isInteger(port) && port > 0, "port must be a positive integer");

  const cwd = realpathSync(directory);
  const args = ["serve", "--hostname", hostname, "--port", String(port)];
  for (const origin of corsOrigins) {
    args.push("--cors", origin);
  }

  const child = spawn("opencode", args, {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      // Make it explicit we're a non-TUI client.
      OPENCODE_CLIENT: "openwork-test",
    },
  });

  const baseUrl = `http://${hostname}:${port}`;

  // If the process dies early, surface stderr.
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  async function waitForExit(ms) {
    return Promise.race([
      once(child, "exit").then(() => true),
      new Promise((r) => setTimeout(() => r(false), ms)),
    ]);
  }

  return {
    cwd,
    baseUrl,
    child,
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) {
        return;
      }

      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }

      const exited = await waitForExit(2500);
      if (exited) {
        return;
      }

      // Force kill.
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }

      await waitForExit(2500);
    },
    getStderr() {
      return stderr;
    },
  };
}

export async function waitForHealthy(client, { timeoutMs = 10_000, pollMs = 250 } = {}) {
  const start = Date.now();
  let lastError;

  while (Date.now() - start < timeoutMs) {
    try {
      const health = await client.global.health();
      assert.equal(health.healthy, true);
      assert.ok(typeof health.version === "string");
      return health;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  const msg = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out waiting for /global/health: ${msg}`);
}

export function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  if (typeof raw.type === "string") {
    return { type: raw.type, properties: raw.properties };
  }

  if (raw.payload && typeof raw.payload === "object" && typeof raw.payload.type === "string") {
    return { type: raw.payload.type, properties: raw.payload.properties };
  }

  return null;
}

export function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args.set(key, value);
  }
  return args;
}

export function canWriteWorkspace(directory) {
  try {
    const stat = statSync(directory);
    return stat && stat.isDirectory();
  } catch {
    return false;
  }
}
