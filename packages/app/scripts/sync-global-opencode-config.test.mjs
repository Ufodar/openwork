import { expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

test("sync-global-opencode-config writes bocha search MCP from runtime env", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openwork-sync-config-"));
  const output = join(workspace, "opencode.json");

  const result = spawnSync("python3", [resolve(root, "scripts/sync-global-opencode-config.py")], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENWORK_GLOBAL_CONFIG: output,
      OPENWORK_PROVIDER_ID: "my-company",
      OPENWORK_DEFAULT_MODEL: "MiniMax-2.5",
      OPENWORK_SMALL_MODEL: "MiniMax-2.5",
      OPENWORK_MODEL_BASE_URL: "http://127.0.0.1:3002/v1",
      MY_COMPANY_API_KEY: "provider-key",
      BOCHA_API_KEY: "bocha-test-key",
      BOCHA_MCP_DIR: "/opt/bocha-search-mcp",
    },
  });

  expect(result.status).toBe(0);

  const config = JSON.parse(await readFile(output, "utf8"));
  const bocha = config.mcp?.["bocha-search"] ?? {};

  expect(bocha.enabled).toBe(true);
  expect(bocha.environment?.BOCHA_API_KEY).toBe("bocha-test-key");
  expect(bocha.command).toEqual(["uv", "--directory", "/opt/bocha-search-mcp", "run", "bocha-search-mcp"]);
  expect(config.model).toBe("my-company/MiniMax-2.5");
  expect(config.small_model).toBe("my-company/MiniMax-2.5");
  expect(config.provider?.["my-company"]?.models?.["MiniMax-2.5"]?.limit).toEqual({
    context: 256000,
    output: 32000,
  });
  expect(config.provider?.["my-company"]?.models?.["GLM-5"]?.limit).toEqual({
    context: 256000,
    output: 32000,
  });
});
