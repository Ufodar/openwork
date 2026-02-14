import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { openSync } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";

const cwd = process.cwd();
const tmpDir = path.join(cwd, "tmp");
const statePath = path.join(tmpDir, "dev-headless-web.state.json");

const ensureTmp = async () => {
  await mkdir(tmpDir, { recursive: true });
};

type DevHeadlessWebState = {
  schemaVersion: 1;
  updatedAt: number;
  webPid?: number;
  headlessPid?: number;
  openworkPort?: number;
  webPort?: number;
  openworkToken?: string;
  openworkHostToken?: string;
};

const readState = async (): Promise<DevHeadlessWebState | null> => {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<DevHeadlessWebState> | null;
    if (!parsed || parsed.schemaVersion !== 1) return null;
    return parsed as DevHeadlessWebState;
  } catch {
    return null;
  }
};

const writeState = async (state: DevHeadlessWebState) => {
  try {
    await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // ignore
  }
};

const isPortFree = (port: number, host: string) =>
  new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, host, () => {
      server.close(() => resolve(true));
    });
  });

const getFreePort = (host: string) =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Unable to resolve free port")));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });

const resolvePort = async (value: string | undefined, host: string) => {
  if (value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      const free = await isPortFree(parsed, host);
      if (free) return parsed;
    }
  }
  return await getFreePort(host);
};

const logLine = (message: string) => {
  process.stdout.write(`${message}\n`);
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

const waitForPortFree = async (port: number, host: string, timeoutMs: number) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortFree(port, host)) return true;
    await sleep(100);
  }
  return false;
};

const readPidCommand = (pid: number): string | null => {
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (process.platform === "win32") return null;
  try {
    const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8" });
    if (result.status !== 0) return null;
    const value = String(result.stdout || "").trim();
    return value || null;
  } catch {
    return null;
  }
};

const killProcessGroup = (pid: number, signal: NodeJS.Signals) => {
  if (!Number.isFinite(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // ignore
    }
    return;
  }

  try {
    process.kill(-pid, signal);
    return;
  } catch {
    // ignore
  }

  try {
    process.kill(pid, signal);
  } catch {
    // ignore
  }
};

const killProcessTree = (child: ChildProcess, signal: NodeJS.Signals) => {
  if (!child.pid) return;

  if (process.platform === "win32") {
    // Best-effort: kill process + children.
    try {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      // ignore
    }
    return;
  }

  // If spawned detached, pid is also the process group id.
  try {
    process.kill(-child.pid, signal);
    return;
  } catch {
    // ignore
  }

  try {
    child.kill(signal);
  } catch {
    // ignore
  }
};

const readBool = (value: string | undefined) => {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};

const silent = process.argv.includes("--silent");
const cleanupEnabled = process.env.OPENWORK_DEV_HEADLESS_WEB_CLEANUP == null
  ? true
  : readBool(process.env.OPENWORK_DEV_HEADLESS_WEB_CLEANUP);

const autoBuildEnabled = process.env.OPENWORK_DEV_HEADLESS_WEB_AUTOBUILD == null
  ? true
  : readBool(process.env.OPENWORK_DEV_HEADLESS_WEB_AUTOBUILD);

const runCommand = (command: string, args: string[]) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: silent ? "ignore" : "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });

const spawnLogged = (command: string, args: string[], logPath: string, env: NodeJS.ProcessEnv) => {
  const logFd = openSync(logPath, "w");
  return spawn(command, args, {
    cwd,
    env,
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
  });
};

await ensureTmp();

const workspace = process.env.OPENWORK_WORKSPACE ?? cwd;

const previousState = await readState();
let cleanupRequested = false;
if (cleanupEnabled && previousState && (previousState.webPid || previousState.headlessPid)) {
  const candidates: Array<{ pid?: number; label: string; matcher: (cmd: string) => boolean }> = [
    {
      pid: previousState.webPid,
      label: "web",
      matcher: (cmd) => cmd.includes("openwork-ui") && cmd.includes("vite"),
    },
    {
      pid: previousState.headlessPid,
      label: "openwrk",
      matcher: (cmd) => cmd.includes("openwrk") && cmd.includes("start"),
    },
  ];

  let killedAny = false;
  for (const entry of candidates) {
    const pid = entry.pid ?? 0;
    if (!pid) continue;
    const cmd = readPidCommand(pid);
    if (cmd && !entry.matcher(cmd)) continue;
    killedAny = true;
    logLine(`[dev:headless-web] Cleaning up stale ${entry.label} (pid ${pid})`);
    killProcessGroup(pid, "SIGTERM");
  }

  if (killedAny) {
    cleanupRequested = true;
    const timer = setTimeout(() => {
      for (const entry of candidates) {
        const pid = entry.pid ?? 0;
        if (!pid) continue;
        const cmd = readPidCommand(pid);
        if (cmd && !entry.matcher(cmd)) continue;
        killProcessGroup(pid, "SIGKILL");
      }
    }, 1500);
    timer.unref?.();
  }
}

if (cleanupEnabled && !previousState && process.platform !== "win32") {
  try {
    const ps = spawnSync("ps", ["-eo", "pid=,command="], { encoding: "utf8" });
    const lines = String(ps.stdout || "").split("\n");
    const matcher = `--filter openwrk dev -- start --workspace ${workspace}`;
    for (const line of lines) {
      if (!line.includes(matcher)) continue;
      const pid = Number(line.trim().split(/\s+/, 1)[0]);
      if (!Number.isFinite(pid) || pid <= 0) continue;
      logLine(`[dev:headless-web] Cleaning up stale openwrk (pid ${pid})`);
      killProcessGroup(pid, "SIGTERM");
      cleanupRequested = true;
    }
  } catch {
    // ignore
  }
}

const host = process.env.OPENWORK_HOST ?? "0.0.0.0";
const viteHost = process.env.VITE_HOST ?? process.env.HOST ?? host;
const publicHost = process.env.OPENWORK_PUBLIC_HOST ?? null;
const clientHost = publicHost ?? (host === "0.0.0.0" ? "127.0.0.1" : host);
// Resolve ports on the actual bind host to avoid false positives (e.g. a port
// may be free on 127.0.0.1 but already taken on another interface, which would
// make binding to 0.0.0.0 fail with EADDRINUSE).
const desiredOpenworkPortRaw = process.env.OPENWORK_PORT ??
  (previousState?.openworkPort ? String(previousState.openworkPort) : undefined);
const desiredWebPortRaw = process.env.OPENWORK_WEB_PORT ??
  (previousState?.webPort ? String(previousState.webPort) : undefined);
if (cleanupRequested) {
  const desiredOpenworkPort = desiredOpenworkPortRaw ? Number(desiredOpenworkPortRaw) : NaN;
  if (Number.isFinite(desiredOpenworkPort) && desiredOpenworkPort > 0) {
    await waitForPortFree(desiredOpenworkPort, host, 2000);
  }
  const desiredWebPort = desiredWebPortRaw ? Number(desiredWebPortRaw) : NaN;
  if (Number.isFinite(desiredWebPort) && desiredWebPort > 0) {
    await waitForPortFree(desiredWebPort, viteHost, 2000);
  }
}
const openworkPort = await resolvePort(
  desiredOpenworkPortRaw,
  host,
);
const webPort = await resolvePort(
  desiredWebPortRaw,
  viteHost,
);
const openworkToken = process.env.OPENWORK_TOKEN ??
  previousState?.openworkToken ??
  randomUUID();
const openworkHostToken = process.env.OPENWORK_HOST_TOKEN ??
  previousState?.openworkHostToken ??
  randomUUID();
// Default to source entrypoints so dev iteration never requires rebuilding binaries.
// - openwrk can run `.ts` via Bun automatically.
// - For production / binary parity, override via OPENWORK_SERVER_BIN / OWPENBOT_BIN.
const defaultOpenworkServerBin = path.join(cwd, "packages/server/src/cli.ts");
const defaultOwpenbotBin = path.join(cwd, "packages/owpenbot/src/cli.ts");

const resolveBinOverride = (value: string | undefined, fallback: string) => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  return path.isAbsolute(trimmed) ? trimmed : path.join(cwd, trimmed);
};

const openworkServerBin = resolveBinOverride(process.env.OPENWORK_SERVER_BIN, defaultOpenworkServerBin);
const owpenbotBin = resolveBinOverride(process.env.OWPENBOT_BIN, defaultOwpenbotBin);

const resolveLatestMtimeMs = async (dir: string): Promise<number> => {
  let latest = 0;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, await resolveLatestMtimeMs(abs));
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(abs).catch(() => null);
    if (!info) continue;
    latest = Math.max(latest, info.mtimeMs);
  }
  return latest;
};

const ensureOpenworkServer = async () => {
  const isSourceEntrypoint = openworkServerBin.endsWith(".ts") || openworkServerBin.endsWith(".js");
  try {
    await access(openworkServerBin);
  } catch {
    if (!autoBuildEnabled || openworkServerBin !== defaultOpenworkServerBin || isSourceEntrypoint) {
      logLine(`[dev:headless-web] Missing OpenWork server binary at ${openworkServerBin}`);
      logLine("[dev:headless-web] Auto-build disabled (OPENWORK_DEV_HEADLESS_WEB_AUTOBUILD=0)");
      logLine("[dev:headless-web] Run: pnpm --filter openwork-server build:bin");
      if (isSourceEntrypoint) {
        logLine("[dev:headless-web] Or set OPENWORK_SERVER_BIN to a valid entrypoint path.");
      }
      logLine("[dev:headless-web] Or unset/enable OPENWORK_DEV_HEADLESS_WEB_AUTOBUILD to auto-build.");
      process.exit(1);
    }

    logLine(`[dev:headless-web] Missing OpenWork server binary at ${openworkServerBin}`);
    logLine("[dev:headless-web] Auto-building: pnpm --filter openwork-server build:bin");
    try {
      await runCommand("pnpm", ["--filter", "openwork-server", "build:bin"]);
      await access(openworkServerBin);
    } catch (error) {
      logLine(`[dev:headless-web] Auto-build failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }

  if (!autoBuildEnabled) return;
  if (isSourceEntrypoint) return;
  if (openworkServerBin !== defaultOpenworkServerBin) return;

  const [binaryInfo, latestSrcMtime] = await Promise.all([
    stat(openworkServerBin).catch(() => null),
    resolveLatestMtimeMs(path.join(cwd, "packages/server/src")),
  ]);
  if (!binaryInfo) return;
  if (latestSrcMtime <= binaryInfo.mtimeMs) return;

  logLine("[dev:headless-web] Detected openwork-server source changes; rebuilding binary");
  await runCommand("pnpm", ["--filter", "openwork-server", "build:bin"]);
};

const ensureOwpenbot = async () => {
  const isSourceEntrypoint = owpenbotBin.endsWith(".ts") || owpenbotBin.endsWith(".js");
  try {
    await access(owpenbotBin);
  } catch {
    if (!autoBuildEnabled || owpenbotBin !== defaultOwpenbotBin || isSourceEntrypoint) {
      logLine(`[dev:headless-web] Missing owpenbot binary at ${owpenbotBin}`);
      logLine("[dev:headless-web] Auto-build disabled (OPENWORK_DEV_HEADLESS_WEB_AUTOBUILD=0)");
      logLine("[dev:headless-web] Run: pnpm --filter owpenwork build:bin");
      if (isSourceEntrypoint) {
        logLine("[dev:headless-web] Or set OWPENBOT_BIN to a valid entrypoint path.");
      }
      logLine("[dev:headless-web] Or unset/enable OPENWORK_DEV_HEADLESS_WEB_AUTOBUILD to auto-build.");
      process.exit(1);
    }

    logLine(`[dev:headless-web] Missing owpenbot binary at ${owpenbotBin}`);
    logLine("[dev:headless-web] Auto-building: pnpm --filter owpenwork build:bin");
    try {
      await runCommand("pnpm", ["--filter", "owpenwork", "build:bin"]);
      await access(owpenbotBin);
    } catch (error) {
      logLine(`[dev:headless-web] Auto-build failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
};

const openworkUrl = `http://${clientHost}:${openworkPort}`;
const webUrl = `http://${clientHost}:${webPort}`;
// In practice we want owpenbot on for end-to-end messaging tests.
// Allow opt-out via OPENWORK_DEV_OWPENBOT=0.
const owpenbotEnabled = process.env.OPENWORK_DEV_OWPENBOT == null
  ? true
  : readBool(process.env.OPENWORK_DEV_OWPENBOT);
const owpenbotRequired = readBool(process.env.OPENWORK_DEV_OWPENBOT_REQUIRED);
const viteEnv = {
  ...process.env,
  HOST: viteHost,
  PORT: String(webPort),
  VITE_OPENWORK_URL: process.env.VITE_OPENWORK_URL ?? openworkUrl,
  VITE_OPENWORK_PORT: process.env.VITE_OPENWORK_PORT ?? String(openworkPort),
  VITE_OPENWORK_TOKEN: process.env.VITE_OPENWORK_TOKEN ?? openworkToken,
};
const headlessEnv = {
  ...process.env,
  OPENWORK_WORKSPACE: workspace,
  OPENWORK_HOST: host,
  OPENWORK_PORT: String(openworkPort),
  OPENWORK_TOKEN: openworkToken,
  OPENWORK_HOST_TOKEN: openworkHostToken,
  OPENWORK_SERVER_BIN: openworkServerBin,
  OPENWRK_SIDECAR_SOURCE: process.env.OPENWRK_SIDECAR_SOURCE ?? "external",
  OWPENBOT_BIN: owpenbotBin,
};

await ensureOpenworkServer();
if (owpenbotEnabled) {
  await ensureOwpenbot();
}

logLine("[dev:headless-web] Starting services");
logLine(`[dev:headless-web] Workspace: ${workspace}`);
logLine(`[dev:headless-web] OpenWork server: ${openworkUrl}`);
logLine(`[dev:headless-web] Web host: ${viteHost}`);
logLine(`[dev:headless-web] Web port: ${webPort}`);
logLine(`[dev:headless-web] Web URL: ${webUrl}`);
logLine(
  `[dev:headless-web] Owpenbot: ${owpenbotEnabled ? "on" : "off"} (set OPENWORK_DEV_OWPENBOT=0 to disable)`,
);
logLine(`[dev:headless-web] OPENWORK_TOKEN: ${openworkToken}`);
logLine(`[dev:headless-web] OPENWORK_HOST_TOKEN: ${openworkHostToken}`);
logLine(`[dev:headless-web] Web logs: ${path.relative(cwd, path.join(tmpDir, "dev-web.log"))}`);
logLine(`[dev:headless-web] Headless logs: ${path.relative(cwd, path.join(tmpDir, "dev-headless.log"))}`);

const webProcess = spawnLogged(
  "pnpm",
  [
    "--filter",
    "@different-ai/openwork-ui",
    "exec",
    "vite",
    "--host",
    viteHost,
    "--port",
    String(webPort),
    "--strictPort",
  ],
  path.join(tmpDir, "dev-web.log"),
  viteEnv,
);

const headlessProcess = spawnLogged(
  "pnpm",
  [
    "--filter",
    "openwrk",
    "dev",
    "--",
    "start",
    "--workspace",
    workspace,
    "--approval",
    "auto",
    "--allow-external",
    "--no-opencode-auth",
    "--owpenbot",
    owpenbotEnabled ? "true" : "false",
    ...(owpenbotRequired ? ["--owpenbot-required"] : []),
    "--openwork-host",
    host,
    "--openwork-port",
    String(openworkPort),
    "--openwork-token",
    openworkToken,
    "--openwork-host-token",
    openworkHostToken,
  ],
  path.join(tmpDir, "dev-headless.log"),
  headlessEnv,
);

let stopping = false;
let requestedExitCode: number | null = null;

const stopAll = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;

  killProcessTree(webProcess, signal);
  killProcessTree(headlessProcess, signal);

  if (signal !== "SIGKILL") {
    const timer = setTimeout(() => {
      killProcessTree(webProcess, "SIGKILL");
      killProcessTree(headlessProcess, "SIGKILL");
    }, 1500);
    timer.unref?.();
  }
};

const shutdown = (label: string, code: number | null, signal: NodeJS.Signals | null) => {
  const reason = code !== null ? `code ${code}` : signal ? `signal ${signal}` : "unknown";
  logLine(`[dev:headless-web] ${label} exited (${reason})`);

  if (!stopping) {
    requestedExitCode = code ?? 1;
    stopAll("SIGTERM");
  }

  const exitCode = requestedExitCode ?? code ?? 1;
  process.exit(exitCode);
};

process.on("SIGINT", () => {
  requestedExitCode = 0;
  stopAll("SIGINT");
});
process.on("SIGTERM", () => {
  requestedExitCode = 0;
  stopAll("SIGTERM");
});

webProcess.on("exit", (code, signal) => shutdown("web", code, signal));
headlessProcess.on("exit", (code, signal) => shutdown("openwrk", code, signal));

await writeState({
  schemaVersion: 1,
  updatedAt: Date.now(),
  webPid: webProcess.pid ?? undefined,
  headlessPid: headlessProcess.pid ?? undefined,
  openworkPort,
  webPort,
  openworkToken,
  openworkHostToken,
});
