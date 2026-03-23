import { normalizeOpenworkServerUrl } from "./openwork-server";

type AdminRemoteWorkspaceLike = {
  id: string;
  name?: string | null;
  displayName?: string | null;
  workspaceType?: string | null;
  remoteType?: string | null;
  baseUrl?: string | null;
  openworkHostUrl?: string | null;
  openworkWorkspaceId?: string | null;
  openworkWorkspaceName?: string | null;
};

export type AdminSessionWorkspacePlan =
  | {
    mode: "refresh-existing";
    workspaceId: string;
    displayName: string | null;
  }
  | {
    mode: "update-active";
    workspaceId: string;
    displayName: string | null;
  }
  | {
    mode: "create";
    displayName: string | null;
  };

export function buildAdminSessionWorkspacePlan(input: {
  workspaces: AdminRemoteWorkspaceLike[];
  activeWorkspace: AdminRemoteWorkspaceLike | null;
  hostUrl: string;
  targetWorkspaceId: string;
  targetWorkspaceName?: string | null;
}): AdminSessionWorkspacePlan {
  const hostUrl = normalizeOpenworkServerUrl(input.hostUrl.trim()) ?? "";
  const targetWorkspaceId = input.targetWorkspaceId.trim();
  const targetWorkspaceName = input.targetWorkspaceName?.trim() || null;

  const resolveDisplayName = (workspace: AdminRemoteWorkspaceLike | null | undefined) =>
    workspace?.displayName?.trim() ||
    workspace?.openworkWorkspaceName?.trim() ||
    workspace?.name?.trim() ||
    targetWorkspaceName;

  const existingWorkspace = input.workspaces.find((workspace) =>
    workspace.workspaceType === "remote" &&
    workspace.remoteType === "openwork" &&
    (workspace.openworkWorkspaceId?.trim() ?? "") === targetWorkspaceId &&
    (normalizeOpenworkServerUrl(workspace.openworkHostUrl ?? workspace.baseUrl ?? "") ?? "") === hostUrl
  ) ?? null;

  if (existingWorkspace) {
    return {
      mode: "refresh-existing",
      workspaceId: existingWorkspace.id,
      displayName: resolveDisplayName(existingWorkspace),
    };
  }

  const activeWorkspace = input.activeWorkspace;
  const canReuseActiveRemote =
    activeWorkspace?.workspaceType === "remote" &&
    activeWorkspace.remoteType === "openwork" &&
    (normalizeOpenworkServerUrl(activeWorkspace.openworkHostUrl ?? activeWorkspace.baseUrl ?? "") ?? "") === hostUrl;

  if (canReuseActiveRemote && activeWorkspace) {
    return {
      mode: "update-active",
      workspaceId: activeWorkspace.id,
      displayName: resolveDisplayName(activeWorkspace),
    };
  }

  return {
    mode: "create",
    displayName: targetWorkspaceName,
  };
}
