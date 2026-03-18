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

const MIN_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 5_000;

export class SessionActivityService {
  private activeByWorkspace = new Map<string, Map<string, ActiveSessionRecord>>();
  private subscriptions = new Map<string, SubscriptionRecord>();

  constructor(private readonly logger?: ServerLogger) {}

  async ensureWorkspace(workspace: WorkspaceInfo): Promise<void> {
    const baseUrl = workspace.baseUrl?.trim() ?? "";
    if (!workspace.id?.trim() || !baseUrl) return;
    const fingerprint = buildWorkspaceFingerprint(workspace);
    const existing = this.subscriptions.get(workspace.id);
    if (existing && existing.fingerprint === fingerprint && !existing.controller.signal.aborted) {
      return;
    }
    existing?.controller.abort();

    const controller = new AbortController();
    this.subscriptions.set(workspace.id, { fingerprint, controller });
    void this.runWorkspaceLoop(workspace, controller).finally(() => {
      const latest = this.subscriptions.get(workspace.id);
      if (latest?.controller === controller) {
        this.subscriptions.delete(workspace.id);
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
  }

  noteSessionBusy(workspaceId: string, sessionId: string): void {
    this.notePromptStart(workspaceId, sessionId);
  }

  noteSessionIdle(workspaceId: string, sessionId: string): void {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const sessions = this.activeByWorkspace.get(ws);
    if (!sessions) return;
    sessions.delete(sid);
    if (sessions.size === 0) {
      this.activeByWorkspace.delete(ws);
    }
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

  private async runWorkspaceLoop(workspace: WorkspaceInfo, controller: AbortController): Promise<void> {
    let delayMs = MIN_RECONNECT_DELAY_MS;
    while (!controller.signal.aborted) {
      try {
        await this.consumeWorkspaceEvents(workspace, controller.signal);
        delayMs = MIN_RECONNECT_DELAY_MS;
      } catch (error) {
        if (controller.signal.aborted) return;
        this.logger?.log("warn", "OpenCode event tracking disconnected; retrying", {
          workspaceId: workspace.id,
          error: error instanceof Error ? error.message : String(error),
        });
        await wait(delayMs, controller.signal).catch(() => undefined);
        delayMs = Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS);
      }
    }
  }

  private async consumeWorkspaceEvents(workspace: WorkspaceInfo, signal: AbortSignal): Promise<void> {
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
          this.handlePayload(workspace.id, payload);
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

  private handlePayload(workspaceId: string, payload: Record<string, unknown>) {
    const type = typeof payload.type === "string" ? payload.type : "";
    const props = payload.properties && typeof payload.properties === "object"
      ? (payload.properties as Record<string, unknown>)
      : null;
    const sessionId = typeof props?.sessionID === "string" ? props.sessionID.trim() : "";
    if (!sessionId) return;

    if (type === "session.status") {
      const status = props?.status && typeof props.status === "object"
        ? (props.status as Record<string, unknown>)
        : null;
      const statusType = typeof status?.type === "string" ? status.type : "";
      if (statusType === "busy" || statusType === "retry") {
        this.noteSessionBusy(workspaceId, sessionId);
      }
      if (statusType === "idle") {
        this.noteSessionIdle(workspaceId, sessionId);
      }
      return;
    }

    if (type === "session.idle" || type === "session.error") {
      this.noteSessionIdle(workspaceId, sessionId);
    }
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

function buildWorkspaceFingerprint(workspace: WorkspaceInfo): string {
  return [
    workspace.id,
    workspace.baseUrl?.trim() ?? "",
    workspace.path?.trim() ?? "",
    workspace.directory?.trim() ?? "",
    workspace.opencodeUsername?.trim() ?? "",
    workspace.opencodePassword?.trim() ?? "",
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
