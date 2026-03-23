import { describe, expect, test } from "bun:test";

import { buildAdminSessionWorkspacePlan } from "./admin-session-workspace-plan";

describe("buildAdminSessionWorkspacePlan", () => {
  test("refreshes an existing matching remote workspace instead of blindly activating stale state", () => {
    const plan = buildAdminSessionWorkspacePlan({
      hostUrl: "http://192.168.5.10:32765/openwork",
      targetWorkspaceId: "user-wangry",
      targetWorkspaceName: "wangry",
      activeWorkspace: {
        id: "remote:andy",
        workspaceType: "remote",
        remoteType: "openwork",
        openworkHostUrl: "http://192.168.5.10:32765/openwork",
        openworkWorkspaceId: "user-andy",
        displayName: "Andy",
      },
      workspaces: [
        {
          id: "remote:wangry",
          workspaceType: "remote",
          remoteType: "openwork",
          openworkHostUrl: "http://192.168.5.10:32765/openwork",
          openworkWorkspaceId: "user-wangry",
          displayName: "wangry",
        },
      ],
    });

    expect(plan).toEqual({
      mode: "refresh-existing",
      workspaceId: "remote:wangry",
      displayName: "wangry",
    });
  });

  test("reuses the active remote workspace when it already targets the same host", () => {
    const plan = buildAdminSessionWorkspacePlan({
      hostUrl: "http://192.168.5.10:32765/openwork",
      targetWorkspaceId: "user-wangry",
      targetWorkspaceName: "wangry",
      activeWorkspace: {
        id: "remote:active",
        workspaceType: "remote",
        remoteType: "openwork",
        openworkHostUrl: "http://192.168.5.10:32765/openwork",
        openworkWorkspaceId: "user-andy",
        displayName: "Andy remote",
      },
      workspaces: [],
    });

    expect(plan).toEqual({
      mode: "update-active",
      workspaceId: "remote:active",
      displayName: "Andy remote",
    });
  });

  test("creates a fresh remote workspace when there is nothing to reuse", () => {
    const plan = buildAdminSessionWorkspacePlan({
      hostUrl: "http://192.168.5.10:32765/openwork",
      targetWorkspaceId: "user-wangry",
      targetWorkspaceName: "wangry",
      activeWorkspace: {
        id: "local:dev",
        workspaceType: "local",
        remoteType: null,
        displayName: "dev",
      },
      workspaces: [],
    });

    expect(plan).toEqual({
      mode: "create",
      displayName: "wangry",
    });
  });
});
