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

function classifyWorkspace(rootDir) {
  const files = sampleWorkspace(rootDir);
  let officeCount = 0;
  let textDocCount = 0;
  let codeCount = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (OFFICE_EXTENSIONS.has(ext)) {
      officeCount += 1;
      continue;
    }
    if (TEXT_DOCUMENT_EXTENSIONS.has(ext)) {
      textDocCount += 1;
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
  };
}

function buildSystemBridge(mode) {
  return `<DOCUMENT_MODE_BRIDGE>
Document mode is active for this workspace because the sampled files look document-heavy (office=${mode.officeCount}, text=${mode.textDocCount}, code=${mode.codeCount}).

When the current task is document-centric rather than code-centric:
- Pick exactly 1 primary skill for the core outcome.
- Add at most 2 companion skills for concrete gaps.
- Add at most 1 process skill when complexity or failure pattern requires it.
- Prefer document/process skills over code-only superpowers unless the task is actually software implementation.

Recommended document combinations:
- Structure + final .docx output -> doc-coauthoring + docx
- Evidence/citations/research + final deliverable -> content-research-writer + docx or pdf
- Internal announcement / report tone + final .docx -> internal-comms + docx
- Many messy source files before extraction -> file-organizer + one format/domain skill

Process skills are conditional:
- brainstorming -> route is ambiguous or there are multiple plausible approaches
- writing-plans -> task is multi-phase, multi-file, or long-running
- systematic-debugging -> repeated failures or environment/tool mismatch
- verification-before-completion -> before claiming completion or pass status

Before switching primary skills, persist reusable state in workspace files rather than relying on short-term chat memory.
</DOCUMENT_MODE_BRIDGE>`;
}

function buildCompactionBridge(mode) {
  return `## Document Session Continuation Contract
This workspace currently looks document-heavy (office=${mode.officeCount}, text=${mode.textDocCount}, code=${mode.codeCount}).

When summarizing for continuation, preserve if present:
- the target output document and canonical input filenames
- which skill acted as primary and which were companions
- state files already written (for example requirements.csv, .worktree/index.json, .worktree/conventions.md, .bid/facts.json)
- any unresolved blockers, TBD facts, or pending document sections
- the single best next action for the next agent

Do not collapse exact filenames, paths, or document roles into vague summaries.`;
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
      appendSystemPrompt(output, buildSystemBridge(mode));
    },
    "experimental.session.compacting": async (_input, output) => {
      const mode = classify();
      if (!mode.documentLikely) return;
      (output.context ||= []).push(buildCompactionBridge(mode));
    },
  };
};
