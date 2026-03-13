import { afterEach, describe, expect, test } from "bun:test";

import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { countAdminSessionsByOwner } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function createConfig(workspaces: WorkspaceInfo[] = []): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 8789,
    token: "client-token",
    hostToken: "host-token",
    configPath: undefined,
    approval: { mode: "auto", timeoutMs: 30_000 },
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

describe("countAdminSessionsByOwner", () => {
  test("aggregates counts from visible session listings", async () => {
    const config = createConfig([
      {
        id: "ws-shared",
        name: "shared",
        path: "/root/ai_staff/openwork",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
      },
      {
        id: "user-1",
        name: "alice",
        path: "/root/.openwork/user-workspaces/alice",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
      },
    ]);

    const sessionOwnership = {
      listEntries: async (workspaceId: string) => {
        if (workspaceId === "ws-shared") {
          return {
            ses_a: { ownerKey: "owner-alice", updatedAt: 1 },
            ses_b: { ownerKey: "owner-bob", updatedAt: 2 },
            ses_stale: { ownerKey: "owner-alice", updatedAt: 4 },
          };
        }
        if (workspaceId === "user-1") {
          return {
            ses_c: { ownerKey: "owner-alice", updatedAt: 3 },
          };
        }
        return {};
      },
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async (_workspaceId: string, sessionId: string) => ({
        runtimeId: sessionId,
        runtimeDir: sessionId === "ses_c"
          ? "/root/.openwork/user-workspaces/alice/documents/sessions/ses_c"
          : `/root/ai_staff/openwork/documents/sessions/${sessionId}`,
        createdAt: 1,
      }),
    } as unknown as SessionWorkspaceService;

    globalThis.fetch = (async () => new Response(JSON.stringify([
      {
        id: "ses_a",
        title: "A",
        directory: "/root/ai_staff/openwork/documents/sessions/ses_a",
        time: { created: 1, updated: 2 },
      },
      {
        id: "ses_b",
        title: "B",
        directory: "/root/ai_staff/openwork/documents/sessions/ses_b",
        time: { created: 1, updated: 3 },
      },
      {
        id: "ses_c",
        title: "C",
        directory: "/root/.openwork/user-workspaces/alice/documents/sessions/ses_c",
        time: { created: 1, updated: 4 },
      },
    ]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    const counts = await countAdminSessionsByOwner(config, sessionOwnership, sessionWorkspaces);

    expect(counts.get("owner-alice")).toBe(2);
    expect(counts.get("owner-bob")).toBe(1);
    expect(counts.size).toBe(2);
  });
});
