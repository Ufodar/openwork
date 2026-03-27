import { afterEach, describe, expect, test } from "bun:test";

import { createRoutes, matchRoute } from "./server.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createConfig(workspaces: WorkspaceInfo[]): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 8789,
    token: "client-token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces,
    authorizedRoots: workspaces.map((workspace) => workspace.path),
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

describe("runtime maintenance routes", () => {
  test("does not boot isolated session runtimes while reading maintenance status", async () => {
    const workspace: WorkspaceInfo = {
      id: "user-1",
      name: "alice",
      path: "/root/.openwork/user-workspaces/user-1",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };
    const config = createConfig([workspace]);

    const routes = createRoutes(
      config,
      {} as any,
      {} as any,
      {} as any,
      { listEntries: async () => ({}) } as any,
      {
        listWorkspaces: async () => ({
          ses_iso_1: {
            runtimeId: "runtime-iso-1",
            runtimeDir: "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-iso-1",
            createdAt: 1,
            opencodeRuntime: {
              mode: "isolated_process",
              rootDir: "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-iso-1/.openwork-runtime/opencode",
              configDir: "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-iso-1/.openwork-runtime/opencode/config",
              dataDir: "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-iso-1/.openwork-runtime/opencode/data",
              stateDir: "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-iso-1/.openwork-runtime/opencode/state",
              cacheDir: "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-iso-1/.openwork-runtime/opencode/cache",
              bindHost: "127.0.0.1",
            },
          },
        }),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      {} as any,
      { getState: () => ({ mode: "idle", requestedAt: null, reason: null, force: false }) } as any,
      {
        ensureWorkspace: async () => undefined,
        ensureSessionRuntime: async () => {
          throw new Error("should not subscribe by booting an isolated runtime");
        },
        listActiveSessions: () => [],
      } as any,
      { log: () => undefined } as any,
      {
        isEnabledForWorkspace: () => true,
        peekSessionWorkspace: () => null,
        resolveSessionWorkspace: async () => {
          throw new Error("should not boot an isolated runtime while reading maintenance status");
        },
      } as any,
    );

    const url = new URL("http://openwork.local/admin/runtime/restart");
    const matched = matchRoute(routes, "GET", url.pathname);
    expect(matched).toBeTruthy();
    if (!matched) throw new Error("Route not found");

    const response = await matched.handler({
      request: new Request(url, {
        method: "GET",
        headers: {
          "x-openwork-host-token": "host-token",
        },
      }),
      url,
      params: matched.params,
      config,
      approvals: {} as any,
      reloadEvents: {} as any,
      tokens: {} as any,
      actor: { type: "host", tokenHash: "host-owner", scope: "owner" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      mode: "idle",
      activeSessionCount: 0,
    });
  });
});
