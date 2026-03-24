import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveSimulationModel } from "./doc-subagent-model-config.mjs";

test("resolveSimulationModel prefers explicit and env overrides before config files", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-subagent-model-"));

  try {
    await writeFile(join(workspace, "opencode.json"), JSON.stringify({
      provider: { local: {} },
      model: "workspace-model",
    }, null, 2), "utf8");

    expect(await resolveSimulationModel({
      explicitModel: "provider/explicit-model",
      envModel: "provider/env-model",
      workspaceRoot: workspace,
    })).toBe("provider/explicit-model");

    expect(await resolveSimulationModel({
      explicitModel: "",
      envModel: "provider/env-model",
      workspaceRoot: workspace,
    })).toBe("provider/env-model");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("resolveSimulationModel uses workspace config first and infers provider when only one provider exists", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-subagent-model-"));

  try {
    await writeFile(join(workspace, "opencode.json"), JSON.stringify({
      provider: { "my-company": {} },
      model: "Qwen3.5-397B-A17B",
    }, null, 2), "utf8");

    expect(await resolveSimulationModel({
      explicitModel: "",
      envModel: "",
      workspaceRoot: workspace,
    })).toBe("my-company/Qwen3.5-397B-A17B");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("resolveSimulationModel falls back to user config when workspace config has no model", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-subagent-model-"));
  const fakeHome = await mkdtemp(join(tmpdir(), "doc-subagent-home-"));

  try {
    await writeFile(join(workspace, "opencode.json"), JSON.stringify({
      provider: { workspace: {} },
    }, null, 2), "utf8");

    await mkdir(join(fakeHome, ".config", "opencode"), { recursive: true });
    await writeFile(join(fakeHome, ".config", "opencode", "opencode.json"), JSON.stringify({
      provider: { "my-company": {} },
      model: "MiniMax-2.5",
    }, null, 2), "utf8");

    const originalHome = process.env.HOME;
    process.env.HOME = fakeHome;
    try {
      expect(await resolveSimulationModel({
        explicitModel: "",
        envModel: "",
        workspaceRoot: workspace,
        workspaceConfigPaths: [join(workspace, "opencode.json")],
        userConfigPaths: [join(fakeHome, ".config", "opencode", "opencode.json")],
      })).toBe("my-company/MiniMax-2.5");
    } finally {
      process.env.HOME = originalHome;
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(fakeHome, { recursive: true, force: true });
  }
});
