import { describe, expect, test } from "bun:test";

import { resolveSessionPreferences } from "./session-preferences";

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
});
