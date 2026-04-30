import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { WorkspaceInfo } from "./types.js";
import { proxyOpencodeRequest } from "./server.js";
import type { SessionOwnershipService } from "./session-ownership.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

const originalFetch = globalThis.fetch;

function createFetchMock(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return handler as unknown as typeof fetch;
}

function createTempWorkspacePath(prefix: string) {
  return mkdtemp(join(tmpdir(), `${prefix}-`));
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("proxyOpencodeRequest session listing", () => {
  test("aggregates workspace-root session lists from a shared session index", async () => {
    const captured: { url?: string; headers?: Headers } = {};
    globalThis.fetch = createFetchMock(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    });

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
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<{ id: string }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe("ses_123");
    expect(captured.url).toBe("http://127.0.0.1:33459/session");
    expect(captured.headers?.get("x-opencode-directory")).toBe("/root/ai_staff/openwork/documents/sessions/ses_123");
  });

  test("recovers historical workspace sessions when the live opencode list is empty", async () => {
    globalThis.fetch = createFetchMock(async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const workspacePath = await createTempWorkspacePath("openwork-session-history");
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

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`,
        { method: "GET" },
      ),
      url: new URL(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`,
      ),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "collaborator", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<{ id: string; directory: string | null }>;
    expect(payload.map((item) => item.id)).toContain("ses_hist_1");
    expect(payload.find((item) => item.id === "ses_hist_1")?.directory).toBe(workspacePath);
  });

  test("merges historical sessions from root and runtime openwork metadata", async () => {
    globalThis.fetch = createFetchMock(async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const workspacePath = await createTempWorkspacePath("openwork-session-history-merged");
    await mkdir(join(workspacePath, ".opencode"), { recursive: true });
    await writeFile(
      join(workspacePath, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_root_hist_1: { view: "document-agent" },
        },
      }),
      "utf8",
    );

    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(join(runtimeDir, ".opencode"), { recursive: true });
    await writeFile(
      join(runtimeDir, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_runtime_hist_1: { view: "document-agent" },
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

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`,
        { method: "GET" },
      ),
      url: new URL(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`,
      ),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "collaborator", tokenHash: "owner-alice" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<{ id: string; directory: string | null }>;
    expect(payload.map((item) => item.id).sort()).toEqual(["ses_root_hist_1", "ses_runtime_hist_1"]);
    expect(payload.find((item) => item.id === "ses_root_hist_1")?.directory).toBe(workspacePath);
    expect(payload.find((item) => item.id === "ses_runtime_hist_1")?.directory).toBe(runtimeDir);
  });

  test("prefers recovered runtime history when the runtime session list is unavailable", async () => {
    let fetchCount = 0;
    globalThis.fetch = createFetchMock(async () => {
      fetchCount += 1;
      throw new Error("runtime session list unavailable");
    });

    const workspacePath = await createTempWorkspacePath("openwork-session-iso-list");
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-iso-1");
    await mkdir(join(runtimeDir, ".opencode"), { recursive: true });
    await writeFile(
      join(runtimeDir, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_iso_1: { view: "document-agent" },
        },
      }),
      "utf8",
    );

    const workspace: WorkspaceInfo = {
      id: "ws_shared",
      name: "shared",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const sessionOwnership = {
      listEntries: async () => ({
        ses_iso_1: { ownerKey: "host-owner", updatedAt: 1 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-iso-1",
        runtimeDir,
        createdAt: 1,
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/ws_shared/opencode/session?directory=${encodeURIComponent(workspacePath)}`,
        { method: "GET" },
      ),
      url: new URL(`http://openwork.local/w/ws_shared/opencode/session?directory=${encodeURIComponent(workspacePath)}`),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<{ id: string; directory: string | null }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe("ses_iso_1");
    expect(payload[0]?.directory).toBe(runtimeDir);
    expect(fetchCount).toBe(1);
  });

  test("includes preferred view metadata from session workspace entries when runtime session listing is unavailable", async () => {
    globalThis.fetch = createFetchMock(async () => {
      throw new Error("runtime session list unavailable");
    });

    const workspacePath = await createTempWorkspacePath("openwork-session-view-metadata");
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-doc-agent");
    await mkdir(runtimeDir, { recursive: true });

    const workspace: WorkspaceInfo = {
      id: "ws_doc_agent",
      name: "doc-agent",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const sessionOwnership = {
      listEntries: async () => ({
        ses_doc_agent: { ownerKey: "host-owner", updatedAt: 1 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-doc-agent",
        runtimeDir,
        createdAt: 1,
        preferredView: "document-agent",
        preferredAgent: "common-work",
        preferredAgentLock: "common-work",
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspacePath)}`,
        { method: "GET" },
      ),
      url: new URL(`http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspacePath)}`),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<Record<string, unknown>>;
    expect(payload[0]?.id).toBe("ses_doc_agent");
    expect(payload[0]?.openworkPreferredView).toBe("document-agent");
    expect(payload[0]?.openworkPreferredAgent).toBe("common-work");
    expect(payload[0]?.openworkPreferredAgentLock).toBe("common-work");
  });

  test("includes preferred view metadata from shared-runtime session workspace entries", async () => {
    const workspacePath = await createTempWorkspacePath("openwork-session-shared-profile");
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-doc-writer");
    await mkdir(runtimeDir, { recursive: true });

    globalThis.fetch = createFetchMock(async () => new Response(JSON.stringify([{
      id: "ses_doc_writer",
      title: "Writer Session",
      directory: runtimeDir,
      time: { created: 1, updated: 2 },
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const workspace: WorkspaceInfo = {
      id: "ws_doc_writer",
      name: "doc-writer",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const sessionOwnership = {
      listEntries: async () => ({
        ses_doc_writer: { ownerKey: "host-owner", updatedAt: 2 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-doc-writer",
        runtimeDir,
        createdAt: 1,
        preferredView: "document-writer",
        preferredAgent: "document-writer",
        preferredAgentLock: "document-writer",
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`,
        { method: "GET" },
      ),
      url: new URL(`http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<Record<string, unknown>>;
    expect(payload[0]?.id).toBe("ses_doc_writer");
    expect(payload[0]?.openworkPreferredView).toBe("document-writer");
    expect(payload[0]?.openworkPreferredAgent).toBe("document-writer");
    expect(payload[0]?.openworkPreferredAgentLock).toBe("document-writer");
  });

  test("prefers the mapped runtime directory over a workspace-root directory from the shared session list", async () => {
    const workspacePath = await createTempWorkspacePath("openwork-session-runtime-dir-preferred");
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-doc-writer");
    await mkdir(runtimeDir, { recursive: true });

    globalThis.fetch = createFetchMock(async () => new Response(JSON.stringify([{
      id: "ses_doc_writer",
      title: "Writer Session",
      directory: workspacePath,
      time: { created: 1, updated: 2 },
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    const workspace: WorkspaceInfo = {
      id: "ws_doc_writer",
      name: "doc-writer",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    const sessionOwnership = {
      listEntries: async () => ({
        ses_doc_writer: { ownerKey: "host-owner", updatedAt: 2 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-doc-writer",
        runtimeDir,
        createdAt: 1,
        preferredView: "document-writer",
        preferredAgent: "document-writer",
        preferredAgentLock: "document-writer",
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`,
        { method: "GET" },
      ),
      url: new URL(`http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspace.path)}`),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<Record<string, unknown>>;
    expect(payload[0]?.id).toBe("ses_doc_writer");
    expect(payload[0]?.directory).toBe(runtimeDir);
  });

  test("recovers preferred view metadata from runtime profiles for historical session runtimes", async () => {
    globalThis.fetch = createFetchMock(async () => {
      throw new Error("runtime session list unavailable");
    });

    const workspacePath = await createTempWorkspacePath("openwork-session-runtime-profile");
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-profile-1");
    await mkdir(join(runtimeDir, ".opencode"), { recursive: true });
    await writeFile(
      join(runtimeDir, ".opencode", "openwork-runtime-profile.json"),
      JSON.stringify({
        id: "document-agent",
        skillAllowlist: ["docx"],
        mcpAllowlist: ["doc_state"],
      }),
      "utf8",
    );

    const workspace: WorkspaceInfo = {
      id: "ws_runtime_profile",
      name: "runtime-profile",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:33459",
    };

    await writeFile(
      join(runtimeDir, ".opencode", "openwork.json"),
      JSON.stringify({
        version: 1,
        sessions: {
          ses_runtime_profile: { view: "document-agent" },
        },
      }),
      "utf8",
    );

    const sessionOwnership = {
      listEntries: async () => ({
        ses_runtime_profile: { ownerKey: "host-owner", updatedAt: 1 },
      }),
    } as unknown as SessionOwnershipService;

    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-profile-1",
        runtimeDir,
        createdAt: 1,
      }),
    } as unknown as SessionWorkspaceService;

    const response = await proxyOpencodeRequest({
      request: new Request(
        `http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspacePath)}`,
        { method: "GET" },
      ),
      url: new URL(`http://openwork.local/w/${workspace.id}/opencode/session?directory=${encodeURIComponent(workspacePath)}`),
      workspace,
      proxyPath: "/session",
      actor: { type: "remote", scope: "owner", tokenHash: "host-owner" },
      sessionOwnership,
      sessionWorkspaces,
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<Record<string, unknown>>;
    expect(payload[0]?.id).toBe("ses_runtime_profile");
    expect(payload[0]?.openworkPreferredView).toBe("document-agent");
    expect(payload[0]?.openworkPreferredAgent).toBe("common-work");
    expect(payload[0]?.openworkPreferredAgentLock).toBe("common-work");
  });
});
