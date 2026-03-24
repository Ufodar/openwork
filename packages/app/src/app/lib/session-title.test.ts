import { describe, expect, test } from "bun:test";

import { formatSessionDisplayTitle, isGeneratedSessionTitle } from "./session-title";

describe("isGeneratedSessionTitle", () => {
  test("detects default opencode session titles", () => {
    expect(isGeneratedSessionTitle("New session")).toBe(true);
    expect(isGeneratedSessionTitle("New session - 2026-03-24T05:49:52.412Z")).toBe(true);
  });

  test("ignores user-authored titles", () => {
    expect(isGeneratedSessionTitle("矩阵-own-20260324")).toBe(false);
    expect(isGeneratedSessionTitle("新会话")).toBe(false);
  });
});

describe("formatSessionDisplayTitle", () => {
  const labels = {
    generated: "新会话",
    untitled: "未命名",
  };

  test("maps generated opencode titles to a localized display title", () => {
    expect(formatSessionDisplayTitle("New session - 2026-03-24T05:49:52.412Z", labels)).toBe("新会话");
  });

  test("maps empty and untitled values to the localized untitled label", () => {
    expect(formatSessionDisplayTitle("", labels)).toBe("未命名");
    expect(formatSessionDisplayTitle("Untitled session", labels)).toBe("未命名");
  });

  test("preserves custom session titles", () => {
    expect(formatSessionDisplayTitle("矩阵-own-20260324", labels)).toBe("矩阵-own-20260324");
  });
});
