import { describe, expect, test } from "bun:test";
import { resolveSessionPreferences } from "./session-preferences.ts";

describe("resolveSessionPreferences", () => {
  test("uses legacy title inference when no stored prefs exist", () => {
    const resolved = resolveSessionPreferences({
      title: "文档智能体",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "legacy" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "legacy" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "legacy" });
  });

  test("explicit stored session view disables legacy title fallback", () => {
    const resolved = resolveSessionPreferences({
      stored: { view: "session" },
      title: "文档智能体",
    });

    expect(resolved.view).toEqual({ value: "session", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: null, source: "none" });
    expect(resolved.agent).toEqual({ value: null, source: "none" });
  });

  test("stored agent lock wins over legacy title inference", () => {
    const resolved = resolveSessionPreferences({
      stored: { agentLock: "document-writer" },
      title: "文档智能体",
    });

    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "legacy" });
    expect(resolved.view).toEqual({ value: "document-agent", source: "legacy" });
  });

  test("stored document view can still use legacy agent lock for old sessions", () => {
    const resolved = resolveSessionPreferences({
      stored: { view: "document-agent" },
      title: "标书写作助手",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "default" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "default" });
  });
});
