import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");
const harnessPath = resolve(root, "tmp", "qin-abc-minimax.mjs");

test("qin compare harness creates hosted common-work sessions with explicit runtime profile hints", () => {
  const script = readFileSync(harnessPath, "utf8");

  expect(script).toContain("openworkPreferredView: preferredView || undefined");
  expect(script).toContain("openworkPreferredAgent: preferredAgent || undefined");
  expect(script).toContain("openworkPreferredAgentLock: preferredAgentLock || undefined");
  expect(script).toContain("preferredView: \"document-agent\"");
  expect(script).toContain("preferredAgent: \"common-work\"");
  expect(script).toContain("preferredAgentLock: \"common-work\"");
  expect(script).toContain("check_document_delivery.py");
  expect(script).toContain("deliveryQualityGate");
});
