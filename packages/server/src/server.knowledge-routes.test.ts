import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeAttachmentService } from "./knowledge-attachments.js";
import { KnowledgeRegistryService } from "./knowledge-registry.js";
import type { RagflowClient } from "./ragflow.js";
import { RuntimeKnowledgeTokenService } from "./runtime-knowledge-tokens.js";
import { createRoutes, matchRoute } from "./server.js";
import { SessionOwnershipService } from "./session-ownership.js";
import { SessionWorkspaceService } from "./session-workspaces.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

type TestUser = {
  id: string;
  username: string;
  ownerKey: string;
};

describe("knowledge routes", () => {
  const originalFetch = globalThis.fetch;
  const originalOpenworkDataDir = process.env.OPENWORK_DATA_DIR;

  let workspacePath = "";
  let runtimeDir = "";
  let config: ServerConfig;
  let workspace: WorkspaceInfo;
  let registry: KnowledgeRegistryService;
  let attachments: KnowledgeAttachmentService;
  let sessionOwnership: SessionOwnershipService;
  let sessionWorkspaces: SessionWorkspaceService;
  let ragflowCalls: Array<{ question: string; datasetIds: string[] }> = [];
  let ragflowCreateDatasetCalls: Array<{
    name: string;
    description: string | null;
    chunkMethod: string | null;
    parserConfig: Record<string, unknown> | null;
  }> = [];
  let ragflowUploadCalls: Array<{
    datasetId: string;
    files: Array<{ name: string; size: number; type: string; text: string }>;
  }> = [];
  let ragflowDocumentsByDataset: Map<string, Array<{
    id: string;
    datasetId: string | null;
    name: string;
    size: number | null;
    chunkMethod: string | null;
    parserConfig: Record<string, unknown> | null;
    run: string | null;
    type: string | null;
    chunkCount?: number | null;
  }>>;
  let ragflowParseCalls: Array<{ datasetId: string; documentIds: string[] }> = [];
  let usersByOwnerKey: Map<string, TestUser>;
  let routes: ReturnType<typeof createRoutes>;
  let disposeCalls: string[] = [];

  beforeEach(async () => {
    process.env.OPENWORK_DATA_DIR = await mkdtemp(join(tmpdir(), "openwork-knowledge-data-"));
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-knowledge-workspace-"));
    runtimeDir = join(workspacePath, "documents", "sessions", "runtime_1");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(
      join(workspacePath, "opencode.jsonc"),
      JSON.stringify({ model: "test-model" }, null, 2),
      "utf8",
    );

    workspace = {
      id: "ws_1",
      name: "alice",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:8789",
    };
    config = {
      host: "127.0.0.1",
      port: 8789,
      token: "client-token",
      hostToken: "host-token",
      approval: { mode: "auto", timeoutMs: 1000 },
      corsOrigins: ["*"],
      workspaces: [workspace],
      authorizedRoots: [workspacePath],
      readOnly: false,
      startedAt: 1,
      tokenSource: "env",
      hostTokenSource: "env",
      logFormat: "pretty",
      logRequests: false,
    };

    registry = new KnowledgeRegistryService();
    attachments = new KnowledgeAttachmentService();
    sessionOwnership = new SessionOwnershipService();
    sessionWorkspaces = new SessionWorkspaceService();
    await sessionOwnership.setOwner(workspace.id, "ses_1", "owner-alice");
    await sessionWorkspaces.setWorkspace(workspace.id, "ses_1", {
      runtimeId: "runtime_1",
      runtimeDir,
      createdAt: Date.now(),
    });

    usersByOwnerKey = new Map([
      ["owner-alice", { id: "user_alice", username: "alice", ownerKey: "owner-alice" }],
      ["owner-bob", { id: "user_bob", username: "bob", ownerKey: "owner-bob" }],
    ]);

    ragflowCalls = [];
    ragflowCreateDatasetCalls = [];
    ragflowUploadCalls = [];
    ragflowDocumentsByDataset = new Map();
    ragflowParseCalls = [];
    disposeCalls = [];
    globalThis.fetch = (async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      disposeCalls.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const ragflow = {
      listDatasets: async () => [],
      createDataset: async (input) => {
        ragflowCreateDatasetCalls.push({
          name: input.name,
          description: input.description ?? null,
          chunkMethod: input.chunkMethod ?? null,
          parserConfig: input.parserConfig ?? null,
        });
        return {
          id: "ds_created",
          name: input.name,
          description: input.description ?? "",
          documentCount: 0,
          chunkCount: 0,
          embeddingModel: null,
          permission: "me",
          chunkMethod: input.chunkMethod ?? null,
          parserConfig: input.parserConfig ?? null,
        };
      },
      uploadDocuments: async (input) => {
        const capturedFiles = await Promise.all(input.files.map(async (file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          text: await file.text(),
        })));
        ragflowUploadCalls.push({
          datasetId: input.datasetId,
          files: capturedFiles,
        });
        return capturedFiles.map((file, index) => ({
          id: `doc_${index + 1}`,
          datasetId: input.datasetId,
          name: file.name,
          size: file.size,
          chunkMethod: "naive",
          parserConfig: { chunk_token_num: 2000 },
          run: "UNSTART",
          type: "doc",
        }));
      },
      listDocuments: async (input) => {
        return ragflowDocumentsByDataset.get(input.datasetId) ?? [];
      },
      startParse: async (input) => {
        ragflowParseCalls.push({
          datasetId: input.datasetId,
          documentIds: [...input.documentIds],
        });
      },
      retrieve: async (input) => {
        ragflowCalls.push({ question: input.question, datasetIds: [...input.datasetIds] });
        return {
          chunks: [
            {
              id: "chunk_1",
              content: "Alpha beta gamma",
              datasetId: input.datasetIds[0] ?? null,
              datasetName: null,
              documentId: "doc_1",
              documentName: "spec.md",
              similarity: 0.91,
              vectorSimilarity: null,
              termSimilarity: null,
              positions: null,
              imageId: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 8,
          question: input.question,
          datasetIds: [...input.datasetIds],
        };
      },
    } satisfies RagflowClient;

    routes = createRoutes(
      config,
      {} as any,
      {} as any,
      {
        getUserByOwnerKey: async (ownerKey: string) => {
          const user = usersByOwnerKey.get(ownerKey);
          if (!user) return null;
          return {
            id: user.id,
            username: user.username,
            createdAt: 1,
            lastLoginAt: 1,
            isAdmin: false,
            ownerKey: user.ownerKey,
            workspace: {
              id: workspace.id,
              name: workspace.name,
              path: workspace.path,
            },
          };
        },
      } as any,
      sessionOwnership,
      sessionWorkspaces,
      registry,
      attachments,
      ragflow,
      new RuntimeKnowledgeTokenService(),
      { getState: () => null } as any,
      { listActiveSessions: () => [] } as any,
      { log: () => undefined } as any,
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (typeof originalOpenworkDataDir === "string") {
      process.env.OPENWORK_DATA_DIR = originalOpenworkDataDir;
    } else {
      delete process.env.OPENWORK_DATA_DIR;
    }
  });

  async function invokeRoute(
    method: string,
    path: string,
    input?: {
      query?: string;
      body?: Record<string, unknown>;
      formData?: FormData;
      actor?: { type: "remote"; tokenHash: string; scope: "owner" | "collaborator" | "viewer" };
    },
  ) {
    const url = new URL(`http://openwork.local${path}${input?.query ? `?${input.query}` : ""}`);
    const matched = matchRoute(routes, method, url.pathname);
    expect(matched).toBeTruthy();
    if (!matched) throw new Error(`Route not found: ${method} ${path}`);

    return matched.handler({
      request: new Request(url, {
        method,
        body: input?.formData ? input.formData : input?.body ? JSON.stringify(input.body) : undefined,
        headers: input?.formData
          ? undefined
          : input?.body
            ? { "Content-Type": "application/json" }
            : undefined,
      }),
      url,
      params: matched.params,
      config,
      approvals: {} as any,
      reloadEvents: {} as any,
      tokens: {} as any,
      actor: input?.actor ?? { type: "remote", tokenHash: "owner-alice", scope: "collaborator" },
    });
  }

  test("lists mine and others from the knowledge registry", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "Alice Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await registry.upsert({
      knowledgeId: "kb_bob",
      ragflowDatasetId: "ds_bob",
      ownerUserId: "user_bob",
      ownerDisplayName: "bob",
      title: "Bob Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });

    const mine = await invokeRoute("GET", "/workspace/ws_1/knowledge", { query: "scope=mine" });
    const others = await invokeRoute("GET", "/workspace/ws_1/knowledge", { query: "scope=others" });

    await expect(mine.json()).resolves.toMatchObject({
      scope: "mine",
      items: [{ knowledgeId: "kb_alice", ownerDisplayName: "alice", title: "Alice Docs" }],
    });
    await expect(others.json()).resolves.toMatchObject({
      scope: "others",
      items: [{ knowledgeId: "kb_bob", ownerDisplayName: "bob", title: "Bob Docs" }],
    });
  });

  test("creates a personal knowledge base with ragflow defaults", async () => {
    const response = await invokeRoute("POST", "/workspace/ws_1/knowledge", {
      body: { title: "商业资质库" },
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      item: {
        ownerUserId: "user_alice",
        ownerDisplayName: "alice",
        title: "商业资质库",
        status: "ready",
        chunkMethod: "naive",
        parserConfig: {
          chunk_token_num: 2000,
          delimiter: "\n",
          layout_recognize: "True",
          html4excel: false,
          raptor: { use_raptor: false },
        },
      },
    });

    expect(ragflowCreateDatasetCalls).toEqual([
      {
        name: "商业资质库",
        description: null,
        chunkMethod: "naive",
        parserConfig: {
          chunk_token_num: 2000,
          delimiter: "\n",
          layout_recognize: "True",
          html4excel: false,
          raptor: { use_raptor: false },
        },
      },
    ]);

    const mine = await registry.listMine("user_alice");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      ragflowDatasetId: "ds_created",
      title: "商业资质库",
      ownerDisplayName: "alice",
      status: "ready",
      chunkMethod: "naive",
      parserConfig: {
        chunk_token_num: 2000,
      },
    });
  });

  test("listing knowledge refreshes processing state from ragflow documents", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "商业资质库",
      source: "openwork",
      visibility: "visible_to_all_users",
      chunkMethod: "naive",
      parserConfig: { chunk_token_num: 2000 },
      status: "processing",
      documentCount: 0,
      chunkCount: 0,
    });
    ragflowDocumentsByDataset.set("ds_alice", [
      {
        id: "doc_1",
        datasetId: "ds_alice",
        name: "license.pdf",
        size: 15,
        chunkMethod: "naive",
        parserConfig: { chunk_token_num: 2000 },
        run: "DONE",
        type: "doc",
        chunkCount: 4,
      },
      {
        id: "doc_2",
        datasetId: "ds_alice",
        name: "social.txt",
        size: 14,
        chunkMethod: "naive",
        parserConfig: { chunk_token_num: 2000 },
        run: "DONE",
        type: "doc",
        chunkCount: 3,
      },
    ]);

    const response = await invokeRoute("GET", "/workspace/ws_1/knowledge", { query: "scope=mine" });

    await expect(response.json()).resolves.toMatchObject({
      scope: "mine",
      items: [
        {
          knowledgeId: "kb_alice",
          status: "ready",
          documentCount: 2,
          chunkCount: 7,
        },
      ],
    });

    const stored = await registry.get("kb_alice");
    expect(stored).toMatchObject({
      status: "ready",
      documentCount: 2,
      chunkCount: 7,
    });
  });

  test("uploads documents to an owned knowledge base and starts parsing", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "商业资质库",
      source: "openwork",
      visibility: "visible_to_all_users",
      chunkMethod: "naive",
      parserConfig: {
        chunk_token_num: 2000,
        delimiter: "\n",
        layout_recognize: "True",
        html4excel: false,
        raptor: { use_raptor: false },
      },
      status: "ready",
      documentCount: 0,
      chunkCount: 0,
    });

    const form = new FormData();
    form.append("file", new File(["license-content"], "license.pdf", { type: "application/pdf" }));
    form.append("file", new File(["social-content"], "social.txt", { type: "text/plain" }));

    const response = await invokeRoute("POST", "/workspace/ws_1/knowledge/kb_alice/documents", {
      formData: form,
    });

    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      knowledgeId: "kb_alice",
      uploadedCount: 2,
      documentIds: ["doc_1", "doc_2"],
      item: {
        knowledgeId: "kb_alice",
        ragflowDatasetId: "ds_alice",
        status: "processing",
        documentCount: 2,
      },
    });

    expect(ragflowUploadCalls).toEqual([
      {
        datasetId: "ds_alice",
        files: [
          { name: "license.pdf", size: 15, type: "application/pdf", text: "license-content" },
          { name: "social.txt", size: 14, type: "text/plain;charset=utf-8", text: "social-content" },
        ],
      },
    ]);
    expect(ragflowParseCalls).toEqual([{ datasetId: "ds_alice", documentIds: ["doc_1", "doc_2"] }]);

    const stored = await registry.get("kb_alice");
    expect(stored).toMatchObject({
      knowledgeId: "kb_alice",
      status: "processing",
      documentCount: 2,
    });
  });

  test("saves and reads session knowledge attachments", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "Alice Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await registry.upsert({
      knowledgeId: "kb_bob",
      ragflowDatasetId: "ds_bob",
      ownerUserId: "user_bob",
      ownerDisplayName: "bob",
      title: "Bob Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });

    const saved = await invokeRoute("PUT", "/workspace/ws_1/sessions/ses_1/knowledge", {
      body: { knowledgeIds: ["kb_alice", "kb_bob", "kb_alice"] },
    });
    const loaded = await invokeRoute("GET", "/workspace/ws_1/sessions/ses_1/knowledge");

    await expect(saved.json()).resolves.toMatchObject({
      sessionId: "ses_1",
      runtimeId: "runtime_1",
      knowledgeIds: ["kb_alice", "kb_bob"],
    });
    await expect(loaded.json()).resolves.toMatchObject({
      sessionId: "ses_1",
      runtimeId: "runtime_1",
      knowledgeIds: ["kb_alice", "kb_bob"],
      items: [
        { knowledgeId: "kb_alice", ownerDisplayName: "alice" },
        { knowledgeId: "kb_bob", ownerDisplayName: "bob" },
      ],
    });

    const runtimeConfig = JSON.parse(await readFile(join(runtimeDir, "opencode.jsonc"), "utf8")) as {
      instructions?: string[];
      mcp?: Record<string, unknown>;
    };
    const instructionRaw = await readFile(join(runtimeDir, ".opencode", "openwork-knowledge.md"), "utf8");
    expect(runtimeConfig.instructions).toContain(".opencode/openwork-knowledge.md");
    expect(runtimeConfig.mcp?.["openwork-knowledge"]).toBeTruthy();
    expect(instructionRaw).toContain("Alice Docs");
    expect(instructionRaw).toContain("Bob Docs");
    const disposeOnlyCalls = disposeCalls.filter((url) => url.includes("/instance/dispose"));
    expect(disposeOnlyCalls).toHaveLength(1);
    expect(disposeOnlyCalls[0]).toContain(encodeURIComponent(runtimeDir));
  });

  test("rejects changing attached knowledge after the session already has history", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "Alice Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await registry.upsert({
      knowledgeId: "kb_bob",
      ragflowDatasetId: "ds_bob",
      ownerUserId: "user_bob",
      ownerDisplayName: "bob",
      title: "Bob Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await attachments.set(workspace.id, "ses_1", "runtime_1", ["kb_alice"]);

    globalThis.fetch = (async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes("/session/ses_1/message")) {
        return new Response(JSON.stringify([
          {
            id: "msg_1",
            info: { role: "user" },
            parts: [{ type: "text", text: "hello" }],
          },
        ]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      disposeCalls.push(url);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      invokeRoute("PUT", "/workspace/ws_1/sessions/ses_1/knowledge", {
        body: { knowledgeIds: ["kb_bob"] },
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "knowledge_scope_locked",
    });

    expect(await attachments.get(workspace.id, "ses_1")).toEqual(["kb_alice"]);
  });

  test("searches only within the attached knowledge set and returns registry labels", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "Alice Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await registry.upsert({
      knowledgeId: "kb_bob",
      ragflowDatasetId: "ds_bob",
      ownerUserId: "user_bob",
      ownerDisplayName: "bob",
      title: "Bob Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await attachments.set(workspace.id, "ses_1", "runtime_1", ["kb_alice", "kb_bob"]);

    const response = await invokeRoute("POST", "/workspace/ws_1/knowledge/search", {
      body: {
        sessionId: "ses_1",
        question: "What changed?",
        knowledgeIds: ["kb_bob"],
      },
    });

    expect(ragflowCalls).toEqual([{ question: "What changed?", datasetIds: ["ds_bob"] }]);
    await expect(response.json()).resolves.toMatchObject({
      question: "What changed?",
      knowledgeIds: ["kb_bob"],
      items: [
        {
          id: "chunk_1",
          knowledgeId: "kb_bob",
          knowledgeTitle: "Bob Docs",
          ownerDisplayName: "bob",
          datasetId: "ds_bob",
        },
      ],
    });
  });

  test("rejects search when no knowledge is attached", async () => {
    await expect(
      invokeRoute("POST", "/workspace/ws_1/knowledge/search", {
        body: {
          sessionId: "ses_1",
          question: "What changed?",
        },
      }),
    ).rejects.toMatchObject({
      status: 400,
      code: "no_attached_knowledge",
    });
  });

  test("rejects search overrides outside the attached knowledge set", async () => {
    await registry.upsert({
      knowledgeId: "kb_alice",
      ragflowDatasetId: "ds_alice",
      ownerUserId: "user_alice",
      ownerDisplayName: "alice",
      title: "Alice Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await registry.upsert({
      knowledgeId: "kb_bob",
      ragflowDatasetId: "ds_bob",
      ownerUserId: "user_bob",
      ownerDisplayName: "bob",
      title: "Bob Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await attachments.set(workspace.id, "ses_1", "runtime_1", ["kb_alice"]);

    await expect(
      invokeRoute("POST", "/workspace/ws_1/knowledge/search", {
        body: {
          sessionId: "ses_1",
          question: "What changed?",
          knowledgeIds: ["kb_bob"],
        },
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: "knowledge_scope_forbidden",
    });
  });
});
