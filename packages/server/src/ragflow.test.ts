import { afterEach, describe, expect, test } from "bun:test";

import { createRagflowClient, getRagflowStatus, resolveRagflowServerConfig } from "./ragflow.js";

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
      resolveRagflowServerConfig(undefined, {
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

describe("ragflow client", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("search sends explicit dataset_ids and never relies on backend fallback", async () => {
    const calls: unknown[] = [];
    const client = createRagflowClient({
      baseUrl: "http://ragflow.local",
      apiKey: "test",
      fetchImpl: async (_url, init) => {
        calls.push(JSON.parse(String(init?.body ?? "{}")));
        return new Response(
          JSON.stringify({
            code: 0,
            data: {
              total: 0,
              page: 1,
              page_size: 8,
              chunks: [],
            },
          }),
          { status: 200 },
        );
      },
    });

    await client.retrieve({ question: "test", datasetIds: ["ds_1"] });

    expect(calls).toHaveLength(1);
    expect((calls[0] as { dataset_ids?: string[] }).dataset_ids).toEqual(["ds_1"]);
  });

  test("maps dataset summaries", async () => {
    const client = createRagflowClient({
      baseUrl: "http://ragflow.local",
      apiKey: "test",
      fetchImpl: async () =>
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
          { status: 200 },
        ),
    });

    await expect(client.listDatasets()).resolves.toEqual([
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
    const client = createRagflowClient({
      baseUrl: "http://ragflow.local",
      apiKey: "test",
      fetchImpl: async () =>
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
          { status: 200 },
        ),
    });

    await expect(client.retrieve({ question: "What changed?", datasetIds: ["ds_1"] })).resolves.toEqual({
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
});
