import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeAttachmentService } from "./knowledge-attachments.js";
import { KnowledgeRegistryService } from "./knowledge-registry.js";
import type { RagflowClient } from "./ragflow.js";
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
  let usersByOwnerKey: Map<string, TestUser>;
  let routes: ReturnType<typeof createRoutes>;

  beforeEach(async () => {
    process.env.OPENWORK_DATA_DIR = await mkdtemp(join(tmpdir(), "openwork-knowledge-data-"));
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-knowledge-workspace-"));
    runtimeDir = join(workspacePath, "documents", "sessions", "runtime_1");
    await mkdir(runtimeDir, { recursive: true });

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
    const ragflow = {
      listDatasets: async () => [],
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
      { getState: () => null } as any,
      {} as any,
      { log: () => undefined } as any,
    );
  });

  afterEach(() => {
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
        body: input?.body ? JSON.stringify(input.body) : undefined,
        headers: input?.body ? { "Content-Type": "application/json" } : undefined,
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
