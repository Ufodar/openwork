import { describe, expect, test } from "bun:test";

import { resolveClientWorkspaceDirectory } from "./client-workspace-directory";

describe("resolveClientWorkspaceDirectory", () => {
  test("prefers the live client directory for remote workspaces", () => {
    expect(
      resolveClientWorkspaceDirectory({
        workspaceType: "remote",
        clientDirectory: "/root/.openwork/user-workspaces/user-new",
        workspaceDirectory: "/root/.openwork/user-workspaces/user-old",
        workspaceRoot: "/root/.openwork/user-workspaces/user-old",
      }),
    ).toBe("/root/.openwork/user-workspaces/user-new");
  });

  test("falls back to the stored workspace directory when the remote client has not resolved yet", () => {
    expect(
      resolveClientWorkspaceDirectory({
        workspaceType: "remote",
        clientDirectory: "",
        workspaceDirectory: "/root/.openwork/user-workspaces/user-target",
        workspaceRoot: "/root/.openwork/user-workspaces/user-old",
      }),
    ).toBe("/root/.openwork/user-workspaces/user-target");
  });

  test("prefers the active local workspace root for local workspaces", () => {
    expect(
      resolveClientWorkspaceDirectory({
        workspaceType: "local",
        clientDirectory: "/tmp/session-runtime",
        workspaceDirectory: "/root/.openwork/user-workspaces/user-target",
        workspaceRoot: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      }),
    ).toBe("/Users/storm/Documents/code/studyProject/opencode-docx/openwork");
  });
});
