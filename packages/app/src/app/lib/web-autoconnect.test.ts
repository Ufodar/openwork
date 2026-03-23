import { describe, expect, test } from "bun:test";

import { shouldAutoConnectWebClient } from "./web-autoconnect";

describe("shouldAutoConnectWebClient", () => {
  test("skips autoconnect on tauri", () => {
    expect(
      shouldAutoConnectWebClient({
        isTauri: true,
        hasClient: false,
        openworkServerStatus: "connected",
        openworkUrlOverride: "http://example.com",
        token: "token",
        view: "dashboard",
        tab: "agents",
      }),
    ).toBe(false);
  });

  test("skips autoconnect on admin users page", () => {
    expect(
      shouldAutoConnectWebClient({
        isTauri: false,
        hasClient: false,
        openworkServerStatus: "connected",
        openworkUrlOverride: "http://example.com",
        token: "token",
        view: "dashboard",
        tab: "users",
      }),
    ).toBe(false);
  });

  test("allows autoconnect on other web tabs when credentials exist", () => {
    expect(
      shouldAutoConnectWebClient({
        isTauri: false,
        hasClient: false,
        openworkServerStatus: "connected",
        openworkUrlOverride: "http://example.com",
        token: "token",
        view: "dashboard",
        tab: "agents",
      }),
    ).toBe(true);
  });
});
