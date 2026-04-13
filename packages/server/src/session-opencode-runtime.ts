import { spawn, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

import { ApiError } from "./errors.js";
import { readJsoncFile, writeJsoncFile } from "./jsonc.js";
import { sanitizeRuntimeConfigForSession, type IsolatedOpencodeRuntime, type SessionWorkspaceEntry } from "./session-workspaces.js";
import type { WorkspaceInfo } from "./types.js";
import { ensureDir, exists } from "./utils.js";

type ServerLogger = {
  log: (level: "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => void;
};

type ChildProcessLike = {
  pid?: number;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  on: (...args: any[]) => unknown;
  killed?: boolean;
  exitCode?: number | null;
};

type SpawnProcessFn = (command: string, args: string[], options: SpawnOptions) => ChildProcessLike;
type WaitForHealthyFn = (url: string, headers?: Record<string, string>) => Promise<void>;
type FindFreePortFn = (host: string) => Promise<number>;

type RunningRuntime = {
  baseUrl: string;
  pid: number | null;
  child: ChildProcessLike;
  dispose: () => Promise<void>;
  busy: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
};

type ProvisionedRuntimeSeed = Pick<SessionWorkspaceEntry, "runtimeId" | "runtimeDir" | "createdAt">;

export type StartedSessionRuntime = {
  baseUrl: string;
  pid: number | null;
  dispose: () => Promise<void>;
  runtimeReservationId: string;
};

const DEFAULT_MAX_ACTIVE_SESSION_RUNTIMES = 30;
const DEFAULT_SESSION_RUNTIME_IDLE_TTL_MS = 8 * 60 * 60 * 1000;
const STRIPPED_RUNTIME_CONFIG_DIRS = [
  "skills",
  "plugins",
  "commands",
  "agents",
  "prompts",
  "references",
  "themes",
  "tools",
  "superpowers",
] as const;
const STRIPPED_RUNTIME_CONFIG_FILES = [
  "opencode-mem.jsonc",
] as const;
const COPIED_RUNTIME_CONFIG_KEYS = [
  "$schema",
  "provider",
  "model",
  "small_model",
  "reasoning_model",
] as const;

function parsePositiveInteger(value: string | undefined): number | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
}

function resolveHostOpencodeConfigDir(): string {
  const configured = process.env.OPENCODE_CONFIG_DIR?.trim();
  if (configured) return configured;
  return join(homedir(), ".config", "opencode");
}

function resolveHostXdgDataHome(): string {
  const configured = process.env.XDG_DATA_HOME?.trim();
  if (configured) return configured;
  return join(homedir(), ".local", "share");
}

async function waitForHealthy(url: string, headers?: Record<string, string>, timeoutMs = 60_000, pollMs = 250): Promise<void> {
  const start = Date.now();
  let lastError: string | null = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${url.replace(/\/$/, "")}/health`, {
        headers,
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(lastError ?? "Timed out waiting for OpenCode health");
}

async function findFreePort(host: string): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createNetServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

function makeSessionKey(workspaceId: string, sessionId: string): string {
  return `${workspaceId.trim()}::${sessionId.trim()}`;
}

export class SessionOpencodeRuntimeService {
  private readonly enabled: boolean;
  private readonly opencodeBin: string;
  private readonly bindHost: string;
  private readonly spawnProcess: SpawnProcessFn;
  private readonly waitForHealthy: WaitForHealthyFn;
  private readonly findFreePort: FindFreePortFn;
  private readonly logger?: ServerLogger;
  private readonly maxRunningRuntimes: number;
  private readonly idleTtlMs: number;
  private readonly handles = new Map<string, RunningRuntime>();
  private readonly pendingRuntimeReservations = new Set<string>();

  constructor(options?: {
    enabled?: boolean;
    opencodeBin?: string;
    bindHost?: string;
    spawnProcess?: SpawnProcessFn;
    waitForHealthy?: WaitForHealthyFn;
    findFreePort?: FindFreePortFn;
    logger?: ServerLogger;
    maxRunningRuntimes?: number;
    idleTtlMs?: number;
  }) {
    const runtimeMode = process.env.OPENWORK_SESSION_RUNTIME_MODE?.trim().toLowerCase() ?? "";
    this.enabled = options?.enabled ?? (runtimeMode === "process" || runtimeMode === "isolated_process");
    this.opencodeBin = options?.opencodeBin ?? process.env.OPENWORK_OPENCODE_BIN?.trim() ?? "opencode";
    this.bindHost = options?.bindHost ?? "127.0.0.1";
    this.spawnProcess = options?.spawnProcess ?? ((command, args, spawnOptions) => spawn(command, args, spawnOptions));
    this.waitForHealthy = options?.waitForHealthy ?? waitForHealthy;
    this.findFreePort = options?.findFreePort ?? findFreePort;
    this.logger = options?.logger;
    this.maxRunningRuntimes =
      options?.maxRunningRuntimes ??
      parsePositiveInteger(process.env.OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES) ??
      DEFAULT_MAX_ACTIVE_SESSION_RUNTIMES;
    this.idleTtlMs =
      options?.idleTtlMs ??
      parsePositiveInteger(process.env.OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS) ??
      DEFAULT_SESSION_RUNTIME_IDLE_TTL_MS;
  }

  isEnabledForWorkspace(workspace: WorkspaceInfo | undefined): boolean {
    return Boolean(this.enabled && workspace && workspace.workspaceType === "local");
  }

  async provisionSessionRuntime(workspace: WorkspaceInfo, entry: ProvisionedRuntimeSeed): Promise<SessionWorkspaceEntry> {
    if (!this.isEnabledForWorkspace(workspace)) {
      return { ...entry };
    }

    const runtime = buildIsolatedRuntime(entry.runtimeDir, this.bindHost);
    await seedIsolatedRuntime(runtime);
    return {
      ...entry,
      opencodeRuntime: runtime,
    };
  }

  async startProvisionedRuntime(workspace: WorkspaceInfo, entry: SessionWorkspaceEntry): Promise<StartedSessionRuntime> {
    const runtime = entry.opencodeRuntime;
    if (!runtime || runtime.mode !== "isolated_process") {
      return {
        baseUrl: workspace.baseUrl?.trim() ?? "",
        pid: null,
        dispose: async () => undefined,
        runtimeReservationId: entry.runtimeId,
      };
    }

    const reservationId = entry.runtimeId.trim();
    this.reserveRuntimeSlot(workspace, reservationId);
    await seedIsolatedRuntime(runtime);
    try {
      const port = await this.findFreePort(runtime.bindHost);
      const baseUrl = `http://${runtime.bindHost}:${port}`;
      const headers = buildRuntimeAuthHeaders(workspace);
      const child = this.spawnProcess(this.opencodeBin, [
        "serve",
        "--hostname",
        runtime.bindHost,
        "--port",
        String(port),
      ], {
        cwd: entry.runtimeDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          OPENCODE_CLIENT: "openwork-server",
          OPENWORK: "1",
          OPENWORK_SESSION_RUNTIME_ID: entry.runtimeId,
          OPENCODE_CONFIG_DIR: runtime.configDir,
          XDG_CONFIG_HOME: runtime.configHomeDir,
          XDG_DATA_HOME: runtime.dataDir,
          XDG_STATE_HOME: runtime.stateDir,
          XDG_CACHE_HOME: runtime.cacheDir,
          TMPDIR: runtime.tempDir,
          TMP: runtime.tempDir,
          TEMP: runtime.tempDir,
          ...(workspace.opencodeUsername?.trim() ? { OPENCODE_SERVER_USERNAME: workspace.opencodeUsername.trim() } : {}),
          ...(workspace.opencodePassword?.trim() ? { OPENCODE_SERVER_PASSWORD: workspace.opencodePassword.trim() } : {}),
        },
      });
      await this.waitForHealthy(baseUrl, headers);
      this.logger?.log("info", "Started isolated session opencode runtime", {
        workspaceId: workspace.id,
        runtimeId: entry.runtimeId,
        runtimeDir: entry.runtimeDir,
        baseUrl,
        pid: child.pid ?? null,
      });

      let disposed = false;
      const dispose = async () => {
        if (disposed) return;
        disposed = true;
        this.pendingRuntimeReservations.delete(reservationId);
        if (!child.kill) return;
        if (child.exitCode != null || child.killed) return;
        child.kill("SIGTERM");
        if (typeof (child as any).once === "function") {
          await Promise.race([
            once(child as any, "exit").catch(() => undefined),
            new Promise((resolve) => setTimeout(resolve, 1_000)),
          ]);
        }
        if (child.exitCode == null && !child.killed) {
          child.kill("SIGKILL");
        }
      };

      return {
        baseUrl,
        pid: child.pid ?? null,
        dispose,
        runtimeReservationId: reservationId,
      };
    } catch (error) {
      this.pendingRuntimeReservations.delete(reservationId);
      throw error;
    }
  }

  registerSessionRuntime(workspaceId: string, sessionId: string, runtime: StartedSessionRuntime): void {
    const key = makeSessionKey(workspaceId, sessionId);
    this.pendingRuntimeReservations.delete(runtime.runtimeReservationId);
    const handle = this.createHandle(runtime);
    this.handles.set(key, handle);
    this.scheduleIdleDispose(key, handle);
  }

  peekSessionWorkspace(
    workspace: WorkspaceInfo,
    workspaceId: string,
    sessionId: string,
    entry: SessionWorkspaceEntry,
  ): WorkspaceInfo | null {
    const runtime = entry.opencodeRuntime;
    if (!runtime || runtime.mode !== "isolated_process") {
      return {
        ...workspace,
        directory: entry.runtimeDir,
      };
    }
    const key = makeSessionKey(workspaceId, sessionId);
    const handle = this.handles.get(key);
    if (!handle) {
      return null;
    }
    return {
      ...workspace,
      baseUrl: handle.baseUrl,
      directory: entry.runtimeDir,
    };
  }

  async resolveSessionWorkspace(
    workspace: WorkspaceInfo,
    workspaceId: string,
    sessionId: string,
    entry: SessionWorkspaceEntry,
  ): Promise<WorkspaceInfo> {
    const runtime = entry.opencodeRuntime;
    if (!runtime || runtime.mode !== "isolated_process") {
      return {
        ...workspace,
        directory: entry.runtimeDir,
      };
    }
    const key = makeSessionKey(workspaceId, sessionId);
    let handle = this.handles.get(key);
    if (!handle) {
      const started = await this.startProvisionedRuntime(workspace, entry);
      this.pendingRuntimeReservations.delete(started.runtimeReservationId);
      handle = this.createHandle(started);
      this.handles.set(key, handle);
      this.scheduleIdleDispose(key, handle);
    } else if (!handle.busy) {
      this.scheduleIdleDispose(key, handle);
    }
    if (!handle) {
      throw new Error(`Missing session runtime for ${key}`);
    }
    return {
      ...workspace,
      baseUrl: handle.baseUrl,
      directory: entry.runtimeDir,
    };
  }

  async disposeSessionRuntime(workspaceId: string, sessionId: string): Promise<void> {
    const key = makeSessionKey(workspaceId, sessionId);
    const handle = this.handles.get(key);
    if (!handle) return;
    this.handles.delete(key);
    this.clearIdleTimer(handle);
    await handle.dispose();
  }

  markSessionActive(workspaceId: string, sessionId: string): void {
    const handle = this.handles.get(makeSessionKey(workspaceId, sessionId));
    if (!handle) return;
    handle.busy = true;
    this.clearIdleTimer(handle);
  }

  markSessionIdle(workspaceId: string, sessionId: string): void {
    const key = makeSessionKey(workspaceId, sessionId);
    const handle = this.handles.get(key);
    if (!handle) return;
    handle.busy = false;
    this.scheduleIdleDispose(key, handle);
  }

  private createHandle(runtime: StartedSessionRuntime): RunningRuntime {
    return {
      baseUrl: runtime.baseUrl,
      pid: runtime.pid,
      child: {
        pid: runtime.pid ?? undefined,
        kill: () => true,
        on: () => null,
      },
      dispose: runtime.dispose,
      busy: false,
      idleTimer: null,
    };
  }

  private reserveRuntimeSlot(workspace: WorkspaceInfo, reservationId: string): void {
    const activeCount = this.handles.size + this.pendingRuntimeReservations.size;
    if (activeCount >= this.maxRunningRuntimes) {
      this.logger?.log("warn", "Rejected isolated session runtime start because capacity was reached", {
        workspaceId: workspace.id,
        runtimeReservationId: reservationId,
        activeCount,
        maxRunningRuntimes: this.maxRunningRuntimes,
      });
      throw new ApiError(503, "session_runtime_capacity_reached", "当前会话并发已满，请联系管理员。", {
        activeCount,
        maxRunningRuntimes: this.maxRunningRuntimes,
      });
    }
    this.pendingRuntimeReservations.add(reservationId);
  }

  private scheduleIdleDispose(key: string, handle: RunningRuntime): void {
    this.clearIdleTimer(handle);
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs <= 0) return;
    const timer = setTimeout(() => {
      void this.disposeIdleHandle(key, handle);
    }, this.idleTtlMs);
    timer.unref?.();
    handle.idleTimer = timer;
  }

  private clearIdleTimer(handle: RunningRuntime): void {
    if (!handle.idleTimer) return;
    clearTimeout(handle.idleTimer);
    handle.idleTimer = null;
  }

  private async disposeIdleHandle(key: string, handle: RunningRuntime): Promise<void> {
    const current = this.handles.get(key);
    if (current !== handle) return;
    this.handles.delete(key);
    this.clearIdleTimer(handle);
    await handle.dispose().catch(() => undefined);
    this.logger?.log("info", "Disposed isolated session opencode runtime after idle timeout", {
      sessionKey: key,
      idleTtlMs: this.idleTtlMs,
    });
  }
}

function buildIsolatedRuntime(runtimeDir: string, bindHost: string): IsolatedOpencodeRuntime {
  const rootDir = join(runtimeDir, ".openwork-runtime", "opencode");
  return {
    mode: "isolated_process",
    rootDir,
    configDir: join(rootDir, "config"),
    configHomeDir: join(rootDir, "config-home"),
    dataDir: join(rootDir, "data"),
    stateDir: join(rootDir, "state"),
    cacheDir: join(rootDir, "cache"),
    tempDir: join(runtimeDir, ".tmp", "system"),
    bindHost,
  };
}

async function seedIsolatedRuntime(runtime: IsolatedOpencodeRuntime): Promise<void> {
  await ensureDir(runtime.configDir);
  await ensureDir(runtime.configHomeDir);
  await ensureDir(runtime.dataDir);
  await ensureDir(runtime.stateDir);
  await ensureDir(runtime.cacheDir);
  await ensureDir(runtime.tempDir);

  const seededMarker = join(runtime.rootDir, ".seeded");
  if (await exists(seededMarker)) return;

  const hostConfigDir = resolveHostOpencodeConfigDir();
  if (await exists(hostConfigDir)) {
    await cp(hostConfigDir, runtime.configDir, { recursive: true, force: true });
    await sanitizeSeededRuntimeConfigDir(runtime);
  }

  const hostOpencodeDataDir = join(resolveHostXdgDataHome(), "opencode");
  const targetOpencodeDataDir = join(runtime.dataDir, "opencode");
  await ensureDir(targetOpencodeDataDir);
  for (const fileName of ["auth.json", "mcp-auth.json"]) {
    const sourcePath = join(hostOpencodeDataDir, fileName);
    if (await exists(sourcePath)) {
      const contents = await readFile(sourcePath, "utf8");
      await writeFile(join(targetOpencodeDataDir, fileName), contents, "utf8");
    }
  }
  await ensureDir(runtime.rootDir);
  await writeFile(seededMarker, "seeded\n", "utf8");
}

async function sanitizeSeededRuntimeConfigDir(runtime: IsolatedOpencodeRuntime): Promise<void> {
  for (const relativeDir of STRIPPED_RUNTIME_CONFIG_DIRS) {
    await rm(join(runtime.configDir, relativeDir), { recursive: true, force: true }).catch(() => undefined);
  }
  for (const relativeFile of STRIPPED_RUNTIME_CONFIG_FILES) {
    await rm(join(runtime.configDir, relativeFile), { force: true }).catch(() => undefined);
  }
  for (const fileName of ["opencode.json", "opencode.jsonc"]) {
    const configPath = join(runtime.configDir, fileName);
    if (!(await exists(configPath))) continue;
    const { data } = await readJsoncFile<Record<string, unknown>>(configPath, {});
    const stripped = sanitizeRuntimeConfigForSession(data, {
      runtimeDir: runtime.tempDir ? join(runtime.tempDir, "..", "..") : undefined,
    });
    const sanitized = buildSeededRuntimeConfigRecord(stripped);
    await writeJsoncFile(configPath, sanitized);
  }
}

function buildSeededRuntimeConfigRecord(configInput: Record<string, unknown>): Record<string, unknown> {
  const config = configInput && typeof configInput === "object" ? configInput : {};
  const sanitized: Record<string, unknown> = {};
  for (const key of COPIED_RUNTIME_CONFIG_KEYS) {
    if (key in config) sanitized[key] = config[key];
  }
  return sanitized;
}

function buildRuntimeAuthHeaders(workspace: WorkspaceInfo): Record<string, string> | undefined {
  const username = workspace.opencodeUsername?.trim() ?? "";
  const password = workspace.opencodePassword?.trim() ?? "";
  if (!username || !password) return undefined;
  return {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}
