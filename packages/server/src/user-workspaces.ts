import { join, resolve } from "node:path";
import { homedir } from "node:os";

import { ensureDir } from "./utils.js";
import { copyWorkspaceConfigTemplate } from "./workspace-template.js";

function resolveUserWorkspacesRoot(input?: string): string {
  const override = input?.trim() || process.env.OPENWORK_USER_WORKSPACES_ROOT?.trim();
  if (override) return resolve(override);
  return join(homedir(), ".openwork", "user-workspaces");
}

export async function provisionUserWorkspace(input: {
  userId: string;
  templateDir: string;
  workspacesRoot?: string;
}): Promise<{ workspaceId: string; workspacePath: string }> {
  const userId = input.userId.trim();
  if (!userId) {
    throw new Error("userId is required");
  }

  const workspacesRoot = resolveUserWorkspacesRoot(input.workspacesRoot);
  const workspacePath = join(workspacesRoot, userId);
  await ensureDir(workspacePath);
  await ensureDir(join(workspacePath, "documents"));
  await copyWorkspaceConfigTemplate(input.templateDir, workspacePath);

  return {
    workspaceId: `user-${userId}`,
    workspacePath,
  };
}
