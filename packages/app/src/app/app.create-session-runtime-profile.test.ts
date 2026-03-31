import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("createSessionAndOpen forwards preferred session hints to the server create payload", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("openworkPreferredView: nextView");
  expect(file).toContain("openworkPreferredAgent: requestedAgent");
  expect(file).toContain("openworkPreferredAgentLock: requestedAgentLock");
});

test("createSessionAndOpen uses the shared OpenWork action gate instead of an inline health precheck", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("ensureOpenworkServerActionReady({");
  expect(file).not.toContain("const health = unwrap(await c.global.health");
});
