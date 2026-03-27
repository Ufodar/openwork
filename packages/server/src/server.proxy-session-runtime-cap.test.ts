import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { ApiError } from "./errors.js";
import { proxyOpencodeRequest } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";
import type { WorkspaceInfo } from "./types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("proxyOpencodeRequest session runtime capacity", () => {
  test("rejects reopening an isolated historical session when runtime capacity is reached", async () => {
    let upstreamCalled = false;
    globalThis.fetch = (async () => {
      upstreamCalled = true;
      return new Response(null, { status: 202 });
    }) as unknown as typeof fetch;

    const workspace: WorkspaceInfo = {
      id: "ws_1",
      name: "alice",
      path: "/root/.openwork/user-workspaces/user-1",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const runtimeDir = join(workspace.path, "documents", "sessions", "runtime-iso");
    const sessionOwnership = {
      getOwner: async () => "owner-alice",
    } as unknown as SessionOwnershipService;
    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-iso",
        runtimeDir,
        createdAt: 1,
        opencodeRuntime: {
          mode: "isolated_process",
          rootDir: join(runtimeDir, ".openwork-runtime", "opencode"),
          configDir: join(runtimeDir, ".openwork-runtime", "opencode", "config"),
          dataDir: join(runtimeDir, ".openwork-runtime", "opencode", "data"),
          stateDir: join(runtimeDir, ".openwork-runtime", "opencode", "state"),
          cacheDir: join(runtimeDir, ".openwork-runtime", "opencode", "cache"),
          bindHost: "127.0.0.1",
        },
      }),
    } as unknown as SessionWorkspaceService;

    const response = proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session/ses_iso/prompt_async", {
        method: "POST",
        body: JSON.stringify({ parts: [{ type: "text", text: "continue" }] }),
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session/ses_iso/prompt_async"),
      workspace,
      proxyPath: "/session/ses_iso/prompt_async",
      actor: { type: "remote", scope: "owner", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      sessionRuntimeService: {
        resolveSessionWorkspace: async () => {
          throw new ApiError(503, "session_runtime_capacity_reached", "当前会话并发已满，请联系管理员。");
        },
      } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    await expect(response).rejects.toMatchObject({
      status: 503,
      code: "session_runtime_capacity_reached",
      message: "当前会话并发已满，请联系管理员。",
    } satisfies Partial<ApiError>);
    expect(upstreamCalled).toBe(false);
  });
});
