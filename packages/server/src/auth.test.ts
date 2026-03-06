import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AuthService } from "./auth.js";
import { TokenService } from "./tokens.js";
import type { ServerConfig } from "./types.js";

function createTestConfig(): ServerConfig {
  const tempDir = join(
    tmpdir(),
    `openwork-auth-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  return {
    host: "127.0.0.1",
    port: 8787,
    token: "test-client-token",
    hostToken: "test-host-token",
    configPath: join(tempDir, "server.json"),
    approval: { mode: "auto", timeoutMs: 30000 },
    corsOrigins: ["*"],
    workspaces: [],
    authorizedRoots: [],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

describe("AuthService", () => {
  let config: ServerConfig;
  let tokens: TokenService;
  let auth: AuthService;

  beforeEach(() => {
    config = createTestConfig();
    tokens = new TokenService(config);
    auth = new AuthService(config, tokens);
  });

  test("built-in admin login returns owner token", async () => {
    const result = await auth.login({ username: "admin", password: "admin123" });

    expect(result.token).toBe(config.hostToken);
    expect(result.user.username).toBe("admin");
    expect(result.user.id).toBe("admin");
  });

  test("rejects registering the reserved admin username", async () => {
    await expect(auth.register({ username: "admin", password: "123456" })).rejects.toThrow("用户名已存在。");
    await expect(auth.register({ username: "ADMIN", password: "123456" })).rejects.toThrow("用户名已存在。");
  });

  test("lists built-in admin alongside file-backed users", async () => {
    await auth.register({ username: "alice", password: "123456" });

    const users = await auth.listUsers();

    expect(users.map((user) => user.username)).toEqual(["admin", "alice"]);
    expect(users[0]?.isAdmin).toBe(true);
    expect(users[1]?.isAdmin).toBe(false);
  });
});
