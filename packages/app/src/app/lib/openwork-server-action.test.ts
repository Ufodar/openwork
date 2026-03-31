import { describe, expect, test } from "bun:test";

import { ensureOpenworkServerActionReady } from "./openwork-server-action";

describe("ensureOpenworkServerActionReady", () => {
  test("returns ready immediately when connected and client is present", async () => {
    const reconnectCalls: number[] = [];

    const result = await ensureOpenworkServerActionReady({
      getStatus: () => "connected",
      getHasClient: () => true,
      reconnect: async () => {
        reconnectCalls.push(Date.now());
        return true;
      },
    });

    expect(result).toEqual({ ok: true, status: "connected" });
    expect(reconnectCalls).toHaveLength(0);
  });

  test("returns limited when token-limited access is not sufficient", async () => {
    const result = await ensureOpenworkServerActionReady({
      getStatus: () => "limited",
      getHasClient: () => true,
    });

    expect(result).toEqual({ ok: false, reason: "limited" });
  });

  test("accepts limited state when explicitly allowed", async () => {
    const result = await ensureOpenworkServerActionReady({
      getStatus: () => "limited",
      getHasClient: () => true,
      allowLimited: true,
    });

    expect(result).toEqual({ ok: true, status: "limited" });
  });

  test("reconnects once and succeeds when state becomes connected", async () => {
    let status: "connected" | "disconnected" | "limited" = "disconnected";
    let hasClient = false;
    let reconnectCalls = 0;

    const result = await ensureOpenworkServerActionReady({
      getStatus: () => status,
      getHasClient: () => hasClient,
      reconnect: async () => {
        reconnectCalls += 1;
        status = "connected";
        hasClient = true;
        return true;
      },
    });

    expect(result).toEqual({ ok: true, status: "connected" });
    expect(reconnectCalls).toBe(1);
  });

  test("returns reconnect_failed when reconnect does not restore readiness", async () => {
    let reconnectCalls = 0;

    const result = await ensureOpenworkServerActionReady({
      getStatus: () => "disconnected",
      getHasClient: () => false,
      reconnect: async () => {
        reconnectCalls += 1;
        return false;
      },
    });

    expect(result).toEqual({ ok: false, reason: "reconnect_failed" });
    expect(reconnectCalls).toBe(1);
  });
});
