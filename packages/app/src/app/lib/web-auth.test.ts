import { describe, expect, test } from "bun:test";

import { clearOpenworkWebSession } from "./web-auth";

describe("clearOpenworkWebSession", () => {
  test("clears only the persisted web auth token and preserves the server URL", () => {
    expect(
      clearOpenworkWebSession({
        urlOverride: "http://192.168.5.10:8789",
        portOverride: 8789,
        token: "secret-token",
      }),
    ).toEqual({
      urlOverride: "http://192.168.5.10:8789",
      portOverride: 8789,
    });
  });
});
