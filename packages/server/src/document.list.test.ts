import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentRoutes } from "./document.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

describe("document routes", () => {
  test("does not register retired bid module routes", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-route-no-bid-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });

    const routes: any[] = [];
    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-1",
        runtimeDir,
        createdAt: Date.now(),
      }),
      resolveDocumentsDir: async () => runtimeDir,
    } as unknown as SessionWorkspaceService;

    createDocumentRoutes(routes, sessionWorkspaces);

    const retiredPaths = [
      "/w/ws_test/bid/fill",
      "/w/ws_test/bid/facts",
      "/w/ws_test/bid/qc",
      "/w/ws_test/bid/dedupe",
      "/w/ws_test/bid/preview-pdf",
    ];

    for (const path of retiredPaths) {
      const route = routes.find((candidate) => candidate.regex.test(path));
      expect(route).toBeUndefined();
    }
  });

  test("hides runtime config files from session document listings", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-route-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "opencode.json"), JSON.stringify({ model: "test" }), "utf8");
    await writeFile(join(runtimeDir, "opencode.jsonc"), JSON.stringify({ model: "test" }), "utf8");
    await writeFile(join(runtimeDir, ".gitignore"), ".openwork-runtime/\n.tmp/\n", "utf8");
    await writeFile(join(runtimeDir, "uploaded.docx"), "doc", "utf8");

    const workspace: WorkspaceInfo = {
      id: "ws_test",
      name: "test",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:8789",
    };

    const routes: any[] = [];
    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-1",
        runtimeDir,
        createdAt: Date.now(),
      }),
      resolveDocumentsDir: async () => runtimeDir,
    } as unknown as SessionWorkspaceService;

    createDocumentRoutes(routes, sessionWorkspaces);

    const route = routes.find((candidate) => candidate.method === "GET" && candidate.regex.test("/w/ws_test/documents"));
    expect(route).toBeTruthy();

    const response = await route.handler({
      request: new Request("http://openwork.local/w/ws_test/documents?session=ses_test"),
      url: new URL("http://openwork.local/w/ws_test/documents?session=ses_test"),
      params: { id: "ws_test" },
      config: { workspaces: [workspace] } as ServerConfig,
    });

    const payload = (await response.json()) as { items: Array<{ name: string }>; dirs: string[] };
    expect(payload.items.map((item) => item.name)).toEqual(["uploaded.docx"]);
    expect(payload.dirs).toEqual([]);
  });

  test("surfaces original uploaded names from bootstrap manifest when listing session documents", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-route-original-name-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(join(runtimeDir, ".worktree", "sources"), { recursive: true });
    await writeFile(join(runtimeDir, "src-001.docx"), "doc", "utf8");
    await writeFile(join(runtimeDir, ".worktree", "sources", "manifest.json"), JSON.stringify({
      generated_at: "2026-03-30T00:00:00.000Z",
      goal: "",
      target_doc: null,
      blockers: [],
      sources: [
        {
          docId: "doc-src-001",
          title: "天河监控运维一体化平台软件介绍 v0.3",
          relativePath: "src-001.docx",
          originalName: "天河监控运维一体化平台软件介绍 v0.3.docx",
          originalRelativePath: "资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx",
          kind: "docx",
          role: "参考材料",
          status: "uploaded",
        },
      ],
    }, null, 2), "utf8");

    const workspace: WorkspaceInfo = {
      id: "ws_test",
      name: "test",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:8789",
    };

    const routes: any[] = [];
    const sessionWorkspaces = {
      getWorkspace: async () => ({
        runtimeId: "runtime-1",
        runtimeDir,
        createdAt: Date.now(),
      }),
      resolveDocumentsDir: async () => runtimeDir,
    } as unknown as SessionWorkspaceService;

    createDocumentRoutes(routes, sessionWorkspaces);

    const route = routes.find((candidate) => candidate.method === "GET" && candidate.regex.test("/w/ws_test/documents"));
    expect(route).toBeTruthy();

    const response = await route.handler({
      request: new Request("http://openwork.local/w/ws_test/documents?session=ses_test"),
      url: new URL("http://openwork.local/w/ws_test/documents?session=ses_test"),
      params: { id: "ws_test" },
      config: { workspaces: [workspace] } as ServerConfig,
    });

    const payload = (await response.json()) as {
      items: Array<{ name: string; originalName?: string; title?: string }>;
      dirs: string[];
    };
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]).toMatchObject({
      name: "src-001.docx",
      originalName: "天河监控运维一体化平台软件介绍 v0.3.docx",
      title: "天河监控运维一体化平台软件介绍 v0.3",
    });
  });
});
