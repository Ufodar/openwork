import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
      runtimeKnowledgeTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      runtimeDocumentStateTokens: { revokeRuntime: async () => undefined, issue: async () => ({ token: "", expiresAt: 0 }), resolve: async () => null } as any,
      openworkBaseUrl: "http://127.0.0.1:8789",
    });

    const payload = await response.json() as Array<{ id: string }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe("ses_123");
    expect(captured.url).toBe("http://127.0.0.1:33459/session");
    expect(captured.headers?.get("x-opencode-directory")).toBe("/root/ai_staff/openwork");
  });

  test("recovers historical workspace sessions when the live opencode list is empty", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const workspacePath = await mkdir(join(tmpdir(), `openwork-session-history-${Date.now()}`), { recursive: true });
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
    globalThis.fetch = (async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const workspacePath = await mkdir(join(tmpdir(), `openwork-session-history-merged-${Date.now()}`), { recursive: true });
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

  test("does not boot an isolated runtime just to list historical sessions", async () => {
    let fetchCount = 0;
    globalThis.fetch = (async () => {
      fetchCount += 1;
      throw new Error("should not query a session-owned runtime for history");
    }) as typeof fetch;

    const workspacePath = await mkdir(join(tmpdir(), `openwork-session-iso-list-${Date.now()}`), { recursive: true });
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
      sessionRuntimeService: {
        peekSessionWorkspace: () => null,
      } as any,
    });

    const payload = await response.json() as Array<{ id: string; directory: string | null }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.id).toBe("ses_iso_1");
    expect(payload[0]?.directory).toBe(runtimeDir);
    expect(fetchCount).toBe(0);
  });

  test("includes preferred view metadata from isolated session workspace entries", async () => {
    globalThis.fetch = (async () => {
      throw new Error("shared session list should not be queried for isolated sessions");
    }) as typeof fetch;

    const workspacePath = await mkdir(join(tmpdir(), `openwork-session-view-metadata-${Date.now()}`), { recursive: true });
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
        opencodeRuntime: {
          mode: "isolated_process",
          rootDir: join(runtimeDir, ".openwork-runtime", "opencode"),
          configDir: join(runtimeDir, ".openwork-runtime", "opencode", "config"),
          configHomeDir: join(runtimeDir, ".openwork-runtime", "opencode", "config-home"),
          dataDir: join(runtimeDir, ".openwork-runtime", "opencode", "data"),
          stateDir: join(runtimeDir, ".openwork-runtime", "opencode", "state"),
          cacheDir: join(runtimeDir, ".openwork-runtime", "opencode", "cache"),
          bindHost: "127.0.0.1",
        },
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
      sessionRuntimeService: {
        peekSessionWorkspace: () => null,
      } as any,
    });

    const payload = await response.json() as Array<Record<string, unknown>>;
    expect(payload[0]?.id).toBe("ses_doc_agent");
    expect(payload[0]?.openworkPreferredView).toBe("document-agent");
    expect(payload[0]?.openworkPreferredAgent).toBe("common-work");
    expect(payload[0]?.openworkPreferredAgentLock).toBe("common-work");
  });

  test("includes preferred view metadata from shared-runtime session workspace entries", async () => {
    const workspacePath = await mkdir(join(tmpdir(), `openwork-session-shared-profile-${Date.now()}`), { recursive: true });
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-doc-writer");
    await mkdir(runtimeDir, { recursive: true });

    globalThis.fetch = (async () => new Response(JSON.stringify([{
      id: "ses_doc_writer",
      title: "Writer Session",
      directory: runtimeDir,
      time: { created: 1, updated: 2 },
    }]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

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

  test("recovers preferred view metadata from runtime profiles for historical isolated sessions", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })) as typeof fetch;

    const workspacePath = await mkdir(join(tmpdir(), `openwork-session-runtime-profile-${Date.now()}`), { recursive: true });
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
        opencodeRuntime: {
          mode: "isolated_process",
          rootDir: join(runtimeDir, ".openwork-runtime", "opencode"),
          configDir: join(runtimeDir, ".openwork-runtime", "opencode", "config"),
          configHomeDir: join(runtimeDir, ".openwork-runtime", "opencode", "config-home"),
          dataDir: join(runtimeDir, ".openwork-runtime", "opencode", "data"),
          stateDir: join(runtimeDir, ".openwork-runtime", "opencode", "state"),
          cacheDir: join(runtimeDir, ".openwork-runtime", "opencode", "cache"),
          bindHost: "127.0.0.1",
        },
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
      sessionRuntimeService: {
        peekSessionWorkspace: () => null,
      } as any,
    });

    const payload = await response.json() as Array<Record<string, unknown>>;
    expect(payload[0]?.id).toBe("ses_runtime_profile");
    expect(payload[0]?.openworkPreferredView).toBe("document-agent");
    expect(payload[0]?.openworkPreferredAgent).toBe("common-work");
    expect(payload[0]?.openworkPreferredAgentLock).toBe("common-work");
  });
});
