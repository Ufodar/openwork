import { describe, expect, test } from "bun:test";

import { joinVisibleAssistantText, stripReasoningArtifacts } from "./_assistant-text.mjs";

describe("script assistant text sanitization", () => {
  test("removes complete think blocks", () => {
    expect(stripReasoningArtifacts("<think>private</think>\n\npublic")).toBe("public");
  });

  test("removes orphan closing think tags", () => {
    expect(stripReasoningArtifacts("任务已完成。\n</think>\n\n总结")).toBe("任务已完成。\n\n总结");
  });

  test("extracts visible assistant text from parts", () => {
    expect(
      joinVisibleAssistantText([
        { type: "text", text: "<think>hidden</think>\n\nanswer" },
        { type: "tool", text: "ignored" },
        { type: "text", text: "</think>\nnext" },
      ]),
    ).toBe("answer\n\nnext");
  });
});
