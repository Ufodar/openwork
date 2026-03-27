import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

const officeRuntimeFiles = [
  ".opencode/skills/docx/scripts/office/validate.py",
  ".opencode/skills/docx/scripts/office/pack.py",
  ".opencode/skills/pptx/scripts/office/validate.py",
  ".opencode/skills/pptx/scripts/office/pack.py",
  ".opencode/skills/xlsx/scripts/office/validate.py",
  ".opencode/skills/xlsx/scripts/office/pack.py",
];

test("office runtime scripts avoid python 3.10-only syntax used in hosted python 3.9 environments", async () => {
  for (const relativePath of officeRuntimeFiles) {
    const source = await readFile(resolve(root, relativePath), "utf8");

    expect(source).not.toContain("match file_extension:");
    expect(source).not.toContain('case ".docx":');
    expect(source).not.toContain('case ".pptx":');
    expect(source).not.toContain("str | None");
    expect(source).not.toContain("tuple[bool, str | None]");
  }
});
