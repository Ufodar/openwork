import { describe, expect, test } from "bun:test";

import { resolveSessionPreferences, resolveStoredRagflowSelection } from "./session-preferences";

describe("resolveSessionPreferences", () => {
  test("preserves a stored document-writer view instead of collapsing it to document-agent", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "document-writer",
        agent: "document-writer",
        agentLock: "document-writer",
      },
      title: "标书写作助手",
    });

    expect(resolved.view).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agent).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "stored" });
  });

  test("maps 标书写作助手 legacy titles to the document-writer view and lock", () => {
    const resolved = resolveSessionPreferences({
      title: "标书写作助手",
    });

    expect(resolved.view).toEqual({ value: "document-writer", source: "legacy" });
    expect(resolved.agent).toEqual({ value: "document-writer", source: "legacy" });
    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "legacy" });
  });

  test("keeps 文档智能体 mapped to document-agent and common-work", () => {
    const resolved = resolveSessionPreferences({
      title: "文档智能体",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "legacy" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "legacy" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "legacy" });
  });

  test("defaults stored document-agent sessions without explicit agent back to common-work", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "document-agent",
      },
      title: "New session - 2026-03-18T00:00:00.000Z",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "stored" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "default" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "default" });
  });

  test("normalizes stored ragflow dataset selection", () => {
    expect(
      resolveStoredRagflowSelection({
        ragflowDatasetIds: [" ds_1 ", "ds_2", "ds_1", ""],
        ragflowDatasetNames: [" Product Docs ", "", "Policies"],
        ragflowTopK: 8,
      }),
    ).toEqual({
      datasetIds: ["ds_1", "ds_2"],
      datasetNames: ["Product Docs", "Policies"],
      topK: 8,
    });
  });

  test("drops ragflow selection when no dataset ids remain", () => {
    expect(
      resolveStoredRagflowSelection({
        ragflowDatasetIds: ["", "   "],
        ragflowDatasetNames: ["Anything"],
      }),
    ).toBeNull();
  });
});
