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
