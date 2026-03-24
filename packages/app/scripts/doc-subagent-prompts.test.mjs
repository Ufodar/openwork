import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

test("doc-orchestrator reader tasks are anchored on the deterministic extractor command", async () => {
  const prompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");

  expect(prompt).toContain("extract_doc_state.py");
  expect(prompt).toContain("verify_doc_state.py");
  expect(prompt).toContain("--doc-id");
  expect(prompt).toContain("--output");
  expect(prompt).toContain("Do not ask `doc-reader` to use the `docx` or `pdf` skills");
});

test("writer and verifier prompts treat user-specified section titles as exact headings", async () => {
  const writerPrompt = await readFile(resolve(root, ".opencode/prompts/doc-writer.md"), "utf8");
  const verifierPrompt = await readFile(resolve(root, ".opencode/prompts/doc-verifier.md"), "utf8");
  const orchestratorPrompt = await readFile(resolve(root, ".opencode/prompts/doc-orchestrator.md"), "utf8");

  expect(writerPrompt).toContain("literal heading contract");
  expect(writerPrompt).toContain("do not invent helper scripts");
  expect(writerPrompt).toContain("run `verify_doc_state.py` or write verifier-owned artifacts");
  expect(verifierPrompt).toContain("exact heading contract");
  expect(verifierPrompt).toContain("execute that verification command directly");
  expect(verifierPrompt).toContain("do not fake verifier outputs");
  expect(orchestratorPrompt).toContain("literal output headings");
  expect(orchestratorPrompt).toContain("do not tell `doc-writer` to \"follow the plan titles\"");
  expect(orchestratorPrompt).toContain("do not invent helper scripts for coverage refresh");
  expect(orchestratorPrompt).toContain("split that into two subagent calls");
  expect(orchestratorPrompt).toContain("If `doc-verifier` reports missing sections");
  expect(orchestratorPrompt).toContain("title mismatch is a failure");
  expect(orchestratorPrompt).toContain("do not call non-`doc-*` agents");
});

test("doc-reader does not allow docx/pdf skills for standard source compilation", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const skillPermission = config.agent?.["doc-reader"]?.permission?.skill ?? {};

  expect(skillPermission.docx).not.toBe("allow");
  expect(skillPermission.pdf).not.toBe("allow");
});

test("doc-writer can read runtime state files and write nested outputs in session workspaces", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const readPermission = config.agent?.["doc-writer"]?.permission?.read ?? {};
  const writePermission = config.agent?.["doc-writer"]?.permission?.write ?? {};

  expect(readPermission["**/.worktree/facts.json"]).toBe("allow");
  expect(readPermission["**/.worktree/plan/solution-plan.json"]).toBe("allow");
  expect(writePermission["outputs/**"]).toBe("allow");
  expect(writePermission["**/outputs/**"]).toBe("allow");
});

test("doc-verifier can execute the verification script directly", async () => {
  const config = JSON.parse(await readFile(resolve(root, "opencode.json"), "utf8"));
  const verifier = config.agent?.["doc-verifier"];

  expect(verifier?.tools?.bash).toBe(true);
  expect(verifier?.permission?.bash).toBe("allow");
});
