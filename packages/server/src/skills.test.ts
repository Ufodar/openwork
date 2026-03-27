import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listSkills } from "./skills.js";

describe("listSkills", () => {
  test("stops at the session runtime project boundary instead of inheriting parent workspace skills", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "openwork-skills-workspace-"));
    const runtimeDir = join(workspaceRoot, "documents", "sessions", "runtime-1");

    await mkdir(join(workspaceRoot, ".opencode", "skills", "openwork-debug"), { recursive: true });
    await writeFile(
      join(workspaceRoot, ".opencode", "skills", "openwork-debug", "SKILL.md"),
      "---\nname: openwork-debug\ndescription: Debug OpenWork\n---\n# debug\n",
      "utf8",
    );

    await mkdir(join(runtimeDir, ".opencode", "skills", "docx"), { recursive: true });
    await writeFile(
      join(runtimeDir, ".opencode", "skills", "docx", "SKILL.md"),
      "---\nname: docx\ndescription: Handle Word docs\n---\n# docx\n",
      "utf8",
    );

    const inherited = await listSkills(runtimeDir, false);
    expect(inherited.map((item) => item.name).sort()).toEqual(["docx", "openwork-debug"]);

    await writeFile(join(runtimeDir, ".git"), "gitdir: .openwork-runtime/git\n", "utf8");

    const isolated = await listSkills(runtimeDir, false);
    expect(isolated.map((item) => item.name)).toEqual(["docx"]);
  });
});
