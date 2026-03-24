import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AuthIdentity } from "./auth.js";
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

async function invokeHostRoute(
  routes: ReturnType<typeof createRoutes>,
  config: ServerConfig,
  method: string,
  path: string,
) {
  const url = new URL(`http://openwork.local${path}`);
  const matched = matchRoute(routes, method, url.pathname);
  expect(matched).toBeTruthy();
  if (!matched) throw new Error(`Route not found: ${method} ${path}`);

  return matched.handler({
    request: new Request(url, { method }),
    url,
    params: matched.params,
    config,
    approvals: {} as any,
    reloadEvents: {} as any,
    tokens: {} as any,
    actor: { type: "host", tokenHash: "host-owner", scope: "owner" },
  });
}

describe("admin user session routes", () => {
  test("counts and lists historical sessions only from the user's own workspace", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const alicePath = await mkdtemp(join(tmpdir(), "openwork-admin-alice-"));
    await mkdir(join(alicePath, ".opencode"), { recursive: true });
    await writeFile(
      join(alicePath, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_alice_hist_1: { view: "document-agent" },
        },
      }),
      "utf8",
    );

    const bobPath = await mkdtemp(join(tmpdir(), "openwork-admin-bob-"));
    await mkdir(join(bobPath, ".opencode"), { recursive: true });
    await writeFile(
      join(bobPath, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_bob_hist_1: { view: "document-agent" },
        },
      }),
      "utf8",
    );

    const config = createConfig([
      {
        id: "user-alice",
        name: "alice",
        path: alicePath,
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
      },
      {
        id: "user-bob",
        name: "bob",
        path: bobPath,
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
      },
    ]);

    const users: AuthIdentity[] = [
      {
        id: "user_alice",
        username: "alice",
        createdAt: 1,
        lastLoginAt: 2,
        isAdmin: false,
        ownerKey: "owner-alice",
        workspace: { id: "user-alice", name: "alice", path: alicePath },
      },
      {
        id: "user_bob",
        username: "bob",
        createdAt: 3,
        lastLoginAt: 4,
        isAdmin: false,
        ownerKey: "owner-bob",
        workspace: { id: "user-bob", name: "bob", path: bobPath },
      },
    ];

    const auth = {
      listUsers: async () => users,
      getUserById: async (id: string) => users.find((user) => user.id === id) ?? null,
    } as any;

    const routes = createRoutes(
      config,
      {} as any,
      {} as any,
      auth,
      { listEntries: async () => ({}) } as any,
      { getWorkspace: async () => null } as any,
      {} as any,
      {} as any,
      {} as any,
      { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      {} as any,
      {} as any,
      {} as any,
      { log: () => undefined } as any,
    );

    const usersResponse = await invokeHostRoute(routes, config, "GET", "/admin/users");
    const usersPayload = await usersResponse.json() as { items: Array<{ username: string; sessionCount: number }> };

    expect(usersPayload.items.find((item) => item.username === "alice")?.sessionCount).toBe(1);
    expect(usersPayload.items.find((item) => item.username === "bob")?.sessionCount).toBe(1);

    const aliceSessionsResponse = await invokeHostRoute(routes, config, "GET", "/admin/users/user_alice/sessions");
    const aliceSessionsPayload = await aliceSessionsResponse.json() as { items: Array<{ id: string }> };

    expect(aliceSessionsPayload.items.map((item) => item.id)).toEqual(["ses_alice_hist_1"]);
  });
});
