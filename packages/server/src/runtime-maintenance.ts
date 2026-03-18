export type RuntimeMaintenanceMode = "idle" | "draining" | "restarting";

export type RuntimeMaintenanceState = {
  mode: RuntimeMaintenanceMode;
  requestedAt: number | null;
  reason: string | null;
  force: boolean;
};

const IDLE_STATE: RuntimeMaintenanceState = {
  mode: "idle",
  requestedAt: null,
  reason: null,
  force: false,
};

export class RuntimeMaintenanceService {
  private state: RuntimeMaintenanceState = { ...IDLE_STATE };

  getState(): RuntimeMaintenanceState {
    return { ...this.state };
  }

  enterDraining(reason?: string | null): RuntimeMaintenanceState {
    this.state = {
      mode: "draining",
      requestedAt: Date.now(),
      reason: normalizeReason(reason),
      force: false,
    };
    return this.getState();
  }

  enterRestarting(reason?: string | null, force = false): RuntimeMaintenanceState {
    this.state = {
      mode: "restarting",
      requestedAt: Date.now(),
      reason: normalizeReason(reason),
      force,
    };
    return this.getState();
  }

  clear(): RuntimeMaintenanceState {
    this.state = { ...IDLE_STATE };
    return this.getState();
  }
}

export function isRuntimeMaintenanceBlockingNewWork(
  state: RuntimeMaintenanceState,
  method: string,
  proxyPath: string,
): boolean {
  if (state.mode !== "draining" && state.mode !== "restarting") return false;
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") return false;
  const normalizedPath = normalizeProxyPath(proxyPath);
  if (normalizedMethod === "POST" && normalizedPath === "/session") {
    return true;
  }
  if (
    normalizedMethod === "POST" &&
    /^\/session\/[^/]+\/(prompt|prompt_async|command|shell)$/.test(normalizedPath)
  ) {
    return true;
  }
  return false;
}

function normalizeReason(reason?: string | null): string | null {
  const normalized = reason?.trim() ?? "";
  return normalized || null;
}

function normalizeProxyPath(proxyPath: string): string {
  const raw = (proxyPath ?? "").trim() || "/";
  const withoutPrefix = raw.startsWith("/opencode") ? raw.slice("/opencode".length) : raw;
  const normalized = (withoutPrefix || "/").replace(/\/+$/, "");
  return normalized || "/";
}
