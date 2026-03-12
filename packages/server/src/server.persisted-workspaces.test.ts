import { describe, expect, test } from "bun:test";

import type { AuthIdentity } from "./auth.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { syncPersistedUserWorkspaces } from "./server.js";

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

describe("syncPersistedUserWorkspaces", () => {
  test("adds persisted user workspaces to the runtime catalog", () => {
    const config = createConfig([
      {
        id: "ws_shared",
        name: "shared",
        path: "/root/ai_staff/openwork",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
        opencodeUsername: "worker",
        opencodePassword: "secret",
      },
    ]);

    const users: AuthIdentity[] = [
      {
        id: "admin",
        username: "admin",
        createdAt: 1,
        lastLoginAt: 1,
        isAdmin: true,
        ownerKey: "owner-admin",
      },
      {
        id: "user-1",
        username: "alice",
        createdAt: 2,
        lastLoginAt: 3,
        isAdmin: false,
        ownerKey: "owner-alice",
        workspace: {
          id: "user-user-1",
          name: "alice",
          path: "/root/.openwork/user-workspaces/user-1",
        },
      },
    ];

    const added = syncPersistedUserWorkspaces(config, users);

    expect(added).toBe(1);
    expect(config.workspaces.map((workspace) => workspace.id)).toEqual(["user-user-1", "ws_shared"]);
    expect(config.workspaces[0]).toMatchObject({
      id: "user-user-1",
      path: "/root/.openwork/user-workspaces/user-1",
      baseUrl: "http://127.0.0.1:33459",
      opencodeUsername: "worker",
      opencodePassword: "secret",
    });
    expect(config.authorizedRoots).toContain("/root/.openwork/user-workspaces/user-1");
  });

  test("does not double-count workspaces already present in the runtime catalog", () => {
    const config = createConfig([
      {
        id: "user-user-1",
        name: "alice",
        path: "/root/.openwork/user-workspaces/user-1",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
      },
      {
        id: "ws_shared",
        name: "shared",
        path: "/root/ai_staff/openwork",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:33459",
      },
    ]);

    const users: AuthIdentity[] = [
      {
        id: "user-1",
        username: "alice",
        createdAt: 2,
        lastLoginAt: 3,
        isAdmin: false,
        ownerKey: "owner-alice",
        workspace: {
          id: "user-user-1",
          name: "alice",
          path: "/root/.openwork/user-workspaces/user-1",
        },
      },
    ];

    const added = syncPersistedUserWorkspaces(config, users);

    expect(added).toBe(0);
    expect(config.workspaces.map((workspace) => workspace.id)).toEqual(["user-user-1", "ws_shared"]);
  });
});
