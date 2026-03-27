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
import { exists } from "./utils.js";

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

  test("provisions only the runtime knowledge overlay for a standard session", async () => {
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
    const runtimeInstructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-runtime.md"), "utf8");
    const instructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-knowledge.md"), "utf8");
    expect(parsed.model).toBe("test-model");
    expect(parsed.mcp?.filesystem).toBeTruthy();
    expect(parsed.mcp?.["openwork-knowledge"]).toBeTruthy();
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
    expect(parsed.instructions).toContain(".opencode/openwork-knowledge.md");
    expect(parsed.instructions ?? []).not.toContain(".opencode/doc-state.md");
    expect(runtimeInstructionRaw).toContain("<WORKSPACE>/.tmp/system");
    expect(instructionRaw).toContain("openwork_knowledge_list_attached");
    expect(parsed.mcp?.doc_state).toBeUndefined();
    expect(await exists(join(runtime?.runtimeDir ?? "", ".tmp", "system"))).toBe(true);
    await expect(readFile(join(runtime?.runtimeDir ?? "", ".opencode", "doc-state.md"), "utf8")).rejects.toThrow();
  });

  test("provisions document-state overlays when the session requests the bid-writer runtime profile", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "ses_bid", title: "Bid Session" }), {
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
        body: JSON.stringify({ title: "Bid Session", openworkEnableDocState: true }),
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

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_bid");
    const raw = await readFile(join(runtime?.runtimeDir ?? "", "opencode.jsonc"), "utf8");
    const parsed = JSON.parse(raw) as {
      mcp?: Record<string, unknown>;
      instructions?: string[];
    };
    const runtimeInstructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-runtime.md"), "utf8");
    const docStateInstructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "doc-state.md"), "utf8");

    expect(parsed.mcp?.doc_state).toBeTruthy();
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
    expect(parsed.instructions).toContain(".opencode/doc-state.md");
    expect(runtimeInstructionRaw).toContain("workspace-local temp directory");
    expect(docStateInstructionRaw).toContain("doc_state_state_get_brief");
  });

  test("can create a session against an isolated per-session opencode runtime", async () => {
    const captured: { url?: string } = {};
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      captured.url = typeof input === "string" ? input : input.toString();
      return new Response(JSON.stringify({ id: "ses_isolated", title: "Isolated Session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();
    let registeredSessionId = "";

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session", {
        method: "POST",
        body: JSON.stringify({ title: "Isolated Session" }),
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
      sessionRuntimeService: {
        isEnabledForWorkspace: () => true,
        provisionSessionRuntime: async (_workspace: WorkspaceInfo, entry: any) => ({
          ...entry,
          opencodeRuntime: {
            mode: "isolated_process",
            rootDir: join(entry.runtimeDir, ".openwork-runtime", "opencode"),
            configDir: join(entry.runtimeDir, ".openwork-runtime", "opencode", "config"),
            configHomeDir: join(entry.runtimeDir, ".openwork-runtime", "opencode", "config-home"),
            dataDir: join(entry.runtimeDir, ".openwork-runtime", "opencode", "data"),
            stateDir: join(entry.runtimeDir, ".openwork-runtime", "opencode", "state"),
            cacheDir: join(entry.runtimeDir, ".openwork-runtime", "opencode", "cache"),
            tempDir: join(entry.runtimeDir, ".tmp", "system"),
            bindHost: "127.0.0.1",
          },
        }),
        startProvisionedRuntime: async () => ({
          baseUrl: "http://127.0.0.1:4555",
          pid: 4555,
          dispose: async () => undefined,
        }),
        registerSessionRuntime: (_workspaceId: string, sessionId: string) => {
          registeredSessionId = sessionId;
        },
      } as any,
    });

    expect(response.status).toBe(200);
    expect(captured.url).toBe("http://127.0.0.1:4555/session?directory=" + encodeURIComponent((await sessionWorkspaces.getWorkspace(workspace.id, "ses_isolated"))?.runtimeDir ?? ""));
    expect(registeredSessionId).toBe("ses_isolated");
    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_isolated");
    expect(runtime?.opencodeRuntime?.mode).toBe("isolated_process");
  });
});
