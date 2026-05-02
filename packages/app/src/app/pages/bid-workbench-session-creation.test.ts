import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("bid-workbench creates node sessions through the workspace proxy instead of the app-level session surface", () => {
  const file = readFileSync(join(import.meta.dir, "bid-workbench.tsx"), "utf8");

  expect(file).toContain("client.createWorkspaceOpencodeSession(workspaceId(), {");
  expect(file).toContain('openworkPreferredView: "document-agent"');
  expect(file).toContain('openworkRuntimeProfileId: "bid-workbench-node"');
  expect(file).toContain("await Promise.resolve(props.selectSession(nextSessionId)).catch(() => undefined);");
  expect(file).not.toContain("const nextSessionId = await props.createSessionAndOpen({");
});

test("bid-workbench refreshes node binding before reopening an existing node session", () => {
  const file = readFileSync(join(import.meta.dir, "bid-workbench.tsx"), "utf8");

  expect(file).toContain("if (existingSessionId) {");
  expect(file).toContain("client.setBidWorkbenchSectionSession(workspaceId(), node.id, {");
  expect(file).toContain("sessionId: existingSessionId,");
  expect(file).toContain("navigate(`/document-agent/${existingSessionId}`);");
});

test("bid-workbench waits for both workspace id and openwork client before caching empty workspace data", () => {
  const file = readFileSync(join(import.meta.dir, "bid-workbench.tsx"), "utf8");

  expect(file).toContain("const [stableWorkspaceId, setStableWorkspaceId] = createSignal<string | null>(null);");
  expect(file).toContain("setStableWorkspaceId((current) => (current === id ? current : id));");
  expect(file).toContain("const workspaceResourceKey = createMemo(() => stableWorkspaceId() ?? undefined);");
  expect(file).toContain("createResource(\n    workspaceResourceKey,");
  expect(file).toContain("const [visibleWorkbenchState, setVisibleWorkbenchState] = createSignal<OpenworkBidWorkbenchState>(EMPTY_WORKBENCH_STATE);");
  expect(file).toContain("const currentWorkbenchState = createMemo(() => {");
  expect(file).toContain("return key && nextState ? nextState : visibleWorkbenchState();");
});

test("app proactively resolves the workspace id when opening bid-workbench directly", () => {
  const file = readFileSync(join(import.meta.dir, "..", "app.tsx"), "utf8");

  expect(file).toContain('if (!path.startsWith("/bid-workbench")) return;');
  expect(file).toContain("void ensureOpenworkServerWorkspaceIdResolved().catch(() => undefined);");
  expect(file).toContain("const preserveExplicitBidWorkbenchWorkspace =");
  expect(file).toContain("window.location.pathname.trim().toLowerCase().startsWith(\"/bid-workbench\")");
  expect(file).toContain("openworkServerWorkspaceId: resolvedDevtoolsWorkspaceId(),");
});
