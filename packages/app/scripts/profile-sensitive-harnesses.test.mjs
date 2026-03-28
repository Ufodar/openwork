import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

function readScript(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

test("doc-agent live compare creates both lanes with explicit hosted runtime profile hints", () => {
  const script = readScript("packages/app/scripts/doc-agent-live-compare.mjs");

  expect(script).toContain('preferredView: "document-agent"');
  expect(script).toContain('preferredAgent: "common-work"');
  expect(script).toContain('preferredAgentLock: "common-work"');
  expect(script).toContain('preferredView: "document-writer"');
  expect(script).toContain('preferredAgent: "document-writer"');
  expect(script).toContain('preferredAgentLock: "document-writer"');
  expect(script).toContain("fetchHostedSessionRecord");
  expect(script).toContain("workspacePath");
});

test("doc-subagent simulate does not create writer sessions through client.session.create", () => {
  const script = readScript("packages/app/scripts/doc-subagent-simulate.mjs");

  expect(script).not.toContain("client.session.create({ title: scenario.title })");
  expect(script).toContain('preferredView: "document-writer"');
  expect(script).toContain('preferredAgent: "document-writer"');
  expect(script).toContain('preferredAgentLock: "document-writer"');
  expect(script).toContain("fetchHostedSessionRecord");
  expect(script).toContain("workspacePath: workspace.path");
});

test("qin compare scripts pin hosted sessions to the intended runtime profiles", () => {
  const oneShot = readScript("packages/app/scripts/qin-one-shot-compare.mjs");
  const writerOnly = readScript("packages/app/scripts/run-qin-doc-writer.mjs");
  const commonDebug = readScript("packages/app/scripts/qin-common-work-debug.mjs");

  expect(oneShot).toContain('preferredView: "document-agent"');
  expect(oneShot).toContain('preferredAgent: "common-work"');
  expect(oneShot).toContain('preferredView: "document-writer"');
  expect(oneShot).toContain('preferredAgent: "document-writer"');
  expect(oneShot).toContain("workspacePath");
  expect(writerOnly).toContain('preferredView: "document-writer"');
  expect(writerOnly).toContain('preferredAgentLock: "document-writer"');
  expect(writerOnly).toContain("workspacePath: auth.workspace.path");
  expect(commonDebug).toContain('preferredView: "document-agent"');
  expect(commonDebug).toContain('preferredAgentLock: "common-work"');
  expect(commonDebug).toContain("workspacePath: auth.workspace.path");
});
