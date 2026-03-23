export function resolveClientWorkspaceDirectory(input: {
  workspaceType?: string | null;
  clientDirectory?: string | null;
  workspaceDirectory?: string | null;
  workspaceRoot?: string | null;
}) {
  const workspaceType = (input.workspaceType ?? "").trim();
  const clientDirectory = (input.clientDirectory ?? "").trim();
  const workspaceDirectory = (input.workspaceDirectory ?? "").trim();
  const workspaceRoot = (input.workspaceRoot ?? "").trim();

  if (workspaceType === "remote") {
    return clientDirectory || workspaceDirectory || workspaceRoot;
  }

  return workspaceRoot || workspaceDirectory || clientDirectory;
}
