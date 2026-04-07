import fs from "node:fs";
import path from "node:path";

const OFFICE_EXTENSIONS = new Set([
  ".doc",
  ".docx",
  ".pdf",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
  ".tsv",
]);

const TEXT_DOCUMENT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".rtf",
]);

const CODE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);

const SKIP_DIRECTORIES = new Set([
  ".git",
  ".tmp",
  ".worktree",
  "dist",
  "build",
  "node_modules",
  "target",
  "vendor",
]);

function sampleWorkspace(rootDir, maxDepth = 3, maxFiles = 120) {
  const files = [];

  function walk(currentDir, depth) {
    if (files.length >= maxFiles) return;

    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= maxFiles) return;
      if (entry.name.startsWith(".") && entry.name !== ".tmp" && entry.name !== ".worktree") continue;

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= maxDepth) continue;
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        walk(fullPath, depth + 1);
        continue;
      }

      files.push(fullPath);
    }
  }

  walk(rootDir, 0);
  return files;
}

function toWorkspaceRelative(rootDir, filePath) {
  const relative = path.relative(rootDir, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath;
}

function classifyWorkspace(rootDir) {
  const files = sampleWorkspace(rootDir);
  let officeCount = 0;
  let textDocCount = 0;
  let codeCount = 0;
  const officeFiles = [];
  const textFiles = [];

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (OFFICE_EXTENSIONS.has(ext)) {
      officeCount += 1;
      officeFiles.push(toWorkspaceRelative(rootDir, file));
      continue;
    }
    if (TEXT_DOCUMENT_EXTENSIONS.has(ext)) {
      textDocCount += 1;
      textFiles.push(toWorkspaceRelative(rootDir, file));
      continue;
    }
    if (CODE_EXTENSIONS.has(ext)) {
      codeCount += 1;
    }
  }

  const documentLikely =
    officeCount > 0 || (textDocCount >= 3 && codeCount === 0) || (textDocCount >= 5 && textDocCount >= codeCount);

  return {
    documentLikely,
    officeCount,
    textDocCount,
    codeCount,
    officeFiles: officeFiles.slice(0, 8),
    textFiles: textFiles.slice(0, 8),
  };
}

function buildSystemBridge() {
  return `<DOCUMENT_MODE_BRIDGE>
- Prefer a readable working surface for binary Office files: reuse an existing readable artifact or use the appropriate document capability before treating the original binary like plain text.
- Keep reopenable temp artifacts under \`<WORKSPACE>/.tmp/system\`, and keep persisted state plus final deliverables inside \`<WORKSPACE>\`; do not treat workspace-external paths or \`external_directory\` as the normal document I/O path.
- If bootstrap control files such as \`.worktree/index.json\` or \`.worktree/sources/manifest.json\` already exist, read those narrow control files before doing another broad rediscovery pass.
- Do not let extracted source text replace control files as the main-session bootstrap surface; source-compilation phases can still consume whichever readable artifacts they need.
- Before delivery, run \`python3 .opencode/references/check_document_delivery.py --target outputs --target reports\` plus the exact final file path if it lives elsewhere, and do not point the sweep at the whole \`.\` tree.
</DOCUMENT_MODE_BRIDGE>`;
}

function buildCompactionBridge() {
  return `## Document Session Continuation Contract
When summarizing for continuation, preserve if present:
- the authoritative source files and the stable target document
- the current stage
- state files already written
- unresolved blockers and open questions
- the single best next action

Do not collapse exact filenames, target paths, or blockers into vague summaries.`;
}

function appendSystemPrompt(output, prompt) {
  if (!prompt) return;

  if (typeof output.system === "string") {
    output.system = `${output.system}\n\n${prompt}`;
    return;
  }

  if (Array.isArray(output.system) && output.system.length > 0) {
    output.system[0] = `${output.system[0]}\n\n${prompt}`;
    return;
  }

  output.system = [prompt];
}

export const DocumentModeBridge = async ({ directory }) => {
  const workspaceDir = typeof directory === "string" && directory ? directory : process.cwd();
  const classify = () => classifyWorkspace(workspaceDir);

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      const mode = classify();
      if (!mode.documentLikely) return;
      appendSystemPrompt(output, buildSystemBridge());
    },
    "experimental.session.compacting": async (_input, output) => {
      const mode = classify();
      if (!mode.documentLikely) return;
      (output.context ||= []).push(buildCompactionBridge());
    },
  };
};
