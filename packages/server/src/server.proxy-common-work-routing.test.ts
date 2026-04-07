import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { proxyOpencodeRequest } from "./server.js";
import { RuntimeDocumentStateTokenService } from "./runtime-document-state-tokens.js";
import { RuntimeKnowledgeTokenService } from "./runtime-knowledge-tokens.js";
import { SessionOwnershipService } from "./session-ownership.js";
import { provisionSessionWorkspace, SessionWorkspaceService } from "./session-workspaces.js";
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

describe("proxyOpencodeRequest common-work first-prompt routing", () => {
  let workspacePath = "";
  let workspace: WorkspaceInfo;
  let sessionWorkspaces: SessionWorkspaceService;
  let runtimeKnowledgeTokens: RuntimeKnowledgeTokenService;
  let runtimeDocumentStateTokens: RuntimeDocumentStateTokenService;

  beforeEach(async () => {
    process.env.OPENWORK_DATA_DIR = await mkdtemp(join(tmpdir(), "openwork-common-work-routing-data-"));
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-common-work-routing-workspace-"));
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({
        model: "test-model",
        mcp: {
          "bocha-search": {
            type: "remote",
            url: "https://bocha.example.invalid/mcp",
          },
        },
      }, null, 2),
      "utf8",
    );
    await mkdir(join(workspacePath, ".opencode", "runtime-support", "document-state"), { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "runtime-support", "document-state", "extract_doc_state.py"),
      "print('ok')\n",
      "utf8",
    );
    workspace = {
      id: "ws_1",
      name: "alice",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };
    sessionWorkspaces = new SessionWorkspaceService();
    runtimeKnowledgeTokens = {
      revokeRuntime: async () => undefined,
      issue: async () => ({ token: "owk_test", expiresAt: Date.now() + 60_000 }),
      resolve: async () => null,
    } as unknown as RuntimeKnowledgeTokenService;
    runtimeDocumentStateTokens = {
      revokeRuntime: async () => undefined,
      issue: async () => ({ token: "owdst_test", expiresAt: Date.now() + 60_000 }),
      resolve: async () => null,
    } as unknown as RuntimeDocumentStateTokenService;
  });

  async function parseRequestBody(init?: RequestInit): Promise<Record<string, unknown>> {
    if (!init?.body) return {};
    if (typeof init.body === "string") {
      return JSON.parse(init.body) as Record<string, unknown>;
    }
    const raw = await new Response(init.body as BodyInit).text();
    return raw ? JSON.parse(raw) as Record<string, unknown> : {};
  }

  test("promotes the first long-form formal common-work prompt to document-writer and upgrades the runtime profile", async () => {
    const sessionId = "ses_route_me";
    const runtime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });
    await sessionWorkspaces.setWorkspace(workspace.id, sessionId, {
      runtimeId: runtime.runtimeId,
      runtimeDir: runtime.runtimeDir,
      createdAt: 1,
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });

    const captured: { promptBody?: Record<string, unknown>; messageChecks: number } = { messageChecks: 0 };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      if (url.includes(`/session/${sessionId}/message`)) {
        captured.messageChecks += 1;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/session/${sessionId}/prompt_async`)) {
        captured.promptBody = await parseRequestBody(init);
        return new Response(JSON.stringify({ ok: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const response = await proxyOpencodeRequest({
      request: new Request(`http://openwork.local/w/${workspace.id}/opencode/session/${sessionId}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          agent: "common-work",
          parts: [{
            type: "text",
            text:
              "请你结合参考两篇文档以及查找网络中的一些资料，帮我写一份项目申报所需要的技术材料，围绕以下三部分进行扩充和对应材料补充，生成word文档。分三大系统，给出技术架构、技术路线、互联互通机制、标识系统构建等技术实现的方式方法，面向应用层，给出API调用的示例。",
          }],
        }),
      }),
      url: new URL(`http://openwork.local/w/${workspace.id}/opencode/session/${sessionId}/prompt_async`),
      workspace,
      proxyPath: `/session/${sessionId}/prompt_async`,
      actor: { type: "remote", scope: "owner", tokenHash: "owner-alice" },
      sessionOwnership: {
        getOwner: async () => "owner-alice",
        setOwner: async () => undefined,
        removeOwner: async () => undefined,
      } as unknown as SessionOwnershipService,
      sessionWorkspaces,
      runtimeKnowledgeTokens,
      runtimeDocumentStateTokens,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    expect(response.status).toBe(202);
    expect(captured.messageChecks).toBe(1);
    expect(captured.promptBody?.agent).toBe("document-writer");

    const stored = await sessionWorkspaces.getWorkspace(workspace.id, sessionId);
    expect(stored?.preferredView).toBe("document-writer");
    expect(stored?.preferredAgent).toBe("document-writer");
    expect(stored?.preferredAgentLock).toBe("document-writer");

    const profileRaw = await readFile(join(runtime.runtimeDir, ".opencode", "openwork-runtime-profile.json"), "utf8");
    const profile = JSON.parse(profileRaw) as { id?: string };
    expect(profile.id).toBe("document-writer");
    expect(
      await exists(join(runtime.runtimeDir, ".opencode", "runtime-support", "document-state", "extract_doc_state.py")),
    ).toBe(true);
  });

  test("keeps simple first-turn common-work prompts on common-work", async () => {
    const sessionId = "ses_keep_common";
    const runtime = await provisionSessionWorkspace(workspacePath, {
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });
    await sessionWorkspaces.setWorkspace(workspace.id, sessionId, {
      runtimeId: runtime.runtimeId,
      runtimeDir: runtime.runtimeDir,
      createdAt: 1,
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
    });

    const captured: { promptBody?: Record<string, unknown>; messageChecks: number } = { messageChecks: 0 };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof URL ? input.toString() : typeof input === "string" ? input : input.url;
      if (url.includes(`/session/${sessionId}/message`)) {
        captured.messageChecks += 1;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes(`/session/${sessionId}/prompt_async`)) {
        captured.promptBody = await parseRequestBody(init);
        return new Response(JSON.stringify({ ok: true }), {
          status: 202,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    const response = await proxyOpencodeRequest({
      request: new Request(`http://openwork.local/w/${workspace.id}/opencode/session/${sessionId}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          agent: "common-work",
          parts: [{
            type: "text",
            text: "请帮我整理当前上传材料的三个核心要点。",
          }],
        }),
      }),
      url: new URL(`http://openwork.local/w/${workspace.id}/opencode/session/${sessionId}/prompt_async`),
      workspace,
      proxyPath: `/session/${sessionId}/prompt_async`,
      actor: { type: "remote", scope: "owner", tokenHash: "owner-alice" },
      sessionOwnership: {
        getOwner: async () => "owner-alice",
        setOwner: async () => undefined,
        removeOwner: async () => undefined,
      } as unknown as SessionOwnershipService,
      sessionWorkspaces,
      runtimeKnowledgeTokens,
      runtimeDocumentStateTokens,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    expect(response.status).toBe(202);
    expect(captured.messageChecks).toBe(0);
    expect(captured.promptBody?.agent).toBe("common-work");

    const stored = await sessionWorkspaces.getWorkspace(workspace.id, sessionId);
    expect(stored?.preferredView).toBe("document-agent");
    expect(stored?.preferredAgent).toBe("common-work");
    expect(stored?.preferredAgentLock).toBe("common-work");

    const profileRaw = await readFile(join(runtime.runtimeDir, ".opencode", "openwork-runtime-profile.json"), "utf8");
    const profile = JSON.parse(profileRaw) as { id?: string };
    expect(profile.id).toBe("document-agent");
  });
});
