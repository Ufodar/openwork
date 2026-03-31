import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const readPage = (name: string) => readFileSync(join(here, name), "utf8");

for (const pageName of ["document-agent.tsx", "document-writer.tsx"] as const) {
  test(`${pageName} wires reconnect recovery through the shared helper`, () => {
    const source = readPage(pageName);
    expect(source).toContain('import { createDocumentSessionReconnectRecovery } from "../lib/document-session-recovery"');
    expect(source).toContain("createDocumentSessionReconnectRecovery({");
    expect(source).toContain("serverStatus: () => props.openworkServerStatus");
    expect(source).toContain("recover: async (activeSessionId) => {");
    expect(source).toContain("const hydrated = await props.selectSession(activeSessionId);");
    expect(source).toContain("await refetchDocuments();");
  });
}
