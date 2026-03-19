import { afterEach, describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ApiError } from "./errors.js";
import type { WorkspaceInfo } from "./types.js";
import { proxyOpencodeRequest } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createWorkspace(): WorkspaceInfo {
  const root = join(tmpdir(), "openwork-server-runtime-control-test");
  return {
    id: "ws_shared",
    name: "shared",
    path: root,
    workspaceType: "local",
    baseUrl: "http://127.0.0.1:33459",
  };
}

function createServices() {
  const root = join(tmpdir(), "openwork-server-runtime-control-test");
  return {
    sessionOwnership: {
      listEntries: async () => ({
        ses_123: { ownerKey: "host-owner", updatedAt: 1 },
      }),
      getOwner: async () => "host-owner",
      setOwner: async () => undefined,
    } as unknown as SessionOwnershipService,
    sessionWorkspaces: {
      getWorkspace: async () => ({
        runtimeId: "ses_123",
        runtimeDir: join(root, "documents", "sessions", "ses_123"),
        createdAt: 1,
      }),
      setWorkspace: async () => undefined,
    } as unknown as SessionWorkspaceService,
  };
}

describe("proxyOpencodeRequest runtime maintenance", () => {
  test("rejects new session creation while the worker is draining", async () => {
    let upstreamCalled = false;
    globalThis.fetch = (async () => {
      upstreamCalled = true;
      return new Response(JSON.stringify({ id: "ses_new" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { sessionOwnership, sessionWorkspaces } = createServices();

    const response = proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_shared/opencode/session", {
        method: "POST",
        body: JSON.stringify({ title: "New Session" }),
      }),
      url: new URL("http://openwork.local/w/ws_shared/opencode/session"),
      workspace: createWorkspace(),
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
      runtimeMaintenance: {
        getState: () => ({ mode: "draining", requestedAt: 1, reason: "safe restart" }),
      },
    } as any);

    await expect(response).rejects.toMatchObject({
      status: 503,
      code: "server_draining",
    } satisfies Partial<ApiError>);
    expect(upstreamCalled).toBe(false);
  });

  test("rejects new prompts while the worker is draining", async () => {
    let upstreamCalled = false;
    globalThis.fetch = (async () => {
      upstreamCalled = true;
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const { sessionOwnership, sessionWorkspaces } = createServices();

    const response = proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_shared/opencode/session/ses_123/prompt_async", {
        method: "POST",
        body: JSON.stringify({ parts: [{ type: "text", text: "continue" }] }),
      }),
      url: new URL("http://openwork.local/w/ws_shared/opencode/session/ses_123/prompt_async"),
      workspace: createWorkspace(),
      proxyPath: "/session/ses_123/prompt_async",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
      runtimeMaintenance: {
        getState: () => ({ mode: "draining", requestedAt: 1, reason: "safe restart" }),
      },
    } as any);

    await expect(response).rejects.toMatchObject({
      status: 503,
      code: "server_draining",
    } satisfies Partial<ApiError>);
    expect(upstreamCalled).toBe(false);
  });

  test("still allows read-only session listing while draining", async () => {
    let upstreamCalled = false;
    globalThis.fetch = (async () => {
      upstreamCalled = true;
      return new Response(JSON.stringify([{
        id: "ses_123",
        title: "Existing Session",
        directory: join(tmpdir(), "openwork-server-runtime-control-test", "documents", "sessions", "ses_123"),
        time: { created: 1, updated: 2 },
      }]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const { sessionOwnership, sessionWorkspaces } = createServices();

    const response = await proxyOpencodeRequest({
      request: new Request(
        "http://openwork.local/w/ws_shared/opencode/session?directory=/root/ai_staff/openwork",
        { method: "GET" },
      ),
      url: new URL("http://openwork.local/w/ws_shared/opencode/session?directory=/root/ai_staff/openwork"),
      workspace: createWorkspace(),
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
      runtimeMaintenance: {
        getState: () => ({ mode: "draining", requestedAt: 1, reason: "safe restart" }),
      },
    } as any);

    expect(response.status).toBe(200);
    expect(upstreamCalled).toBe(true);
  });
});
