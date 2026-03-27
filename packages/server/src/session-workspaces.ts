import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { cp, readFile, rename, rm, writeFile } from "node:fs/promises";

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

export type IsolatedOpencodeRuntime = {
  mode: "isolated_process";
  rootDir: string;
  configDir: string;
  configHomeDir: string;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
  tempDir: string;
  bindHost: string;
};

export type SessionWorkspaceEntry = {
  runtimeId: string;
  runtimeDir: string;
  createdAt: number;
  opencodeRuntime?: IsolatedOpencodeRuntime;
  preferredView?: string | null;
  preferredAgent?: string | null;
  preferredAgentLock?: string | null;
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
};

type RuntimeSessionProfileId = "default" | "document-agent" | "document-writer";

type RuntimeSessionProfile = {
  id: RuntimeSessionProfileId;
  skillAllowlist: string[];
  mcpAllowlist: string[];
};

const RUNTIME_INSTRUCTIONS_RELATIVE_PATH = ".opencode/openwork-runtime.md";
const RUNTIME_PROFILE_RELATIVE_PATH = ".opencode/openwork-runtime-profile.json";
const KNOWLEDGE_INSTRUCTIONS_RELATIVE_PATH = ".opencode/openwork-knowledge.md";
const DOC_STATE_INSTRUCTIONS_RELATIVE_PATH = ".opencode/doc-state.md";
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
  "plugins",
  "prompts",
  "references",
  "skills",
] as const;
const DOCUMENT_SESSION_SKILL_ALLOWLIST = [
  "doc-coauthoring",
  "doc-normalize",
  "docx",
  "pdf",
  "pptx",
  "xlsx",
] as const;
const DOCUMENT_WRITER_SESSION_SKILL_ALLOWLIST = [...DOCUMENT_SESSION_SKILL_ALLOWLIST, "openwork-core"] as const;
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
  const preferredView = normalizeOptionalString(hints?.preferredView)?.toLowerCase() ?? "";
  const preferredAgent = normalizeOptionalString(hints?.preferredAgent)?.toLowerCase() ?? "";
  const preferredAgentLock = normalizeOptionalString(hints?.preferredAgentLock)?.toLowerCase() ?? "";

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
  if (id !== "document-agent" && id !== "document-writer") {
    return buildDefaultRuntimeSessionProfile();
  }
  const fallback = resolveRuntimeSessionProfile({ preferredView: id });
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
      const opencodeRuntimeRecord =
        record.opencodeRuntime && typeof record.opencodeRuntime === "object"
          ? record.opencodeRuntime as Partial<IsolatedOpencodeRuntime>
          : null;
      const opencodeRuntime =
        opencodeRuntimeRecord?.mode === "isolated_process" &&
          typeof opencodeRuntimeRecord.rootDir === "string" &&
          typeof opencodeRuntimeRecord.configDir === "string" &&
          typeof opencodeRuntimeRecord.dataDir === "string" &&
          typeof opencodeRuntimeRecord.stateDir === "string" &&
          typeof opencodeRuntimeRecord.cacheDir === "string"
          ? {
              mode: "isolated_process" as const,
              rootDir: opencodeRuntimeRecord.rootDir.trim(),
              configDir: opencodeRuntimeRecord.configDir.trim(),
              configHomeDir:
                typeof (opencodeRuntimeRecord as Partial<IsolatedOpencodeRuntime>).configHomeDir === "string" &&
                  (opencodeRuntimeRecord as Partial<IsolatedOpencodeRuntime>).configHomeDir?.trim()
                  ? (opencodeRuntimeRecord as Partial<IsolatedOpencodeRuntime>).configHomeDir!.trim()
                  : join(opencodeRuntimeRecord.rootDir.trim(), "config-home"),
              dataDir: opencodeRuntimeRecord.dataDir.trim(),
              stateDir: opencodeRuntimeRecord.stateDir.trim(),
              cacheDir: opencodeRuntimeRecord.cacheDir.trim(),
              tempDir:
                typeof (opencodeRuntimeRecord as Partial<IsolatedOpencodeRuntime>).tempDir === "string" &&
                  (opencodeRuntimeRecord as Partial<IsolatedOpencodeRuntime>).tempDir?.trim()
                  ? (opencodeRuntimeRecord as Partial<IsolatedOpencodeRuntime>).tempDir!.trim()
                  : join(runtimeDir, SESSION_TMP_ROOT_RELATIVE_PATH),
              bindHost: typeof opencodeRuntimeRecord.bindHost === "string" && opencodeRuntimeRecord.bindHost.trim()
                ? opencodeRuntimeRecord.bindHost.trim()
                : "127.0.0.1",
            }
          : undefined;
      if (!sessionId.trim() || !runtimeId || !runtimeDir) continue;
      workspaces[sessionId] = {
        runtimeId,
        runtimeDir,
        createdAt,
        opencodeRuntime,
        preferredView,
        preferredAgent,
        preferredAgentLock,
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
  return { runtimeId, runtimeDir };
}

async function writeRuntimeProjectBoundary(runtimeDir: string): Promise<void> {
  const gitMarkerPath = join(runtimeDir, ".git");
  if (await exists(gitMarkerPath)) return;
  await writeFile(gitMarkerPath, "gitdir: .openwork-runtime/git\n", "utf8");
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
    await cp(sourceDir, targetDir, { recursive: true, force: true });
  }
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
    "# OpenWork Session Runtime",
    "",
    "This session runs inside a dedicated OpenWork workspace. Treat the current workspace root as `<WORKSPACE>`.",
    "",
    "Runtime temp root:",
    `- Use \`<WORKSPACE>/${SESSION_TMP_ROOT_RELATIVE_PATH}\` as the default location for transient extraction, conversion, generated helper files, and other temporary artifacts.`,
    "",
    "Rules:",
    `1. Prefer \`<WORKSPACE>/${SESSION_TMP_ROOT_RELATIVE_PATH}\`, \`<WORKSPACE>/.tmp/\`, or another workspace-local temp directory over system \`/tmp\` paths.`,
    "2. Any artifact that will later be reopened by file tools (`read`, `list`, `glob`, `edit`, `filesystem_*`) must stay inside `<WORKSPACE>`.",
    `3. If a tool naturally returns an external temp path, first copy or re-emit the needed artifact into \`<WORKSPACE>/${SESSION_TMP_ROOT_RELATIVE_PATH}/\` (or another workspace-local path) before using any file tool on it.`,
    "4. Treat `/tmp/*` and `/private/tmp/*` as shell-only transient paths until you copy them back into `<WORKSPACE>`.",
    "5. Hosted runtime permissions may deny shell commands that explicitly write reopenable document/text artifacts to system temp paths like `/tmp/*.md` or `/private/tmp/*.docx`.",
    "6. Final deliverables and persisted state must stay inside `<WORKSPACE>`.",
    "7. Do not assume hosted sessions can rely on external directories remaining readable.",
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
    "# OpenWork Knowledge Routing",
    "",
    "This session can use OpenWork-managed knowledge tools:",
    "- `openwork_knowledge_list_attached`",
    "- `openwork_knowledge_search`",
    "",
    `Attached knowledge count: ${attachedKnowledge.length}`,
    "",
    "Rules:",
    "1. Attached knowledge bases are the primary recall source for factual questions about project, bid, company, product, qualification, requirement, or document content.",
    "2. If one or more knowledge bases are attached, call `openwork_knowledge_search` before using any other search or read tool for factual recall.",
    "3. Treat the current attachment set as authoritative for this turn. If attachments changed earlier in the conversation, do not trust prior knowledge-derived answers until you search the current attached set again.",
    "4. Use `openwork_knowledge_list_attached` only if you need to confirm which knowledge bases are attached.",
    "5. You may call `openwork_knowledge_search` multiple times to narrow or refine recall.",
    "6. Never use `memory_search_nodes` or `memory_read_graph` to search attached knowledge bases. Those tools are only for session memory and graph memory, not document knowledge recall.",
    "7. Do not conclude that information is missing just because the current session workspace has no uploaded files. Attached knowledge bases can still contain the answer.",
    "8. If the knowledge results are relevant, use them first. If exact wording, numbers, tables, clauses, or citations matter, then read the original files afterwards.",
    "9. If no knowledge bases are attached, do not call `openwork_knowledge_search`. Say that clearly, do not reuse older knowledge-derived answers from earlier turns, and do not use `memory_search_nodes` or `memory_read_graph` as a substitute for knowledge retrieval.",
    "10. If attached knowledge search results are insufficient, say so briefly and then continue with other appropriate tools.",
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
    "# Document State Routing",
    "",
    "This session can use document-state tools from the `doc_state` MCP server.",
    "In the tool list they are normally prefixed with the server name:",
    "- `doc_state_state_get_brief`",
    "- `doc_state_state_list_sources`",
    "- `doc_state_state_get_doc`",
    "- `doc_state_state_get_facts`",
    "- `doc_state_state_get_conflicts`",
    "- `doc_state_state_get_plan`",
    "- `doc_state_state_get_coverage`",
    "",
    "Rules:",
    "1. For long document work, inspect state through these tools before reading raw source files.",
    "2. Treat `.worktree/**`, `.bid/facts.json`, `requirements.csv`, and `reports/**` as the canonical persisted state surface.",
    "3. Only fall back to raw source documents when the state layer is missing, stale, or insufficient for the current question.",
    "4. Prefer `doc_state_state_list_sources` before `doc_state_state_get_doc` when you need to see which source summaries already exist.",
    "5. Use `doc_state_state_get_facts`, `doc_state_state_get_conflicts`, `doc_state_state_get_plan`, and `doc_state_state_get_coverage` to recover task context after compaction or long runs.",
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
  return [
    ...buildHostedSystemTempBashDenyRules(),
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
      opencodeRuntime: entry.opencodeRuntime,
      preferredView: normalizeOptionalString(entry.preferredView),
      preferredAgent: normalizeOptionalString(entry.preferredAgent),
      preferredAgentLock: normalizeOptionalString(entry.preferredAgentLock),
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
