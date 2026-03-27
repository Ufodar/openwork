import { describe, expect, test } from "bun:test";

import { joinVisibleAssistantText, stripReasoningArtifacts } from "./assistant-text";

describe("assistant text sanitization", () => {
  test("removes complete think blocks while preserving visible answer", () => {
    expect(stripReasoningArtifacts("<think>hidden reasoning</think>\n\nVisible answer")).toBe("Visible answer");
  });

  test("removes orphan think tag lines from visible assistant text", () => {
    expect(stripReasoningArtifacts("任务已完成。\n</think>\n\n最终总结")).toBe("任务已完成。\n\n最终总结");
  });

  test("joins only text parts and strips reasoning artifacts", () => {
    expect(
      joinVisibleAssistantText([
        { type: "tool", text: "ignored" },
        { type: "text", text: "<think>hidden</think>\n\nVisible" },
        { type: "text", text: "</think>\nDone" },
      ]),
    ).toBe("Visible\n\nDone");
  });
});
