import { describe, expect, test } from "bun:test";

import type { ServerConfig, WorkspaceInfo } from "./types.js";
import { upsertWorkspace } from "./server.js";

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

describe("upsertWorkspace", () => {
  test("inherits OpenCode runtime settings from the existing server workspace", () => {
    const config = createConfig([
      {
        id: "ws_shared",
        name: "shared",
        path: "/root/ai_staff/openwork",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:41147",
        opencodeUsername: "worker",
        opencodePassword: "secret",
      },
    ]);

    upsertWorkspace(config, {
      id: "user-123",
      name: "alice",
      path: "/root/.openwork/user-workspaces/123",
    });

    expect(config.workspaces[0]).toMatchObject({
      id: "user-123",
      name: "alice",
      path: "/root/.openwork/user-workspaces/123",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:41147",
      opencodeUsername: "worker",
      opencodePassword: "secret",
    });
    expect(config.authorizedRoots).toContain("/root/.openwork/user-workspaces/123");
  });

  test("preserves existing runtime settings when re-upserting the same workspace", () => {
    const config = createConfig([
      {
        id: "user-123",
        name: "alice",
        path: "/root/.openwork/user-workspaces/123",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:41147",
        opencodeUsername: "worker",
        opencodePassword: "secret",
      },
      {
        id: "ws_shared",
        name: "shared",
        path: "/root/ai_staff/openwork",
        workspaceType: "local",
        baseUrl: "http://127.0.0.1:9999",
        opencodeUsername: "other",
        opencodePassword: "other-secret",
      },
    ]);

    upsertWorkspace(config, {
      id: "user-123",
      name: "alice",
      path: "/root/.openwork/user-workspaces/123",
    });

    expect(config.workspaces[0]).toMatchObject({
      id: "user-123",
      baseUrl: "http://127.0.0.1:41147",
      opencodeUsername: "worker",
      opencodePassword: "secret",
    });
  });
});
