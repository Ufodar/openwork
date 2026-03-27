import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("document mode bridge forbids external-directory detours for document-heavy sessions", () => {
  const file = readFileSync(join(import.meta.dir, "document-mode-bridge.js"), "utf8");

  expect(file).toContain("Do not use \\`external_directory\\`");
  expect(file).toContain("parent directories, sibling session folders, or repo-root files");
});
