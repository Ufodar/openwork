import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("session command palette memos are declared after selected session agent state", () => {
  const file = readFileSync(resolve(import.meta.dir, "app.tsx"), "utf8");

  const selectedAgentIndex = file.indexOf("const selectedSessionAgent = createMemo(() => {");
  const selectedAgentLockIndex = file.indexOf("const selectedSessionAgentLock = createMemo(() => {");
  const paletteContextIndex = file.indexOf("const sessionCommandPaletteContext = createMemo(() => ({");
  const sessionSkillsIndex = file.indexOf("const sessionSkills = createMemo(() =>");
  const sessionCommandsIndex = file.indexOf("async function listSessionCommands(): Promise<");

  expect(selectedAgentIndex).toBeGreaterThanOrEqual(0);
  expect(selectedAgentLockIndex).toBeGreaterThanOrEqual(0);
  expect(paletteContextIndex).toBeGreaterThanOrEqual(0);
  expect(sessionSkillsIndex).toBeGreaterThanOrEqual(0);
  expect(sessionCommandsIndex).toBeGreaterThanOrEqual(0);

  expect(selectedAgentIndex).toBeLessThan(paletteContextIndex);
  expect(selectedAgentLockIndex).toBeLessThan(paletteContextIndex);
  expect(selectedAgentLockIndex).toBeLessThan(sessionSkillsIndex);
  expect(selectedAgentLockIndex).toBeLessThan(sessionCommandsIndex);
});
