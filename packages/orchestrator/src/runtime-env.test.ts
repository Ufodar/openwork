import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildOpenworkServerRuntimeEnv, loadOpenworkRuntimeEnv } from "./runtime-env";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadOpenworkRuntimeEnv", () => {
  test("loads generated-secrets.env and secrets.env when process env is missing the values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openwork-runtime-env-"));
    tempDirs.push(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "generated-secrets.env"),
      "export BOCHA_API_KEY=generated-key\nexport BOCHA_MCP_DIR=/generated/bocha\n",
      "utf8",
    );
    await writeFile(
      join(dir, "secrets.env"),
      "export BOCHA_API_KEY=secret-key\nexport BOCHA_MCP_DIR=/secret/bocha\n",
      "utf8",
    );

    const env = loadOpenworkRuntimeEnv({
      runtimeEnvDir: dir,
      baseEnv: { PATH: process.env.PATH ?? "" },
    });

    expect(env.BOCHA_API_KEY).toBe("secret-key");
    expect(env.BOCHA_MCP_DIR).toBe("/secret/bocha");
  });

  test("keeps explicit process env values over file-loaded defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "openwork-runtime-env-"));
    tempDirs.push(dir);
    await writeFile(join(dir, "secrets.env"), "export BOCHA_API_KEY=file-key\n", "utf8");

    const env = loadOpenworkRuntimeEnv({
      runtimeEnvDir: dir,
      baseEnv: {
        PATH: process.env.PATH ?? "",
        BOCHA_API_KEY: "process-key",
      },
    });

    expect(env.BOCHA_API_KEY).toBe("process-key");
  });
});

describe("buildOpenworkServerRuntimeEnv", () => {
  test("pins OPENWORK_OPENCODE_BIN to the resolved orchestrator binary", () => {
    const env = buildOpenworkServerRuntimeEnv({
      baseEnv: {
        PATH: process.env.PATH ?? "",
      },
      opencodeBin: "/tmp/downloaded/opencode-1.3.2",
      openworkToken: "client-token",
      openworkHostToken: "host-token",
      runId: "run-1",
      logFormat: "json",
    });

    expect(env.OPENWORK_OPENCODE_BIN).toBe("/tmp/downloaded/opencode-1.3.2");
    expect(env.OPENWORK_TOKEN).toBe("client-token");
    expect(env.OPENWORK_HOST_TOKEN).toBe("host-token");
  });
});
