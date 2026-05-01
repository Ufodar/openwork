import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("createSessionAndOpen forwards preferred session hints to the server create payload", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("openworkPreferredView: nextView");
  expect(file).toContain("openworkPreferredAgent: requestedAgent");
  expect(file).toContain("openworkPreferredAgentLock: requestedAgentLock");
  expect(file).toContain("openworkRuntimeProfileId: options?.openworkRuntimeProfileId ?? undefined");
  expect(file).toContain("openworkRuntimeScopeKind: options?.openworkRuntimeScopeKind ?? undefined");
  expect(file).toContain("openworkRuntimeScopeKey: options?.openworkRuntimeScopeKey ?? undefined");
  expect(file).toContain("openworkBidNodeId: options?.openworkBidNodeId ?? undefined");
});

test("createSessionAndOpen uses the shared OpenWork action gate instead of an inline health precheck", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("ensureOpenworkServerActionReady({");
  expect(file).not.toContain("const health = unwrap(await c.global.health");
});

test("OpenWork client recreation uses the active workspace scoped opencode route", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("const resolveActiveOpencodeClientBaseUrl = () => {");
  expect(file).toContain("buildOpenworkWorkspaceBaseUrl(hostBaseUrl, workspaceId)");
  expect(file).toContain("const opencodeUrl = resolveActiveOpencodeClientBaseUrl();");
  expect(file).not.toContain("const opencodeUrl = `${openworkBaseUrl.replace(/\\\\/+$/, \"\")}/opencode`;");
});
