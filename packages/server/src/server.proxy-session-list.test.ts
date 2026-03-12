import { afterEach, describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "./types.js";
import { proxyOpencodeRequest } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("proxyOpencodeRequest session listing", () => {
  test("aggregates workspace-root session lists from a shared session index", async () => {
    const captured: { url?: string; headers?: Headers } = {};
    globalThis.fetch = (async (input, init) => {
      captured.url = typeof input === "string" ? input : input.toString();
      captured.headers = new Headers(init?.headers);
      return new Response(JSON.stringify([{
        id: "ses_123",
        title: "Migrated Session",
        directory: "/root/ai_staff/openwork/documents/sessions/ses_123",
        time: { created: 1, updated: 2 },
      }]), {
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

    const sessionOwnership = {
      listEntries: async () => ({
        ses_123: { ownerKey: "host-owner", updatedAt: 1 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "ses_123",
        runtimeDir: "/root/ai_staff/openwork/documents/sessions/ses_123",
        createdAt: 1,
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(
        "http://openwork.local/w/ws_shared/opencode/session?directory=/root/ai_staff/openwork",
        { method: "GET" },
      ),
      url: new URL("http://openwork.local/w/ws_shared/opencode/session?directory=/root/ai_staff/openwork"),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
    });

    const payload = await response.json() as Array<{ id: string }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe("ses_123");
    expect(captured.url).toBe("http://127.0.0.1:33459/session");
    expect(captured.headers?.get("x-opencode-directory")).toBe("/root/ai_staff/openwork");
  });
});
