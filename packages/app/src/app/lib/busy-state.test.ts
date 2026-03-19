import { describe, expect, test } from "bun:test";

import { clearBusyState, type BusyStateSnapshot } from "./busy-state";

describe("clearBusyState", () => {
  test("clears loading session state after session creation completes", () => {
    const current: BusyStateSnapshot = {
      busy: true,
      busyLabel: "status.loading_session",
      busyStartedAt: 1_742_352_800_000,
    };

    expect(clearBusyState(current)).toEqual({
      busy: false,
      busyLabel: null,
      busyStartedAt: null,
    });
  });

  test("clears generic busy state without preserving stale metadata", () => {
    const current: BusyStateSnapshot = {
      busy: true,
      busyLabel: "status.running",
      busyStartedAt: 1_742_352_800_000,
    };

    expect(clearBusyState(current)).toEqual({
      busy: false,
      busyLabel: null,
      busyStartedAt: null,
    });
  });
});
