import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceInfo } from "./types.js";
import { SessionOpencodeRuntimeService } from "./session-opencode-runtime.js";
import { exists } from "./utils.js";

const originalOpencodeConfigDir = process.env.OPENCODE_CONFIG_DIR;
const originalXdgDataHome = process.env.XDG_DATA_HOME;
const originalXdgStateHome = process.env.XDG_STATE_HOME;
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
const originalSessionRuntimeIdleTtlMs = process.env.OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS;
const originalMaxActiveSessionRuntimes = process.env.OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES;

describe("SessionOpencodeRuntimeService", () => {
  let workspacePath = "";
  let workspace: WorkspaceInfo;

  beforeEach(async () => {
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-runtime-workspace-"));
    workspace = {
      id: "ws_1",
      name: "alice",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
      opencodeUsername: "user",
      opencodePassword: "pass",
    };
  });

  afterEach(() => {
    if (typeof originalOpencodeConfigDir === "string") process.env.OPENCODE_CONFIG_DIR = originalOpencodeConfigDir;
    else delete process.env.OPENCODE_CONFIG_DIR;
    if (typeof originalXdgDataHome === "string") process.env.XDG_DATA_HOME = originalXdgDataHome;
    else delete process.env.XDG_DATA_HOME;
    if (typeof originalXdgStateHome === "string") process.env.XDG_STATE_HOME = originalXdgStateHome;
    else delete process.env.XDG_STATE_HOME;
    if (typeof originalXdgCacheHome === "string") process.env.XDG_CACHE_HOME = originalXdgCacheHome;
    else delete process.env.XDG_CACHE_HOME;
    if (typeof originalSessionRuntimeIdleTtlMs === "string") process.env.OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS = originalSessionRuntimeIdleTtlMs;
    else delete process.env.OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS;
    if (typeof originalMaxActiveSessionRuntimes === "string") process.env.OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES = originalMaxActiveSessionRuntimes;
    else delete process.env.OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES;
  });

  test("provisions isolated config and XDG roots seeded from the host defaults", async () => {
    const hostConfigDir = await mkdtemp(join(tmpdir(), "openwork-session-runtime-host-config-"));
    const hostDataHome = await mkdtemp(join(tmpdir(), "openwork-session-runtime-host-data-"));
    await mkdir(join(hostConfigDir, "plugins"), { recursive: true });
    await writeFile(
      join(hostConfigDir, "opencode.json"),
      JSON.stringify({
        model: "host-model",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/Users/storm/Documents/code"],
          },
          memory: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          },
        },
      }),
      "utf8",
    );
    await writeFile(join(hostConfigDir, "plugins", "sample.js"), "export default {}", "utf8");
    await mkdir(join(hostDataHome, "opencode"), { recursive: true });
    await writeFile(join(hostDataHome, "opencode", "auth.json"), "{\"ok\":true}", "utf8");
    await writeFile(join(hostDataHome, "opencode", "mcp-auth.json"), "{\"mcp\":true}", "utf8");
    process.env.OPENCODE_CONFIG_DIR = hostConfigDir;
    process.env.XDG_DATA_HOME = hostDataHome;

    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });

    const service = new SessionOpencodeRuntimeService({ enabled: true });
    const entry = await service.provisionSessionRuntime(workspace, {
      runtimeId: "runtime-1",
      runtimeDir,
      createdAt: 1,
    });

    expect(entry.opencodeRuntime?.mode).toBe("isolated_process");
    expect(entry.opencodeRuntime?.rootDir.startsWith(runtimeDir)).toBe(true);
    expect(entry.opencodeRuntime?.configHomeDir.startsWith(runtimeDir)).toBe(true);
    expect(await exists(join(entry.opencodeRuntime?.configDir ?? "", "opencode.json"))).toBe(true);
    expect(await exists(join(entry.opencodeRuntime?.configDir ?? "", "plugins", "sample.js"))).toBe(true);
    expect(await exists(join(entry.opencodeRuntime?.dataDir ?? "", "opencode", "auth.json"))).toBe(true);
    expect(await exists(join(entry.opencodeRuntime?.dataDir ?? "", "opencode", "mcp-auth.json"))).toBe(true);
    expect(await exists(entry.opencodeRuntime?.tempDir ?? "")).toBe(true);
    const configRaw = await readFile(join(entry.opencodeRuntime?.configDir ?? "", "opencode.json"), "utf8");
    expect(configRaw).toContain("host-model");
    const config = JSON.parse(configRaw) as {
      mcp?: Record<string, unknown>;
    };
    expect(config.mcp?.filesystem).toBeUndefined();
    expect(config.mcp?.memory).toMatchObject({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
    });
  });

  test("spawns opencode serve with session-scoped env and resolves a dedicated runtime workspace", async () => {
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-2");
    await mkdir(runtimeDir, { recursive: true });

    const captured: {
      command?: string;
      args?: string[];
      cwd?: string;
      env?: Record<string, string | undefined>;
      healthUrl?: string;
    } = {};

    const service = new SessionOpencodeRuntimeService({
      enabled: true,
      opencodeBin: "/custom/opencode",
      findFreePort: async () => 4123,
      waitForHealthy: async (url) => {
        captured.healthUrl = String(url);
      },
      spawnProcess: (command, args, options) => {
        captured.command = command;
        captured.args = [...args];
        captured.cwd = options.cwd ? String(options.cwd) : undefined;
        captured.env = options.env as Record<string, string | undefined>;
        return {
          pid: 999,
          kill: () => true,
          on: () => undefined,
        } as any;
      },
    });

    const entry = await service.provisionSessionRuntime(workspace, {
      runtimeId: "runtime-2",
      runtimeDir,
      createdAt: 2,
    });

    const started = await service.startProvisionedRuntime(workspace, entry);
    service.registerSessionRuntime(workspace.id, "ses_1", started);
    const runtimeWorkspace = await service.resolveSessionWorkspace(workspace, workspace.id, "ses_1", entry);

    expect(captured.command).toBe("/custom/opencode");
    expect(captured.args).toEqual(["serve", "--hostname", "127.0.0.1", "--port", "4123"]);
    expect(captured.cwd).toBe(runtimeDir);
    expect(captured.env?.OPENCODE_CONFIG_DIR).toBe(entry.opencodeRuntime?.configDir);
    expect(captured.env?.XDG_CONFIG_HOME).toBe(entry.opencodeRuntime?.configHomeDir);
    expect(captured.env?.XDG_DATA_HOME).toBe(entry.opencodeRuntime?.dataDir);
    expect(captured.env?.XDG_STATE_HOME).toBe(entry.opencodeRuntime?.stateDir);
    expect(captured.env?.XDG_CACHE_HOME).toBe(entry.opencodeRuntime?.cacheDir);
    expect(captured.env?.TMPDIR).toBe(entry.opencodeRuntime?.tempDir);
    expect(captured.env?.TMP).toBe(entry.opencodeRuntime?.tempDir);
    expect(captured.env?.TEMP).toBe(entry.opencodeRuntime?.tempDir);
    expect(captured.env?.OPENCODE_SERVER_USERNAME).toBe("user");
    expect(captured.env?.OPENCODE_SERVER_PASSWORD).toBe("pass");
    expect(captured.healthUrl).toBe("http://127.0.0.1:4123");
    expect(runtimeWorkspace.baseUrl).toBe("http://127.0.0.1:4123");
    expect(runtimeWorkspace.directory).toBe(runtimeDir);
  });

  test("peekSessionWorkspace does not start a runtime and only returns running isolated workspaces", async () => {
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-3");
    await mkdir(runtimeDir, { recursive: true });

    const service = new SessionOpencodeRuntimeService({
      enabled: true,
      spawnProcess: () => {
        throw new Error("should not spawn");
      },
    });

    const entry = await service.provisionSessionRuntime(workspace, {
      runtimeId: "runtime-3",
      runtimeDir,
      createdAt: 3,
    });

    expect(service.peekSessionWorkspace(workspace, workspace.id, "ses_peek", entry)).toBeNull();

    service.registerSessionRuntime(workspace.id, "ses_peek", {
      baseUrl: "http://127.0.0.1:4777",
      pid: 4777,
      dispose: async () => undefined,
    });

    expect(service.peekSessionWorkspace(workspace, workspace.id, "ses_peek", entry)).toMatchObject({
      baseUrl: "http://127.0.0.1:4777",
      directory: runtimeDir,
    });
  });

  test("rejects starting a new isolated runtime when the active runtime cap is reached", async () => {
    process.env.OPENWORK_MAX_ACTIVE_SESSION_RUNTIMES = "1";

    const runtimeDirA = join(workspacePath, "documents", "sessions", "runtime-cap-a");
    const runtimeDirB = join(workspacePath, "documents", "sessions", "runtime-cap-b");
    await mkdir(runtimeDirA, { recursive: true });
    await mkdir(runtimeDirB, { recursive: true });

    const service = new SessionOpencodeRuntimeService({
      enabled: true,
      findFreePort: async () => 4555,
      waitForHealthy: async () => undefined,
      spawnProcess: () => ({
        pid: 111,
        kill: () => true,
        on: () => undefined,
      }) as any,
    });

    const entryA = await service.provisionSessionRuntime(workspace, {
      runtimeId: "runtime-cap-a",
      runtimeDir: runtimeDirA,
      createdAt: 1,
    });
    const entryB = await service.provisionSessionRuntime(workspace, {
      runtimeId: "runtime-cap-b",
      runtimeDir: runtimeDirB,
      createdAt: 2,
    });

    const startedA = await service.startProvisionedRuntime(workspace, entryA);
    service.registerSessionRuntime(workspace.id, "ses_cap_a", startedA);

    await expect(service.startProvisionedRuntime(workspace, entryB)).rejects.toMatchObject({
      status: 503,
      code: "session_runtime_capacity_reached",
    });
  });

  test("auto-disposes an idle runtime after the configured ttl", async () => {
    process.env.OPENWORK_SESSION_RUNTIME_IDLE_TTL_MS = "25";

    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-idle");
    await mkdir(runtimeDir, { recursive: true });

    let killCount = 0;
    const service = new SessionOpencodeRuntimeService({
      enabled: true,
      findFreePort: async () => 4666,
      waitForHealthy: async () => undefined,
      spawnProcess: () => {
        let killed = false;
        return {
          pid: 222,
          get killed() {
            return killed;
          },
          get exitCode() {
            return killed ? 0 : null;
          },
          kill: () => {
            killCount += 1;
            killed = true;
            return true;
          },
          on: () => undefined,
        } as any;
      },
    });

    const entry = await service.provisionSessionRuntime(workspace, {
      runtimeId: "runtime-idle",
      runtimeDir,
      createdAt: 3,
    });

    const started = await service.startProvisionedRuntime(workspace, entry);
    service.registerSessionRuntime(workspace.id, "ses_idle", started);
    service.markSessionIdle(workspace.id, "ses_idle");

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(killCount).toBeGreaterThan(0);
    expect(service.peekSessionWorkspace(workspace, workspace.id, "ses_idle", entry)).toBeNull();
  });
});
