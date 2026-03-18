import { ApiError } from "./errors.js";

export type RagflowServerConfig = {
  baseUrl: string | null;
  apiKey: string | null;
  mcpUrl: string | null;
};

export type RagflowStatus = {
  configured: boolean;
  available: boolean;
  baseUrl: string | null;
  mcpUrl: string | null;
  reason: string | null;
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

type RagflowApiEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

const normalizeBaseUrl = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
};

const normalizeToken = (value: string | null | undefined): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const numeric = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const describeFetchFailure = (error: unknown): { message: string; details: Record<string, unknown> } => {
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
};

const arrayOfStrings = (value: unknown): string[] => {
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
};

export const resolveRagflowServerConfig = (
  env: Record<string, string | undefined> = process.env,
): RagflowServerConfig => {
  const baseUrl =
    normalizeBaseUrl(env.RAGFLOW_BASE_URL) ??
    normalizeBaseUrl(env.RAGFLOW_URL) ??
    normalizeBaseUrl(env.RAGFLOW_APP_URL);
  const apiKey = normalizeToken(env.RAGFLOW_API_KEY);
  const mcpUrl = normalizeBaseUrl(env.RAGFLOW_MCP_URL);
  return { baseUrl, apiKey, mcpUrl };
};

export const getRagflowStatus = (
  env: Record<string, string | undefined> = process.env,
): RagflowStatus => {
  const config = resolveRagflowServerConfig(env);
  if (!config.baseUrl && !config.apiKey) {
    return {
      configured: false,
      available: false,
      baseUrl: null,
      mcpUrl: config.mcpUrl,
      reason: "Set RAGFLOW_BASE_URL and RAGFLOW_API_KEY on the OpenWork server.",
    };
  }
  if (!config.baseUrl) {
    return {
      configured: false,
      available: false,
      baseUrl: null,
      mcpUrl: config.mcpUrl,
      reason: "RAGFLOW_BASE_URL is missing.",
    };
  }
  if (!config.apiKey) {
    return {
      configured: false,
      available: false,
      baseUrl: config.baseUrl,
      mcpUrl: config.mcpUrl,
      reason: "RAGFLOW_API_KEY is missing.",
    };
  }
  return {
    configured: true,
    available: true,
    baseUrl: config.baseUrl,
    mcpUrl: config.mcpUrl,
    reason: null,
  };
};

const ensureConfigured = (env?: Record<string, string | undefined>): RagflowServerConfig => {
  const config = resolveRagflowServerConfig(env);
  const status = getRagflowStatus(env);
  if (!status.available || !config.baseUrl || !config.apiKey) {
    throw new ApiError(503, "ragflow_unavailable", status.reason ?? "RAGFlow is not configured.");
  }
  return config;
};

const fetchRagflowJson = async <T>(
  config: RagflowServerConfig,
  path: string,
  init?: RequestInit,
): Promise<T> => {
  const url = `${config.baseUrl}/api/v1${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
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
};

export const listRagflowDatasets = async (
  options?: { query?: string | null; limit?: number | null },
  env?: Record<string, string | undefined>,
): Promise<RagflowDatasetSummary[]> => {
  const config = ensureConfigured(env);
  const query = stringValue(options?.query);
  const limit = Math.max(1, Math.min(500, numeric(options?.limit) ?? 200));
  const search = new URLSearchParams();
  search.set("page", "1");
  search.set("page_size", String(limit));
  search.set("orderby", "create_time");
  search.set("desc", "true");
  if (query) search.set("name", query);

  const data = await fetchRagflowJson<Record<string, unknown>[]>(
    config,
    `/datasets?${search.toString()}`,
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
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const retrieveFromRagflow = async (
  input: {
    question: string;
    datasetIds: string[];
    page?: number | null;
    pageSize?: number | null;
    topK?: number | null;
    similarityThreshold?: number | null;
    vectorSimilarityWeight?: number | null;
    keyword?: boolean;
  },
  env?: Record<string, string | undefined>,
): Promise<RagflowRetrievalResult> => {
  const config = ensureConfigured(env);
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
    config,
    "/retrieval",
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
  const chunks: RagflowRetrievalChunk[] = chunksRaw.map((entry) => {
    const chunk = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    return {
      id: stringValue(chunk.id),
      content:
        stringValue(chunk.content_with_weight) ??
        stringValue(chunk.content) ??
        stringValue(chunk["content_ltks"]) ??
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
  }).filter((chunk) => chunk.content.trim().length > 0);

  return {
    chunks,
    total: numeric(data.total) ?? chunks.length,
    page: numeric(data.page) ?? page,
    pageSize: numeric(data.page_size) ?? pageSize,
    question,
    datasetIds,
  };
};
