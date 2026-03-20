import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createDocumentRoutes } from "./document.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";

describe("document config route", () => {
  test("disables OnlyOffice spellcheck by default", async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), "openwork-document-config-"));
    const runtimeDir = join(workspacePath, "documents", "sessions", "runtime-1");
    await mkdir(runtimeDir, { recursive: true });
    await writeFile(join(runtimeDir, "draft.docx"), "doc", "utf8");

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

    const route = routes.find(
      (candidate) => candidate.method === "GET" && candidate.regex.test("/w/ws_test/document/config"),
    );
    expect(route).toBeTruthy();

    const response = await route.handler({
      request: new Request("http://openwork.local/w/ws_test/document/config?doc=draft.docx&session=ses_test"),
      url: new URL("http://openwork.local/w/ws_test/document/config?doc=draft.docx&session=ses_test"),
      params: { id: "ws_test" },
      actor: { clientId: "client-1" },
      config: { workspaces: [workspace] } as ServerConfig,
    });

    const payload = (await response.json()) as {
      config: {
        editorConfig: {
          customization: {
            autosave: boolean;
            forcesave: boolean;
            spellcheck?: boolean;
            features?: {
              spellcheck?: boolean;
            };
          };
        };
      };
    };

    expect(payload.config.editorConfig.customization.spellcheck).toBe(false);
    expect(payload.config.editorConfig.customization.features?.spellcheck).toBe(false);
  });
});
