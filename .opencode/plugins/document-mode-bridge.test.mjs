import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("document mode bridge forbids external-directory detours for document-heavy sessions", () => {
  const file = readFileSync(join(import.meta.dir, "document-mode-bridge.js"), "utf8");

  expect(file).toContain("Non-negotiable hosted document guardrails");
  expect(file).toContain("python3 .opencode/references/check_document_delivery.py");
  expect(file).toContain("Never point the final delivery sweep at the whole \\`.\\` tree");
  expect(file).toContain("\\`ls\\` or \\`glob\\` is not a substitute");
  expect(file).toContain("Do not use \\`external_directory\\`");
  expect(file).toContain("create \\`<WORKSPACE>/.tmp/system\\`");
  expect(file).toContain("Do not \"probe\" \\`/tmp/*\\`");
  expect(file).toContain("parent directories, sibling session folders, or repo-root files");
  expect(file).toContain("If machine-named source files such as \\`src-001.docx\\` are present");
  expect(file).toContain("\\`.worktree/text/*.txt\\`");
  expect(file).toContain("read those bootstrap text files before you extract the original binary again");
  expect(file).toContain("do not call \\`read\\` on that original file");
  expect(file).toContain("A failed binary \\`read\\` on an Office file does not count as progress");
  expect(file).toContain("For existing \\`.worktree/**\\` or other state files, do not call \\`write\\` as an overwrite shortcut");
  expect(file).toContain("read the current file first and then update it with \\`edit\\`");
});
