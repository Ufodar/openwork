import { describe, expect, test } from "bun:test";

import {
  clearOpenworkWebSession,
  clearWebLogoutStorage,
  OPENWORK_SESSION_PREFS_LOCAL_STORAGE_KEY,
  OPENWORK_WEB_AUTH_USER_KEY,
  resolveWebAuthBaseUrl,
  SESSION_BY_WORKSPACE_KEY,
} from "./web-auth";
import { SESSION_MODEL_PREF_KEY } from "../constants";

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

describe("clearWebLogoutStorage", () => {
  test("removes user-scoped session caches and model overrides", () => {
    const store = new Map<string, string>([
      [OPENWORK_WEB_AUTH_USER_KEY, "admin"],
      [SESSION_BY_WORKSPACE_KEY, JSON.stringify({ remote: "ses_123" })],
      [OPENWORK_SESSION_PREFS_LOCAL_STORAGE_KEY, JSON.stringify({ sessions: { ses_123: { view: "document-agent" } } })],
      [`${SESSION_MODEL_PREF_KEY}.ws_marken`, JSON.stringify({ ses_123: "my-company/Kimi-K2.5" })],
      ["openwork.themePref", "light"],
    ]);
    const storage = {
      get length() {
        return store.size;
      },
      key(index: number) {
        return [...store.keys()][index] ?? null;
      },
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
      removeItem(key: string) {
        store.delete(key);
      },
    };

    clearWebLogoutStorage(storage);

    expect(store.has(OPENWORK_WEB_AUTH_USER_KEY)).toBe(false);
    expect(store.has(SESSION_BY_WORKSPACE_KEY)).toBe(false);
    expect(store.has(OPENWORK_SESSION_PREFS_LOCAL_STORAGE_KEY)).toBe(false);
    expect(store.has(`${SESSION_MODEL_PREF_KEY}.ws_marken`)).toBe(false);
    expect(store.get("openwork.themePref")).toBe("light");
  });
});

describe("resolveWebAuthBaseUrl", () => {
  test("prefers the configured OpenWork server URL when available", () => {
    expect(
      resolveWebAuthBaseUrl({
        configuredBaseUrl: "http://192.168.5.10:32765/openwork",
        envBaseUrl: "/openwork",
        locationOrigin: "http://192.168.5.10:32765",
        dev: true,
      }),
    ).toBe("http://192.168.5.10:32765/openwork");
  });

  test("uses the same-origin /openwork proxy in web dev when no server URL is configured", () => {
    expect(
      resolveWebAuthBaseUrl({
        configuredBaseUrl: "",
        envBaseUrl: "",
        locationOrigin: "http://192.168.5.10:32765",
        dev: true,
      }),
    ).toBe("http://192.168.5.10:32765/openwork");
  });

  test("ignores loopback env URLs when the page is opened from another machine in web dev", () => {
    expect(
      resolveWebAuthBaseUrl({
        configuredBaseUrl: "",
        envBaseUrl: "http://localhost:8787",
        locationOrigin: "http://192.168.5.10:32765",
        dev: true,
      }),
    ).toBe("http://192.168.5.10:32765/openwork");
  });

  test("falls back to the page origin in production web mode", () => {
    expect(
      resolveWebAuthBaseUrl({
        configuredBaseUrl: "",
        envBaseUrl: "",
        locationOrigin: "http://192.168.5.10:32765",
        dev: false,
      }),
    ).toBe("http://192.168.5.10:32765");
  });
});
