import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { ApiError } from "./errors.js";
import type { ServerConfig } from "./types.js";

export type RagflowServerConfig = {
  baseUrl: string | null;
  apiKey: string | null;
  mcpUrl: string | null;
  insecureTls: boolean;
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

export type RagflowDatasetCreateInput = {
  name: string;
  description?: string | null;
  embeddingModel?: string | null;
  permission?: string | null;
  chunkMethod?: string | null;
  parserConfig?: Record<string, unknown> | null;
};

export type RagflowDocumentSummary = {
  id: string;
  datasetId: string | null;
  name: string;
  size: number | null;
  chunkCount: number | null;
  chunkMethod: string | null;
  parserConfig: Record<string, unknown> | null;
  run: string | null;
  type: string | null;
};

export type RagflowUploadDocumentsInput = {
  datasetId: string;
  files: File[];
};

export type RagflowStartParseInput = {
  datasetId: string;
  documentIds: string[];
};

export type RagflowListDocumentsInput = {
  datasetId: string;
  limit?: number | null;
};

export type RagflowDeleteDocumentsInput = {
  datasetId: string;
  documentIds: string[];
};

export type RagflowDeleteDatasetInput = {
  datasetId: string;
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
  createDataset: (input: RagflowDatasetCreateInput) => Promise<RagflowDatasetSummary>;
  uploadDocuments: (input: RagflowUploadDocumentsInput) => Promise<RagflowDocumentSummary[]>;
  listDocuments: (input: RagflowListDocumentsInput) => Promise<RagflowDocumentSummary[]>;
  startParse: (input: RagflowStartParseInput) => Promise<void>;
  deleteDocuments: (input: RagflowDeleteDocumentsInput) => Promise<void>;
  deleteDataset: (input: RagflowDeleteDatasetInput) => Promise<void>;
  retrieve: (input: RagflowRetrieveInput) => Promise<RagflowRetrievalResult>;
};

type RagflowApiEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type RequestTransport = (input: { url: string; init?: RequestInit; allowInsecureTls: boolean }) => Promise<Response>;

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

function parseBoolean(value: string | boolean | null | undefined): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return undefined;
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

function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeParserConfig(value: unknown): Record<string, unknown> | null {
  const object = objectValue(value);
  return object ? { ...object } : null;
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

function getConfigBoolean(
  config: Pick<ServerConfig, "ragflow"> | undefined,
  key: "insecureTls",
): boolean | undefined {
  const value = config?.ragflow?.[key];
  return typeof value === "boolean" ? value : undefined;
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
  const insecureTls =
    getConfigBoolean(config, "insecureTls") ??
    parseBoolean(env.RAGFLOW_INSECURE_TLS) ??
    parseBoolean(env.RAGFLOW_SKIP_TLS_VERIFY) ??
    false;
  return { baseUrl, apiKey, mcpUrl, insecureTls };
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

async function fetchRagflowEnvelope<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  fetchImpl: FetchLike,
  requestImpl: RequestTransport | undefined,
  allowInsecureTls: boolean,
  init?: RequestInit,
): Promise<{ url: string; response: Response; payload: RagflowApiEnvelope<T> | null }> {
  const url = `${baseUrl}/api/v1${path}`;
  let response: Response;
  try {
    const headers = new Headers(init?.headers ?? {});
    headers.set("Authorization", `Bearer ${apiKey}`);
    headers.set("Accept", "application/json");
    if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    const nextInit = {
      ...init,
      headers,
    };
    const shouldUseRequestTransport = allowInsecureTls && new URL(url).protocol === "https:";
    if (shouldUseRequestTransport) {
      response = await (requestImpl ?? nodeRequestTransport)({
        url,
        init: nextInit,
        allowInsecureTls,
      });
    } else {
      response = await fetchImpl(url, nextInit);
    }
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

  return { url, response, payload };
}

function assertRagflowEnvelopeSucceeded<T>(
  input: { url: string; response: Response; payload: RagflowApiEnvelope<T> | null },
): asserts input is { url: string; response: Response; payload: RagflowApiEnvelope<T> } {
  const { url, response, payload } = input;
  if (!response.ok) {
    throw new ApiError(502, "ragflow_request_failed", payload?.message ?? `RAGFlow request failed with status ${response.status}`, {
      status: response.status,
      url,
    });
  }

  if (!payload || payload.code !== 0) {
    throw new ApiError(502, "ragflow_invalid_response", payload?.message ?? "RAGFlow returned an unexpected response.", {
      url,
    });
  }
}

async function fetchRagflowJson<T>(
  baseUrl: string,
  apiKey: string,
  path: string,
  fetchImpl: FetchLike,
  requestImpl: RequestTransport | undefined,
  allowInsecureTls: boolean,
  init?: RequestInit,
): Promise<T> {
  const result = await fetchRagflowEnvelope<T>(baseUrl, apiKey, path, fetchImpl, requestImpl, allowInsecureTls, init);
  assertRagflowEnvelopeSucceeded(result);
  if (result.payload.data === undefined) {
    throw new ApiError(502, "ragflow_invalid_response", "RAGFlow returned an unexpected response.", {
      url: result.url,
    });
  }
  return result.payload.data;
}

async function fetchRagflowOk(
  baseUrl: string,
  apiKey: string,
  path: string,
  fetchImpl: FetchLike,
  requestImpl: RequestTransport | undefined,
  allowInsecureTls: boolean,
  init?: RequestInit,
): Promise<void> {
  const result = await fetchRagflowEnvelope<unknown>(
    baseUrl,
    apiKey,
    path,
    fetchImpl,
    requestImpl,
    allowInsecureTls,
    init,
  );
  assertRagflowEnvelopeSucceeded(result);
}

function toHeadersInit(input: Record<string, string | string[] | undefined>): [string, string][] {
  const next: [string, string][] = [];
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.length > 0) {
      next.push([key, value]);
      continue;
    }
    if (Array.isArray(value) && value.length > 0) {
      next.push([key, value.join(", ")]);
    }
  }
  return next;
}

async function nodeRequestTransport(input: {
  url: string;
  init?: RequestInit;
  allowInsecureTls: boolean;
}): Promise<Response> {
  const request = new Request(input.url, input.init);
  const url = new URL(request.url);
  const requestBodyAllowed = request.method !== "GET" && request.method !== "HEAD";
  const body = requestBodyAllowed ? Buffer.from(await request.arrayBuffer()) : null;
  const headers = new Headers(request.headers);
  if (body && body.length > 0 && !headers.has("Content-Length")) {
    headers.set("Content-Length", String(body.length));
  }

  return await new Promise<Response>((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = transport(
      url,
      {
        method: request.method,
        headers: Object.fromEntries(headers.entries()),
        ...(url.protocol === "https:" ? { rejectUnauthorized: !input.allowInsecureTls } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: toHeadersInit(res.headers),
            }),
          );
        });
      },
    );

    req.on("error", reject);
    req.setTimeout(15000, () => {
      const error = new Error("RAGFlow request timed out.");
      Object.assign(error, { code: "ETIMEDOUT" });
      req.destroy(error);
    });

    if (body && body.length > 0) {
      req.write(body);
    }
    req.end();
  });
}

function mapDatasetSummary(entry: Record<string, unknown>): RagflowDatasetSummary | null {
  const id = stringValue(entry.id);
  const name = stringValue(entry.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: stringValue(entry.description) ?? "",
    documentCount: numeric(entry.doc_num) ?? numeric(entry.document_count),
    chunkCount: numeric(entry.chunk_num) ?? numeric(entry.chunk_count),
    embeddingModel: stringValue(entry.embd_id) ?? stringValue(entry.embedding_model),
    permission: stringValue(entry.permission),
  };
}

function mapDocumentSummary(entry: Record<string, unknown>): RagflowDocumentSummary | null {
  const id = stringValue(entry.id);
  const name = stringValue(entry.name);
  if (!id || !name) return null;
  return {
    id,
    datasetId: stringValue(entry.dataset_id) ?? stringValue(entry.knowledgebase_id),
    name,
    size: numeric(entry.size),
    chunkCount: numeric(entry.chunk_count),
    chunkMethod: stringValue(entry.chunk_method) ?? stringValue(entry.parser_id),
    parserConfig: normalizeParserConfig(entry.parser_config),
    run: stringValue(entry.run),
    type: stringValue(entry.type),
  };
}

function assertConfigured(config: RagflowServerConfig): { baseUrl: string; apiKey: string; insecureTls: boolean } {
  if (!config.baseUrl || !config.apiKey) {
    const reason = !config.baseUrl && !config.apiKey
      ? "Set RAGFLOW_BASE_URL and RAGFLOW_API_KEY on the OpenWork server."
      : !config.baseUrl
        ? "RAGFLOW_BASE_URL is missing."
        : "RAGFLOW_API_KEY is missing.";
    throw new ApiError(503, "ragflow_unavailable", reason);
  }
  return { baseUrl: config.baseUrl, apiKey: config.apiKey, insecureTls: config.insecureTls };
}

export function createRagflowClient(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  requestImpl?: RequestTransport;
  allowInsecureTls?: boolean;
}): RagflowClient {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const apiKey = normalizeToken(input.apiKey);
  if (!baseUrl || !apiKey) {
    throw new Error("RAGFlow baseUrl and apiKey are required");
  }
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  const requestImpl = input.requestImpl;
  const allowInsecureTls = input.allowInsecureTls === true;

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
        requestImpl,
        allowInsecureTls,
        { method: "GET" },
      );

      return data
        .map((entry) => mapDatasetSummary(entry))
        .filter((entry): entry is RagflowDatasetSummary => Boolean(entry))
        .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    },

    async createDataset(input) {
      const name = stringValue(input.name);
      if (!name) {
        throw new ApiError(400, "invalid_ragflow_dataset", "A dataset name is required.");
      }
      const payload = {
        name,
        ...(stringValue(input.description) ? { description: stringValue(input.description) } : {}),
        ...(stringValue(input.embeddingModel) ? { embedding_model: stringValue(input.embeddingModel) } : {}),
        ...(stringValue(input.permission) ? { permission: stringValue(input.permission) } : {}),
        ...(stringValue(input.chunkMethod) ? { chunk_method: stringValue(input.chunkMethod) } : {}),
        ...(normalizeParserConfig(input.parserConfig) ? { parser_config: normalizeParserConfig(input.parserConfig) } : {}),
      };

      const data = await fetchRagflowJson<Record<string, unknown>>(
        baseUrl,
        apiKey,
        "/datasets",
        fetchImpl,
        requestImpl,
        allowInsecureTls,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );

      const summary = mapDatasetSummary(data);
      if (!summary) {
        throw new ApiError(502, "ragflow_invalid_response", "RAGFlow returned an unexpected dataset response.", {
          url: `${baseUrl}/api/v1/datasets`,
        });
      }
      return summary;
    },

    async uploadDocuments(input) {
      const datasetId = stringValue(input.datasetId);
      if (!datasetId) {
        throw new ApiError(400, "invalid_ragflow_dataset", "A dataset id is required.");
      }
      const files = Array.isArray(input.files) ? input.files.filter((file): file is File => file instanceof File) : [];
      if (!files.length) {
        throw new ApiError(400, "invalid_ragflow_documents", "At least one file is required.");
      }

      const form = new FormData();
      for (const file of files) form.append("file", file, file.name);

      const data = await fetchRagflowJson<Record<string, unknown>[]>(
        baseUrl,
        apiKey,
        `/datasets/${encodeURIComponent(datasetId)}/documents`,
        fetchImpl,
        requestImpl,
        allowInsecureTls,
        {
          method: "POST",
          body: form,
        },
      );

      return data
        .map((entry) => mapDocumentSummary(entry))
        .filter((entry): entry is RagflowDocumentSummary => Boolean(entry));
    },

    async listDocuments(input) {
      const datasetId = stringValue(input.datasetId);
      if (!datasetId) {
        throw new ApiError(400, "invalid_ragflow_dataset", "A dataset id is required.");
      }
      const limit = Math.max(1, Math.min(500, numeric(input.limit) ?? 200));
      const search = new URLSearchParams();
      search.set("page", "1");
      search.set("page_size", String(limit));
      search.set("orderby", "create_time");
      search.set("desc", "true");

      const data = await fetchRagflowJson<Record<string, unknown>>(
        baseUrl,
        apiKey,
        `/datasets/${encodeURIComponent(datasetId)}/documents?${search.toString()}`,
        fetchImpl,
        requestImpl,
        allowInsecureTls,
        { method: "GET" },
      );

      const docs = Array.isArray(data.docs) ? data.docs : [];
      return docs
        .map((entry) => {
          const object = objectValue(entry);
          return object ? mapDocumentSummary(object) : null;
        })
        .filter((entry): entry is RagflowDocumentSummary => Boolean(entry));
    },

    async startParse(input) {
      const datasetId = stringValue(input.datasetId);
      const documentIds = arrayOfStrings(input.documentIds);
      if (!datasetId) {
        throw new ApiError(400, "invalid_ragflow_dataset", "A dataset id is required.");
      }
      if (!documentIds.length) {
        throw new ApiError(400, "invalid_ragflow_documents", "At least one document id is required.");
      }
      await fetchRagflowOk(
        baseUrl,
        apiKey,
        `/datasets/${encodeURIComponent(datasetId)}/chunks`,
        fetchImpl,
        requestImpl,
        allowInsecureTls,
        {
          method: "POST",
          body: JSON.stringify({ document_ids: documentIds }),
        },
      );
    },

    async deleteDocuments(input) {
      const datasetId = stringValue(input.datasetId);
      const documentIds = arrayOfStrings(input.documentIds);
      if (!datasetId) {
        throw new ApiError(400, "invalid_ragflow_dataset", "A dataset id is required.");
      }
      if (!documentIds.length) {
        throw new ApiError(400, "invalid_ragflow_documents", "At least one document id is required.");
      }
      await fetchRagflowOk(
        baseUrl,
        apiKey,
        `/datasets/${encodeURIComponent(datasetId)}/documents`,
        fetchImpl,
        requestImpl,
        allowInsecureTls,
        {
          method: "DELETE",
          body: JSON.stringify({ ids: documentIds }),
        },
      );
    },

    async deleteDataset(input) {
      const datasetId = stringValue(input.datasetId);
      if (!datasetId) {
        throw new ApiError(400, "invalid_ragflow_dataset", "A dataset id is required.");
      }
      await fetchRagflowOk(
        baseUrl,
        apiKey,
        "/datasets",
        fetchImpl,
        requestImpl,
        allowInsecureTls,
        {
          method: "DELETE",
          body: JSON.stringify({ ids: [datasetId] }),
        },
      );
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
        requestImpl,
        allowInsecureTls,
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
  clientOptions?: {
    fetchImpl?: FetchLike;
    requestImpl?: RequestTransport;
  },
): RagflowClient {
  return {
    async listDatasets(listOptions) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).listDatasets(listOptions);
    },
    async createDataset(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).createDataset(input);
    },
    async uploadDocuments(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).uploadDocuments(input);
    },
    async listDocuments(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).listDocuments(input);
    },
    async startParse(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).startParse(input);
    },
    async deleteDocuments(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).deleteDocuments(input);
    },
    async deleteDataset(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).deleteDataset(input);
    },
    async retrieve(input) {
      const resolved = assertConfigured(resolveRagflowServerConfig(config, env));
      return createRagflowClient({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        allowInsecureTls: resolved.insecureTls,
        fetchImpl: clientOptions?.fetchImpl,
        requestImpl: clientOptions?.requestImpl,
      }).retrieve(input);
    },
  };
}

export async function listRagflowDatasets(
  options?: { query?: string | null; limit?: number | null },
  config?: Pick<ServerConfig, "ragflow">,
  env: Record<string, string | undefined> = process.env,
): Promise<RagflowDatasetSummary[]> {
  return createConfiguredRagflowClient(config, env).listDatasets(options);
}

export async function retrieveFromRagflow(
  input: RagflowRetrieveInput,
  config?: Pick<ServerConfig, "ragflow">,
  env: Record<string, string | undefined> = process.env,
): Promise<RagflowRetrievalResult> {
  return createConfiguredRagflowClient(config, env).retrieve(input);
}
