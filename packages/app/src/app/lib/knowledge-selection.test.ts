import { describe, expect, test } from "bun:test";

import {
  reduceKnowledgeSelection,
  sameKnowledgeSelection,
} from "./knowledge-selection";

describe("knowledge selection", () => {
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
