import { describe, expect, test } from "bun:test";
import { buildRagflowContextText } from "./ragflow-context";

describe("buildRagflowContextText", () => {
  test("formats selected datasets and retrieved chunks into a prompt prelude", () => {
    const text = buildRagflowContextText({
      selection: {
        datasetIds: ["ds_1"],
        datasetNames: ["Product Docs"],
      },
      question: "What changed in the API?",
      chunks: [
        {
          id: "chunk_1",
          content: "  Added a new /v2/reports endpoint.  ",
          datasetId: "ds_1",
          datasetName: "Product Docs",
          documentId: "doc_1",
          documentName: "api.md",
          similarity: 0.93,
          vectorSimilarity: null,
          termSimilarity: null,
          positions: null,
          imageId: null,
        },
      ],
    });

    expect(text).toContain("Knowledge base context (RAGFlow, auto-attached for this session).");
    expect(text).toContain("Selected datasets: Product Docs");
    expect(text).toContain("Search query: What changed in the API?");
    expect(text).toContain("[1] dataset=Product Docs | document=api.md | score=0.93");
    expect(text).toContain("Added a new /v2/reports endpoint.");
  });

  test("still returns a useful message when nothing was retrieved", () => {
    const text = buildRagflowContextText({
      selection: {
        datasetIds: ["ds_1"],
        datasetNames: ["Policies"],
      },
      question: "Vacation carry-over",
      chunks: [],
    });

    expect(text).toContain("Selected datasets: Policies");
    expect(text).toContain("No matching passages were retrieved");
  });
});
