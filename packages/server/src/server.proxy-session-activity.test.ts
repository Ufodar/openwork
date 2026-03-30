import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { proxyOpencodeRequest } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";
import type { WorkspaceInfo } from "./types.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("proxyOpencodeRequest session activity routing", () => {
  test("uses session-scoped activity tracking for isolated prompt runs", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const workspace: WorkspaceInfo = {
      id: "ws_1",
      name: "alice",
      path: "/root/ai_staff/openwork",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const runtimeDir = join(workspace.path, "documents", "sessions", "runtime-iso");
    const sessionOwnership = {
      getOwner: async () => "owner-alice",
      removeOwner: async () => undefined,
    } as unknown as SessionOwnershipService;
    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-iso",
        runtimeDir,
        createdAt: 1,
        opencodeRuntime: {
          mode: "isolated_process",
          rootDir: join(runtimeDir, ".openwork-runtime", "opencode"),
          configDir: join(runtimeDir, ".openwork-runtime", "opencode", "config"),
          dataDir: join(runtimeDir, ".openwork-runtime", "opencode", "data"),
          stateDir: join(runtimeDir, ".openwork-runtime", "opencode", "state"),
          cacheDir: join(runtimeDir, ".openwork-runtime", "opencode", "cache"),
          bindHost: "127.0.0.1",
        },
      }),
    } as unknown as SessionWorkspaceService;

    const calls: string[] = [];

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session/ses_iso/prompt_async", {
        method: "POST",
        body: JSON.stringify({ parts: [{ type: "text", text: "continue" }] }),
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session/ses_iso/prompt_async"),
      workspace,
      proxyPath: "/session/ses_iso/prompt_async",
      actor: { type: "remote", scope: "owner", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      sessionRuntimeService: {
        resolveSessionWorkspace: async () => ({
          ...workspace,
          baseUrl: "http://127.0.0.1:4555",
          directory: runtimeDir,
        }),
      } as any,
      sessionActivity: {
        ensureWorkspace: async () => {
          calls.push("workspace");
        },
        ensureSessionRuntime: async (_workspaceId: string, sessionId: string, sessionWorkspace: WorkspaceInfo) => {
          calls.push(`session:${sessionId}:${sessionWorkspace.baseUrl}:${sessionWorkspace.directory}`);
        },
        notePromptStart: (_workspaceId: string, sessionId: string) => {
          calls.push(`prompt:${sessionId}`);
        },
        removeSession: () => undefined,
      } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    expect(response.status).toBe(202);
    expect(calls).toContain(`session:ses_iso:http://127.0.0.1:4555:${runtimeDir}`);
    expect(calls).toContain("prompt:ses_iso");
    expect(calls).not.toContain("workspace");
  });

  test("overrides an incoming root x-opencode-directory header with the isolated runtime directory", async () => {
    const captured = { url: "", directory: "" };
    globalThis.fetch = (async (input, init) => {
      captured.url = typeof input === "string" ? input : input.toString();
      captured.directory = new Headers(init?.headers).get("x-opencode-directory") ?? "";
      return new Response(JSON.stringify({ ok: true }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const workspace: WorkspaceInfo = {
      id: "ws_1",
      name: "alice",
      path: "/root/.openwork/user-workspaces/user-1",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const runtimeDir = join(workspace.path, "documents", "sessions", "runtime-iso");
    const sessionOwnership = {
      getOwner: async () => "owner-alice",
      removeOwner: async () => undefined,
    } as unknown as SessionOwnershipService;
    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-iso",
        runtimeDir,
        createdAt: 1,
        opencodeRuntime: {
          mode: "isolated_process",
          rootDir: join(runtimeDir, ".openwork-runtime", "opencode"),
          configDir: join(runtimeDir, ".openwork-runtime", "opencode", "config"),
          dataDir: join(runtimeDir, ".openwork-runtime", "opencode", "data"),
          stateDir: join(runtimeDir, ".openwork-runtime", "opencode", "state"),
          cacheDir: join(runtimeDir, ".openwork-runtime", "opencode", "cache"),
          bindHost: "127.0.0.1",
        },
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request("http://openwork.local/w/ws_1/opencode/session/ses_iso/prompt_async", {
        method: "POST",
        headers: { "x-opencode-directory": workspace.path },
        body: JSON.stringify({ parts: [{ type: "text", text: "continue" }] }),
      }),
      url: new URL("http://openwork.local/w/ws_1/opencode/session/ses_iso/prompt_async"),
      workspace,
      proxyPath: "/session/ses_iso/prompt_async",
      actor: { type: "remote", scope: "owner", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      sessionRuntimeService: {
        resolveSessionWorkspace: async () => ({
          ...workspace,
          baseUrl: "http://127.0.0.1:4555",
          directory: runtimeDir,
        }),
      } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    expect(response.status).toBe(202);
    expect(captured.url).toBe("http://127.0.0.1:4555/session/ses_iso/prompt_async?directory=" + encodeURIComponent(runtimeDir));
    expect(captured.directory).toBe(runtimeDir);
  });

  test("routes event subscriptions scoped by runtime directory through the isolated session runtime", async () => {
    const captured = { url: "", directory: "" };
    globalThis.fetch = (async (input, init) => {
      captured.url = typeof input === "string" ? input : input.toString();
      captured.directory = new Headers(init?.headers).get("x-opencode-directory") ?? "";
      return new Response("data: {\"type\":\"server.connected\",\"properties\":{}}\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const workspace: WorkspaceInfo = {
      id: "ws_1",
      name: "alice",
      path: "/root/.openwork/user-workspaces/user-1",
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const runtimeDir = join(workspace.path, "documents", "sessions", "runtime-iso");
    const sessionOwnership = {
      getOwner: async () => "owner-alice",
      removeOwner: async () => undefined,
    } as unknown as SessionOwnershipService;
    const sessionWorkspaces = {
      listWorkspaces: async () => ({
        ses_iso: {
          runtimeId: "runtime-iso",
          runtimeDir,
          createdAt: 1,
          opencodeRuntime: {
            mode: "isolated_process",
            rootDir: join(runtimeDir, ".openwork-runtime", "opencode"),
            configDir: join(runtimeDir, ".openwork-runtime", "opencode", "config"),
            dataDir: join(runtimeDir, ".openwork-runtime", "opencode", "data"),
            stateDir: join(runtimeDir, ".openwork-runtime", "opencode", "state"),
            cacheDir: join(runtimeDir, ".openwork-runtime", "opencode", "cache"),
            bindHost: "127.0.0.1",
          },
        },
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(`http://openwork.local/w/ws_1/opencode/event?directory=${encodeURIComponent(runtimeDir)}`, {
        method: "GET",
      }),
      url: new URL(`http://openwork.local/w/ws_1/opencode/event?directory=${encodeURIComponent(runtimeDir)}`),
      workspace,
      proxyPath: "/event",
      actor: { type: "remote", scope: "owner", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      sessionRuntimeService: {
        resolveSessionWorkspace: async () => ({
          ...workspace,
          baseUrl: "http://127.0.0.1:4555",
          directory: runtimeDir,
        }),
      } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    expect(response.status).toBe(200);
    expect(captured.url).toBe(`http://127.0.0.1:4555/event?directory=${encodeURIComponent(runtimeDir)}`);
    expect(captured.directory).toBe(runtimeDir);
  });
});
