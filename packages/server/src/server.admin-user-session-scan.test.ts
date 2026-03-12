import { afterEach, describe, expect, test } from "bun:test";

import type { WorkspaceInfo } from "./types.js";
import { scanAdminSessions } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("scanAdminSessions", () => {
  test("filters by owner key before fetching per-session details", async () => {
    const requestedSessionIds: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const sessionId = url.split("/").pop() ?? "";
      requestedSessionIds.push(sessionId);
      return new Response(JSON.stringify({
        id: sessionId,
        title: `Session ${sessionId}`,
        directory: `/root/.openwork/user-workspaces/alice/documents/sessions/${sessionId}`,
        time: { created: 1, updated: 2 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const workspace: WorkspaceInfo = {
      id: "user-1",
      name: "alice",
      path: "/root/.openwork/user-workspaces/alice",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const sessionOwnership = {
      listEntries: async () => ({
        ses_alice_1: { ownerKey: "owner-alice", updatedAt: 1 },
        ses_alice_2: { ownerKey: "owner-alice", updatedAt: 2 },
        ses_bob_1: { ownerKey: "owner-bob", updatedAt: 3 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async (_workspaceId: string, sessionId: string) => ({
        runtimeId: sessionId,
        runtimeDir: `/root/.openwork/user-workspaces/alice/documents/sessions/${sessionId}`,
        createdAt: 1,
      }),
    } as unknown as SessionWorkspaceService;

    const result = await scanAdminSessions(
      {
        workspaces: [workspace],
        authorizedRoots: [workspace.path],
      } as any,
        sessionOwnership,
        sessionWorkspaces,
        "owner-alice",
    );

    expect(result.items.map((item) => item.id).sort()).toEqual(["ses_alice_1", "ses_alice_2"]);
    expect(requestedSessionIds.sort()).toEqual(["ses_alice_1", "ses_alice_2"]);
  });
});
