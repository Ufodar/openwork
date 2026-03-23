import { describe, expect, test } from "bun:test";

import { resolveDashboardClientConnected } from "./dashboard-client-status";

describe("resolveDashboardClientConnected", () => {
  test("keeps a bound workspace client connected", () => {
    expect(
      resolveDashboardClientConnected({
        clientConnected: true,
        globalReady: false,
        openworkServerStatus: "disconnected",
        tab: "users",
      }),
    ).toBe(true);
  });

  test("treats admin users tab as connected when global opencode is healthy", () => {
    expect(
      resolveDashboardClientConnected({
        clientConnected: false,
        globalReady: true,
        openworkServerStatus: "connected",
        tab: "users",
      }),
    ).toBe(true);
  });

  test("does not mask disconnected state on other tabs", () => {
    expect(
      resolveDashboardClientConnected({
        clientConnected: false,
        globalReady: true,
        openworkServerStatus: "connected",
        tab: "agents",
      }),
    ).toBe(false);
  });
});
