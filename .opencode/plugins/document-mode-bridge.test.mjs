import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("document mode bridge forbids external-directory detours for document-heavy sessions", () => {
  const file = readFileSync(join(import.meta.dir, "document-mode-bridge.js"), "utf8");

  expect(file).toContain("Non-negotiable hosted document guardrails");
  expect(file).toContain("Before delivery, run a real text sweep such as");
  expect(file).toContain("\\`ls\\` or \\`glob\\` is not a substitute");
  expect(file).toContain("Do not use \\`external_directory\\`");
  expect(file).toContain("create \\`<WORKSPACE>/.tmp/system\\`");
  expect(file).toContain("Do not \"probe\" \\`/tmp/*\\`");
  expect(file).toContain("parent directories, sibling session folders, or repo-root files");
  expect(file).toContain("do not call \\`read\\` on that original file");
  expect(file).toContain("A failed binary \\`read\\` on an Office file does not count as progress");
});
