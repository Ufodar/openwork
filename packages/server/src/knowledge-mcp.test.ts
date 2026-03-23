import { beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeAttachmentService } from "./knowledge-attachments.js";
import { KnowledgeRegistryService } from "./knowledge-registry.js";
import { handleKnowledgeMcpRequest } from "./knowledge-mcp.js";
import { RuntimeKnowledgeTokenService } from "./runtime-knowledge-tokens.js";
import type { RagflowClient } from "./ragflow.js";

describe("knowledge MCP handler", () => {
  let root: string;
  let registry: KnowledgeRegistryService;
  let attachments: KnowledgeAttachmentService;
  let runtimeTokens: RuntimeKnowledgeTokenService;
  let workspacePath: string;
  let ragflow: RagflowClient;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openwork-knowledge-mcp-"));
    process.env.OPENWORK_DATA_DIR = root;
    workspacePath = await mkdtemp(join(tmpdir(), "openwork-knowledge-mcp-workspace-"));
    await mkdir(join(workspacePath, "documents", "sessions", "rt_1"), { recursive: true });
    await mkdir(join(workspacePath, "documents", "sessions", "rt_2"), { recursive: true });

    registry = new KnowledgeRegistryService();
    attachments = new KnowledgeAttachmentService();
    runtimeTokens = new RuntimeKnowledgeTokenService();
    ragflow = {
      listDatasets: async () => [],
      createDataset: async () => ({
        id: "ds_1",
        name: "Dataset 1",
        description: "",
        documentCount: 0,
        chunkCount: 0,
        embeddingModel: null,
        permission: "me",
      }),
      uploadDocuments: async () => [],
      listDocuments: async () => [],
      startParse: async () => undefined,
      retrieve: async (input) => ({
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
      }),
    };
  });

  async function invoke(
    token: string,
    body: Record<string, unknown>,
  ) {
    return handleKnowledgeMcpRequest({
      request: new Request("http://openwork.local/workspace/ws_1/knowledge/mcp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      }),
      workspaceId: "ws_1",
      runtimeTokens,
      knowledgeAttachments: attachments,
      knowledgeRegistry: registry,
      ragflow,
      serverVersion: "0.11.121",
    });
  }

  test("lists only the knowledge tools", async () => {
    const issued = await runtimeTokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const response = await invoke(issued.token, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "openwork_knowledge_list_attached" },
          { name: "openwork_knowledge_search" },
        ],
      },
    });
  });

  test("runtime token scope resolves attachments from the bound runtime", async () => {
    await registry.upsert({
      knowledgeId: "kb_a",
      ragflowDatasetId: "ds_a",
      ownerUserId: "user_a",
      ownerDisplayName: "alice",
      title: "Alice Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await registry.upsert({
      knowledgeId: "kb_b",
      ragflowDatasetId: "ds_b",
      ownerUserId: "user_b",
      ownerDisplayName: "bob",
      title: "Bob Docs",
      source: "openwork",
      visibility: "visible_to_all_users",
      status: "ready",
    });
    await attachments.set("ws_1", "ses_1", "rt_1", ["kb_a"]);
    await attachments.set("ws_1", "ses_2", "rt_2", ["kb_b"]);
    const issued = await runtimeTokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const response = await invoke(issued.token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "openwork_knowledge_list_attached",
        arguments: {},
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      result: {
        isError: false,
        structuredContent: {
          runtimeId: "rt_1",
          knowledgeIds: ["kb_a"],
          items: [{ knowledgeId: "kb_a", title: "Alice Docs" }],
        },
      },
    });
  });

  test("knowledge_search without attachments returns no_attached_knowledge", async () => {
    const issued = await runtimeTokens.issue({ workspaceId: "ws_1", sessionId: "ses_1", runtimeId: "rt_1" });

    const response = await invoke(issued.token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "openwork_knowledge_search",
        arguments: { question: "What changed?" },
      },
    });

    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: 3,
      result: {
        isError: true,
        structuredContent: {
          code: "no_attached_knowledge",
        },
      },
    });
  });
});
