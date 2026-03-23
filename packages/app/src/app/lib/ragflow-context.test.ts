import { describe, expect, test } from "bun:test";
import { buildKnowledgeSearchContextText, buildRagflowContextText } from "./ragflow-context";

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

  test("formats attached knowledge search results into a prompt prelude", () => {
    const text = buildKnowledgeSearchContextText({
      knowledgeIds: ["kb_1"],
      knowledgeTitles: ["wjw产品信息验收-0323"],
      question: "海滨医院的交换机型号有哪些？",
      items: [
        {
          id: "chunk_1",
          content: "海滨医院 交换机 CE6855-48XS8CQ；海滨医院 交换机 S5755-H24T4Y2CZ",
          similarity: 0.82,
          vectorSimilarity: 0.91,
          termSimilarity: 0.73,
          datasetId: "ds_1",
          documentId: "doc_1",
          documentName: "设备型号.xlsx",
          positions: [],
          imageId: null,
          knowledgeId: "kb_1",
          knowledgeTitle: "wjw产品信息验收-0323",
          ownerUserId: "user_1",
          ownerDisplayName: "fuda",
        },
      ],
    });

    expect(text).toContain("Selected datasets: wjw产品信息验收-0323");
    expect(text).toContain("Search query: 海滨医院的交换机型号有哪些？");
    expect(text).toContain("[1] dataset=wjw产品信息验收-0323 | document=设备型号.xlsx | score=0.82");
    expect(text).toContain("海滨医院 交换机 CE6855-48XS8CQ");
  });
});
