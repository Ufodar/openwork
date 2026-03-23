import { describe, expect, test } from "bun:test";

import { shouldAutoConnectWebClient } from "./web-autoconnect";

describe("shouldAutoConnectWebClient", () => {
  test("skips autoconnect on tauri", () => {
    expect(
      shouldAutoConnectWebClient({
        isTauri: true,
        hasClient: false,
        connectingWorkspace: false,
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
        connectingWorkspace: false,
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
        connectingWorkspace: false,
        openworkServerStatus: "connected",
        openworkUrlOverride: "http://example.com",
        token: "token",
        view: "dashboard",
        tab: "agents",
      }),
    ).toBe(true);
  });

  test("skips autoconnect while another workspace connection is already running", () => {
    expect(
      shouldAutoConnectWebClient({
        isTauri: false,
        hasClient: false,
        connectingWorkspace: true,
        openworkServerStatus: "connected",
        openworkUrlOverride: "http://example.com",
        token: "token",
        view: "document-agent",
        tab: "agents",
      }),
    ).toBe(false);
  });
});
