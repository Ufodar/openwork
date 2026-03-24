import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { copyWorkspaceConfigTemplate } from "./workspace-template.js";

describe("copyWorkspaceConfigTemplate", () => {
  test("merges managed root config into an existing user workspace config", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-workspace-template-"));
    const sourceRoot = join(root, "source");
    const targetRoot = join(root, "target");
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(targetRoot, { recursive: true });

    await writeFile(
      join(sourceRoot, "opencode.jsonc"),
      JSON.stringify({
        plugin: ["opencode-scheduler"],
        agent: {
          "document-writer": {
            description: "new orchestrator",
            tools: { task: true },
          },
        },
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(targetRoot, "opencode.jsonc"),
      JSON.stringify({
        mcp: {
          memory: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          },
        },
      }, null, 2),
      "utf8",
    );

    await copyWorkspaceConfigTemplate(sourceRoot, targetRoot);

    const merged = JSON.parse(await readFile(join(targetRoot, "opencode.jsonc"), "utf8")) as Record<string, any>;
    expect(merged.mcp?.memory?.command).toEqual(["npx", "-y", "@modelcontextprotocol/server-memory"]);
    expect(merged.plugin).toEqual(["opencode-scheduler"]);
    expect(merged.agent?.["document-writer"]?.description).toBe("new orchestrator");
    expect(merged.agent?.["document-writer"]?.tools?.task).toBe(true);
  });

  test("refreshes built-in .opencode files while preserving user-only extras", async () => {
    const root = await mkdtemp(join(tmpdir(), "openwork-workspace-template-files-"));
    const sourceRoot = join(root, "source");
    const targetRoot = join(root, "target");
    await mkdir(join(sourceRoot, ".opencode", "agent"), { recursive: true });
    await mkdir(join(targetRoot, ".opencode", "agent"), { recursive: true });
    await mkdir(join(targetRoot, ".opencode", "skills", "custom-skill"), { recursive: true });

    await writeFile(
      join(sourceRoot, ".opencode", "agent", "document-writer.md"),
      "new orchestrator prompt\n",
      "utf8",
    );
    await writeFile(
      join(targetRoot, ".opencode", "agent", "document-writer.md"),
      "old single-agent prompt\n",
      "utf8",
    );
    await writeFile(
      join(targetRoot, ".opencode", "skills", "custom-skill", "SKILL.md"),
      "user custom skill\n",
      "utf8",
    );

    await copyWorkspaceConfigTemplate(sourceRoot, targetRoot);

    expect(await readFile(join(targetRoot, ".opencode", "agent", "document-writer.md"), "utf8")).toBe(
      "new orchestrator prompt\n",
    );
    expect(await readFile(join(targetRoot, ".opencode", "skills", "custom-skill", "SKILL.md"), "utf8")).toBe(
      "user custom skill\n",
    );
  });
});
