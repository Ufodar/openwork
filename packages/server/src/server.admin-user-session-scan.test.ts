import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceInfo } from "./types.js";
import { scanAdminSessions } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("scanAdminSessions", () => {
  test("filters by owner key from a single session list fetch", async () => {
    const requestedPaths: string[] = [];
    globalThis.fetch = (async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      requestedPaths.push(new URL(url).pathname);
      return new Response(JSON.stringify([
        {
          id: "ses_alice_1",
          title: "Session ses_alice_1",
          directory: "/root/.openwork/user-workspaces/alice/documents/sessions/ses_alice_1",
          time: { created: 1, updated: 2 },
        },
        {
          id: "ses_alice_2",
          title: "Session ses_alice_2",
          directory: "/root/.openwork/user-workspaces/alice/documents/sessions/ses_alice_2",
          time: { created: 1, updated: 3 },
        },
        {
          id: "ses_bob_1",
          title: "Session ses_bob_1",
          directory: "/root/.openwork/user-workspaces/bob/documents/sessions/ses_bob_1",
          time: { created: 1, updated: 4 },
        },
      ]), {
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
    expect(requestedPaths).toEqual(["/session"]);
  });

  test("recovers historical sessions from workspace openwork metadata when live listing is empty", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const workspacePath = await mkdir(join(tmpdir(), `openwork-admin-session-scan-${Date.now()}`), { recursive: true });
    await mkdir(join(workspacePath, ".opencode"), { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_hist_1: { view: "document-agent" },
        },
      }),
      "utf8",
    );

    const workspace: WorkspaceInfo = {
      id: "user-1",
      name: "alice",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const sessionOwnership = {
      listEntries: async () => ({}),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => null,
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

    expect(result.items.map((item) => item.id)).toEqual(["ses_hist_1"]);
    expect(result.items[0]?.directory).toBe(workspacePath);
  });
});
