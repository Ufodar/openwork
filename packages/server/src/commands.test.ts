import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listCommands } from "./commands.js";

describe("listCommands", () => {
  test("inherits workspace commands for session runtime directories", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-commands-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");

    await mkdir(join(workspacePath, ".git"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "commands"), { recursive: true });
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "commands", "doc-normalize.md"),
      "---\nname: doc-normalize\ndescription: normalize docs\n---\nscan docs\n",
      "utf8",
    );

    const items = await listCommands(runtimeDir, "workspace");

    expect(items.map((item) => item.name)).toEqual(["doc-normalize"]);
  });

  test("prefers nearer command definitions over parent workspace duplicates", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-commands-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");

    await mkdir(join(workspacePath, ".git"), { recursive: true });
    await mkdir(join(workspacePath, ".opencode", "commands"), { recursive: true });
    await mkdir(join(runtimeDir, ".opencode", "commands"), { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "commands", "doc-normalize.md"),
      "---\nname: doc-normalize\ndescription: parent\n---\nparent\n",
      "utf8",
    );
    await writeFile(
      join(runtimeDir, ".opencode", "commands", "doc-normalize.md"),
      "---\nname: doc-normalize\ndescription: runtime\n---\nruntime\n",
      "utf8",
    );

    const items = await listCommands(runtimeDir, "workspace");

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: "doc-normalize",
      description: "runtime",
      template: "runtime",
      scope: "workspace",
    });
  });
});
