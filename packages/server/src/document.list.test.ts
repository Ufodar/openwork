import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentRoutes } from "./document.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

describe("document routes", () => {
  test("hides runtime config files from session document listings", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-route-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "opencode.json"), JSON.stringify({ model: "test" }), "utf8");
    await writeFile(join(runtimeDir, "opencode.jsonc"), JSON.stringify({ model: "test" }), "utf8");
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
});
