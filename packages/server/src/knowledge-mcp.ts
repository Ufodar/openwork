import type { KnowledgeAttachmentService } from "./knowledge-attachments.js";
import type { KnowledgeRegistryService, KnowledgeRegistryRecord } from "./knowledge-registry.js";
import type { RagflowClient } from "./ragflow.js";
import type { RuntimeKnowledgeTokenService } from "./runtime-knowledge-tokens.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const KNOWLEDGE_LIST_TOOL = "openwork_knowledge_list_attached";
const KNOWLEDGE_SEARCH_TOOL = "openwork_knowledge_search";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function normalizeKnowledgeIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function isKnowledgeVisible(record: KnowledgeRegistryRecord): boolean {
  return record.visibility === "visible_to_all_users" && record.status !== "deleted";
}

function serializeKnowledgeRecord(record: KnowledgeRegistryRecord) {
  return {
    knowledgeId: record.knowledgeId,
    ragflowDatasetId: record.ragflowDatasetId,
    ownerUserId: record.ownerUserId,
    ownerDisplayName: record.ownerDisplayName,
    title: record.title,
    description: record.description ?? null,
    source: record.source,
    visibility: record.visibility,
    ingestionPreset: record.ingestionPreset ?? null,
    chunkMethod: record.chunkMethod ?? null,
    parserConfig: record.parserConfig ?? {},
    embeddingModel: record.embeddingModel ?? null,
    status: record.status,
    documentCount: record.documentCount ?? 0,
    chunkCount: record.chunkCount ?? 0,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcResult(id: string | number | null | undefined, result: unknown, status = 200): Response {
  return jsonResponse({ jsonrpc: "2.0", id: id ?? null, result }, status);
}

function jsonRpcError(
  id: string | number | null | undefined,
  code: number,
  message: string,
  data?: Record<string, unknown>,
  status = 200,
): Response {
  return jsonResponse({
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  }, status);
}

function buildToolPayload(structuredContent: Record<string, unknown>, isError = false) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent),
      },
    ],
    structuredContent,
    isError,
  };
}

function toolError(code: string, message: string) {
  return buildToolPayload({ ok: false, code, message }, true);
}

async function listKnowledgeRecordsByIds(
  knowledgeRegistry: KnowledgeRegistryService,
  knowledgeIds: string[],
): Promise<KnowledgeRegistryRecord[]> {
  const items: KnowledgeRegistryRecord[] = [];
  for (const knowledgeId of knowledgeIds) {
    const record = await knowledgeRegistry.get(knowledgeId);
    if (!record || !isKnowledgeVisible(record)) continue;
    items.push(record);
  }
  return items;
}

export async function handleKnowledgeMcpRequest(input: {
  request: Request;
  workspaceId: string;
  runtimeTokens: RuntimeKnowledgeTokenService;
  knowledgeAttachments: KnowledgeAttachmentService;
  knowledgeRegistry: KnowledgeRegistryService;
  ragflow: RagflowClient;
  serverVersion: string;
}): Promise<Response> {
  let payload: JsonRpcRequest;
  try {
    payload = await input.request.json() as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Invalid JSON body", { code: "invalid_json" }, 400);
  }

  const id = payload.id ?? null;
  if (payload.jsonrpc !== "2.0" || typeof payload.method !== "string" || !payload.method.trim()) {
    return jsonRpcError(id, -32600, "Invalid JSON-RPC request", { code: "invalid_request" }, 400);
  }

  const bearer = input.request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1] ?? "";
  const runtime = await input.runtimeTokens.resolve(bearer);
  if (!runtime || runtime.workspaceId !== input.workspaceId) {
    return jsonRpcError(id, -32001, "Unauthorized runtime token", { code: "knowledge_runtime_unauthorized" }, 401);
  }

  if (payload.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (payload.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: {
          listChanged: false,
        },
      },
      serverInfo: {
        name: "openwork-knowledge-mcp",
        version: input.serverVersion,
      },
    });
  }

  if (payload.method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (payload.method === "tools/list") {
    const attachedKnowledgeIds = await input.knowledgeAttachments.get(runtime.workspaceId, runtime.sessionId);
    const tools = [
      {
        name: KNOWLEDGE_LIST_TOOL,
        title: "List Attached Knowledge",
        description: "List the knowledge bases currently attached to this OpenWork session runtime.",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
    ];
    if (attachedKnowledgeIds.length > 0) {
      tools.push({
        name: KNOWLEDGE_SEARCH_TOOL,
        title: "Search Attached Knowledge",
        description: "Primary search tool for facts stored in the knowledge bases attached to this OpenWork session. Do not substitute graph-memory tools for this. Optionally narrow the search to a subset of attached knowledge_ids.",
        inputSchema: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "The search question to run against the attached knowledge bases.",
            },
            knowledge_ids: {
              type: "array",
              items: { type: "string" },
              description: "Optional subset of attached knowledge IDs to search for this call only.",
            },
          },
          required: ["question"],
          additionalProperties: false,
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      });
    }
    return jsonRpcResult(id, {
      tools,
    });
  }

  if (payload.method !== "tools/call") {
    return jsonRpcError(id, -32601, `Method not found: ${payload.method}`, { code: "method_not_found" }, 404);
  }

  const name = typeof payload.params?.name === "string" ? payload.params.name.trim() : "";
  const args = payload.params?.arguments && typeof payload.params.arguments === "object"
    ? payload.params.arguments as Record<string, unknown>
    : {};

  if (name === KNOWLEDGE_LIST_TOOL) {
    const knowledgeIds = await input.knowledgeAttachments.get(runtime.workspaceId, runtime.sessionId);
    const items = await listKnowledgeRecordsByIds(input.knowledgeRegistry, knowledgeIds);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      knowledgeIds,
      items: items.map(serializeKnowledgeRecord),
    }));
  }

  if (name !== KNOWLEDGE_SEARCH_TOOL) {
    return jsonRpcError(id, -32601, `Tool not found: ${name}`, { code: "tool_not_found" }, 404);
  }

  const question = typeof args.question === "string" ? args.question.trim() : "";
  if (!question) {
    return jsonRpcResult(id, toolError("invalid_payload", "question is required"));
  }
  const attachedKnowledgeIds = await input.knowledgeAttachments.get(runtime.workspaceId, runtime.sessionId);
  const overrideProvided = Object.prototype.hasOwnProperty.call(args, "knowledge_ids");
  const requestedKnowledgeIds = overrideProvided
    ? normalizeKnowledgeIdList(args.knowledge_ids)
    : attachedKnowledgeIds;
  if (!requestedKnowledgeIds.length) {
    return jsonRpcResult(id, toolError("no_attached_knowledge", "No knowledge bases are attached to this session."));
  }
  const attachedSet = new Set(attachedKnowledgeIds);
  if (overrideProvided && requestedKnowledgeIds.some((knowledgeId) => !attachedSet.has(knowledgeId))) {
    return jsonRpcResult(id, toolError("knowledge_scope_forbidden", "Requested knowledge_ids must already be attached to this session."));
  }

  const records = await listKnowledgeRecordsByIds(input.knowledgeRegistry, requestedKnowledgeIds);
  if (!records.length) {
    return jsonRpcResult(id, toolError("no_attached_knowledge", "No knowledge bases are attached to this session."));
  }
  if (records.length !== requestedKnowledgeIds.length) {
    return jsonRpcResult(id, toolError("invalid_knowledge_ids", "One or more requested knowledge_ids are unavailable."));
  }

  const recordByDatasetId = new Map(records.map((record) => [record.ragflowDatasetId, record]));
  const result = await input.ragflow.retrieve({
    question,
    datasetIds: records.map((record) => record.ragflowDatasetId),
  });

  return jsonRpcResult(id, buildToolPayload({
    ok: true,
    workspaceId: runtime.workspaceId,
    sessionId: runtime.sessionId,
    runtimeId: runtime.runtimeId,
    question: result.question,
    knowledgeIds: requestedKnowledgeIds,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
    items: result.chunks.map((chunk) => {
      const knowledge = chunk.datasetId ? recordByDatasetId.get(chunk.datasetId) ?? null : null;
      return {
        id: chunk.id,
        content: chunk.content,
        similarity: chunk.similarity,
        vectorSimilarity: chunk.vectorSimilarity,
        termSimilarity: chunk.termSimilarity,
        datasetId: chunk.datasetId,
        documentId: chunk.documentId,
        documentName: chunk.documentName,
        positions: chunk.positions,
        imageId: chunk.imageId,
        knowledgeId: knowledge?.knowledgeId ?? null,
        knowledgeTitle: knowledge?.title ?? null,
        ownerUserId: knowledge?.ownerUserId ?? null,
        ownerDisplayName: knowledge?.ownerDisplayName ?? null,
      };
    }),
  }));
}
