import { afterEach, describe, expect, test } from "bun:test";

import {
  createOpenworkServerClient,
  OpenworkServerError,
  resolveBrowserOpenworkEnvUrl,
} from "./openwork-server";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("openwork server client", () => {
  test("surfaces a friendly error when the web proxy returns plain text", async () => {
    globalThis.fetch = (async () =>
      new Response("Proxy error: connect ECONNREFUSED 127.0.0.1:8789", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })) as typeof fetch;

    const client = createOpenworkServerClient({
      baseUrl: "http://127.0.0.1:32765/openwork",
      hostToken: "host-token",
    });

    await expect(client.adminListUsers()).rejects.toMatchObject({
      constructor: OpenworkServerError,
      status: 502,
      code: "request_failed",
      message: "OpenWork 服务未连接。",
    });
  });

  test("falls back to the plain-text body for non-json server errors", async () => {
    globalThis.fetch = (async () =>
      new Response("Backend overloaded", {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })) as typeof fetch;

    const client = createOpenworkServerClient({
      baseUrl: "http://127.0.0.1:32765/openwork",
      hostToken: "host-token",
    });

    await expect(client.adminListUsers()).rejects.toMatchObject({
      constructor: OpenworkServerError,
      status: 503,
      code: "request_failed",
      message: "Backend overloaded",
    });
  });
});

describe("resolveBrowserOpenworkEnvUrl", () => {
  test("rewrites loopback env URLs to the same-origin /openwork proxy in web dev", () => {
    expect(
      resolveBrowserOpenworkEnvUrl({
        envUrl: "http://localhost:8787",
        locationOrigin: "http://192.168.5.10:32765",
        dev: true,
        tauri: false,
      }),
    ).toBe("http://192.168.5.10:32765/openwork");
  });

  test("keeps the env URL outside web dev mode", () => {
    expect(
      resolveBrowserOpenworkEnvUrl({
        envUrl: "http://localhost:8787",
        locationOrigin: "http://192.168.5.10:32765",
        dev: false,
        tauri: false,
      }),
    ).toBe("http://localhost:8787");
  });
});
