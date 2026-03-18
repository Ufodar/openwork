import { afterEach, describe, expect, test } from "bun:test";
import { getRagflowStatus, listRagflowDatasets, resolveRagflowServerConfig, retrieveFromRagflow } from "./ragflow.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("ragflow config", () => {
  test("reports unavailable when base url and api key are missing", () => {
    expect(getRagflowStatus({})).toEqual({
      configured: false,
      available: false,
      baseUrl: null,
      mcpUrl: null,
      reason: "Set RAGFLOW_BASE_URL and RAGFLOW_API_KEY on the OpenWork server.",
    });
  });

  test("normalizes configured base url", () => {
    expect(
      resolveRagflowServerConfig({
        RAGFLOW_BASE_URL: "http://127.0.0.1:32473/",
        RAGFLOW_API_KEY: "secret",
        RAGFLOW_MCP_URL: "http://127.0.0.1:30467/sse/",
      }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:32473",
      apiKey: "secret",
      mcpUrl: "http://127.0.0.1:30467/sse",
    });
  });
});

describe("ragflow api helpers", () => {
  test("maps dataset summaries", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: [
            {
              id: "ds_1",
              name: "Product Docs",
              description: "Release docs",
              doc_num: 12,
              chunk_num: 220,
              embd_id: "bge-large",
              permission: "me",
            },
          ],
        }),
      )) as unknown as typeof fetch;

    await expect(
      listRagflowDatasets(undefined, {
        RAGFLOW_BASE_URL: "http://127.0.0.1:32473",
        RAGFLOW_API_KEY: "secret",
      }),
    ).resolves.toEqual([
      {
        id: "ds_1",
        name: "Product Docs",
        description: "Release docs",
        documentCount: 12,
        chunkCount: 220,
        embeddingModel: "bge-large",
        permission: "me",
      },
    ]);
  });

  test("maps retrieval chunks and preserves selected datasets", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          code: 0,
          data: {
            total: 1,
            page: 1,
            page_size: 8,
            chunks: [
              {
                id: "chunk_1",
                content_with_weight: "Alpha beta gamma",
                dataset_id: "ds_1",
                dataset_name: "Product Docs",
                document_id: "doc_1",
                document_name: "spec.md",
                similarity: 0.91,
              },
            ],
          },
        }),
      )) as unknown as typeof fetch;

    await expect(
      retrieveFromRagflow(
        {
          question: "What changed?",
          datasetIds: ["ds_1"],
        },
        {
          RAGFLOW_BASE_URL: "http://127.0.0.1:32473",
          RAGFLOW_API_KEY: "secret",
        },
      ),
    ).resolves.toEqual({
      chunks: [
        {
          id: "chunk_1",
          content: "Alpha beta gamma",
          datasetId: "ds_1",
          datasetName: "Product Docs",
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
      question: "What changed?",
      datasetIds: ["ds_1"],
    });
  });

  test("wraps transport failures in an api error with a specific message", async () => {
    globalThis.fetch = (async () => {
      const error = new Error("The socket connection was closed unexpectedly.");
      Object.assign(error, { code: "ECONNRESET" });
      throw error;
    }) as unknown as typeof fetch;

    await expect(
      retrieveFromRagflow(
        {
          question: "What changed?",
          datasetIds: ["ds_1"],
        },
        {
          RAGFLOW_BASE_URL: "http://127.0.0.1:32473",
          RAGFLOW_API_KEY: "secret",
        },
      ),
    ).rejects.toMatchObject({
      status: 502,
      code: "ragflow_request_failed",
      message: "RAGFlow connection was reset before it returned a response.",
      details: {
        url: "http://127.0.0.1:32473/api/v1/retrieval",
        code: "ECONNRESET",
        cause: "The socket connection was closed unexpectedly.",
      },
    });
  });
});
