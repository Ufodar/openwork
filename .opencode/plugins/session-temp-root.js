import fs from "node:fs";
import path from "node:path";

function resolveWorkspaceDir(directory) {
  return typeof directory === "string" && directory.trim() ? directory : process.cwd();
}

function ensureSessionTempRoot(workspaceDir) {
  const tempRoot = path.join(workspaceDir, ".tmp", "system");
  fs.mkdirSync(tempRoot, { recursive: true });
  return tempRoot;
}

export const SessionTempRootPlugin = async ({ directory }) => {
  const workspaceDir = resolveWorkspaceDir(directory);

  return {
    "shell.env": async (_input, output) => {
      const tempRoot = ensureSessionTempRoot(workspaceDir);
      output.env = {
        ...(output.env ?? {}),
        TMPDIR: tempRoot,
        TMP: tempRoot,
        TEMP: tempRoot,
      };
    },
  };
};
