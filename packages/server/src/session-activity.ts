import type { WorkspaceInfo } from "./types.js";

type ActiveSessionRecord = {
  workspaceId: string;
  sessionId: string;
  startedAt: number;
  lastEventAt: number;
};

type ServerLogger = {
  log: (level: "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => void;
};

type SubscriptionRecord = {
  fingerprint: string;
  controller: AbortController;
};

type SubscriptionTarget = {
  key: string;
  workspaceId: string;
  workspace: WorkspaceInfo;
  expectedSessionId?: string;
};

const MIN_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

function isTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export class SessionActivityService {
  private activeByWorkspace = new Map<string, Map<string, ActiveSessionRecord>>();
  private subscriptions = new Map<string, SubscriptionRecord>();
  private readonly disableWorkspaceTracking: boolean;
  private readonly disableSessionRuntimeTracking: boolean;
  private readonly onSessionBusy?: (workspaceId: string, sessionId: string) => void;
  private readonly onSessionIdle?: (workspaceId: string, sessionId: string) => void;

  constructor(
    private readonly logger?: ServerLogger,
    options?: {
      disableWorkspaceTracking?: boolean;
      disableSessionRuntimeTracking?: boolean;
      onSessionBusy?: (workspaceId: string, sessionId: string) => void;
      onSessionIdle?: (workspaceId: string, sessionId: string) => void;
    },
  ) {
    this.disableWorkspaceTracking = options?.disableWorkspaceTracking ?? isTruthy(process.env.OPENWORK_DISABLE_SHARED_WORKSPACE_EVENT_TRACKING);
    this.disableSessionRuntimeTracking = options?.disableSessionRuntimeTracking ?? isTruthy(process.env.OPENWORK_DISABLE_SESSION_RUNTIME_EVENT_TRACKING);
    this.onSessionBusy = options?.onSessionBusy;
    this.onSessionIdle = options?.onSessionIdle;
  }

  async ensureWorkspace(workspace: WorkspaceInfo): Promise<void> {
    if (this.disableWorkspaceTracking) return;
    const baseUrl = workspace.baseUrl?.trim() ?? "";
    if (!workspace.id?.trim() || !baseUrl) return;
    await this.ensureTarget({
      key: buildWorkspaceTargetKey(workspace.id),
      workspaceId: workspace.id,
      workspace,
    });
  }

  async ensureSessionRuntime(workspaceId: string, sessionId: string, workspace: WorkspaceInfo): Promise<void> {
    if (this.disableSessionRuntimeTracking) return;
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    const baseUrl = workspace.baseUrl?.trim() ?? "";
    if (!ws || !sid || !baseUrl) return;
    await this.ensureTarget({
      key: buildSessionTargetKey(ws, sid),
      workspaceId: ws,
      workspace,
      expectedSessionId: sid,
    });
  }

  private async ensureTarget(target: SubscriptionTarget): Promise<void> {
    const fingerprint = buildWorkspaceFingerprint(target.workspace, target.expectedSessionId);
    const existing = this.subscriptions.get(target.key);
    if (existing && existing.fingerprint === fingerprint && !existing.controller.signal.aborted) {
      return;
    }
    existing?.controller.abort();

    const controller = new AbortController();
    this.subscriptions.set(target.key, { fingerprint, controller });
    void this.runWorkspaceLoop(target, controller).finally(() => {
      const latest = this.subscriptions.get(target.key);
      if (latest?.controller === controller) {
        this.subscriptions.delete(target.key);
      }
    });
  }

  notePromptStart(workspaceId: string, sessionId: string): void {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const now = Date.now();
    const sessions = ensureWorkspaceMap(this.activeByWorkspace, ws);
    const existing = sessions.get(sid);
    sessions.set(sid, {
      workspaceId: ws,
      sessionId: sid,
      startedAt: existing?.startedAt ?? now,
      lastEventAt: now,
    });
    this.onSessionBusy?.(ws, sid);
  }

  noteSessionBusy(workspaceId: string, sessionId: string): void {
    this.notePromptStart(workspaceId, sessionId);
  }

  noteSessionIdle(workspaceId: string, sessionId: string): void {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const sessions = this.activeByWorkspace.get(ws);
    if (sessions) {
      sessions.delete(sid);
      if (sessions.size === 0) {
        this.activeByWorkspace.delete(ws);
      }
    }
    this.stopSessionSubscription(ws, sid);
    this.onSessionIdle?.(ws, sid);
  }

  removeSession(workspaceId: string, sessionId: string): void {
    this.noteSessionIdle(workspaceId, sessionId);
  }

  listActiveSessions(): ActiveSessionRecord[] {
    return Array.from(this.activeByWorkspace.values())
      .flatMap((sessions) => Array.from(sessions.values()))
      .sort((left, right) => left.startedAt - right.startedAt);
  }

  countActiveSessions(): number {
    return this.listActiveSessions().length;
  }

  private async runWorkspaceLoop(target: SubscriptionTarget, controller: AbortController): Promise<void> {
    let delayMs = MIN_RECONNECT_DELAY_MS;
    while (!controller.signal.aborted) {
      try {
        await this.consumeWorkspaceEvents(target, controller.signal);
        delayMs = MIN_RECONNECT_DELAY_MS;
      } catch (error) {
        if (controller.signal.aborted) return;
        this.logger?.log("warn", "OpenCode event tracking disconnected; retrying", {
          workspaceId: target.workspaceId,
          sessionId: target.expectedSessionId ?? null,
          subscriptionKey: target.key,
          baseUrl: target.workspace.baseUrl ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
        await wait(delayMs, controller.signal).catch(() => undefined);
        delayMs = Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS);
      }
    }
  }

  private async consumeWorkspaceEvents(target: SubscriptionTarget, signal: AbortSignal): Promise<void> {
    const workspace = target.workspace;
    const baseUrl = workspace.baseUrl?.trim() ?? "";
    if (!baseUrl) return;
    const targetUrl = new URL(baseUrl);
    targetUrl.pathname = "/event";
    targetUrl.search = "";

    const headers = new Headers();
    const directory = resolveOpencodeDirectory(workspace);
    if (directory) {
      headers.set("x-opencode-directory", directory);
    }
    const auth = buildOpencodeAuthHeader(workspace);
    if (auth) {
      headers.set("Authorization", auth);
    }

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers,
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`event stream failed with ${response.status}`);
    }

    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";

    try {
      while (!signal.aborted) {
        const next = await reader.read();
        if (next.done) {
          throw new Error("event stream closed");
        }
        buffer += next.value;
        buffer = buffer.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const payload = parseSsePayload(chunk);
          if (!payload) continue;
          this.handlePayload(target, payload);
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  private handlePayload(target: SubscriptionTarget, payload: Record<string, unknown>) {
    const type = typeof payload.type === "string" ? payload.type : "";
    const props = payload.properties && typeof payload.properties === "object"
      ? (payload.properties as Record<string, unknown>)
      : null;
    const sessionId = typeof props?.sessionID === "string" ? props.sessionID.trim() : "";
    if (!sessionId) return;
    if (target.expectedSessionId && sessionId !== target.expectedSessionId) return;

    if (type === "session.status") {
      const status = props?.status && typeof props.status === "object"
        ? (props.status as Record<string, unknown>)
        : null;
      const statusType = typeof status?.type === "string" ? status.type : "";
      if (statusType === "busy" || statusType === "retry") {
        this.noteSessionBusy(target.workspaceId, sessionId);
      }
      if (statusType === "idle") {
        this.noteSessionIdle(target.workspaceId, sessionId);
      }
      return;
    }

    if (type === "session.idle" || type === "session.error") {
      this.noteSessionIdle(target.workspaceId, sessionId);
    }
  }

  private stopSessionSubscription(workspaceId: string, sessionId: string): void {
    const key = buildSessionTargetKey(workspaceId, sessionId);
    const existing = this.subscriptions.get(key);
    if (!existing) return;
    existing.controller.abort();
    this.subscriptions.delete(key);
  }
}

function ensureWorkspaceMap(
  store: Map<string, Map<string, ActiveSessionRecord>>,
  workspaceId: string,
): Map<string, ActiveSessionRecord> {
  let value = store.get(workspaceId);
  if (!value) {
    value = new Map();
    store.set(workspaceId, value);
  }
  return value;
}

function parseSsePayload(chunk: string): Record<string, unknown> | null {
  const lines = chunk.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const rest = line.slice(5);
    dataLines.push(rest.startsWith(" ") ? rest.slice(1) : rest);
  }
  if (dataLines.length === 0) return null;
  try {
    const parsed = JSON.parse(dataLines.join("\n")) as Record<string, unknown>;
    const payload = parsed.payload && typeof parsed.payload === "object"
      ? (parsed.payload as Record<string, unknown>)
      : parsed;
    return payload;
  } catch {
    return null;
  }
}

function resolveOpencodeDirectory(workspace: WorkspaceInfo): string | null {
  const explicit = workspace.directory?.trim() ?? "";
  if (explicit) return explicit;
  if (workspace.workspaceType === "local") return workspace.path;
  return null;
}

function buildOpencodeAuthHeader(workspace: WorkspaceInfo): string | null {
  const username = workspace.opencodeUsername?.trim() ?? "";
  const password = workspace.opencodePassword?.trim() ?? "";
  if (!username || !password) return null;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function buildWorkspaceTargetKey(workspaceId: string): string {
  return `workspace::${workspaceId.trim()}`;
}

function buildSessionTargetKey(workspaceId: string, sessionId: string): string {
  return `session::${workspaceId.trim()}::${sessionId.trim()}`;
}

function buildWorkspaceFingerprint(workspace: WorkspaceInfo, expectedSessionId?: string): string {
  return [
    workspace.id,
    workspace.baseUrl?.trim() ?? "",
    workspace.path?.trim() ?? "",
    workspace.directory?.trim() ?? "",
    workspace.opencodeUsername?.trim() ?? "",
    workspace.opencodePassword?.trim() ?? "",
    expectedSessionId?.trim() ?? "",
  ].join("::");
}

async function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new Error("aborted");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}
