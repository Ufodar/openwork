import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("dashboard history entry forwards session preference hints when reopening a session", () => {
  const file = readFileSync(join(import.meta.dir, "dashboard.tsx"), "utf8");

  expect(file).toContain("const hint = buildSessionPreferenceHint(session);");
  expect(file).toContain("void props.openSessionInPreferredView(sessionId, { title: session.title ?? null, hint });");
});
