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
- 面对二进制 Office 文件时，优先进入可读工作面：先复用已有可读副本，或先调用合适的文档能力，再去处理原始二进制文件。
- 可重开的临时工件放在 \`<WORKSPACE>/.tmp/system\`；持久状态和最终交付物放在 \`<WORKSPACE>\` 内，不要把 workspace 外路径或 \`external_directory\` 当成常规文档 I/O 路线。
- 如果 \`.worktree/index.json\`、\`.worktree/sources/manifest.json\` 这类 bootstrap 控制文件已经存在，先读这些窄控制文件，再决定是否继续做更宽的重新发现。
- 交付前运行 \`python3 .opencode/references/check_document_delivery.py --target outputs --target reports\`；如果最终文件在别处，再额外传入那个精确路径，不要把整个 \`.\` 树都拿去扫。
</DOCUMENT_MODE_BRIDGE>`;
}

function buildCompactionBridge() {
  return `## 文档会话续跑合同
在为后续续跑做总结时，如果以下信息存在，必须保留下来：
- 权威源文件与稳定目标文档
- 当前阶段
- 已经写出的 state 文件
- 尚未解决的 blocker 与 open question
- 当前最值得做的下一步

不要把精确文件名、目标路径或 blocker 压缩成模糊总结。`;
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
