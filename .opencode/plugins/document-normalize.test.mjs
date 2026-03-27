import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "..", "..");
const pluginPath = path.join(rootDir, ".opencode", "plugins", "document-mode-bridge.js");
const commandPath = path.join(rootDir, ".opencode", "commands", "doc-normalize.md");
const commandAliasPath = path.join(rootDir, ".opencode", "commands", "document-normalize.md");
const skillPath = path.join(rootDir, ".opencode", "skills", "doc-normalize", "SKILL.md");

test("document mode bridge injects normalization rules and doc-normalize routing", async () => {
  const { DocumentModeBridge } = await import(pathToFileURL(pluginPath).href);
  const plugin = await DocumentModeBridge({ directory: rootDir });
  const output = {};

  await plugin["experimental.chat.system.transform"]({}, output);

  const systemPrompt = Array.isArray(output.system) ? output.system.join("\n") : String(output.system ?? "");
  assert.match(systemPrompt, /must use real Word heading semantics/i);
  assert.match(systemPrompt, /must use real numbering or bullet structure/i);
  assert.match(systemPrompt, /use \/doc-normalize for full-document normalization/i);
  assert.match(systemPrompt, /do not call the skill tool merely to "activate" docx, pdf, xlsx, or pptx/i);
  assert.match(systemPrompt, /do not use the glob tool once exact candidate paths are known/i);
  assert.match(systemPrompt, /do not use the grep tool/i);
  assert.match(systemPrompt, /use `bash grep -n`, `sed -n`, or targeted `read` instead/i);
});

test("doc-normalize command exists as a thin wrapper around the skill", () => {
  assert.ok(fs.existsSync(commandPath), "expected .opencode/commands/doc-normalize.md to exist");
  const command = fs.readFileSync(commandPath, "utf8");

  assert.match(command, /^---[\s\S]*name:\s*doc-normalize/m);
  assert.match(command, /Use the `doc-normalize` skill/i);
  assert.match(command, /first execution scan-only/i);
});

test("document-normalize alias exists and routes to the same skill", () => {
  assert.ok(fs.existsSync(commandAliasPath), "expected .opencode/commands/document-normalize.md to exist");
  const command = fs.readFileSync(commandAliasPath, "utf8");

  assert.match(command, /^---[\s\S]*name:\s*document-normalize/m);
  assert.match(command, /Use the `doc-normalize` skill/i);
  assert.match(command, /first execution scan-only/i);
});

test("doc-normalize skill exists and is explicitly scan-only in v1", () => {
  assert.ok(fs.existsSync(skillPath), "expected .opencode/skills/doc-normalize/SKILL.md to exist");
  const skill = fs.readFileSync(skillPath, "utf8");

  assert.match(skill, /^---[\s\S]*name:\s*doc-normalize/m);
  assert.match(skill, /scan-only/i);
  assert.doesNotMatch(skill, /write back to the document in v1/i);
});
