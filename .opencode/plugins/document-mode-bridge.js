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

function buildSystemBridge(mode) {
  const candidates = mode.officeFiles.length ? mode.officeFiles : mode.textFiles;
  const candidateLine = candidates.length
    ? `Detected document candidates in workspace (use exact names if you open them): ${candidates.join(", ")}`
    : "";

  return `<DOCUMENT_MODE_BRIDGE>
Document mode is active for this workspace because the sampled files look document-heavy (office=${mode.officeCount}, text=${mode.textDocCount}, code=${mode.codeCount}).
${candidateLine ? `\n${candidateLine}` : ""}

Document-native operating rules:
- Read real files early. Do not stay in planning-only mode for long.
- If the workspace already contains a likely source document, inspect it before asking the user to upload files or restate facts that can be extracted directly.
- Prefer exact-path file work and real file evidence over generic writing or organizing skills.
- If a candidate source file is a binary Office document such as \`.docx\`, \`.xlsx\`, or \`.pptx\`, do not call \`read\` on that original file; first extract or convert it into workspace-local Markdown / text under \`<WORKSPACE>/.tmp/system\`, then read the extracted artifact.
- A failed binary \`read\` on an Office file does not count as progress; reroute immediately to extraction instead of retrying the same read path.
- Choose the format skill that matches the current authoritative file or target output.
- Do not call the skill tool merely to "activate" docx, pdf, xlsx, or pptx for ordinary document reads, extraction, conversion, or verification; those document capabilities are already installed in this runtime.
- Do not use \`external_directory\` or workspace-external absolute paths for normal document discovery, reads, or writes.
- Before the first extraction or conversion shell command, create \`<WORKSPACE>/.tmp/system\` (or another workspace-local temp directory) and write outputs there directly.
- Do not "probe" \`/tmp/*\` or \`/private/tmp/*\` first and then recover after a permission error; rewrite the command before execution so reopenable outputs stay inside the workspace.
- Do not probe parent directories, sibling session folders, or repo-root files when the needed document is not already inside the current workspace; treat that as missing input instead.
- In normal document sessions, do not use the glob tool once exact candidate paths are known; prefer filtered \`find\` / \`ls\` and then reuse exact workspace-relative paths.
- In normal hosted document sessions, do not use the grep tool; once you have workspace-local extracted text or Markdown, use \`bash grep -n\`, \`sed -n\`, or targeted \`read\` instead.
- If you use the skill tool, pass an exact installed skill name for a genuinely different workflow such as doc-coauthoring or doc-normalize.
- Never call the skill tool with a generic label like "document expert", "writing expert", or an empty name.
- If the task spans formats, handle one sub-step at a time and switch formats by stage.
- Identify the authoritative source hierarchy before drafting.
- Keep one stable target document instead of creating many drifting variants.
- Persist reusable state in workspace files instead of relying on short-term chat memory.

Whole-document quality rules:
- For Word documents, you must use real Word heading semantics for headings instead of manual numeric prefixes such as \`1.\`, \`1.1\`, or \`一、\`.
- For Word documents, you must use real numbering or bullet structure for lists instead of manually typed prefixes.
- When the target document already has styles, numbering, paragraph spacing, or table rules, reuse that structure instead of inventing a new format.
- If a block's role is ambiguous, inherit the nearest equivalent heading, list, or body style instead of improvising a visual clone.
- Before major edits to a long document, reread the title, outline, adjacent sections, and current conclusions.
- Local edits must preserve global logic, terminology, numbering, cross-references, and section dependencies.
- Before claiming a whole document is done, reread the whole document or a faithful extracted representation.
- Use /doc-normalize for full-document normalization instead of hiding that work inside ordinary drafting or revision turns.

Process routing:
- Use writing-plans only for clearly multi-round, multi-file, or multi-output tasks.
- Use systematic-debugging only after repeated failure, environment mismatch, or conflicting results.
- Use verification-before-completion only before claiming completion, verification, or delivery.
- Do not auto-route to generic brainstorming or generic writing skills unless the user explicitly asks for that kind of help after real-file review.
</DOCUMENT_MODE_BRIDGE>`;
}

function buildCompactionBridge(mode) {
  return `## Document Session Continuation Contract
This workspace currently looks document-heavy (office=${mode.officeCount}, text=${mode.textDocCount}, code=${mode.codeCount}).

When summarizing for continuation, preserve if present:
- the authoritative source files and the stable target document
- the current stage: intake, authority resolution, extraction, revision, coherence check, or delivery
- canonical filenames and workspace-relative paths
- state files already written, such as requirements.csv, .worktree/index.json, .worktree/conventions.md, .worktree/sources/*.json, .worktree/facts.json, .worktree/merge/conflicts.json, .worktree/plan/solution-plan.json, .worktree/coverage.json, and reports/*
- the current outline, section dependencies, terminology commitments, and unresolved cross-section issues
- unresolved blockers, TBD facts, and the single best next action

Do not collapse exact filenames, paths, document roles, or open coherence issues into vague summaries.`;
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
