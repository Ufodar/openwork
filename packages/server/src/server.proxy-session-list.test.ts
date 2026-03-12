import { afterEach, describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "./types.js";
import { proxyOpencodeRequest } from "./server.js";
import { SessionOwnershipService } from "./session-ownership.js";
import { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("proxyOpencodeRequest session listing", () => {
  test("keeps x-opencode-directory when stripping workspace-root directory query", async () => {
    const captured: { url?: string; headers?: Headers } = {};
    globalThis.fetch = (async (input, init) => {
      captured.url = typeof input === "string" ? input : input.toString();
      captured.headers = new Headers(init?.headers);
      return new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const workspace: WorkspaceInfo = {
      id: "ws_shared",
      name: "shared",
      path: "/root/ai_staff/openwork",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    await proxyOpencodeRequest({
      request: new Request(
        "http://openwork.local/w/ws_shared/opencode/session?directory=/root/ai_staff/openwork",
        { method: "GET" },
      ),
      url: new URL("http://openwork.local/w/ws_shared/opencode/session?directory=/root/ai_staff/openwork"),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership: new SessionOwnershipService(),
      sessionWorkspaces: new SessionWorkspaceService(),
    });

    expect(captured.url).toBe("http://127.0.0.1:33459/session");
    expect(captured.headers?.get("x-opencode-directory")).toBe("/root/ai_staff/openwork");
  });
});
