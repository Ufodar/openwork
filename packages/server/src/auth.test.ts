import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  const originalCwd = process.cwd();
  const originalTemplateDir = process.env.OPENWORK_USER_WORKSPACE_TEMPLATE_DIR;
  const originalWorkspaceRoot = process.env.OPENWORK_USER_WORKSPACES_ROOT;

  beforeEach(() => {
    if (originalTemplateDir === undefined) {
      delete process.env.OPENWORK_USER_WORKSPACE_TEMPLATE_DIR;
    } else {
      process.env.OPENWORK_USER_WORKSPACE_TEMPLATE_DIR = originalTemplateDir;
    }
    if (originalWorkspaceRoot === undefined) {
      delete process.env.OPENWORK_USER_WORKSPACES_ROOT;
    } else {
      process.env.OPENWORK_USER_WORKSPACES_ROOT = originalWorkspaceRoot;
    }
    process.chdir(originalCwd);
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

  test("register falls back to a usable cwd template when the first workspace is blank", async () => {
    const root = join(tmpdir(), `openwork-auth-template-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const blankWorkspace = join(root, "blank-workspace");
    const templateDir = join(root, "template");
    const userRoots = join(root, "user-workspaces");
    await mkdir(blankWorkspace, { recursive: true });
    await writeFile(join(blankWorkspace, "opencode.jsonc"), "{\n  \"model\": \"blank\"\n}\n", "utf8");
    await mkdir(join(templateDir, ".opencode", "agent"), { recursive: true });
    await writeFile(join(templateDir, "opencode.jsonc"), "{\n  \"model\": \"test\"\n}\n", "utf8");
    await writeFile(join(templateDir, ".opencode", "agent", "common-work.md"), "---\n---\nagent\n", "utf8");

    config.workspaces = [{
      id: "ws_blank",
      name: "blank",
      path: blankWorkspace,
      workspaceType: "local",
    }];
    process.env.OPENWORK_USER_WORKSPACES_ROOT = userRoots;
    process.chdir(templateDir);
    auth = new AuthService(config, tokens);

    const result = await auth.register({ username: "alice", password: "123456" });

    expect(await readFile(join(result.workspace.path, ".opencode", "agent", "common-work.md"), "utf8")).toContain("agent");
  });

  test("login repairs an existing user workspace by backfilling missing template files", async () => {
    const root = join(tmpdir(), `openwork-auth-repair-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const blankWorkspace = join(root, "blank-workspace");
    const templateDir = join(root, "template");
    const userRoots = join(root, "user-workspaces");
    await mkdir(blankWorkspace, { recursive: true });
    await writeFile(join(blankWorkspace, "opencode.jsonc"), "{\n  \"model\": \"blank\"\n}\n", "utf8");
    await mkdir(join(templateDir, ".opencode", "agent"), { recursive: true });
    await writeFile(join(templateDir, "opencode.jsonc"), "{\n  \"model\": \"test\"\n}\n", "utf8");
    await writeFile(join(templateDir, ".opencode", "agent", "common-work.md"), "---\n---\nagent\n", "utf8");

    config.workspaces = [{
      id: "ws_blank",
      name: "blank",
      path: blankWorkspace,
      workspaceType: "local",
    }];
    process.env.OPENWORK_USER_WORKSPACES_ROOT = userRoots;
    process.env.OPENWORK_USER_WORKSPACE_TEMPLATE_DIR = blankWorkspace;
    auth = new AuthService(config, tokens);

    const registered = await auth.register({ username: "bob", password: "123456" });
    const missingAgentPath = join(registered.workspace.path, ".opencode", "agent", "common-work.md");
    await expect(readFile(missingAgentPath, "utf8")).rejects.toThrow();

    delete process.env.OPENWORK_USER_WORKSPACE_TEMPLATE_DIR;
    process.chdir(templateDir);

    await auth.login({ username: "bob", password: "123456" });

    expect(await readFile(missingAgentPath, "utf8")).toContain("agent");
  });
});
