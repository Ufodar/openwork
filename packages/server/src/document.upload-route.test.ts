import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentRoutes } from "./document.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

describe("document upload route", () => {
  test("sanitizes uploaded file names before writing them into session storage", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-upload-route-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });

    const workspace: WorkspaceInfo = {
      id: "ws_test",
      name: "test",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:8789",
    };

    const routes: any[] = [];
    const sessionWorkspaces = {
      resolveDocumentsDir: async () => runtimeDir,
    } as unknown as SessionWorkspaceService;

    createDocumentRoutes(routes, sessionWorkspaces);

    const route = routes.find((candidate) => candidate.method === "POST" && candidate.regex.test("/w/ws_test/document/upload"));
    expect(route).toBeTruthy();

    const form = new FormData();
    form.append(
      "file",
      new File(["doc"], "天河监控运维一体化平台软件介绍 v0.3.docx", {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    );
    form.append("baseDir", "selected");
    form.append("relativePath", "资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx");
    form.append("path", "selected/资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx");

    const response = await route.handler({
      request: new Request("http://openwork.local/w/ws_test/document/upload?session=ses_test", {
        method: "POST",
        body: form,
      }),
      url: new URL("http://openwork.local/w/ws_test/document/upload?session=ses_test"),
      params: { id: "ws_test" },
      config: { workspaces: [workspace] } as ServerConfig,
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { ok: boolean; name: string };
    expect(payload.ok).toBe(true);
    expect(payload.name).toBe("selected/资料-2026/天河监控运维一体化平台软件介绍-v0-3.docx");
    expect(await readFile(join(runtimeDir, payload.name), "utf8")).toBe("doc");

    const responseList = await (routes.find((candidate) => candidate.method === "GET" && candidate.regex.test("/w/ws_test/documents")) as any).handler({
      request: new Request("http://openwork.local/w/ws_test/documents?session=ses_test"),
      url: new URL("http://openwork.local/w/ws_test/documents?session=ses_test"),
      params: { id: "ws_test" },
      config: { workspaces: [workspace] } as ServerConfig,
    });
    const listed = (await responseList.json()) as { items: Array<{ name: string }> };
    expect(listed.items.map((item) => item.name)).toEqual([payload.name]);
  });

  test("adds a unique suffix when the sanitized destination already exists", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-upload-route-collision-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });

    const workspace: WorkspaceInfo = {
      id: "ws_test",
      name: "test",
      path: workspacePath,
      workspaceType: "local",
      baseUrl: "http://127.0.0.1:8789",
    };

    const routes: any[] = [];
    const sessionWorkspaces = {
      resolveDocumentsDir: async () => runtimeDir,
    } as unknown as SessionWorkspaceService;

    createDocumentRoutes(routes, sessionWorkspaces);

    const route = routes.find((candidate) => candidate.method === "POST" && candidate.regex.test("/w/ws_test/document/upload"));
    expect(route).toBeTruthy();

    const upload = async () => {
      const form = new FormData();
      form.append(
        "file",
        new File(["doc"], "天河监控运维一体化平台软件介绍 v0.3.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
      );
      form.append("baseDir", "selected");
      form.append("relativePath", "资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx");
      form.append("path", "selected/资料 2026/天河监控运维一体化平台软件介绍 v0.3.docx");
      const response = await route.handler({
        request: new Request("http://openwork.local/w/ws_test/document/upload?session=ses_test", {
          method: "POST",
          body: form,
        }),
        url: new URL("http://openwork.local/w/ws_test/document/upload?session=ses_test"),
        params: { id: "ws_test" },
        config: { workspaces: [workspace] } as ServerConfig,
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { ok: boolean; name: string };
    };

    const first = await upload();
    const second = await upload();

    expect(first.name).toBe("selected/资料-2026/天河监控运维一体化平台软件介绍-v0-3.docx");
    expect(second.name).toMatch(
      /^selected\/资料-2026\/天河监控运维一体化平台软件介绍-v0-3-[a-f0-9]{8}\.docx$/,
    );
    expect(second.name).not.toBe(first.name);
    expect(await readFile(join(runtimeDir, first.name), "utf8")).toBe("doc");
    expect(await readFile(join(runtimeDir, second.name), "utf8")).toBe("doc");

    const leftovers = await readdir(join(runtimeDir, "selected", "资料-2026"));
    expect(leftovers.sort()).toHaveLength(2);
  });
});
