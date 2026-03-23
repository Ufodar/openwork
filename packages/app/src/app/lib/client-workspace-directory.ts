export function resolveClientWorkspaceDirectory(input: {
  workspaceType?: string | null;
  clientDirectory?: string | null;
  workspaceDirectory?: string | null;
  workspaceRoot?: string | null;
  preferWorkspaceDirectory?: boolean;
}) {
  const workspaceType = (input.workspaceType ?? "").trim();
  const clientDirectory = (input.clientDirectory ?? "").trim();
  const workspaceDirectory = (input.workspaceDirectory ?? "").trim();
  const workspaceRoot = (input.workspaceRoot ?? "").trim();
  const preferWorkspaceDirectory = Boolean(input.preferWorkspaceDirectory);

  if (workspaceType === "remote") {
    if (preferWorkspaceDirectory) {
      return workspaceDirectory || workspaceRoot || clientDirectory;
    }
    return clientDirectory || workspaceDirectory || workspaceRoot;
  }

  return workspaceRoot || workspaceDirectory || clientDirectory;
}
