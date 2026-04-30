import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  refreshBidWorkbenchState,
  setBidWorkbenchOutlineSource,
  setBidWorkbenchSectionLock,
} from "./bid-workbench.js";
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

async function writeOutlineDocx(
  workspacePath: string,
  relativePath: string,
  items: Array<{ text: string; level?: number }>,
) {
  const absolutePath = join(
    workspacePath,
    "documents",
    relativePath,
  );
  await mkdir(dirname(absolutePath), { recursive: true });
  const script = `
import json
import sys
from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

def set_outline(paragraph, level):
    pPr = paragraph._p.get_or_add_pPr()
    outline = OxmlElement("w:outlineLvl")
    outline.set(qn("w:val"), str(level - 1))
    pPr.append(outline)

target = sys.argv[1]
items = json.loads(sys.argv[2])
document = Document()
for item in items:
    paragraph = document.add_paragraph(item["text"])
    level = item.get("level")
    if isinstance(level, int):
        set_outline(paragraph, level)
document.save(target)
`;
  const result = spawnSync("python3", ["-c", script, absolutePath, JSON.stringify(items)], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(String(result.stderr || result.stdout || "failed to write docx"));
  }
}

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

  test("does not provision runtime knowledge overlays for a standard session with no attached knowledge", async () => {
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
    expect(parsed.model).toBe("test-model");
    expect(parsed.mcp?.filesystem).toBeUndefined();
    expect(parsed.mcp?.memory).toBeUndefined();
    expect(parsed.mcp?.["openwork-knowledge"]).toBeUndefined();
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
    expect(parsed.instructions ?? []).not.toContain(".opencode/openwork-knowledge.md");
    expect(parsed.instructions ?? []).not.toContain(".opencode/doc-state.md");
    expect(runtimeInstructionRaw).toContain("Minimal runtime contract:");
    expect(runtimeInstructionRaw).toContain("<WORKSPACE>/.tmp/system");
    expect(runtimeInstructionRaw).toContain("external_directory");
    expect(parsed.mcp?.doc_state).toBeUndefined();
    expect(await exists(join(runtime?.runtimeDir ?? "", ".tmp", "system"))).toBe(true);
    await expect(readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-knowledge.md"), "utf8")).rejects.toThrow();
    await expect(readFile(join(runtime?.runtimeDir ?? "", ".opencode", "doc-state.md"), "utf8")).rejects.toThrow();
  });

  test("provisions document-state overlays when the session requests the document-writer runtime profile", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "ses_document_writer", title: "Document Writer Session" }), {
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
        body: JSON.stringify({ title: "Document Writer Session", openworkEnableDocState: true }),
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

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_document_writer");
    const raw = await readFile(join(runtime?.runtimeDir ?? "", "opencode.jsonc"), "utf8");
    const parsed = JSON.parse(raw) as {
      mcp?: Record<string, unknown>;
      instructions?: string[];
    };
    const runtimeInstructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-runtime.md"), "utf8");
    const docStateInstructionRaw = await readFile(join(runtime?.runtimeDir ?? "", ".opencode", "doc-state.md"), "utf8");

    expect(parsed.mcp?.doc_state).toBeTruthy();
    expect(parsed.mcp?.["openwork-knowledge"]).toBeUndefined();
    expect(parsed.instructions).toContain(".opencode/openwork-runtime.md");
    expect(parsed.instructions).toContain(".opencode/doc-state.md");
    expect(parsed.instructions ?? []).not.toContain(".opencode/openwork-knowledge.md");
    expect(runtimeInstructionRaw).toContain("Minimal runtime contract:");
    expect(docStateInstructionRaw).toContain("The `.worktree/**` files remain the source of truth");
    expect(docStateInstructionRaw).not.toContain("doc_state_state_get_brief");
    await expect(readFile(join(runtime?.runtimeDir ?? "", ".opencode", "openwork-knowledge.md"), "utf8")).rejects.toThrow();
  });

  test("uses preferred session hints for runtime pruning without forwarding them to OpenCode", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      return new Response(JSON.stringify({ id: "ses_pruned", title: "Pruned Session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await mkdir(join(workspace.path, ".opencode", "skills", "docx"), { recursive: true });
    await mkdir(join(workspace.path, ".opencode", "skills", "openwork-debug"), { recursive: true });
    await writeFile(join(workspace.path, ".opencode", "skills", "docx", "SKILL.md"), "# docx\n", "utf8");
    await writeFile(join(workspace.path, ".opencode", "skills", "openwork-debug", "SKILL.md"), "# debug\n", "utf8");

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session", {
        method: "POST",
        body: JSON.stringify({
          title: "Common Work Session",
          openworkPreferredView: "document-agent",
          openworkPreferredAgent: "common-work",
          openworkPreferredAgentLock: "common-work",
          openworkRuntimeProfileId: "bid-workbench-node",
          openworkRuntimeScopeKind: "bid-workbench-node",
          openworkRuntimeScopeKey: "node-a",
          openworkBidNodeId: "node-a",
        }),
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
    expect(captured.body?.openworkPreferredView).toBeUndefined();
    expect(captured.body?.openworkPreferredAgent).toBeUndefined();
    expect(captured.body?.openworkPreferredAgentLock).toBeUndefined();
    expect(captured.body?.openworkRuntimeProfileId).toBeUndefined();
    expect(captured.body?.openworkRuntimeScopeKind).toBeUndefined();
    expect(captured.body?.openworkRuntimeScopeKey).toBeUndefined();
    expect(captured.body?.openworkBidNodeId).toBeUndefined();
    expect(Array.isArray(captured.body?.permission)).toBe(true);
    expect(captured.body?.permission).toEqual(expect.arrayContaining([
      { permission: "external_directory", pattern: "*", action: "deny" },
      { permission: "glob", pattern: "**/*", action: "deny" },
      { permission: "bash", pattern: "*-o /tmp/*.md*", action: "deny" },
      { permission: "bash", pattern: "*> /private/tmp/*.docx*", action: "deny" },
    ]));

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_pruned");
    expect(await exists(join(runtime?.runtimeDir ?? "", ".opencode", "skills", "docx", "SKILL.md"))).toBe(true);
    expect(await exists(join(runtime?.runtimeDir ?? "", ".opencode", "skills", "openwork-debug", "SKILL.md"))).toBe(false);
  });

  test("never provisions isolated opencode runtimes during hosted session creation", async () => {
    const captured: { body?: Record<string, unknown> } = {};
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      captured.body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      return new Response(JSON.stringify({ id: "ses_shared", title: "Shared Session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session", {
        method: "POST",
        body: JSON.stringify({
          title: "Shared Session",
          openworkPreferredView: "document-agent",
          openworkPreferredAgent: "common-work",
          openworkPreferredAgentLock: "common-work",
          openworkRuntimeProfileId: "document-agent",
        }),
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
    expect(captured.body?.openworkPreferredView).toBeUndefined();
    expect(captured.body?.openworkPreferredAgent).toBeUndefined();
    expect(captured.body?.openworkPreferredAgentLock).toBeUndefined();
    expect(captured.body?.openworkRuntimeProfileId).toBeUndefined();

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_shared");
    expect(runtime?.runtimeDir).toBeTruthy();
    expect(runtime?.preferredView).toBe("document-agent");
    expect(runtime?.preferredAgent).toBe("common-work");
    expect(runtime?.preferredAgentLock).toBe("common-work");
  });

  test("rewrites the created session payload to the provisioned runtime directory and profile hints", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        id: "ses_created_runtime",
        title: "Created Runtime Session",
        directory: workspace.path,
      }), {
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
        body: JSON.stringify({
          title: "Created Runtime Session",
          openworkPreferredView: "document-agent",
          openworkPreferredAgent: "common-work",
          openworkPreferredAgentLock: "common-work",
          openworkRuntimeProfileId: "bid-workbench-node",
          openworkRuntimeScopeKind: "bid-workbench-node",
          openworkRuntimeScopeKey: "node-a",
          openworkBidNodeId: "node-a",
        }),
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

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_created_runtime");
    const payload = await response.json() as Record<string, unknown>;

    expect(payload.directory).toBe(runtime?.runtimeDir);
    expect(payload.openworkPreferredView).toBe("document-agent");
    expect(payload.openworkPreferredAgent).toBe("common-work");
    expect(payload.openworkPreferredAgentLock).toBe("common-work");
    expect(runtime?.runtimeProfileId).toBe("bid-workbench-node");
    expect(runtime?.runtimeScopeKind).toBe("bid-workbench-node");
    expect(runtime?.runtimeScopeKey).toBe("node-a");
    expect(runtime?.bidNodeId).toBe("node-a");
  });

  test("reduces common-work document sessions to the document runtime skill and MCP surface", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ id: "ses_document_surface", title: "Document Surface Session" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await writeFile(
      join(workspace.path, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          filesystem: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "."],
          },
          memory: {
            type: "local",
            command: ["npx", "-y", "@modelcontextprotocol/server-memory"],
          },
          "bocha-search": {
            type: "local",
            command: ["uv", "--directory", "/tmp/bocha", "run", "bocha-search-mcp"],
          },
        },
      }, null, 2),
      "utf8",
    );
    for (const skill of ["doc-coauthoring", "doc-normalize", "docx", "pdf", "pptx", "xlsx", "internal-comms", "openwork-debug"] as const) {
      await mkdir(join(workspace.path, ".opencode", "skills", skill), { recursive: true });
      await writeFile(join(workspace.path, ".opencode", "skills", skill, "SKILL.md"), `# ${skill}\n`, "utf8");
    }

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session", {
        method: "POST",
        body: JSON.stringify({
          title: "Document Surface Session",
          openworkPreferredView: "document-agent",
          openworkPreferredAgent: "common-work",
          openworkPreferredAgentLock: "common-work",
        }),
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

    const runtime = await sessionWorkspaces.getWorkspace(workspace.id, "ses_document_surface");
    const runtimeSkills = readdir(join(runtime?.runtimeDir ?? "", ".opencode", "skills"));
    const runtimeConfigRaw = await readFile(join(runtime?.runtimeDir ?? "", "opencode.jsonc"), "utf8");
    const runtimeConfig = JSON.parse(runtimeConfigRaw) as { mcp?: Record<string, unknown> };

    expect((await runtimeSkills).sort()).toEqual([
      "doc-coauthoring",
      "doc-normalize",
      "docx",
      "pdf",
      "pptx",
      "xlsx",
    ]);
    expect(Object.keys(runtimeConfig.mcp ?? {}).sort()).toEqual(["bocha-search"]);
  });

  test("rejects bid-workbench prompt when the section is locked by another user", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();
    const auth = {
      getUserByOwnerKey: async (ownerKey: string) => ({
        id: ownerKey,
        username: ownerKey === "owner-alice" ? "alice" : "bob",
        name: ownerKey === "owner-alice" ? "alice" : "bob",
        email: null,
        role: "user",
        createdAt: Date.now(),
      }),
    } as any;

    await sessionOwnership.setOwner(workspace.id, "ses_locked", "owner-alice");
    await sessionWorkspaces.setWorkspace(workspace.id, "ses_locked", {
      runtimeId: "rt_locked",
      runtimeDir: workspace.path,
      createdAt: Date.now(),
      bidNodeId: "node-a",
    } as any);

    await writeOutlineDocx(workspace.path, "bid-workbench/templates/template.docx", [
      { text: "第一章 节点A", level: 1 },
    ]);
    await setBidWorkbenchOutlineSource(workspace.path, {
      sourcePath: "bid-workbench/templates/template.docx",
      sourceType: "templates",
      structureSourceKind: "template",
    });
    const state = await refreshBidWorkbenchState(workspace.path);
    const node = state.nodes.find((entry) => entry.title === "第一章 节点A");
    expect(node).toBeDefined();
    await setBidWorkbenchSectionLock(workspace.path, {
      sectionId: node!.id,
      lockedBy: "bob",
    });
    await sessionWorkspaces.setWorkspace(workspace.id, "ses_locked", {
      runtimeId: "rt_locked",
      runtimeDir: workspace.path,
      createdAt: Date.now(),
      bidNodeId: node!.id,
    } as any);

    await expect(proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session/ses_locked/prompt", {
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session/ses_locked/prompt"),
      workspace,
      proxyPath: "/session/ses_locked/prompt",
      actor: { type: "remote", scope: "collaborator", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens,
      runtimeDocumentStateTokens,
      openworkBaseUrl: "http://127.0.0.1:8789",
      authService: auth,
    })).rejects.toMatchObject({
      status: 409,
      code: "bid_workbench_section_locked",
    });
  });

  test("injects bid-workbench prompt author metadata into session messages", async () => {
    let proxiedMessageId = "";
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/prompt")) {
        const payload = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
        proxiedMessageId = typeof payload.messageID === "string" ? payload.messageID : "";
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/message")) {
        return new Response(JSON.stringify([
          {
            info: { id: proxiedMessageId, role: "user" },
            parts: [{ id: "part_1", messageID: proxiedMessageId, type: "text", text: "hello" }],
          },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const sessionOwnership = new SessionOwnershipService();
    const sessionWorkspaces = new SessionWorkspaceService();
    const runtimeKnowledgeTokens = new RuntimeKnowledgeTokenService();
    const runtimeDocumentStateTokens = new RuntimeDocumentStateTokenService();
    const auth = {
      getUserByOwnerKey: async (ownerKey: string) => ({
        id: ownerKey,
        username: ownerKey === "owner-alice" ? "alice" : "bob",
        name: ownerKey === "owner-alice" ? "alice" : "bob",
        email: null,
        role: "user",
        createdAt: Date.now(),
      }),
    } as any;

    await writeOutlineDocx(workspace.path, "bid-workbench/templates/template.docx", [
      { text: "第一章 节点A", level: 1 },
    ]);
    await setBidWorkbenchOutlineSource(workspace.path, {
      sourcePath: "bid-workbench/templates/template.docx",
      sourceType: "templates",
      structureSourceKind: "template",
    });
    const state = await refreshBidWorkbenchState(workspace.path);
    const node = state.nodes.find((entry) => entry.title === "第一章 节点A");
    expect(node).toBeDefined();

    await sessionOwnership.setOwner(workspace.id, "ses_author", "owner-alice");
    await sessionWorkspaces.setWorkspace(workspace.id, "ses_author", {
      runtimeId: "rt_author",
      runtimeDir: workspace.path,
      createdAt: Date.now(),
      bidNodeId: node!.id,
    } as any);

    const promptResponse = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session/ses_author/prompt", {
        method: "POST",
        body: JSON.stringify({ text: "hello" }),
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session/ses_author/prompt"),
      workspace,
      proxyPath: "/session/ses_author/prompt",
      actor: { type: "remote", scope: "collaborator", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens,
      runtimeDocumentStateTokens,
      openworkBaseUrl: "http://127.0.0.1:8789",
      authService: auth,
    });

    expect(promptResponse.status).toBe(200);
    expect(proxiedMessageId).toBeTruthy();
    expect(proxiedMessageId).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);

    const messageResponse = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session/ses_author/message", {
        method: "GET",
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session/ses_author/message"),
      workspace,
      proxyPath: `/session/${encodeURIComponent("ses_author")}/message`,
      actor: { type: "remote", scope: "collaborator", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens,
      runtimeDocumentStateTokens,
      openworkBaseUrl: "http://127.0.0.1:8789",
      authService: auth,
    });

    expect(messageResponse.status).toBe(200);
    const messages = await messageResponse.json() as Array<Record<string, unknown>>;
    const first = messages[0] as Record<string, unknown>;
    const info = first.info as Record<string, unknown>;
    const metadata = info.metadata as Record<string, unknown>;
    expect(metadata.openworkPromptAuthor).toBe("alice");
  });


});
