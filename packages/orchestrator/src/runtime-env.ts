import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type RuntimeEnvOptions = {
  runtimeEnvDir?: string;
  baseEnv?: NodeJS.ProcessEnv;
};

type OpenworkServerRuntimeEnvOptions = RuntimeEnvOptions & {
  openworkToken: string;
  openworkHostToken: string;
  runId: string;
  logFormat: string;
  opencodeBaseUrl?: string;
  opencodeDirectory?: string;
  opencodeUsername?: string;
  opencodePassword?: string;
  opencodeRouterHealthPort?: number;
  opencodeRouterDataDir?: string;
  opencodeBin?: string;
};

function stripQuotes(value: string) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseEnvFile(text: string) {
  const parsed: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const eq = normalized.indexOf("=");
    if (eq <= 0) continue;
    const key = normalized.slice(0, eq).trim();
    if (!key) continue;
    const value = stripQuotes(normalized.slice(eq + 1).trim());
    parsed[key] = value;
  }
  return parsed;
}

export function loadOpenworkRuntimeEnv(options: RuntimeEnvOptions = {}) {
  const baseEnv = { ...process.env, ...(options.baseEnv ?? {}) };
  const runtimeEnvDir = options.runtimeEnvDir?.trim() || join(homedir(), ".config", "openwork");
  const fileDefaults: Record<string, string> = {};

  for (const name of ["generated-secrets.env", "secrets.env"]) {
    const path = join(runtimeEnvDir, name);
    if (!existsSync(path)) continue;
    Object.assign(fileDefaults, parseEnvFile(readFileSync(path, "utf8")));
  }

  return {
    ...fileDefaults,
    ...baseEnv,
  };
}

export function buildOpenworkServerRuntimeEnv(options: OpenworkServerRuntimeEnvOptions) {
  const env = loadOpenworkRuntimeEnv({
    runtimeEnvDir: options.runtimeEnvDir,
    baseEnv: options.baseEnv,
  });
  const opencodeBin = options.opencodeBin?.trim();

  return {
    ...env,
    OPENWORK_TOKEN: options.openworkToken,
    OPENWORK_HOST_TOKEN: options.openworkHostToken,
    OPENWORK_RUN_ID: options.runId,
    OPENWORK_LOG_FORMAT: options.logFormat,
    ...(options.opencodeRouterHealthPort ? { OPENCODE_ROUTER_HEALTH_PORT: String(options.opencodeRouterHealthPort) } : {}),
    ...(options.opencodeRouterDataDir ? { OPENCODE_ROUTER_DATA_DIR: options.opencodeRouterDataDir } : {}),
    ...(options.opencodeBaseUrl ? { OPENWORK_OPENCODE_BASE_URL: options.opencodeBaseUrl } : {}),
    ...(options.opencodeDirectory ? { OPENWORK_OPENCODE_DIRECTORY: options.opencodeDirectory } : {}),
    ...(options.opencodeUsername ? { OPENWORK_OPENCODE_USERNAME: options.opencodeUsername } : {}),
    ...(options.opencodePassword ? { OPENWORK_OPENCODE_PASSWORD: options.opencodePassword } : {}),
    ...(opencodeBin ? { OPENWORK_OPENCODE_BIN: opencodeBin } : {}),
  };
}
