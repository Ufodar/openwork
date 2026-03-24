import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { proxyOpencodeRequest } from "./server.js";
import { RuntimeDocumentStateTokenService } from "./runtime-document-state-tokens.js";
import { RuntimeKnowledgeTokenService } from "./runtime-knowledge-tokens.js";
import { SessionOwnershipService } from "./session-ownership.js";
import { SessionWorkspaceService } from "./session-workspaces.js";
import type { WorkspaceInfo } from "./types.js";

const originalFetch = globalThis.fetch;
const originalOpenworkDataDir = process.env.OPENWORK_DATA_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (typeof originalOpenworkDataDir === "string") {
    process.env.OPENWORK_DATA_DIR = originalOpenworkDataDir;
  } else {
    delete process.env.OPENWORK_DATA_DIR;
  }
});

describe("proxyOpencodeRequest session creation", () => {
  let workspacePath = "";
  let workspace: WorkspaceInfo;

  beforeEach(async () => {
    process.env.OPENWORK_DATA_DIR = await mkdtemp(join(tmpdir(), "openwork-proxy-session-create-data-"));
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-proxy-session-create-workspace-"));
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          },
        },
      }, null, 2),
      "utf8",
    );
    workspace = {
      id: "ws_1",
      name: "alice",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };
  });

  test("provisions runtime knowledge and document-state overlays after creating a session", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "ses_created", title: "Created Session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session", {
        method: "POST",
        body: JSON.stringify({ title: "Created Session" }),
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session"),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "collaborator", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens,
      runtimeDocumentStateTokens,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    expect(response.status).toBe(200);

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_created");
    expect(runtime?.runtimeDir).toBeTruthy();
    const configPath = join(runtime?.runtimeDir ?? "", "opencode.jsonc");
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw) as {
      model?: string;
      mcp?: Record<string, unknown>;
      instructions?: string[];
    };
    const instructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-knowledge.md"), "utf8");
    const docStateInstructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "doc-state.md"), "utf8");

    expect(parsed.model).toBe("test-model");
    expect(parsed.mcp?.filesystem).toBeTruthy();
    expect(parsed.mcp?.["openwork-knowledge"]).toBeTruthy();
    expect(parsed.mcp?.doc_state).toBeTruthy();
    expect(parsed.instructions).toContain(".opencode/openwork-knowledge.md");
    expect(parsed.instructions).toContain(".opencode/doc-state.md");
    expect(instructionRaw).toContain("openwork_knowledge_list_attached");
    expect(docStateInstructionRaw).toContain("doc_state_state_get_brief");
  });
});
