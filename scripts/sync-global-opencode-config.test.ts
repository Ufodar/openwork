import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("sync-global-opencode-config.py", () => {
  test("writes both model and small_model for the configured provider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openwork-sync-opencode-"));
    tempDirs.push(dir);
    const configPath = join(dir, "opencode.json");

    const result = spawnSync("python3", ["scripts/sync-global-opencode-config.py"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENWORK_GLOBAL_CONFIG: configPath,
        OPENWORK_PROVIDER_ID: "my-company",
        OPENWORK_DEFAULT_MODEL: "Qwen3.5-397B-A17B",
        OPENWORK_MODEL_BASE_URL: "http://127.0.0.1:3002/v1",
        MY_COMPANY_API_KEY: "test-key",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, any>;
    expect(config.model).toBe("my-company/Qwen3.5-397B-A17B");
    expect(config.small_model).toBe("my-company/Qwen3.5-397B-A17B");
    expect(config.provider?.["my-company"]?.options?.baseURL).toBe("http://127.0.0.1:3002/v1");
    expect(config.provider?.["my-company"]?.options?.apiKey).toBe("test-key");
  });

  test("removes hosted opencode-mem plugin and disables global memory mcp by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openwork-sync-opencode-"));
    tempDirs.push(dir);
    const configPath = join(dir, "opencode.json");

    await Bun.write(
      configPath,
      JSON.stringify(
        {
          plugin: [
            "file:///root/.config/opencode/node_modules/opencode-mem/dist/plugin.js",
            "opencode-scheduler",
          ],
          mcp: {
            memory: {
              type: "local",
              command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const result = spawnSync("python3", ["scripts/sync-global-opencode-config.py"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENWORK_GLOBAL_CONFIG: configPath,
        OPENWORK_PROVIDER_ID: "my-company",
        OPENWORK_DEFAULT_MODEL: "Qwen3.5-397B-A17B",
        OPENWORK_MODEL_BASE_URL: "http://127.0.0.1:3002/v1",
        MY_COMPANY_API_KEY: "test-key",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);

    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, any>;
    expect(config.plugin).toEqual(["opencode-scheduler"]);
    expect(config.mcp?.memory?.enabled).toBe(false);
  });
});
