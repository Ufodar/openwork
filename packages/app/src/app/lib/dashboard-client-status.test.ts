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

  test("treats admin users tab as connected when openwork stays healthy", () => {
    expect(
      resolveDashboardClientConnected({
        clientConnected: false,
        globalReady: false,
        openworkServerStatus: "connected",
        tab: "users",
      }),
    ).toBe(true);
  });

  test("does not treat admin users tab as connected when openwork is down", () => {
    expect(
      resolveDashboardClientConnected({
        clientConnected: false,
        globalReady: true,
        openworkServerStatus: "disconnected",
        tab: "users",
      }),
    ).toBe(false);
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
