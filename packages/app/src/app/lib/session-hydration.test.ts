import { describe, expect, test } from "bun:test";

import { isSessionHydrating } from "./session-hydration";

describe("isSessionHydrating", () => {
  test("returns true when the route is still hydrating the same session", () => {
    expect(
      isSessionHydrating({
        sessionId: "ses_123",
        routeSessionHydratingId: "ses_123",
        busy: false,
        busyLabel: null,
      }),
    ).toBe(true);
  });

  test("returns true while the app is actively busy loading a session", () => {
    expect(
      isSessionHydrating({
        sessionId: "ses_123",
        routeSessionHydratingId: null,
        busy: true,
        busyLabel: "status.loading_session",
      }),
    ).toBe(true);
  });

  test("ignores a stale loading label once the global busy state is cleared", () => {
    expect(
      isSessionHydrating({
        sessionId: "ses_123",
        routeSessionHydratingId: null,
        busy: false,
        busyLabel: "status.loading_session",
      }),
    ).toBe(false);
  });
});
