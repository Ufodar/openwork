import { describe, expect, test } from "bun:test";

import {
  findKnowledgeItem,
  pickKnowledgeSelection,
  reduceKnowledgeSelection,
  sameKnowledgeSelection,
} from "./knowledge-selection";
import type { OpenworkKnowledgeItem } from "./openwork-server";

function item(overrides: Partial<OpenworkKnowledgeItem> & Pick<OpenworkKnowledgeItem, "knowledgeId" | "title">): OpenworkKnowledgeItem {
  return {
    knowledgeId: overrides.knowledgeId,
    ragflowDatasetId: overrides.ragflowDatasetId ?? `dataset-${overrides.knowledgeId}`,
    ownerUserId: overrides.ownerUserId ?? "user-1",
    ownerDisplayName: overrides.ownerDisplayName ?? "storm",
    title: overrides.title,
    description: overrides.description ?? null,
    source: overrides.source ?? "ragflow",
    visibility: overrides.visibility ?? "workspace",
    ingestionPreset: overrides.ingestionPreset ?? "general",
    chunkMethod: overrides.chunkMethod ?? "naive",
    parserConfig: overrides.parserConfig ?? {},
    embeddingModel: overrides.embeddingModel ?? null,
    status: overrides.status ?? "ready",
    documentCount: overrides.documentCount ?? 0,
    chunkCount: overrides.chunkCount ?? 0,
    createdAt: overrides.createdAt ?? 1,
    updatedAt: overrides.updatedAt ?? 1,
  };
}

describe("attached knowledge selection", () => {
  test("starts empty and replaces the attached set on save", () => {
    const state = reduceKnowledgeSelection([], [{ id: "kb_1", checked: true }]);
    expect(state).toEqual(["kb_1"]);
  });

  test("removes unchecked items while preserving the order of the remaining selection", () => {
    const state = reduceKnowledgeSelection(
      ["kb_1", "kb_2", "kb_3"],
      [{ id: "kb_2", checked: false }],
    );
    expect(state).toEqual(["kb_1", "kb_3"]);
  });

  test("treats reordered arrays as the same attached knowledge set", () => {
    expect(sameKnowledgeSelection(["kb_2", "kb_1"], ["kb_1", "kb_2", "kb_1"])).toBe(true);
  });
});

describe("detail pane selection", () => {
  test("pickKnowledgeSelection keeps the current selection when it still exists", () => {
    const mine = [item({ knowledgeId: "mine-a", title: "Mine A" })];
    const others = [item({ knowledgeId: "other-a", title: "Other A", ownerUserId: "user-2" })];

    expect(pickKnowledgeSelection({ scope: "mine", knowledgeId: "mine-a" }, mine, others)).toEqual({
      scope: "mine",
      knowledgeId: "mine-a",
    });
  });

  test("pickKnowledgeSelection falls back to the first personal knowledge base", () => {
    const mine = [
      item({ knowledgeId: "mine-a", title: "Mine A" }),
      item({ knowledgeId: "mine-b", title: "Mine B" }),
    ];

    expect(pickKnowledgeSelection({ scope: "mine", knowledgeId: "missing" }, mine, [])).toEqual({
      scope: "mine",
      knowledgeId: "mine-a",
    });
  });

  test("pickKnowledgeSelection falls back to the first shared knowledge base when mine is empty", () => {
    const others = [item({ knowledgeId: "other-a", title: "Other A", ownerUserId: "user-2" })];

    expect(pickKnowledgeSelection(null, [], others)).toEqual({
      scope: "others",
      knowledgeId: "other-a",
    });
  });

  test("pickKnowledgeSelection returns null when there is nothing to select", () => {
    expect(pickKnowledgeSelection(null, [], [])).toBeNull();
  });

  test("findKnowledgeItem searches only within the requested scope", () => {
    const mine = [item({ knowledgeId: "shared-id", title: "Mine A" })];
    const others = [item({ knowledgeId: "shared-id", title: "Other A", ownerUserId: "user-2" })];

    expect(findKnowledgeItem("mine", "shared-id", mine, others)?.title).toBe("Mine A");
    expect(findKnowledgeItem("others", "shared-id", mine, others)?.title).toBe("Other A");
  });
});
