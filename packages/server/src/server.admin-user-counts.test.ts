import { describe, expect, test } from "bun:test";

import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { countAdminSessionsByOwner } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";

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
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

describe("countAdminSessionsByOwner", () => {
  test("aggregates counts from session ownership stores without fetching session details", async () => {
    const config = createConfig([
      {
        id: "ws-shared",
        name: "shared",
        path: "/root/ai_staff/openwork",
        workspaceType: "local",
      },
      {
        id: "user-1",
        name: "alice",
        path: "/root/.openwork/user-workspaces/alice",
        workspaceType: "local",
      },
    ]);

    const requestedWorkspaceIds: string[] = [];
    const sessionOwnership = {
      listEntries: async (workspaceId: string) => {
        requestedWorkspaceIds.push(workspaceId);
        if (workspaceId === "ws-shared") {
          return {
            ses_a: { ownerKey: "owner-alice", updatedAt: 1 },
            ses_b: { ownerKey: "owner-bob", updatedAt: 2 },
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

    const counts = await countAdminSessionsByOwner(config, sessionOwnership);

    expect(requestedWorkspaceIds.sort()).toEqual(["user-1", "ws-shared"]);
    expect(counts.get("owner-alice")).toBe(2);
    expect(counts.get("owner-bob")).toBe(1);
    expect(counts.size).toBe(2);
  });
});
