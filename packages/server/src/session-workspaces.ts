import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { cp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";

import { readJsoncFile, writeJsoncFile } from "./jsonc.js";
import { opencodeConfigPath } from "./workspace-files.js";
import { ensureDir, exists, shortId } from "./utils.js";

type PermissionAction = "allow" | "deny" | "ask";

type PermissionRule = {
  permission: string;
  pattern: string;
  action: PermissionAction;
};

export type PermissionRuleset = PermissionRule[];

type SessionWorkspaceStore = {
  schemaVersion: 1 | 2;
  updatedAt: number;
  workspaces: Record<string, SessionWorkspaceEntry>;
};

export type SessionWorkspaceEntry = {
  runtimeId: string;
  runtimeDir: string;
  createdAt: number;
  preferredView?: string | null;
  preferredAgent?: string | null;
  preferredAgentLock?: string | null;
  runtimeProfileId?: string | null;
  runtimeScopeKind?: string | null;
  runtimeScopeKey?: string | null;
  bidNodeId?: string | null;
};

type RuntimeKnowledgeInstructionRecord = {
  knowledgeId: string;
  title: string;
  ownerDisplayName?: string | null;
  description?: string | null;
};

export type SessionRuntimeProvisioningHints = {
  preferredView?: string | null;
  preferredAgent?: string | null;
  preferredAgentLock?: string | null;
  runtimeProfileId?: "default" | "document-agent" | "document-writer" | "bid-workbench-node" | null;
  runtimeScopeKind?: "bid-workbench-node" | null;
  runtimeScopeKey?: string | null;
  bidNodeId?: string | null;
};

type RuntimeSessionProfileId =
  | "default"
  | "document-agent"
  | "document-writer"
  | "bid-workbench-node";

type RuntimeSessionProfile = {
  id: RuntimeSessionProfileId;
  skillAllowlist: string[];
  mcpAllowlist: string[];
};

const RUNTIME_INSTRUCTIONS_RELATIVE_PATH = ".opencode/openwork-runtime.md";
const RUNTIME_PROFILE_RELATIVE_PATH = ".opencode/openwork-runtime-profile.json";
const KNOWLEDGE_INSTRUCTIONS_RELATIVE_PATH = ".opencode/openwork-knowledge.md";
const DOC_STATE_INSTRUCTIONS_RELATIVE_PATH = ".opencode/doc-state.md";
const BID_WORKBENCH_NODE_INSTRUCTIONS_RELATIVE_PATH = ".opencode/openwork-bid-workbench-node.md";
const SESSION_TMP_ROOT_RELATIVE_PATH = ".tmp/system";
const HOSTED_SYSTEM_TMP_PREFIXES = ["/tmp/", "/private/tmp/"] as const;
const HOSTED_REOPENABLE_DOC_EXTENSIONS = [
  "md",
  "txt",
  "xml",
  "html",
  "csv",
  "tsv",
  "pdf",
  "docx",
  "xlsx",
  "pptx",
] as const;
const RUNTIME_MIRRORED_OPENCODE_DIRS = [
  "agent",
  "commands",
  "instructions",
  "plugins",
  "prompts",
  "references",
  "runtime-support",
  "skills",
] as const;
const DOCUMENT_SESSION_SKILL_ALLOWLIST = [
  "doc-coauthoring",
  "doc-normalize",
  "docx",
  "hermes-learning-loop",
  "pdf",
  "pptx",
  "xlsx",
] as const;
const DOCUMENT_WRITER_SESSION_SKILL_ALLOWLIST = [...DOCUMENT_SESSION_SKILL_ALLOWLIST] as const;
const DOCUMENT_SESSION_MCP_ALLOWLIST = [
  "bocha-search",
  "doc_state",
  "openwork-knowledge",
] as const;

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = normalizeOptionalString(entry);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    next.push(normalized);
  }
  return next;
}

function buildRuntimeSessionProfile(
  id: RuntimeSessionProfileId,
  options?: {
    skillAllowlist?: readonly string[];
    mcpAllowlist?: readonly string[];
  },
): RuntimeSessionProfile {
  return {
    id,
    skillAllowlist: [...(options?.skillAllowlist ?? [])],
    mcpAllowlist: [...(options?.mcpAllowlist ?? [])],
  };
}

function buildDefaultRuntimeSessionProfile(): RuntimeSessionProfile {
  return buildRuntimeSessionProfile("default", {
    skillAllowlist: DOCUMENT_SESSION_SKILL_ALLOWLIST,
    mcpAllowlist: DOCUMENT_SESSION_MCP_ALLOWLIST,
  });
}

function resolveRuntimeSessionProfile(hints?: SessionRuntimeProvisioningHints | null): RuntimeSessionProfile {
  const explicitRuntimeProfileId = normalizeOptionalString(hints?.runtimeProfileId)?.toLowerCase() ?? "";
  const preferredView = normalizeOptionalString(hints?.preferredView)?.toLowerCase() ?? "";
  const preferredAgent = normalizeOptionalString(hints?.preferredAgent)?.toLowerCase() ?? "";
  const preferredAgentLock = normalizeOptionalString(hints?.preferredAgentLock)?.toLowerCase() ?? "";

  if (explicitRuntimeProfileId === "bid-workbench-node") {
    return buildRuntimeSessionProfile("bid-workbench-node", {
      skillAllowlist: DOCUMENT_SESSION_SKILL_ALLOWLIST,
      mcpAllowlist: DOCUMENT_SESSION_MCP_ALLOWLIST,
    });
  }

  if (explicitRuntimeProfileId === "document-writer") {
    return buildRuntimeSessionProfile("document-writer", {
      skillAllowlist: DOCUMENT_WRITER_SESSION_SKILL_ALLOWLIST,
      mcpAllowlist: DOCUMENT_SESSION_MCP_ALLOWLIST,
    });
  }

  if (explicitRuntimeProfileId === "document-agent") {
    return buildRuntimeSessionProfile("document-agent", {
      skillAllowlist: DOCUMENT_SESSION_SKILL_ALLOWLIST,
      mcpAllowlist: DOCUMENT_SESSION_MCP_ALLOWLIST,
    });
  }

  if (
    preferredView === "document-writer" ||
    preferredAgent === "document-writer" ||
    preferredAgentLock === "document-writer"
  ) {
    return buildRuntimeSessionProfile("document-writer", {
      skillAllowlist: DOCUMENT_WRITER_SESSION_SKILL_ALLOWLIST,
      mcpAllowlist: DOCUMENT_SESSION_MCP_ALLOWLIST,
    });
  }

  if (
    preferredView === "document-agent" ||
    preferredAgent === "common-work" ||
    preferredAgentLock === "common-work"
  ) {
    return buildRuntimeSessionProfile("document-agent", {
      skillAllowlist: DOCUMENT_SESSION_SKILL_ALLOWLIST,
      mcpAllowlist: DOCUMENT_SESSION_MCP_ALLOWLIST,
    });
  }

  return buildDefaultRuntimeSessionProfile();
}

function parseRuntimeSessionProfileRecord(raw: unknown): RuntimeSessionProfile {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  const id = normalizeOptionalString(record?.id);
  if (id !== "document-agent" && id !== "document-writer" && id !== "bid-workbench-node") {
    return buildDefaultRuntimeSessionProfile();
  }
  const fallback = resolveRuntimeSessionProfile({ runtimeProfileId: id as RuntimeSessionProfileId });
  const skillAllowlist = normalizeStringList(record?.skillAllowlist);
  const mcpAllowlist = normalizeStringList(record?.mcpAllowlist);
  return buildRuntimeSessionProfile(id, {
    skillAllowlist: skillAllowlist.length ? skillAllowlist : fallback.skillAllowlist,
    mcpAllowlist: mcpAllowlist.length ? mcpAllowlist : fallback.mcpAllowlist,
  });
}

async function readRuntimeSessionProfile(runtimeDir: string): Promise<RuntimeSessionProfile> {
  const profilePath = join(runtimeDir, RUNTIME_PROFILE_RELATIVE_PATH);
  if (!(await exists(profilePath))) return buildDefaultRuntimeSessionProfile();
  try {
    const raw = JSON.parse(await readFile(profilePath, "utf8")) as unknown;
    return parseRuntimeSessionProfileRecord(raw);
  } catch {
    return buildDefaultRuntimeSessionProfile();
  }
}

async function writeRuntimeSessionProfile(runtimeDir: string, profile: RuntimeSessionProfile): Promise<void> {
  const profilePath = join(runtimeDir, RUNTIME_PROFILE_RELATIVE_PATH);
  await ensureDir(dirname(profilePath));
  if (profile.id === "default") {
    await rm(profilePath, { force: true }).catch(() => undefined);
    return;
  }
  await writeFile(profilePath, JSON.stringify({
    id: profile.id,
    skillAllowlist: [...profile.skillAllowlist],
    mcpAllowlist: [...profile.mcpAllowlist],
  }, null, 2) + "\n", "utf8");
}

function expandHome(value: string): string {
  if (value.startsWith("~/")) return join(homedir(), value.slice(2));
  return value;
}

function resolveOpenworkDataDir(): string {
  const override = process.env.OPENWORK_DATA_DIR?.trim();
  if (override) return expandHome(override);
  return join(homedir(), ".openwork", "openwork-server");
}

function resolveSessionWorkspacePath(workspaceId: string): string {
  return join(resolveOpenworkDataDir(), "session-workspaces", `${workspaceId}.json`);
}

async function readStore(path: string): Promise<SessionWorkspaceStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 2, updatedAt: Date.now(), workspaces: {} };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<SessionWorkspaceStore>;
    const source = parsed.workspaces && typeof parsed.workspaces === "object" ? parsed.workspaces : {};
    const workspaces: Record<string, SessionWorkspaceEntry> = {};
    for (const [sessionId, value] of Object.entries(source as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const record = value as Partial<SessionWorkspaceEntry>;
      const runtimeId = typeof record.runtimeId === "string" ? record.runtimeId.trim() : "";
      const runtimeDir = typeof record.runtimeDir === "string" ? record.runtimeDir.trim() : "";
      const createdAt = typeof record.createdAt === "number" ? record.createdAt : Date.now();
      const preferredView = typeof record.preferredView === "string" ? record.preferredView.trim() || null : null;
      const preferredAgent = typeof record.preferredAgent === "string" ? record.preferredAgent.trim() || null : null;
      const preferredAgentLock =
        typeof record.preferredAgentLock === "string" ? record.preferredAgentLock.trim() || null : null;
      const runtimeProfileId =
        typeof record.runtimeProfileId === "string" ? record.runtimeProfileId.trim() || null : null;
      const runtimeScopeKind =
        typeof record.runtimeScopeKind === "string" ? record.runtimeScopeKind.trim() || null : null;
      const runtimeScopeKey =
        typeof record.runtimeScopeKey === "string" ? record.runtimeScopeKey.trim() || null : null;
      const bidNodeId = typeof record.bidNodeId === "string" ? record.bidNodeId.trim() || null : null;
      if (!sessionId.trim() || !runtimeId || !runtimeDir) continue;
      workspaces[sessionId] = {
        runtimeId,
        runtimeDir,
        createdAt,
        preferredView,
        preferredAgent,
        preferredAgentLock,
        runtimeProfileId,
        runtimeScopeKind,
        runtimeScopeKey,
        bidNodeId,
      };
    }
    return { schemaVersion: 2, updatedAt: Date.now(), workspaces };
  } catch {
    return { schemaVersion: 2, updatedAt: Date.now(), workspaces: {} };
  }
}

async function writeStore(path: string, workspaces: Record<string, SessionWorkspaceEntry>) {
  await ensureDir(dirname(path));
  const payload: SessionWorkspaceStore = {
    schemaVersion: 2,
    updatedAt: Date.now(),
    workspaces,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

export async function provisionSessionWorkspace(
  workspacePath: string,
  hints?: SessionRuntimeProvisioningHints,
): Promise<{ runtimeId: string; runtimeDir: string }> {
  const runtimeId = shortId().replace(/-/g, "");
  const runtimeDir = join(workspacePath, "documents", "sessions", runtimeId);
  const runtimeProfile = resolveRuntimeSessionProfile(hints);
  await ensureDir(runtimeDir);
  await writeRuntimeProjectBoundary(runtimeDir);
  await mirrorWorkspaceOpencodeSupportFiles(workspacePath, runtimeDir, runtimeProfile);
  await writeRuntimeSessionCarrierConfig({ workspacePath, runtimeDir, profile: runtimeProfile });
  if (runtimeProfile.id === "bid-workbench-node") {
    const bidNodeId = sanitizeRuntimeScopeSegment(hints?.bidNodeId, "node");
    await prepareBidWorkbenchNodeRuntime({
      workspacePath,
      runtimeDir,
      runtimeId,
      bidNodeId,
    });
  }
  return { runtimeId, runtimeDir };
}

async function writeRuntimeProjectBoundary(runtimeDir: string): Promise<void> {
  const gitMarkerPath = join(runtimeDir, ".git");
  if (!(await exists(gitMarkerPath))) {
    await writeFile(gitMarkerPath, "gitdir: .openwork-runtime/git\n", "utf8");
  }

  const gitignorePath = join(runtimeDir, ".gitignore");
  if (!(await exists(gitignorePath))) {
    await writeFile(gitignorePath, [".openwork-runtime/", ".tmp/", ""].join("\n"), "utf8");
  }
}

async function mirrorWorkspaceOpencodeSupportFiles(
  workspacePath: string,
  runtimeDir: string,
  runtimeProfile: RuntimeSessionProfile,
): Promise<void> {
  const workspaceOpencodeDir = join(workspacePath, ".opencode");
  if (!(await exists(workspaceOpencodeDir))) return;

  const runtimeOpencodeDir = join(runtimeDir, ".opencode");
  await ensureDir(runtimeOpencodeDir);

  for (const relativeDir of RUNTIME_MIRRORED_OPENCODE_DIRS) {
    const sourceDir = join(workspaceOpencodeDir, relativeDir);
    if (!(await exists(sourceDir))) continue;
    const targetDir = join(runtimeOpencodeDir, relativeDir);
    await rm(targetDir, { recursive: true, force: true }).catch(() => undefined);
    if (relativeDir === "skills") {
      if (!runtimeProfile.skillAllowlist.length) {
        await cp(sourceDir, targetDir, { recursive: true, force: true });
        continue;
      }
      await ensureDir(targetDir);
      for (const skillName of runtimeProfile.skillAllowlist) {
        const sourceSkillDir = join(sourceDir, skillName);
        if (!(await exists(sourceSkillDir))) continue;
        await cp(sourceSkillDir, join(targetDir, skillName), { recursive: true, force: true });
      }
      continue;
    }
    if (relativeDir === "plugins") {
      const pluginEntries = await readdir(sourceDir);
      const allowedPluginEntries = pluginEntries.filter((entry) => pluginEntryAllowedInRuntime(entry, runtimeProfile));
      if (!allowedPluginEntries.length) continue;
      await ensureDir(targetDir);
      for (const entry of allowedPluginEntries) {
        await cp(join(sourceDir, entry), join(targetDir, entry), { recursive: true, force: true });
      }
      continue;
    }
    if (relativeDir === "runtime-support" && runtimeProfile.id !== "document-writer") {
      continue;
    }
    await cp(sourceDir, targetDir, { recursive: true, force: true });
  }
}

function sanitizeRuntimeScopeSegment(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function ensureSymlinkDir(targetPath: string, linkPath: string): Promise<void> {
  await ensureDir(dirname(linkPath));
  await rm(linkPath, { recursive: true, force: true }).catch(() => undefined);
  await symlink(targetPath, linkPath, "dir");
}

function buildBidWorkbenchNodeInstructions(input: {
  privateRuntimeDir: string;
  sharedRoots: string[];
  nodeBriefPath: string;
}): string {
  return [
    "# Bid Workbench Node Contract",
    "",
    "This session belongs to a single bid-workbench node.",
    "",
    `- Treat \`${input.privateRuntimeDir}\` as the default writable scratch and intermediate workspace for this node.`,
    `- Read shared project assets only from: ${input.sharedRoots.map((value) => `\`${value}\``).join(", ")}.`,
    `- Read the node brief from \`${input.nodeBriefPath}\` before broad document work.`,
    "- You may revise this node's own output files under `bid-workbench/output/`.",
    "- Do not modify other nodes' outputs, other nodes' runtime directories, or the project structure source file.",
    "- Do not write directly into the final master document from this node session.",
    "",
  ].join("\n");
}

async function prepareBidWorkbenchNodeRuntime(input: {
  workspacePath: string;
  runtimeDir: string;
  runtimeId: string;
  bidNodeId: string;
}): Promise<void> {
  const sharedDocumentsRoot = join(input.workspacePath, "documents", "bid-workbench");
  const runtimeBidWorkbenchRoot = join(input.runtimeDir, "bid-workbench");
  const categories = ["tender", "reference", "templates", "output"] as const;
  await ensureDir(runtimeBidWorkbenchRoot);
  await ensureDir(join(input.workspacePath, ".openwork", "bid-workbench", "node-briefs"));
  for (const category of categories) {
    const sourceDir = join(sharedDocumentsRoot, category);
    await ensureDir(sourceDir);
    await ensureSymlinkDir(sourceDir, join(runtimeBidWorkbenchRoot, category));
  }

  const privateRuntimeDir = join(runtimeBidWorkbenchRoot, "runtime", input.bidNodeId, input.runtimeId);
  await ensureDir(privateRuntimeDir);

  const sharedStateRoot = join(input.workspacePath, ".openwork", "bid-workbench");
  await ensureDir(sharedStateRoot);
  await ensureDir(join(input.runtimeDir, ".openwork"));
  await ensureSymlinkDir(sharedStateRoot, join(input.runtimeDir, ".openwork", "bid-workbench"));

  const instructionPath = join(input.runtimeDir, BID_WORKBENCH_NODE_INSTRUCTIONS_RELATIVE_PATH);
  await ensureDir(dirname(instructionPath));
  await writeFile(
    instructionPath,
    buildBidWorkbenchNodeInstructions({
      privateRuntimeDir: relative(input.runtimeDir, privateRuntimeDir) || "bid-workbench/runtime",
      sharedRoots: categories.map((category) => `bid-workbench/${category}`),
      nodeBriefPath: `.openwork/bid-workbench/node-briefs/${input.bidNodeId}.md`,
    }),
    "utf8",
  );

  const runtimeConfigPath = opencodeConfigPath(input.runtimeDir);
  const { data: runtimeConfig } = await readJsoncFile<Record<string, unknown>>(runtimeConfigPath, {});
  const existingInstructions = normalizeInstructionEntries(runtimeConfig.instructions);
  runtimeConfig.instructions = [
    ...existingInstructions.filter((entry) => entry !== BID_WORKBENCH_NODE_INSTRUCTIONS_RELATIVE_PATH),
    BID_WORKBENCH_NODE_INSTRUCTIONS_RELATIVE_PATH,
  ];
  await writeJsoncFile(runtimeConfigPath, runtimeConfig);
}

function pluginEntryAllowedInRuntime(entryName: string, runtimeProfile: RuntimeSessionProfile): boolean {
  const normalizedEntryName = entryName.trim().toLowerCase();
  if (!normalizedEntryName) return false;
  if (normalizedEntryName.startsWith("document-writer-")) return runtimeProfile.id === "document-writer";
  if (normalizedEntryName.startsWith("common-work-") || normalizedEntryName.startsWith("document-agent-")) {
    return runtimeProfile.id !== "document-writer";
  }
  return true;
}

function normalizeInstructionEntries(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
}

function buildRuntimeConfigBase(
  workspaceConfigInput: Record<string, unknown>,
  runtimeConfigInput: Record<string, unknown>,
  options?: {
    runtimeProfile?: RuntimeSessionProfile;
    workspacePath?: string;
    runtimeDir?: string;
  },
): Record<string, unknown> {
  const workspaceConfig = workspaceConfigInput && typeof workspaceConfigInput === "object" ? workspaceConfigInput : {};
  const runtimeConfig = runtimeConfigInput && typeof runtimeConfigInput === "object" ? runtimeConfigInput : {};
  const baseConfig: Record<string, unknown> = { ...workspaceConfig, ...runtimeConfig };
  const runtimeProfile = options?.runtimeProfile ?? buildDefaultRuntimeSessionProfile();

  const workspaceMcp = workspaceConfig.mcp && typeof workspaceConfig.mcp === "object"
    ? workspaceConfig.mcp as Record<string, unknown>
    : {};
  const runtimeMcp = runtimeConfig.mcp && typeof runtimeConfig.mcp === "object"
    ? runtimeConfig.mcp as Record<string, unknown>
    : {};
  if (Object.keys(workspaceMcp).length || Object.keys(runtimeMcp).length) {
    baseConfig.mcp = sanitizeRuntimeMcpEntries(
      { ...workspaceMcp, ...runtimeMcp },
      {
        ...options,
        allowlist: runtimeProfile.mcpAllowlist,
      },
    );
  } else {
    delete baseConfig.mcp;
  }

  const instructions = [
    ...normalizeInstructionEntries(workspaceConfig.instructions),
    ...normalizeInstructionEntries(runtimeConfig.instructions),
  ].filter((entry, index, source) => source.indexOf(entry) === index);
  if (instructions.length) baseConfig.instructions = instructions;
  else delete baseConfig.instructions;

  return baseConfig;
}

function pathIsWithin(basePath: string, candidatePath: string): boolean {
  const base = resolve(basePath);
  const candidate = resolve(candidatePath);
  const rel = relative(base, candidate);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function extractFilesystemRoots(command: string[]): string[] {
  const serverIndex = command.findIndex((token) => token.includes("server-filesystem"));
  const rawRoots = (serverIndex >= 0 ? command.slice(serverIndex + 1) : command.slice(1))
    .map((token) => token.trim())
    .filter((token) => token && !token.startsWith("-"));
  return rawRoots;
}

function isSafeFilesystemRoot(
  root: string,
  options?: {
    workspacePath?: string;
    runtimeDir?: string;
  },
): boolean {
  const trimmed = root.trim();
  if (!trimmed || !isAbsolute(trimmed)) return true;
  const allowedBases = [options?.workspacePath, options?.runtimeDir]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!allowedBases.length) return false;
  return allowedBases.some((basePath) => pathIsWithin(basePath, trimmed));
}

function shouldDropHostedFilesystemMcp(
  name: string,
  entry: unknown,
  options?: {
    workspacePath?: string;
    runtimeDir?: string;
  },
): boolean {
  if (name !== "filesystem" || !entry || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.trim() : "local";
  if (type && type !== "local") return false;
  if (!Array.isArray(record.command)) return false;
  const command = record.command.filter((value): value is string => typeof value === "string");
  if (!command.length) return false;
  const roots = extractFilesystemRoots(command);
  if (!roots.length) return false;
  return roots.some((root) => !isSafeFilesystemRoot(root, options));
}

export function sanitizeRuntimeMcpEntries(
  mcpInput: Record<string, unknown>,
  options?: {
    allowlist?: readonly string[];
    workspacePath?: string;
    runtimeDir?: string;
  },
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const allowlist = options?.allowlist?.length ? new Set(options.allowlist) : null;
  for (const [name, entry] of Object.entries(mcpInput)) {
    if (shouldDropHostedFilesystemMcp(name, entry, options)) continue;
    if (allowlist && !allowlist.has(name)) continue;
    sanitized[name] = entry;
  }
  return sanitized;
}

export function sanitizeRuntimeConfigForSession(
  configInput: Record<string, unknown>,
  options?: {
    workspacePath?: string;
    runtimeDir?: string;
  },
): Record<string, unknown> {
  const config = configInput && typeof configInput === "object" ? { ...configInput } : {};
  const mcpInput = config.mcp && typeof config.mcp === "object"
    ? config.mcp as Record<string, unknown>
    : null;
  if (!mcpInput) return config;
  const sanitizedMcp = sanitizeRuntimeMcpEntries(mcpInput, {
    ...options,
  });
  if (Object.keys(sanitizedMcp).length) config.mcp = sanitizedMcp;
  else delete config.mcp;
  return config;
}

function buildRuntimeSessionInstructions(): string {
  return [
    "# Workspace Runtime Contract",
    "",
    "Treat the current workspace root as `<WORKSPACE>`.",
    "",
    "Minimal runtime contract:",
    `- Use \`<WORKSPACE>/${SESSION_TMP_ROOT_RELATIVE_PATH}\` as the default temp root for reopenable extraction, conversion, helper, and other transient artifacts.`,
    "- Keep persisted state, user-visible deliverables, and any artifact that file tools will reopen inside `<WORKSPACE>`.",
    "- Treat system temp paths such as `/tmp/*` and `/private/tmp/*` as shell-local only until you copy the needed artifact back into `<WORKSPACE>`.",
    "- Do not rely on workspace-external absolute paths or `external_directory` for normal document discovery, reads, writes, or delivery.",
    "",
  ].join("\n");
}

function buildHostedSystemTempBashDenyRules(): PermissionRuleset {
  const rules: PermissionRuleset = [];
  for (const prefix of HOSTED_SYSTEM_TMP_PREFIXES) {
    for (const extension of HOSTED_REOPENABLE_DOC_EXTENSIONS) {
      rules.push({ permission: "bash", pattern: `*-o ${prefix}*.${extension}*`, action: "deny" });
      rules.push({ permission: "bash", pattern: `*> ${prefix}*.${extension}*`, action: "deny" });
    }
  }
  return rules;
}

function buildRuntimeKnowledgeInstructions(attachedKnowledge: RuntimeKnowledgeInstructionRecord[]): string {
  const header = [
    "# Attached Knowledge Routing",
    "",
    "When attached knowledge is present, do not skip it for relevant recall tasks.",
    "",
    `Attached knowledge count: ${attachedKnowledge.length}`,
    "",
    "Rules:",
    "1. When one or more knowledge bases are attached and the request is factual, explanatory, comparative, or question-answering in nature, use `openwork_knowledge_search` at least once before external search or broad workspace discovery.",
    "2. For purely local file editing, format conversion, or directed rewriting against already-open local material, you do not need to force a knowledge query first.",
    "3. Use `openwork_knowledge_list_attached` only when you need to confirm the current attachment set, and rerun knowledge search if the active attachments changed earlier in the conversation.",
    "4. Do not use `memory_search_nodes` or `memory_read_graph` as a substitute for attached knowledge retrieval.",
    "5. If no knowledge bases are attached, or attached knowledge is insufficient, say that briefly and then continue with other appropriate tools.",
    "",
    "Currently attached knowledge bases:",
  ];

  if (!attachedKnowledge.length) {
    header.push("- (none attached yet; do not substitute session memory for knowledge retrieval)");
    return header.join("\n") + "\n";
  }

  for (const item of attachedKnowledge) {
    const owner = item.ownerDisplayName?.trim() ? ` · owner=${item.ownerDisplayName.trim()}` : "";
    const description = item.description?.trim() ? ` — ${item.description.trim()}` : "";
    header.push(`- ${item.title} (knowledge_id=${item.knowledgeId})${owner}${description}`);
  }
  return header.join("\n") + "\n";
}

function buildRuntimeDocumentStateInstructions(): string {
  return [
    "# Document State",
    "",
    "Use the existing `.worktree/**`, `requirements.csv`, and `reports/**` artifacts as the durable document-state surface.",
    "The `.worktree/**` files remain the source of truth even when a state-tool overlay is available.",
    "If the current state is missing or stale, update the owning files instead of inventing a parallel summary surface.",
    "If the state-tool overlay is unavailable, continue directly from the files.",
    "",
  ].join("\n");
}

export async function writeRuntimeSessionCarrierConfig(input: {
  workspacePath: string;
  runtimeDir: string;
  profile?: RuntimeSessionProfile;
}): Promise<string> {
  const workspaceConfigPath = opencodeConfigPath(input.workspacePath);
  const runtimeConfigPath = opencodeConfigPath(input.runtimeDir);
  const { data: workspaceConfig } = await readJsoncFile<Record<string, unknown>>(workspaceConfigPath, {});
  const { data: runtimeConfig } = await readJsoncFile<Record<string, unknown>>(runtimeConfigPath, {});
  const runtimeProfile = input.profile ?? await readRuntimeSessionProfile(input.runtimeDir);
  const baseConfig = buildRuntimeConfigBase(workspaceConfig, runtimeConfig, {
    workspacePath: input.workspacePath,
    runtimeDir: input.runtimeDir,
    runtimeProfile,
  });
  const existingInstructions = normalizeInstructionEntries(baseConfig.instructions);
  baseConfig.instructions = [
    ...existingInstructions.filter((entry) => entry !== RUNTIME_INSTRUCTIONS_RELATIVE_PATH),
    RUNTIME_INSTRUCTIONS_RELATIVE_PATH,
  ];

  await ensureDir(join(input.runtimeDir, SESSION_TMP_ROOT_RELATIVE_PATH));

  const instructionPath = join(input.runtimeDir, RUNTIME_INSTRUCTIONS_RELATIVE_PATH);
  await ensureDir(dirname(instructionPath));
  await writeFile(instructionPath, buildRuntimeSessionInstructions(), "utf8");
  await writeRuntimeSessionProfile(input.runtimeDir, runtimeProfile);
  await writeJsoncFile(runtimeConfigPath, baseConfig);
  return runtimeConfigPath;
}

export async function writeRuntimeKnowledgeCarrierConfig(input: {
  workspacePath: string;
  runtimeDir: string;
  mcpUrl: string;
  runtimeToken: string;
  attachedKnowledge?: RuntimeKnowledgeInstructionRecord[];
}): Promise<string> {
  const workspaceConfigPath = opencodeConfigPath(input.workspacePath);
  const runtimeConfigPath = opencodeConfigPath(input.runtimeDir);
  const { data: workspaceConfig } = await readJsoncFile<Record<string, unknown>>(workspaceConfigPath, {});
  const { data: runtimeConfig } = await readJsoncFile<Record<string, unknown>>(runtimeConfigPath, {});
  const runtimeProfile = await readRuntimeSessionProfile(input.runtimeDir);
  const baseConfig = buildRuntimeConfigBase(workspaceConfig, runtimeConfig, {
    workspacePath: input.workspacePath,
    runtimeDir: input.runtimeDir,
    runtimeProfile,
  });
  const existingMcp = baseConfig.mcp && typeof baseConfig.mcp === "object"
    ? { ...(baseConfig.mcp as Record<string, unknown>) }
    : {};
  delete existingMcp.ragflow;
  existingMcp["openwork-knowledge"] = {
    type: "remote",
    url: input.mcpUrl,
    headers: {
      Authorization: `Bearer ${input.runtimeToken}`,
    },
  };
  baseConfig.mcp = existingMcp;
  const existingInstructions = normalizeInstructionEntries(baseConfig.instructions);
  baseConfig.instructions = [
    ...existingInstructions.filter((entry) => entry !== KNOWLEDGE_INSTRUCTIONS_RELATIVE_PATH),
    KNOWLEDGE_INSTRUCTIONS_RELATIVE_PATH,
  ];
  const instructionPath = join(input.runtimeDir, KNOWLEDGE_INSTRUCTIONS_RELATIVE_PATH);
  await ensureDir(dirname(instructionPath));
  await writeFile(
    instructionPath,
    buildRuntimeKnowledgeInstructions(input.attachedKnowledge ?? []),
    "utf8",
  );
  await writeJsoncFile(runtimeConfigPath, baseConfig);
  return runtimeConfigPath;
}

export async function writeRuntimeDocumentStateCarrierConfig(input: {
  workspacePath: string;
  runtimeDir: string;
  mcpUrl: string;
  runtimeToken: string;
}): Promise<string> {
  const workspaceConfigPath = opencodeConfigPath(input.workspacePath);
  const runtimeConfigPath = opencodeConfigPath(input.runtimeDir);
  const { data: workspaceConfig } = await readJsoncFile<Record<string, unknown>>(workspaceConfigPath, {});
  const { data: runtimeConfig } = await readJsoncFile<Record<string, unknown>>(runtimeConfigPath, {});
  const runtimeProfile = await readRuntimeSessionProfile(input.runtimeDir);
  const baseConfig = buildRuntimeConfigBase(workspaceConfig, runtimeConfig, {
    workspacePath: input.workspacePath,
    runtimeDir: input.runtimeDir,
    runtimeProfile,
  });
  const existingMcp = baseConfig.mcp && typeof baseConfig.mcp === "object"
    ? { ...(baseConfig.mcp as Record<string, unknown>) }
    : {};
  existingMcp.doc_state = {
    type: "remote",
    url: input.mcpUrl,
    headers: {
      Authorization: `Bearer ${input.runtimeToken}`,
    },
  };
  baseConfig.mcp = existingMcp;
  const existingInstructions = normalizeInstructionEntries(baseConfig.instructions);
  baseConfig.instructions = [
    ...existingInstructions.filter((entry) => entry !== DOC_STATE_INSTRUCTIONS_RELATIVE_PATH),
    DOC_STATE_INSTRUCTIONS_RELATIVE_PATH,
  ];
  const instructionPath = join(input.runtimeDir, DOC_STATE_INSTRUCTIONS_RELATIVE_PATH);
  await ensureDir(dirname(instructionPath));
  await writeFile(instructionPath, buildRuntimeDocumentStateInstructions(), "utf8");
  await writeJsoncFile(runtimeConfigPath, baseConfig);
  return runtimeConfigPath;
}

export function buildSessionPermissionRules(): PermissionRuleset {
  const globalSkillDir = join(homedir(), ".config", "opencode", "skills");
  const globalSkillPattern = `${globalSkillDir.replaceAll("\\", "/")}/*`;
  return [
    ...buildHostedSystemTempBashDenyRules(),
    { permission: "glob", pattern: "**/*", action: "deny" },
    { permission: "external_directory", pattern: globalSkillPattern, action: "allow" },
    { permission: "external_directory", pattern: "*", action: "deny" },
  ];
}

export function sessionDirectoryBelongsToWorkspace(workspacePath: string, sessionDirectory: string | null | undefined): boolean {
  const sessionDir = (sessionDirectory ?? "").trim();
  if (!sessionDir) return false;
  const prefix = join(workspacePath, "documents", "sessions");
  return sessionDir === workspacePath || sessionDir === prefix || sessionDir.startsWith(`${prefix}/`);
}

export class SessionWorkspaceService {
  private cache = new Map<string, SessionWorkspaceStore>();

  private async ensureLoaded(workspaceId: string) {
    const key = workspaceId.trim();
    if (!key) {
      return { schemaVersion: 1, updatedAt: Date.now(), workspaces: {} } satisfies SessionWorkspaceStore;
    }
    const cached = this.cache.get(key);
    if (cached) return cached;
    const store = await readStore(resolveSessionWorkspacePath(key));
    this.cache.set(key, store);
    return store;
  }

  async setWorkspace(workspaceId: string, sessionId: string, entry: SessionWorkspaceEntry): Promise<void> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const store = await this.ensureLoaded(ws);
    store.workspaces[sid] = {
      runtimeId: entry.runtimeId,
      runtimeDir: entry.runtimeDir,
      createdAt: entry.createdAt,
      preferredView: normalizeOptionalString(entry.preferredView),
      preferredAgent: normalizeOptionalString(entry.preferredAgent),
      preferredAgentLock: normalizeOptionalString(entry.preferredAgentLock),
      runtimeProfileId: normalizeOptionalString(entry.runtimeProfileId),
      runtimeScopeKind: normalizeOptionalString(entry.runtimeScopeKind),
      runtimeScopeKey: normalizeOptionalString(entry.runtimeScopeKey),
      bidNodeId: normalizeOptionalString(entry.bidNodeId),
    };
    await writeStore(resolveSessionWorkspacePath(ws), store.workspaces);
  }

  async getWorkspace(workspaceId: string, sessionId: string): Promise<SessionWorkspaceEntry | null> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return null;
    const store = await this.ensureLoaded(ws);
    return store.workspaces[sid] ?? null;
  }

  async listWorkspaces(workspaceId: string): Promise<Record<string, SessionWorkspaceEntry>> {
    const ws = workspaceId.trim();
    if (!ws) return {};
    const store = await this.ensureLoaded(ws);
    return { ...store.workspaces };
  }

  async removeWorkspace(workspaceId: string, sessionId: string): Promise<void> {
    const ws = workspaceId.trim();
    const sid = sessionId.trim();
    if (!ws || !sid) return;
    const store = await this.ensureLoaded(ws);
    if (!store.workspaces[sid]) return;
    delete store.workspaces[sid];
    await writeStore(resolveSessionWorkspacePath(ws), store.workspaces);
  }

  async resolveDocumentsDir(workspaceId: string, workspacePath: string, sessionId: string | null | undefined): Promise<string> {
    const sid = (sessionId ?? "").trim();
    if (!sid) return join(workspacePath, "documents");
    const entry = await this.getWorkspace(workspaceId, sid);
    return entry?.runtimeDir ?? join(workspacePath, "documents", "sessions", sid);
  }
}
