import { ApiError } from "./errors.js";
import type { ServerConfig } from "./types.js";

export type RagflowServerConfig = {
  baseUrl: string | null;
  apiKey: string | null;
  mcpUrl: string | null;
};

export type RagflowDatasetSummary = {
  id: string;
  name: string;
  description: string;
  documentCount: number | null;
  chunkCount: number | null;
  embeddingModel: string | null;
  permission: string | null;
};

export type RagflowRetrievalChunk = {
  id: string | null;
  content: string;
  datasetId: string | null;
  datasetName: string | null;
  documentId: string | null;
  documentName: string | null;
  similarity: number | null;
  vectorSimilarity: number | null;
  termSimilarity: number | null;
  positions: number[] | null;
  imageId: string | null;
};

export type RagflowRetrievalResult = {
  chunks: RagflowRetrievalChunk[];
  total: number;
  page: number;
  pageSize: number;
  question: string;
  datasetIds: string[];
};

export type RagflowRetrieveInput = {
  question: string;
  datasetIds: string[];
  page?: number | null;
  pageSize?: number | null;
  topK?: number | null;
  similarityThreshold?: number | null;
  vectorSimilarityWeight?: number | null;
  keyword?: boolean;
};

export type RagflowClient = {
  listDatasets: (options?: { query?: string | null; limit?: number | null }) => Promise<RagflowDatasetSummary[]>;
  retrieve: (input: RagflowRetrieveInput) => Promise<RagflowRetrievalResult>;
};

type RagflowApiEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function normalizeBaseUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  return trimmed.replace(/\/api\/v1$/i, "");
}

function normalizeToken(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numeric(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayOfStrings(value: unknown): string[] {
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

function describeFetchFailure(error: unknown): { message: string; details: Record<string, unknown> } {
  const rawMessage = error instanceof Error ? error.message.trim() : "";
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code.trim()
      : null;

  if (code === "ECONNRESET") {
    return {
      message: "RAGFlow connection was reset before it returned a response.",
      details: { code, cause: rawMessage || null },
    };
  }

  if (code === "ETIMEDOUT") {
    return {
      message: "RAGFlow did not respond before the request timed out.",
      details: { code, cause: rawMessage || null },
    };
  }

  return {
    message: rawMessage ? `RAGFlow request failed: ${rawMessage}` : "RAGFlow request failed before a response was received.",
    details: { code, cause: rawMessage || null },
  };
}

function getConfigValue(
  config: Pick<ServerConfig, "ragflow"> | undefined,
  key: "baseUrl" | "apiKey" | "mcpUrl",
): string | undefined {
  const value = config?.ragflow?.[key];
  return typeof value === "string" ? value : undefined;
}

export function resolveRagflowServerConfig(
  config?: Pick<ServerConfig, "ragflow">,
  env: Record<string, string | undefined> = process.env,
): RagflowServerConfig {
  const baseUrl =
    normalizeBaseUrl(getConfigValue(config, "baseUrl")) ??
    normalizeBaseUrl(env.RAGFLOW_BASE_URL) ??
    normalizeBaseUrl(env.RAGFLOW_URL) ??
    normalizeBaseUrl(env.RAGFLOW_APP_URL);
  const apiKey =
    normalizeToken(getConfigValue(config, "apiKey")) ??
    normalizeToken(env.RAGFLOW_API_KEY);
  const mcpUrl =
    normalizeBaseUrl(getConfigValue(config, "mcpUrl")) ??
    normalizeBaseUrl(env.RAGFLOW_MCP_URL);
  return { baseUrl, apiKey, mcpUrl };
}

export function getRagflowStatus(
  config?: Pick<ServerConfig, "ragflow">,
  env: Record<string, string | undefined> = process.env,
): {
  configured: boolean;
  available: boolean;
  baseUrl: string | null;
  mcpUrl: string | null;
  reason: string | null;
} {
  const resolved = resolveRagflowServerConfig(config, env);
  if (!resolved.baseUrl && !resolved.apiKey) {
    return {
      configured: false,
      available: false,
      baseUrl: null,
      mcpUrl: resolved.mcpUrl,
      reason: "Set RAGFLOW_BASE_URL and RAGFLOW_API_KEY on the OpenWork server.",
    };
  }
  if (!resolved.baseUrl) {
    return {
      configured: false,
      available: false,
      baseUrl: null,
      mcpUrl: resolved.mcpUrl,
      reason: "RAGFLOW_BASE_URL is missing.",
    };
  }
  if (!resolved.apiKey) {
    return {
      configured: false,
      available: false,
      baseUrl: resolved.baseUrl,
      mcpUrl: resolved.mcpUrl,
      reason: "RAGFLOW_API_KEY is missing.",
    };
  }
  return {
    configured: true,
    available: true,
    baseUrl: resolved.baseUrl,
    mcpUrl: resolved.mcpUrl,
    reason: null,
  };
}

async function fetchRagflowJson<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  fetchImpl: FetchLike,
  init?: RequestInit,
): Promise<T> {
  const url = `${baseUrl}/api/v1${path}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    const failure = describeFetchFailure(error);
    throw new ApiError(502, "ragflow_request_failed", failure.message, {
      url,
      ...failure.details,
    });
  }

  let payload: RagflowApiEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as RagflowApiEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(502, "ragflow_request_failed", payload?.message ?? `RAGFlow request failed with status ${response.status}`, {
      status: response.status,
      url,
    });
  }

  if (!payload || payload.code !== 0 || payload.data === undefined) {
    throw new ApiError(502, "ragflow_invalid_response", payload?.message ?? "RAGFlow returned an unexpected response.", {
      url,
    });
  }

  return payload.data;
}

function assertConfigured(config: RagflowServerConfig): { baseUrl: string; apiKey: string } {
  if (!config.baseUrl || !config.apiKey) {
    const reason = !config.baseUrl && !config.apiKey
      ? "Set RAGFLOW_BASE_URL and RAGFLOW_API_KEY on the OpenWork server."
      : !config.baseUrl
        ? "RAGFLOW_BASE_URL is missing."
        : "RAGFLOW_API_KEY is missing.";
    throw new ApiError(503, "ragflow_unavailable", reason);
  }
  return { baseUrl: config.baseUrl, apiKey: config.apiKey };
}

export function createRagflowClient(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
}): RagflowClient {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = normalizeToken(input.apiKey);
  if (!baseUrl || !apiKey) {
    throw new Error("RAGFlow baseUrl and apiKey are required");
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;

  return {
    async listDatasets(options) {
      const query = stringValue(options?.query);
      const limit = Math.max(1, Math.min(500, numeric(options?.limit) ?? 200));
      const search = new URLSearchParams();
      search.set("page", "1");
      search.set("page_size", String(limit));
      search.set("orderby", "create_time");
      search.set("desc", "true");
      if (query) search.set("name", query);

      const data = await fetchRagflowJson<Record<string, unknown>[]>(
        baseUrl,
        apiKey,
        `/datasets?${search.toString()}`,
        fetchImpl,
        { method: "GET" },
      );

      return data
        .map((entry) => ({
          id: stringValue(entry.id) ?? "",
          name: stringValue(entry.name) ?? "",
          description: stringValue(entry.description) ?? "",
          documentCount: numeric(entry.doc_num) ?? numeric(entry.document_count),
          chunkCount: numeric(entry.chunk_num) ?? numeric(entry.chunk_count),
          embeddingModel: stringValue(entry.embd_id) ?? stringValue(entry.embedding_model),
          permission: stringValue(entry.permission),
        }))
        .filter((entry) => entry.id && entry.name)
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    },

    async retrieve(input) {
      const question = stringValue(input.question);
      const datasetIds = arrayOfStrings(input.datasetIds);
      if (!question) {
        throw new ApiError(400, "invalid_ragflow_query", "A retrieval query is required.");
      }
      if (!datasetIds.length) {
        throw new ApiError(400, "invalid_ragflow_datasets", "At least one dataset is required.");
      }

      const page = Math.max(1, numeric(input.page) ?? 1);
      const topK = Math.max(1, Math.min(64, numeric(input.topK) ?? 8));
      const pageSize = Math.max(1, Math.min(20, numeric(input.pageSize) ?? topK));
      const similarityThreshold = numeric(input.similarityThreshold) ?? 0.2;
      const vectorSimilarityWeight = numeric(input.vectorSimilarityWeight) ?? 0.3;

      const data = await fetchRagflowJson<Record<string, unknown>>(
        baseUrl,
        apiKey,
        "/retrieval",
        fetchImpl,
        {
          method: "POST",
          body: JSON.stringify({
            page,
            page_size: pageSize,
            top_k: topK,
            similarity_threshold: similarityThreshold,
            vector_similarity_weight: vectorSimilarityWeight,
            keyword: input.keyword === true,
            question,
            dataset_ids: datasetIds,
            document_ids: [],
          }),
        },
      );

      const chunksRaw = Array.isArray(data.chunks) ? data.chunks : [];
      const chunks: RagflowRetrievalChunk[] = chunksRaw
        .map((entry) => {
          const chunk = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
          return {
            id: stringValue(chunk.id),
            content:
              stringValue(chunk.content_with_weight) ??
              stringValue(chunk.content) ??
              stringValue(chunk.content_ltks) ??
              "",
            datasetId: stringValue(chunk.dataset_id),
            datasetName: stringValue(chunk.dataset_name),
            documentId: stringValue(chunk.document_id),
            documentName: stringValue(chunk.document_name),
            similarity: numeric(chunk.similarity),
            vectorSimilarity: numeric(chunk.vector_similarity),
            termSimilarity: numeric(chunk.term_similarity),
            positions: Array.isArray(chunk.positions)
              ? chunk.positions.filter((value): value is number => typeof value === "number" && Number.isFinite(value))
              : null,
            imageId: stringValue(chunk.img_id),
          };
        })
        .filter((chunk) => chunk.content.trim().length > 0);

      return {
        chunks,
        total: numeric(data.total) ?? chunks.length,
        page: numeric(data.page) ?? page,
        pageSize: numeric(data.page_size) ?? pageSize,
        question,
        datasetIds,
      };
    },
  };
}

export function createConfiguredRagflowClient(
  config?: Pick<ServerConfig, "ragflow">,
  env: Record<string, string | undefined> = process.env,
): RagflowClient {
  return {
    async listDatasets(options) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient(resolved).listDatasets(options);
    },
    async retrieve(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient(resolved).retrieve(input);
    },
  };
}
