import { afterEach, describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "./types.js";
import { SessionActivityService } from "./session-activity.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createWorkspace(overrides?: Partial<WorkspaceInfo>): WorkspaceInfo {
  return {
    id: "ws_1",
    name: "alice",
    path: "/workspace",
    workspaceType: "local",
    baseUrl: "http://127.0.0.1:33459",
    ...overrides,
  };
}

function encodeSse(payloads: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ payload })}\n\n`));
      }
      controller.close();
    },
  });
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
}

describe("SessionActivityService", () => {
  test("skips shared workspace tracking when disabled", async () => {
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const service = new SessionActivityService(undefined, { disableWorkspaceTracking: true });
    await service.ensureWorkspace(createWorkspace());

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(requestCount).toBe(0);
  });

  test("skips session runtime tracking when disabled", async () => {
    let requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const service = new SessionActivityService(undefined, { disableSessionRuntimeTracking: true });
    await service.ensureSessionRuntime("ws_1", "ses_iso", createWorkspace());

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(requestCount).toBe(0);
  });

  test("tracks an isolated session through its session-owned event stream and ignores unrelated session ids", async () => {
    const requests: Array<{ url: string; directory: string | null }> = [];
    let requestCount = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestCount += 1;
      const headers = new Headers(init?.headers);
      requests.push({
        url: typeof input === "string" ? input : input.toString(),
        directory: headers.get("x-opencode-directory"),
      });
      return new Response(encodeSse([
        {
          type: "session.status",
          properties: { sessionID: "ses_other", status: { type: "busy" } },
        },
        {
          type: "session.status",
          properties: { sessionID: "ses_iso", status: { type: "busy" } },
        },
        {
          type: "session.idle",
          properties: { sessionID: "ses_iso" },
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const service = new SessionActivityService();
    const runtimeWorkspace = createWorkspace({
      baseUrl: "http://127.0.0.1:4555",
      directory: "/workspace/documents/sessions/runtime-iso",
    });

    await service.ensureSessionRuntime("ws_1", "ses_iso", runtimeWorkspace);

    await waitFor(() => requestCount > 0);
    await waitFor(() => service.listActiveSessions().length === 0);

    expect(requests[0]?.url).toBe("http://127.0.0.1:4555/event");
    expect(requests[0]?.directory).toBe("/workspace/documents/sessions/runtime-iso");
    expect(service.listActiveSessions()).toEqual([]);
  });

  test("notifies runtime hooks when a session becomes busy then idle", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async () =>
      new Response(encodeSse([
        {
          type: "session.status",
          properties: { sessionID: "ses_iso", status: { type: "busy" } },
        },
        {
          type: "session.idle",
          properties: { sessionID: "ses_iso" },
        },
      ]), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      })) as unknown as typeof fetch;

    const service = new SessionActivityService(undefined, {
      onSessionBusy: (workspaceId, sessionId) => {
        calls.push(`busy:${workspaceId}:${sessionId}`);
      },
      onSessionIdle: (workspaceId, sessionId) => {
        calls.push(`idle:${workspaceId}:${sessionId}`);
      },
    });

    await service.ensureSessionRuntime("ws_1", "ses_iso", createWorkspace({
      baseUrl: "http://127.0.0.1:4555",
      directory: "/workspace/documents/sessions/runtime-iso",
    }));

    await waitFor(() => calls.includes("idle:ws_1:ses_iso"));

    expect(calls).toContain("busy:ws_1:ses_iso");
    expect(calls).toContain("idle:ws_1:ses_iso");
  });
});
