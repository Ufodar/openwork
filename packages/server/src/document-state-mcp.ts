import { join } from "node:path";

import {
  listDocumentStateSources,
  readDocumentStateBrief,
  readDocumentStateConflicts,
  readDocumentStateCoverage,
  readDocumentStateDoc,
  readDocumentStateFacts,
  readDocumentStatePlan,
} from "./document-state.js";
import type { RuntimeDocumentStateTokenService } from "./runtime-document-state-tokens.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const STATE_GET_BRIEF_TOOL = "state_get_brief";
const STATE_LIST_SOURCES_TOOL = "state_list_sources";
const STATE_GET_DOC_TOOL = "state_get_doc";
const STATE_GET_FACTS_TOOL = "state_get_facts";
const STATE_GET_CONFLICTS_TOOL = "state_get_conflicts";
const STATE_GET_PLAN_TOOL = "state_get_plan";
const STATE_GET_COVERAGE_TOOL = "state_get_coverage";

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

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
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
    isError,
  };
}

function toolError(code: string, message: string) {
  return buildToolPayload({ ok: false, code, message }, true);
}

export async function handleDocumentStateMcpRequest(input: {
  request: Request;
  workspaceId: string;
  workspacePath: string;
  runtimeTokens: RuntimeDocumentStateTokenService;
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
    return jsonRpcError(id, -32001, "Unauthorized runtime token", { code: "doc_state_runtime_unauthorized" }, 401);
  }

  if (payload.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }

  if (payload.method === "initialize") {
    return jsonRpcResult(id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {
        tools: { listChanged: false },
      },
      serverInfo: {
        name: "doc-state-mcp",
        version: input.serverVersion,
      },
    });
  }

  if (payload.method === "ping") {
    return jsonRpcResult(id, {});
  }

  if (payload.method === "tools/list") {
    return jsonRpcResult(id, {
      tools: [
        { name: STATE_GET_BRIEF_TOOL, title: "Get Document Brief", description: "Read the current document-task brief from workspace state.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: STATE_LIST_SOURCES_TOOL, title: "List Source States", description: "List normalized source-document state records from .worktree.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: STATE_GET_DOC_TOOL, title: "Get Source State", description: "Read one normalized source-document state record by doc_id.", inputSchema: { type: "object", properties: { doc_id: { type: "string" } }, required: ["doc_id"], additionalProperties: false } },
        { name: STATE_GET_FACTS_TOOL, title: "Get Facts", description: "Read the normalized facts payload for the current task.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: STATE_GET_CONFLICTS_TOOL, title: "Get Conflicts", description: "Read the current conflict list if present.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: STATE_GET_PLAN_TOOL, title: "Get Plan", description: "Read the current solution plan if present.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
        { name: STATE_GET_COVERAGE_TOOL, title: "Get Coverage", description: "Read the current coverage summary or report modules if present.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
      ],
    });
  }

  if (payload.method !== "tools/call") {
    return jsonRpcError(id, -32601, `Method not found: ${payload.method}`, { code: "method_not_found" }, 404);
  }

  const name = typeof payload.params?.name === "string" ? payload.params.name.trim() : "";
  const args = payload.params?.arguments && typeof payload.params.arguments === "object"
    ? payload.params.arguments as Record<string, unknown>
    : {};
  const runtimeDir = join(input.workspacePath, "documents", "sessions", runtime.runtimeId);

  if (name === STATE_GET_BRIEF_TOOL) {
    const brief = await readDocumentStateBrief(runtimeDir);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      ...(brief ?? { relativePath: ".worktree/index.json", phase: null, summary: null }),
    }));
  }

  if (name === STATE_LIST_SOURCES_TOOL) {
    const items = await listDocumentStateSources(runtimeDir);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      items,
    }));
  }

  if (name === STATE_GET_DOC_TOOL) {
    const docId = typeof args.doc_id === "string" ? args.doc_id.trim() : "";
    if (!docId) {
      return jsonRpcResult(id, toolError("invalid_payload", "doc_id is required"));
    }
    const doc = await readDocumentStateDoc(runtimeDir, docId);
    if (!doc) {
      return jsonRpcResult(id, toolError("doc_not_found", `No source state found for ${docId}`));
    }
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      ...doc,
    }));
  }

  if (name === STATE_GET_FACTS_TOOL) {
    const facts = await readDocumentStateFacts(runtimeDir);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      ...(facts ?? { relativePath: null, facts: [] }),
    }));
  }

  if (name === STATE_GET_CONFLICTS_TOOL) {
    const conflicts = await readDocumentStateConflicts(runtimeDir);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      ...(conflicts ?? { relativePath: null, conflicts: [] }),
    }));
  }

  if (name === STATE_GET_PLAN_TOOL) {
    const plan = await readDocumentStatePlan(runtimeDir);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      ...(plan ?? { relativePath: null }),
    }));
  }

  if (name === STATE_GET_COVERAGE_TOOL) {
    const coverage = await readDocumentStateCoverage(runtimeDir);
    return jsonRpcResult(id, buildToolPayload({
      ok: true,
      workspaceId: runtime.workspaceId,
      sessionId: runtime.sessionId,
      runtimeId: runtime.runtimeId,
      ...(coverage ?? { relativePath: null }),
    }));
  }

  return jsonRpcError(id, -32601, `Tool not found: ${name}`, { code: "tool_not_found" }, 404);
}
