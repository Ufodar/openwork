import { describe, expect, test } from "bun:test";

import type { OpenworkKnowledgeItem } from "./openwork-server";
import { groupKnowledgeItemsByOwner } from "./knowledge-grouping";

function makeKnowledgeItem(input: Partial<OpenworkKnowledgeItem> & Pick<OpenworkKnowledgeItem, "knowledgeId" | "title">): OpenworkKnowledgeItem {
  return {
    knowledgeId: input.knowledgeId,
    ragflowDatasetId: input.ragflowDatasetId ?? `ds_${input.knowledgeId}`,
    ownerUserId: input.ownerUserId ?? "",
    ownerDisplayName: input.ownerDisplayName ?? "",
    title: input.title,
    description: input.description ?? null,
    source: input.source ?? "ragflow",
    visibility: input.visibility ?? "visible_to_all_users",
    ingestionPreset: input.ingestionPreset ?? "general_document",
    chunkMethod: input.chunkMethod ?? "naive",
    parserConfig: input.parserConfig ?? {},
    embeddingModel: input.embeddingModel ?? null,
    status: input.status ?? "ready",
    documentCount: input.documentCount ?? 0,
    chunkCount: input.chunkCount ?? 0,
    createdAt: input.createdAt ?? 0,
    updatedAt: input.updatedAt ?? 0,
  };
}

describe("groupKnowledgeItemsByOwner", () => {
  test("groups shared knowledge by owner username and preserves item order within each group", () => {
    const groups = groupKnowledgeItemsByOwner([
      makeKnowledgeItem({ knowledgeId: "kb_1", title: "医院资质", ownerUserId: "u_alice", ownerDisplayName: "alice" }),
      makeKnowledgeItem({ knowledgeId: "kb_2", title: "学校案例", ownerUserId: "u_bob", ownerDisplayName: "bob" }),
      makeKnowledgeItem({ knowledgeId: "kb_3", title: "商务材料", ownerUserId: "u_alice", ownerDisplayName: "alice" }),
    ], "未知用户");

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      ownerKey: "u_alice",
      ownerLabel: "alice",
    });
    expect(groups[0]?.items.map((item) => item.knowledgeId)).toEqual(["kb_1", "kb_3"]);
    expect(groups[1]).toMatchObject({
      ownerKey: "u_bob",
      ownerLabel: "bob",
    });
    expect(groups[1]?.items.map((item) => item.knowledgeId)).toEqual(["kb_2"]);
  });

  test("falls back to a translated unknown label when owner metadata is missing", () => {
    const groups = groupKnowledgeItemsByOwner([
      makeKnowledgeItem({ knowledgeId: "kb_1", title: "未标注资料", ownerUserId: "", ownerDisplayName: "   " }),
    ], "未知用户");

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      ownerKey: "未知用户",
      ownerLabel: "未知用户",
    });
  });
});
