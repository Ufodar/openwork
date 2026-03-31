import { describe, expect, test } from "bun:test";

import { isTodoCompletedStatus } from "./todo-status";

describe("isTodoCompletedStatus", () => {
  test("treats completed and done as finished todo states", () => {
    expect(isTodoCompletedStatus("completed")).toBe(true);
    expect(isTodoCompletedStatus("done")).toBe(true);
    expect(isTodoCompletedStatus(" DONE ")).toBe(true);
  });

  test("does not treat active or cancelled todos as finished", () => {
    expect(isTodoCompletedStatus("in_progress")).toBe(false);
    expect(isTodoCompletedStatus("pending")).toBe(false);
    expect(isTodoCompletedStatus("cancelled")).toBe(false);
    expect(isTodoCompletedStatus(null)).toBe(false);
  });
});
