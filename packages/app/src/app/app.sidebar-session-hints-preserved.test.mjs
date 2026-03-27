import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("sidebar session sync preserves hosted preferred-view metadata", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("openworkPreferredView: normalizeStoredView((s as Record<string, unknown>).openworkPreferredView)");
  expect(file).toContain("openworkPreferredAgent: normalizeStoredAgent((s as Record<string, unknown>).openworkPreferredAgent)");
  expect(file).toContain(
    "openworkPreferredAgentLock: normalizeStoredAgent((s as Record<string, unknown>).openworkPreferredAgentLock)",
  );
});
