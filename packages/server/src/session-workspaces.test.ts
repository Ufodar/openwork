import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { provisionSessionWorkspace } from "./session-workspaces.js";
import { exists } from "./utils.js";

describe("provisionSessionWorkspace", () => {
  test("creates a runtime directory without copying workspace config files", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-session-workspace-"));
    await mkdir(join(workspacePath, ".opencode", "commands"), { recursive: true });
    await writeFile(join(workspacePath, "opencode.json"), JSON.stringify({ model: "test" }), "utf8");
    await writeFile(join(workspacePath, ".opencode", "commands", "hello.md"), "---\n---\nhello\n", "utf8");

    const result = await provisionSessionWorkspace(workspacePath);

    expect(result.runtimeDir.startsWith(join(workspacePath, "documents", "sessions"))).toBe(true);
    expect(await exists(join(result.runtimeDir, "opencode.json"))).toBe(false);
    expect(await exists(join(result.runtimeDir, ".opencode", "commands", "hello.md"))).toBe(false);
  });
});
