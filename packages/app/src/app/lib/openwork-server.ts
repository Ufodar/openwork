import type { Session } from "@opencode-ai/sdk/v2/client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { formatBytes, isTauriRuntime } from "../utils";
import type { ScheduledJob } from "./tauri";
import { resolveAbortLikeError } from "./request-abort";

export type OpenworkServerCapabilities = {
  skills: { read: boolean; write: boolean; source: "openwork" | "opencode" };
  hub?: {
    skills?: {
      read: boolean;
      install: boolean;
      repo?: { owner: string; name: string; ref: string };
    };
  };
  plugins: { read: boolean; write: boolean };
  mcp: { read: boolean; write: boolean };
  commands: { read: boolean; write: boolean };
  config: { read: boolean; write: boolean };
  sandbox?: { enabled: boolean; backend: "none" | "docker" | "container" };
  proxy?: { opencode: boolean; opencodeRouter: boolean };
  toolProviders?: {
    browser?: {
      enabled: boolean;
      placement: "in-sandbox" | "host-machine" | "client-machine" | "external";
      mode: "none" | "headless" | "interactive";
    };
    files?: {
      injection: boolean;
      outbox: boolean;
      inboxPath: string;
      outboxPath: string;
      maxBytes: number;
    };
  };
};

export type OpenworkServerStatus = "connected" | "disconnected" | "limited";

export type OpenworkServerDiagnostics = {
  ok: boolean;
  version: string;
  uptimeMs: number;
  readOnly: boolean;
  approval: { mode: "manual" | "auto"; timeoutMs: number };
  corsOrigins: string[];
  workspaceCount: number;
  activeWorkspaceId: string | null;
  workspace: OpenworkWorkspaceInfo | null;
  authorizedRoots: string[];
  server: { host: string; port: number; configPath?: string | null };
  tokenSource: { client: string; host: string };
};

export type OpenworkServerSettings = {
  urlOverride?: string;
  portOverride?: number;
  token?: string;
};

export type OpenworkAuthUser = {
  id: string;
  username: string;
  createdAt: number;
  lastLoginAt?: number | null;
};

export type OpenworkAuthResponse = {
  ok: boolean;
  token: string;
  user: OpenworkAuthUser;
};

export type OpenworkAdminWarning = {
  workspaceId: string;
  workspaceName: string;
  message: string;
};

export type OpenworkAdminUser = {
  id: string;
  username: string;
  createdAt: number;
  lastLoginAt: number | null;
  isAdmin: boolean;
  sessionCount: number;
};

export type OpenworkAdminUsersResponse = {
  items: OpenworkAdminUser[];
  warnings: OpenworkAdminWarning[];
};

export type OpenworkAdminSession = {
  id: string;
  title: string;
  slug: string | null;
  directory: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  workspaceId: string;
  workspaceName: string;
  workspaceType: "local" | "remote";
};

export type OpenworkAdminUserSessionsResponse = {
  user: OpenworkAdminUser;
  items: OpenworkAdminSession[];
  warnings: OpenworkAdminWarning[];
};

export type OpenworkWorkspaceInfo = {
  id: string;
  name: string;
  path: string;
  workspaceType: "local" | "remote";
  baseUrl?: string;
  directory?: string;
  opencode?: {
    baseUrl?: string;
    directory?: string;
    username?: string;
    password?: string;
  };
};

export type OpenworkWorkspaceList = {
  items: OpenworkWorkspaceInfo[];
  activeId?: string | null;
};

export type OpenworkDocumentItem = {
  name: string;
  updatedAt: number;
  size: number;
  type: string;
  originalName?: string;
  title?: string;
};

export type OpenworkDocumentListResponse = {
  items: OpenworkDocumentItem[];
  dirs: string[];
};

export type OpenworkKnowledgeScope = "mine" | "others";

export type OpenworkKnowledgeItem = {
  knowledgeId: string;
  ragflowDatasetId: string;
  ownerUserId: string;
  ownerDisplayName: string;
  title: string;
  description: string | null;
  source: string;
  visibility: string;
  ingestionPreset: string | null;
  chunkMethod: string | null;
  parserConfig: Record<string, unknown>;
  embeddingModel: string | null;
  status: string;
  documentCount: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
};

export type OpenworkKnowledgeListResponse = {
  scope: OpenworkKnowledgeScope;
  items: OpenworkKnowledgeItem[];
};

export type OpenworkKnowledgeCreateInput = {
  title: string;
  description?: string | null;
  chunkMethod?: string | null;
  parserConfig?: Record<string, unknown> | null;
};

export type OpenworkKnowledgeCreateResponse = {
  ok: boolean;
  item: OpenworkKnowledgeItem;
};

export type OpenworkKnowledgeUploadResponse = {
  ok: boolean;
  knowledgeId: string;
  uploadedCount: number;
  documentIds: string[];
  item: OpenworkKnowledgeItem;
};

export type OpenworkKnowledgeDocumentItem = {
  documentId: string | null;
  datasetId: string | null;
  name: string;
  size: number | null;
  chunkCount: number;
  chunkMethod: string | null;
  parserConfig: Record<string, unknown>;
  run: string | null;
  type: string | null;
};

export type OpenworkKnowledgeDocumentsResponse = {
  knowledgeId: string;
  item: OpenworkKnowledgeItem;
  documents: OpenworkKnowledgeDocumentItem[];
};

export type OpenworkKnowledgeDocumentDeleteResponse = {
  ok: boolean;
  knowledgeId: string;
  documentId: string;
  item: OpenworkKnowledgeItem;
};

export type OpenworkKnowledgeDeleteResponse = {
  ok: boolean;
  deleted: boolean;
  knowledgeId: string;
};

export type OpenworkSessionKnowledgeResponse = {
  sessionId: string;
  runtimeId: string;
  knowledgeIds: string[];
  items: OpenworkKnowledgeItem[];
};

export type OpenworkKnowledgeSearchItem = {
  id: string;
  content: string;
  similarity: number | null;
  vectorSimilarity: number | null;
  termSimilarity: number | null;
  datasetId: string | null;
  documentId: string | null;
  documentName: string | null;
  positions: unknown[];
  imageId: string | null;
  knowledgeId: string | null;
  knowledgeTitle: string | null;
  ownerUserId: string | null;
  ownerDisplayName: string | null;
};

export type OpenworkKnowledgeSearchResponse = {
  sessionId: string;
  runtimeId: string;
  question: string;
  knowledgeIds: string[];
  total: number;
  page: number;
  pageSize: number;
  items: OpenworkKnowledgeSearchItem[];
};

export type OpenworkPluginItem = {
  spec: string;
  source: "config" | "dir.project" | "dir.global";
  scope: "project" | "global";
  path?: string;
};

export type OpenworkSkillItem = {
  name: string;
  path: string;
  description: string;
  scope: "project" | "global";
  trigger?: string;
};

export type OpenworkSkillContent = {
  item: OpenworkSkillItem;
  content: string;
};

export type OpenworkHubSkillItem = {
  name: string;
  description: string;
  trigger?: string;
  source: {
    owner: string;
    repo: string;
    ref: string;
    path: string;
  };
};

export type OpenworkWorkspaceFileContent = {
  path: string;
  content: string;
  bytes: number;
  updatedAt: number;
};

export type OpenworkWorkspaceFileWriteResult = {
  ok: boolean;
  path: string;
  bytes: number;
  updatedAt: number;
};

export type OpenworkWorkspaceSessionCreateInput = {
  title?: string;
  openworkPreferredView?: "session" | "document-agent" | "document-writer";
  openworkPreferredAgent?: string | null;
  openworkPreferredAgentLock?: string | null;
  openworkRuntimeProfileId?: "document-agent" | "document-writer" | "bid-workbench-node" | null;
  openworkRuntimeScopeKind?: "bid-workbench-node" | null;
  openworkRuntimeScopeKey?: string | null;
  openworkBidNodeId?: string | null;
};

export type OpenworkCommandItem = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string | null;
  subtask?: boolean;
  scope: "workspace" | "global";
};

export type OpenworkMcpItem = {
  name: string;
  config: Record<string, unknown>;
  source: "config.project" | "config.global" | "config.remote";
  disabledByTools?: boolean;
};

export type OpenworkRagflowStatus = {
  configured: boolean;
  available: boolean;
  baseUrl: string | null;
  mcpUrl: string | null;
  reason: string | null;
};

export type OpenworkRagflowDataset = {
  id: string;
  name: string;
  description: string;
  documentCount: number | null;
  chunkCount: number | null;
  embeddingModel: string | null;
  permission: string | null;
};

export type OpenworkRagflowChunk = {
  id: string | null;
  content: string;
  datasetId: string | null;
  datasetName: string | null;
  documentId: string | null;
  documentName: string | null;
  similarity: number | null;
  vectorSimilarity: number | null;
  termSimilarity: number | null;
  positions: number[] | null;
  imageId: string | null;
};

export type OpenworkRagflowRetrieveResult = {
  chunks: OpenworkRagflowChunk[];
  total: number;
  page: number;
  pageSize: number;
  question: string;
  datasetIds: string[];
};

export type OpenworkOpenCodeRouterTelegramResult = {
  ok: boolean;
  persisted?: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
  telegram?: {
    configured: boolean;
    enabled: boolean;
    applied?: boolean;
    starting?: boolean;
    error?: string;
  };
};

export type OpenworkOpenCodeRouterSlackResult = {
  ok: boolean;
  persisted?: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
  slack?: {
    configured: boolean;
    enabled: boolean;
    applied?: boolean;
    starting?: boolean;
    error?: string;
  };
};

export type OpenworkOpenCodeRouterTelegramBotInfo = {
  id: number;
  username?: string;
  name?: string;
};

export type OpenworkOpenCodeRouterTelegramInfo = {
  ok: boolean;
  configured: boolean;
  enabled: boolean;
  bot: OpenworkOpenCodeRouterTelegramBotInfo | null;
};

export type OpenworkOpenCodeRouterTelegramEnabledResult = {
  ok: boolean;
  persisted?: boolean;
  enabled: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
};

export type OpenworkOpenCodeRouterHealthSnapshot = {
  ok: boolean;
  opencode: {
    url: string;
    healthy: boolean;
    version?: string;
  };
  channels: {
    telegram: boolean;
    whatsapp: boolean;
    slack: boolean;
  };
  config: {
    groupsEnabled: boolean;
  };
  activity?: {
    dayStart: number;
    inboundToday: number;
    outboundToday: number;
    lastInboundAt?: number;
    lastOutboundAt?: number;
    lastMessageAt?: number;
  };
  agent?: {
    scope: "workspace";
    path: string;
    loaded: boolean;
    selected?: string;
  };
};

export type OpenworkOpenCodeRouterBindingItem = {
  channel: string;
  identityId: string;
  peerId: string;
  directory: string;
  updatedAt?: number;
};

export type OpenworkOpenCodeRouterBindingsResult = {
  ok: boolean;
  items: OpenworkOpenCodeRouterBindingItem[];
};

export type OpenworkOpenCodeRouterBindingUpdateResult = {
  ok: boolean;
};

export type OpenworkOpenCodeRouterSendResult = {
  ok: boolean;
  channel: string;
  identityId?: string;
  directory: string;
  peerId?: string;
  attempted: number;
  sent: number;
  failures?: Array<{ identityId: string; peerId: string; error: string }>;
  reason?: string;
};

export type OpenworkOpenCodeRouterIdentityItem = {
  id: string;
  enabled: boolean;
  running: boolean;
  access?: "public" | "private";
  pairingRequired?: boolean;
};

export type OpenworkOpenCodeRouterTelegramIdentitiesResult = {
  ok: boolean;
  items: OpenworkOpenCodeRouterIdentityItem[];
};

export type OpenworkOpenCodeRouterSlackIdentitiesResult = {
  ok: boolean;
  items: OpenworkOpenCodeRouterIdentityItem[];
};

export type OpenworkOpenCodeRouterTelegramIdentityUpsertResult = {
  ok: boolean;
  persisted?: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
  telegram?: {
    id: string;
    enabled: boolean;
    access?: "public" | "private";
    pairingRequired?: boolean;
    pairingCode?: string;
    applied?: boolean;
    starting?: boolean;
    error?: string;
    bot?: OpenworkOpenCodeRouterTelegramBotInfo | null;
  };
};

export type OpenworkOpenCodeRouterSlackIdentityUpsertResult = {
  ok: boolean;
  persisted?: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
  slack?: {
    id: string;
    enabled: boolean;
    applied?: boolean;
    starting?: boolean;
    error?: string;
  };
};

export type OpenworkOpenCodeRouterTelegramIdentityDeleteResult = {
  ok: boolean;
  persisted?: boolean;
  deleted?: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
  telegram?: {
    id: string;
    deleted: boolean;
  };
};

export type OpenworkOpenCodeRouterSlackIdentityDeleteResult = {
  ok: boolean;
  persisted?: boolean;
  deleted?: boolean;
  applied?: boolean;
  applyError?: string;
  applyStatus?: number;
  slack?: {
    id: string;
    deleted: boolean;
  };
};

export type OpenworkWorkspaceExport = {
  workspaceId: string;
  exportedAt: number;
  opencode?: Record<string, unknown>;
  openwork?: Record<string, unknown>;
  skills?: Array<{ name: string; description?: string; content: string }>;
  commands?: Array<{ name: string; description?: string; template?: string }>;
};

export type OpenworkArtifactItem = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  createdAt?: number;
  updatedAt?: number;
  mime?: string;
};

export type OpenworkArtifactList = {
  items: OpenworkArtifactItem[];
};

export type OpenworkInboxItem = {
  id: string;
  name?: string;
  path?: string;
  size?: number;
  updatedAt?: number;
};

export type OpenworkInboxList = {
  items: OpenworkInboxItem[];
};

export type OpenworkInboxUploadResult = {
  ok: boolean;
  path: string;
  bytes: number;
};

export type OpenworkBidWorkbenchSourceType =
  | "tender"
  | "reference"
  | "output"
  | "templates";

export type OpenworkBidWorkbenchStructureSourceKind =
  | "template"
  | "tender"
  | "manual-outline"
  | "derived-outline";

export type OpenworkBidWorkbenchWorkflowStage =
  | "outline"
  | "mapping"
  | "drafting"
  | "merge";

export type OpenworkBidWorkbenchCompositionMode =
  | "strict-reference"
  | "reference-guided"
  | "free-generation";

export type OpenworkBidWorkbenchOutput = {
  path: string;
  kind: "draft" | "candidate" | "final";
  createdBySessionId: string | null;
  createdAt: number;
  updatedAt: number;
};

export type OpenworkBidWorkbenchSourceRangeKind =
  | "page-range"
  | "section-ref"
  | "anchor"
  | "note";

export type OpenworkBidWorkbenchSourceRange = {
  id: string;
  sourcePath: string;
  rangeKind: OpenworkBidWorkbenchSourceRangeKind;
  rangeValue: string;
  note: string | null;
  createdAt: number;
  updatedAt: number;
};

export type OpenworkBidWorkbenchMarkKind =
  | "note"
  | "risk"
  | "todo"
  | "decision";

export type OpenworkBidWorkbenchNode = {
  id: string;
  title: string;
  level: number;
  parentId: string | null;
  children: string[];
  isLeaf: boolean;
  sessionId: string | null;
  activeSessionId: string | null;
  lastSessionId: string | null;
  runtimeScopeKey: string | null;
  lockedBy: string | null;
  lockedAt: number | null;
  recentPromptAuthor: string | null;
  recentPromptAt: number | null;
  participants: string[];
  compositionMode: OpenworkBidWorkbenchCompositionMode;
  assignee: string | null;
  referencePaths: string[];
  sourceRanges: OpenworkBidWorkbenchSourceRange[];
  outputPaths: string[];
  outputs: OpenworkBidWorkbenchOutput[];
  primaryOutputPath: string | null;
  lastEditedOutputPath: string | null;
  templatePath: string | null;
  mergedIntoMaster: boolean;
  mergeRequested: boolean;
  mergeApplied: boolean;
  mergeFailed: boolean;
  mergedOutputPath: string | null;
  refreshConflictState: "none" | "needs-review" | "orphaned";
  sourcePath: string;
  sourceLocator: string;
  orderIndex: number;
};

export type OpenworkBidWorkbenchMark = {
  id: string;
  nodeId: string;
  author: string;
  kind: OpenworkBidWorkbenchMarkKind;
  text: string;
  createdAt: number;
};

export type OpenworkBidWorkbenchProject = {
  outlineSourcePath: string | null;
  outlineSourceType: OpenworkBidWorkbenchSourceType | null;
  structureSourceKind: OpenworkBidWorkbenchStructureSourceKind | null;
  rootOutputPath: string | null;
  workflowStage: OpenworkBidWorkbenchWorkflowStage;
  outlineRevision: number;
  updatedAt: number;
};

export type OpenworkBidWorkbenchConstraints = {
  formatRules: Record<string, unknown>;
  extractedFromPath: string | null;
  updatedAt: number;
};

export type OpenworkBidWorkbenchRefresh = {
  runId: string;
  sourcePath: string;
  sourceHash: string;
  status: string;
  summary: string;
  createdAt: number;
} | null;

export type OpenworkBidWorkbenchMergeJob = {
  id: string;
  sectionId: string;
  outputPath: string;
  rootOutputPath: string;
  status: "requested" | "applied" | "failed";
  errorSummary: string | null;
  createdAt: number;
  updatedAt: number;
};

export type OpenworkBidWorkbenchState = {
  schemaVersion: number;
  project: OpenworkBidWorkbenchProject;
  constraints: OpenworkBidWorkbenchConstraints;
  nodes: OpenworkBidWorkbenchNode[];
  marks: OpenworkBidWorkbenchMark[];
  refresh: OpenworkBidWorkbenchRefresh;
  mergeJobs: OpenworkBidWorkbenchMergeJob[];
};

export type OpenworkSoulHeartbeatEntry = {
  id: string;
  ts: string | null;
  workspace: string | null;
  summary: string;
  looseEnds: string[];
  nextAction: string | null;
};

export type OpenworkSoulStatus = {
  enabled: boolean;
  state: "off" | "healthy" | "stale" | "error";
  memoryEnabled: boolean;
  instructionsEnabled: boolean;
  heartbeatLogExists: boolean;
  heartbeatCommandExists: boolean;
  heartbeatJob: {
    name: string;
    slug: string;
    schedule: string;
    lastRunAt: string | null;
    lastRunStatus: string | null;
    lastRunError: string | null;
  } | null;
  heartbeatCount: number;
  lastHeartbeatAt: string | null;
  lastHeartbeatSummary: string | null;
  staleAfterMs: number | null;
  overdue: boolean;
  summary: string;
  memoryPath: string;
  heartbeatPath: string;
};
type RawJsonResponse<T> = {
  ok: boolean;
  status: number;
  json: T | null;
};

export type OpenworkActor = {
  type: "remote" | "host";
  clientId?: string;
  tokenHash?: string;
};

export type OpenworkAuditEntry = {
  id: string;
  workspaceId: string;
  actor: OpenworkActor;
  action: string;
  target: string;
  summary: string;
  timestamp: number;
};

export type OpenworkReloadTrigger = {
  type: "skill" | "plugin" | "config" | "mcp" | "agent" | "command";
  name?: string;
  action?: "added" | "removed" | "updated";
  path?: string;
};

export type OpenworkReloadEvent = {
  id: string;
  seq: number;
  workspaceId: string;
  reason: "plugins" | "skills" | "mcp" | "config" | "agents" | "commands";
  trigger?: OpenworkReloadTrigger;
  timestamp: number;
};

export const DEFAULT_OPENWORK_SERVER_PORT = 8787;

const STORAGE_URL_OVERRIDE = "openwork.server.urlOverride";
const STORAGE_PORT_OVERRIDE = "openwork.server.port";
const STORAGE_TOKEN = "openwork.server.token";

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}

export function normalizeOpenworkServerUrl(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) {
    if (typeof window === "undefined") return null;
    return `${window.location.origin}${trimmed}`.replace(/\/+$/, "");
  }
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withProtocol.replace(/\/+$/, "");
}

export function resolveBrowserOpenworkEnvUrl(input: {
  envUrl?: string | null;
  locationOrigin?: string | null;
  dev: boolean;
  tauri: boolean;
}) {
  const envUrl = normalizeOpenworkServerUrl(input.envUrl ?? "");
  if (!envUrl) return null;
  if (input.tauri || !input.dev) return envUrl;

  const origin = normalizeOpenworkServerUrl(input.locationOrigin ?? "");
  if (!origin) return envUrl;

  try {
    const parsed = new URL(envUrl);
    if (!isLoopbackHostname(parsed.hostname)) return envUrl;
  } catch {
    return envUrl;
  }

  return `${origin}/openwork`;
}

export function parseOpenworkWorkspaceIdFromUrl(input: string) {
  const normalized = normalizeOpenworkServerUrl(input) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const prev = segments[segments.length - 2] ?? "";
    if (prev !== "w" || !last) return null;
    return decodeURIComponent(last);
  } catch {
    const match = normalized.match(/\/w\/([^/?#]+)/);
    if (!match?.[1]) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }
}

export function buildOpenworkWorkspaceBaseUrl(hostUrl: string, workspaceId?: string | null) {
  const normalized = normalizeOpenworkServerUrl(hostUrl) ?? "";
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    const segments = url.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] ?? "";
    const prev = segments[segments.length - 2] ?? "";
    const alreadyMounted = prev === "w" && Boolean(last);
    if (alreadyMounted) {
      return url.toString().replace(/\/+$/, "");
    }

    const id = (workspaceId ?? "").trim();
    if (!id) return url.toString().replace(/\/+$/, "");

    const basePath = url.pathname.replace(/\/+$/, "");
    url.pathname = `${basePath}/w/${encodeURIComponent(id)}`;
    return url.toString().replace(/\/+$/, "");
  } catch {
    const id = (workspaceId ?? "").trim();
    if (!id) return normalized;
    return `${normalized.replace(/\/+$/, "")}/w/${encodeURIComponent(id)}`;
  }
}

export const DEFAULT_OPENWORK_CONNECT_APP_URL = "https://app.openwork.software";

const OPENWORK_INVITE_PARAM_URL = "ow_url";
const OPENWORK_INVITE_PARAM_TOKEN = "ow_token";
const OPENWORK_INVITE_PARAM_STARTUP = "ow_startup";

export type OpenworkConnectInvite = {
  url: string;
  token?: string;
  startup?: "server";
};

export function buildOpenworkConnectInviteUrl(input: {
  workspaceUrl: string;
  token?: string | null;
  appUrl?: string | null;
  startup?: "server";
}) {
  const workspaceUrl = normalizeOpenworkServerUrl(input.workspaceUrl ?? "") ?? "";
  if (!workspaceUrl) return "";

  const base = normalizeOpenworkServerUrl(input.appUrl ?? "") ?? DEFAULT_OPENWORK_CONNECT_APP_URL;

  try {
    const url = new URL(base);
    const search = new URLSearchParams(url.search);
    search.set(OPENWORK_INVITE_PARAM_URL, workspaceUrl);

    const token = input.token?.trim() ?? "";
    if (token) {
      search.set(OPENWORK_INVITE_PARAM_TOKEN, token);
    }

    const startup = input.startup ?? "server";
    search.set(OPENWORK_INVITE_PARAM_STARTUP, startup);

    url.search = search.toString();
    return url.toString();
  } catch {
    const search = new URLSearchParams();
    search.set(OPENWORK_INVITE_PARAM_URL, workspaceUrl);
    const token = input.token?.trim() ?? "";
    if (token) {
      search.set(OPENWORK_INVITE_PARAM_TOKEN, token);
    }
    search.set(OPENWORK_INVITE_PARAM_STARTUP, input.startup ?? "server");
    return `${DEFAULT_OPENWORK_CONNECT_APP_URL}?${search.toString()}`;
  }
}

export function readOpenworkConnectInviteFromSearch(input: string | URLSearchParams) {
  const search =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input;

  const rawUrl = search.get(OPENWORK_INVITE_PARAM_URL)?.trim() ?? "";
  const url = normalizeOpenworkServerUrl(rawUrl);
  if (!url) return null;

  const token = search.get(OPENWORK_INVITE_PARAM_TOKEN)?.trim() ?? "";
  const startupRaw = search.get(OPENWORK_INVITE_PARAM_STARTUP)?.trim() ?? "";
  const startup = startupRaw === "server" ? "server" : undefined;

  return {
    url,
    token: token || undefined,
    startup,
  } satisfies OpenworkConnectInvite;
}

export function stripOpenworkConnectInviteFromUrl(input: string) {
  try {
    const url = new URL(input);
    url.searchParams.delete(OPENWORK_INVITE_PARAM_URL);
    url.searchParams.delete(OPENWORK_INVITE_PARAM_TOKEN);
    url.searchParams.delete(OPENWORK_INVITE_PARAM_STARTUP);
    return url.toString();
  } catch {
    return input;
  }
}

export function readOpenworkServerSettings(): OpenworkServerSettings {
  if (typeof window === "undefined") return {};
  try {
    const urlOverride = normalizeOpenworkServerUrl(
      window.localStorage.getItem(STORAGE_URL_OVERRIDE) ?? "",
    );
    const portRaw = window.localStorage.getItem(STORAGE_PORT_OVERRIDE) ?? "";
    const portOverride = portRaw ? Number(portRaw) : undefined;
    const token = window.localStorage.getItem(STORAGE_TOKEN) ?? undefined;
    return {
      urlOverride: urlOverride ?? undefined,
      portOverride: Number.isNaN(portOverride) ? undefined : portOverride,
      token: token?.trim() || undefined,
    };
  } catch {
    return {};
  }
}

export function writeOpenworkServerSettings(next: OpenworkServerSettings): OpenworkServerSettings {
  if (typeof window === "undefined") return next;
  try {
    const urlOverride = normalizeOpenworkServerUrl(next.urlOverride ?? "");
    const portOverride = typeof next.portOverride === "number" ? next.portOverride : undefined;
    const token = next.token?.trim() || undefined;

    if (urlOverride) {
      window.localStorage.setItem(STORAGE_URL_OVERRIDE, urlOverride);
    } else {
      window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    }

    if (typeof portOverride === "number" && !Number.isNaN(portOverride)) {
      window.localStorage.setItem(STORAGE_PORT_OVERRIDE, String(portOverride));
    } else {
      window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    }

    if (token) {
      window.localStorage.setItem(STORAGE_TOKEN, token);
    } else {
      window.localStorage.removeItem(STORAGE_TOKEN);
    }

    return readOpenworkServerSettings();
  } catch {
    return next;
  }
}

export function hydrateOpenworkServerSettingsFromEnv() {
  if (typeof window === "undefined") return;

  const envUrl = typeof import.meta.env?.VITE_OPENWORK_URL === "string"
    ? import.meta.env.VITE_OPENWORK_URL.trim()
    : "";
  const envPort = typeof import.meta.env?.VITE_OPENWORK_PORT === "string"
    ? import.meta.env.VITE_OPENWORK_PORT.trim()
    : "";
  const envToken = typeof import.meta.env?.VITE_OPENWORK_TOKEN === "string"
    ? import.meta.env.VITE_OPENWORK_TOKEN.trim()
    : "";

  if (!envUrl && !envPort && !envToken) return;

  try {
    const current = readOpenworkServerSettings();
    const next: OpenworkServerSettings = { ...current };
    let changed = false;

    const currentUrlNormalized = normalizeOpenworkServerUrl(current.urlOverride ?? "") ?? "";
    const isDevMode = Boolean(import.meta.env?.DEV);
    const canHydrateEnvToken = isTauriRuntime();
    const resolvedEnvUrl = resolveBrowserOpenworkEnvUrl({
      envUrl,
      locationOrigin: window.location.origin,
      dev: isDevMode,
      tauri: canHydrateEnvToken,
    }) ?? "";
    const envUrlNormalized = normalizeOpenworkServerUrl(resolvedEnvUrl) ?? "";

    // In web dev mode (e.g. pod + vite), always trust env URL so stale browser
    // localStorage cannot keep the app pointed at an old worker endpoint.
    if (envUrl && (isDevMode || currentUrlNormalized !== envUrlNormalized)) {
      next.urlOverride = envUrlNormalized || undefined;
      changed = true;
    }

    if (envPort) {
      const parsed = Number(envPort);
      if (Number.isFinite(parsed) && parsed > 0 && current.portOverride !== parsed) {
        next.portOverride = parsed;
        changed = true;
      }
    }

    if (envToken) {
      // For web clients, require explicit login/token input in Config.
      // Keep env token hydration only for desktop-hosted flows.
      if (canHydrateEnvToken && (current.token?.trim() ?? "") !== envToken) {
        next.token = envToken;
        changed = true;
      }
    }

    if (changed) {
      writeOpenworkServerSettings(next);
    }
  } catch {
    // ignore
  }
}

export function clearOpenworkServerSettings() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_URL_OVERRIDE);
    window.localStorage.removeItem(STORAGE_PORT_OVERRIDE);
    window.localStorage.removeItem(STORAGE_TOKEN);
  } catch {
    // ignore
  }
}

export function deriveOpenworkServerUrl(
  opencodeBaseUrl: string,
  settings?: OpenworkServerSettings,
) {
  const override = settings?.urlOverride?.trim();
  if (override) {
    return normalizeOpenworkServerUrl(override);
  }

  const base = opencodeBaseUrl.trim();
  if (!base) return null;
  try {
    const url = new URL(base);
    const port = settings?.portOverride ?? DEFAULT_OPENWORK_SERVER_PORT;
    url.port = String(port);
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.origin;
  } catch {
    return null;
  }
}

export class OpenworkServerError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function buildHeaders(
  token?: string,
  hostToken?: string,
  extra?: Record<string, string>,
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-OpenWork-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

function buildAuthHeaders(token?: string, hostToken?: string, extra?: Record<string, string>) {
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (hostToken) {
    headers["X-OpenWork-Host-Token"] = hostToken;
  }
  if (extra) {
    Object.assign(headers, extra);
  }
  return headers;
}

// Use Tauri's fetch when running in the desktop app to avoid CORS issues
const resolveFetch = () => (isTauriRuntime() ? tauriFetch : globalThis.fetch);

const DEFAULT_OPENWORK_SERVER_TIMEOUT_MS = 10_000;

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(url, init);
  }

  const timeoutController = typeof AbortController !== "undefined" ? new AbortController() : null;
  const upstreamSignal = init.signal;
  const canComposeSignals = typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function";
  const signal =
    upstreamSignal && timeoutController && canComposeSignals
      ? AbortSignal.any([upstreamSignal, timeoutController.signal])
      : timeoutController?.signal ?? upstreamSignal;
  const initWithSignal = signal ? { ...init, signal } : init;
  let didTimeout = false;

  // Fallback for runtimes without AbortController support.
  if (!timeoutController) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Request timed out.")), timeoutMs);
    });
    try {
      return await Promise.race([fetchImpl(url, initWithSignal), timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  try {
    // Fallback linking when AbortSignal.any is unavailable.
    if (upstreamSignal && !canComposeSignals) {
      const relayAbort = () => {
        try {
          timeoutController.abort((upstreamSignal as { reason?: unknown }).reason);
        } catch {
          try {
            timeoutController.abort();
          } catch {
            // ignore
          }
        }
      };
      if (upstreamSignal.aborted) {
        relayAbort();
      } else {
        // Use once:true and do not remove in finally so long-lived streaming
        // requests still observe upstream cancellation after headers.
        try {
          upstreamSignal.addEventListener("abort", relayAbort, { once: true });
        } catch {
          // ignore
        }
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    timeoutId = setTimeout(() => {
      didTimeout = true;
      try {
        timeoutController.abort(new Error("Request timed out."));
      } catch {
        try {
          timeoutController.abort();
        } catch {
          // ignore
        }
      }
    }, timeoutMs);

    try {
      return await fetchImpl(url, initWithSignal);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch (error) {
    const name = (error && typeof error === "object" && "name" in error ? (error as any).name : "") as string;
    if (name === "AbortError") {
      throw resolveAbortLikeError(error, {
        didTimeout,
        upstreamAborted: Boolean(upstreamSignal?.aborted),
      });
    }
    throw error;
  }
}

async function requestJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildHeaders(options.token, options.hostToken),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs ?? DEFAULT_OPENWORK_SERVER_TIMEOUT_MS,
  );

  const text = await response.text();
  let json: any = null;
  let parsedJson = false;
  try {
    json = text ? JSON.parse(text) : null;
    parsedJson = true;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : "request_failed";
    const message = typeof json?.message === "string"
      ? json.message
      : resolvePlainTextServerErrorMessage(text, response.statusText);
    throw new OpenworkServerError(response.status, code, message, json?.details);
  }

  if (text && !parsedJson) {
    throw new OpenworkServerError(response.status, "invalid_response", "服务器返回了无效响应。");
  }

  return json as T;
}

function resolvePlainTextServerErrorMessage(text: string, fallback: string): string {
  const value = text.trim();
  if (!value) return fallback;
  if (/^proxy error\b/i.test(value) || /ECONNREFUSED|EHOSTUNREACH|ETIMEDOUT|ENOTFOUND/i.test(value)) {
    return "OpenWork 服务未连接。";
  }
  return value;
}

async function requestJsonRaw<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<RawJsonResponse<T>> {
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildHeaders(options.token, options.hostToken),
      body: options.body ? JSON.stringify(options.body) : undefined,
    },
    options.timeoutMs ?? DEFAULT_OPENWORK_SERVER_TIMEOUT_MS,
  );

  const text = await response.text();
  let json: T | null = null;
  try {
    json = text ? (JSON.parse(text) as T) : null;
  } catch {
    json = null;
  }

  return { ok: response.ok, status: response.status, json };
}

async function requestMultipartRaw(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: FormData; timeoutMs?: number } = {},
): Promise<{ ok: boolean; status: number; text: string }>{
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "POST",
      headers: buildAuthHeaders(options.token, options.hostToken),
      body: options.body,
    },
    options.timeoutMs ?? DEFAULT_OPENWORK_SERVER_TIMEOUT_MS,
  );
  const text = await response.text();
  return { ok: response.ok, status: response.status, text };
}

async function requestMultipartJson<T>(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; body?: FormData; timeoutMs?: number } = {},
): Promise<T> {
  const response = await requestMultipartRaw(baseUrl, path, options);
  let json: any = null;
  try {
    json = response.text ? JSON.parse(response.text) : null;
  } catch {
    json = null;
  }

  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : "request_failed";
    const message = typeof json?.message === "string" ? json.message : "Request failed";
    throw new OpenworkServerError(response.status, code, message, json?.details);
  }

  return json as T;
}

async function requestBinary(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; hostToken?: string; timeoutMs?: number } = {},
): Promise<{ data: ArrayBuffer; contentType: string | null; filename: string | null }>{
  const url = `${baseUrl}${path}`;
  const fetchImpl = resolveFetch();
  const response = await fetchWithTimeout(
    fetchImpl,
    url,
    {
      method: options.method ?? "GET",
      headers: buildAuthHeaders(options.token, options.hostToken),
    },
    options.timeoutMs ?? DEFAULT_OPENWORK_SERVER_TIMEOUT_MS,
  );

  if (!response.ok) {
    const text = await response.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const code = typeof json?.code === "string" ? json.code : "request_failed";
    const message = typeof json?.message === "string" ? json.message : response.statusText;
    throw new OpenworkServerError(response.status, code, message, json?.details);
  }

  const contentType = response.headers.get("content-type");
  const disposition = response.headers.get("content-disposition") ?? "";
  const filenameMatch = disposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
  const filenameRaw = filenameMatch?.[1] ?? filenameMatch?.[2] ?? null;
  const filename = filenameRaw ? decodeURIComponent(filenameRaw) : null;
  const data = await response.arrayBuffer();
  return { data, contentType, filename };
}

export function createOpenworkServerClient(options: { baseUrl: string; token?: string; hostToken?: string }) {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const token = options.token;
  const hostToken = options.hostToken;

  // Shared reference so patchConfig can invalidate the getConfig cache.
  let configCache: Map<string, { value: unknown; expiresAt: number }> | null = null;

  const timeouts = {
    // Keep these generous to avoid UI flapping during heavy server-side work (Python tools, file IO).
    // The server health endpoint itself is fast, but the event loop can be busy.
    health: 10_000,
    capabilities: 10_000,
    listWorkspaces: 8_000,
    activateWorkspace: 10_000,
    deleteWorkspace: 10_000,
    deleteSession: 12_000,
    knowledge: 12_000,
    status: 6_000,
    admin: 12_000,
    config: 10_000,
    opencodeRouter: 10_000,
    workspaceExport: 30_000,
    workspaceImport: 30_000,
    binary: 60_000,
  };

  return {
    baseUrl,
    token,
    authRegister: (input: { username: string; password: string }) =>
      requestJson<OpenworkAuthResponse>(baseUrl, "/auth/register", {
        method: "POST",
        body: input,
      }),
    authLogin: (input: { username: string; password: string }) =>
      requestJson<OpenworkAuthResponse>(baseUrl, "/auth/login", {
        method: "POST",
        body: input,
      }),
    adminListUsers: () =>
      requestJson<OpenworkAdminUsersResponse>(baseUrl, "/admin/users", {
        token,
        hostToken,
        timeoutMs: timeouts.admin,
      }),
    adminListUserSessions: (userId: string) =>
      requestJson<OpenworkAdminUserSessionsResponse>(
        baseUrl,
        `/admin/users/${encodeURIComponent(userId)}/sessions`,
        {
          token,
          hostToken,
          timeoutMs: timeouts.admin,
        },
      ),
    health: () =>
      requestJson<{ ok: boolean; version: string; uptimeMs: number }>(baseUrl, "/health", { token, hostToken, timeoutMs: timeouts.health }),
    status: () => requestJson<OpenworkServerDiagnostics>(baseUrl, "/status", { token, hostToken, timeoutMs: timeouts.status }),
    capabilities: () => requestJson<OpenworkServerCapabilities>(baseUrl, "/capabilities", { token, hostToken, timeoutMs: timeouts.capabilities }),
    opencodeRouterHealth: () =>
      requestJsonRaw<OpenworkOpenCodeRouterHealthSnapshot>(baseUrl, "/opencode-router/health", { token, hostToken, timeoutMs: timeouts.opencodeRouter }),
    opencodeRouterBindings: (filters?: { channel?: string; identityId?: string }) => {
      const search = new URLSearchParams();
      if (filters?.channel?.trim()) search.set("channel", filters.channel.trim());
      if (filters?.identityId?.trim()) search.set("identityId", filters.identityId.trim());
      const suffix = search.toString();
      const path = suffix ? `/opencode-router/bindings?${suffix}` : "/opencode-router/bindings";
      return requestJsonRaw<OpenworkOpenCodeRouterBindingsResult>(baseUrl, path, { token, hostToken, timeoutMs: timeouts.opencodeRouter });
    },
    opencodeRouterTelegramIdentities: () =>
      requestJsonRaw<OpenworkOpenCodeRouterTelegramIdentitiesResult>(baseUrl, "/opencode-router/identities/telegram", { token, hostToken, timeoutMs: timeouts.opencodeRouter }),
    opencodeRouterSlackIdentities: () =>
      requestJsonRaw<OpenworkOpenCodeRouterSlackIdentitiesResult>(baseUrl, "/opencode-router/identities/slack", { token, hostToken, timeoutMs: timeouts.opencodeRouter }),
    listWorkspaces: () => requestJson<OpenworkWorkspaceList>(baseUrl, "/workspaces", { token, hostToken, timeoutMs: timeouts.listWorkspaces }),
    activateWorkspace: (workspaceId: string) =>
      requestJson<{ activeId: string; workspace: OpenworkWorkspaceInfo }>(
        baseUrl,
        `/workspaces/${encodeURIComponent(workspaceId)}/activate`,
        { token, hostToken, method: "POST", timeoutMs: timeouts.activateWorkspace },
      ),
    deleteWorkspace: (workspaceId: string) =>
      requestJson<{ ok: boolean; deleted: boolean; persisted: boolean; activeId: string | null; items: OpenworkWorkspaceInfo[] }>(
        baseUrl,
        `/workspaces/${encodeURIComponent(workspaceId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteWorkspace },
      ),
    deleteSession: (workspaceId: string, sessionId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.deleteSession },
      ),
    createWorkspaceOpencodeSession: (
      workspaceId: string,
      payload: OpenworkWorkspaceSessionCreateInput,
    ) =>
      requestJson<Session>(
        baseUrl,
        `/w/${encodeURIComponent(workspaceId)}/opencode/session`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
          timeoutMs: timeouts.deleteSession,
        },
      ),
    listWorkspaceDocuments: (workspaceId: string, options?: { sessionId?: string | null }) => {
      const search = new URLSearchParams();
      if (options?.sessionId?.trim()) search.set("session", options.sessionId.trim());
      const suffix = search.toString();
      return requestJson<OpenworkDocumentListResponse>(
        baseUrl,
        `/w/${encodeURIComponent(workspaceId)}/documents${suffix ? `?${suffix}` : ""}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      );
    },
    uploadWorkspaceDocument: (
      workspaceId: string,
      payload: {
        file: File;
        sessionId?: string | null;
        path?: string | null;
        baseDir?: string | null;
        relativePath?: string | null;
        overwrite?: boolean;
      },
    ) => {
      const search = new URLSearchParams();
      if (payload.sessionId?.trim()) search.set("session", payload.sessionId.trim());
      const suffix = search.toString();
      const form = new FormData();
      form.append("file", payload.file, payload.file.name);
      if (payload.path?.trim()) form.append("path", payload.path.trim());
      if (payload.baseDir?.trim()) form.append("baseDir", payload.baseDir.trim());
      if (payload.relativePath?.trim()) form.append("relativePath", payload.relativePath.trim());
      if (payload.overwrite === true) form.append("overwrite", "true");
      return requestMultipartJson<{ ok: boolean; name: string }>(
        baseUrl,
        `/w/${encodeURIComponent(workspaceId)}/document/upload${suffix ? `?${suffix}` : ""}`,
        { token, hostToken, method: "POST", body: form, timeoutMs: timeouts.binary },
      );
    },
    listKnowledge: (workspaceId: string, scope: OpenworkKnowledgeScope = "mine") =>
      requestJson<OpenworkKnowledgeListResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge?scope=${encodeURIComponent(scope)}`,
        { token, hostToken, timeoutMs: timeouts.knowledge },
      ),
    createKnowledge: (workspaceId: string, input: OpenworkKnowledgeCreateInput) =>
      requestJson<OpenworkKnowledgeCreateResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge`,
        { token, hostToken, method: "POST", body: input, timeoutMs: timeouts.knowledge },
      ),
    uploadKnowledgeDocuments: (workspaceId: string, knowledgeId: string, files: File[]) => {
      const form = new FormData();
      for (const file of files) {
        form.append("file", file, file.name);
      }
      return requestMultipartJson<OpenworkKnowledgeUploadResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(knowledgeId)}/documents`,
        { token, hostToken, method: "POST", body: form, timeoutMs: timeouts.binary },
      );
    },
    listKnowledgeDocuments: (workspaceId: string, knowledgeId: string) =>
      requestJson<OpenworkKnowledgeDocumentsResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(knowledgeId)}/documents`,
        { token, hostToken, timeoutMs: timeouts.knowledge },
      ),
    deleteKnowledgeDocument: (workspaceId: string, knowledgeId: string, documentId: string) =>
      requestJson<OpenworkKnowledgeDocumentDeleteResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(knowledgeId)}/documents/${encodeURIComponent(documentId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.knowledge },
      ),
    deleteKnowledge: (workspaceId: string, knowledgeId: string) =>
      requestJson<OpenworkKnowledgeDeleteResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge/${encodeURIComponent(knowledgeId)}`,
        { token, hostToken, method: "DELETE", timeoutMs: timeouts.knowledge },
      ),
    getSessionKnowledge: (workspaceId: string, sessionId: string) =>
      requestJson<OpenworkSessionKnowledgeResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/knowledge`,
        { token, hostToken, timeoutMs: timeouts.knowledge },
      ),
    setSessionKnowledge: (workspaceId: string, sessionId: string, knowledgeIds: string[]) =>
      requestJson<OpenworkSessionKnowledgeResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/sessions/${encodeURIComponent(sessionId)}/knowledge`,
        { token, hostToken, method: "PUT", body: { knowledgeIds }, timeoutMs: timeouts.knowledge },
      ),
    searchKnowledge: (
      workspaceId: string,
      input: { sessionId: string; question: string; knowledgeIds?: string[] },
    ) =>
      requestJson<OpenworkKnowledgeSearchResponse>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/knowledge/search`,
        { token, hostToken, method: "POST", body: input, timeoutMs: timeouts.knowledge },
      ),
    exportWorkspace: (workspaceId: string) =>
      requestJson<OpenworkWorkspaceExport>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/export`, {
        token,
        hostToken,
        timeoutMs: timeouts.workspaceExport,
      }),
    importWorkspace: (workspaceId: string, payload: Record<string, unknown>) =>
      requestJson<{ ok: boolean }>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/import`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.workspaceImport,
      }),
    getConfig: (() => {
      // Dedup: concurrent calls for the same workspaceId share one in-flight
      // request. After resolution the cached value lives for a short TTL so
      // rapid-fire reactive re-triggers don't each hit the network.
      const CONFIG_CACHE_TTL_MS = 2_000;
      const inflight = new Map<string, Promise<{ opencode: Record<string, unknown>; openwork: Record<string, unknown>; updatedAt?: number | null }>>();
      const cached = new Map<string, { value: { opencode: Record<string, unknown>; openwork: Record<string, unknown>; updatedAt?: number | null }; expiresAt: number }>();

      // Expose cache for invalidation by patchConfig.
      configCache = cached;

      return (workspaceId: string) => {
        const key = workspaceId;

        // Return from short-lived cache if still valid.
        const hit = cached.get(key);
        if (hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.value);

        // Coalesce with any in-flight request.
        const existing = inflight.get(key);
        if (existing) return existing;

        const promise = requestJson<{ opencode: Record<string, unknown>; openwork: Record<string, unknown>; updatedAt?: number | null }>(
          baseUrl,
          `/workspace/${encodeURIComponent(workspaceId)}/config`,
          { token, hostToken, timeoutMs: timeouts.config },
        ).then((result) => {
          cached.set(key, { value: result, expiresAt: Date.now() + CONFIG_CACHE_TTL_MS });
          return result;
        }).finally(() => {
          inflight.delete(key);
        });

        inflight.set(key, promise);
        return promise;
      };
    })(),
    patchConfig: (() => {
      // Coalesce + serialize PATCH requests per workspace so write traffic
      // cannot saturate the browser's per-origin connection pool (HTTP/1.1 is
      // typically capped at 6 connections).
      //
      // Do NOT debounce with a long timer here: delaying the first PATCH makes
      // it more likely to overlap with other startup API calls and recreate
      // the "pending" symptom. Instead we coalesce within the current tick
      // (microtask) and then flush immediately, while keeping only one request
      // in-flight per workspace.

      type PatchPayload = { opencode?: Record<string, unknown>; openwork?: Record<string, unknown> };
      type Waiter = {
        resolve: (v: { updatedAt?: number | null }) => void;
        reject: (e: unknown) => void;
      };
      type QueueState = {
        queued: PatchPayload | null;
        waiters: Waiter[];
        flushing: boolean;
        scheduled: boolean;
      };

      const queues = new Map<string, QueueState>();

      const isPlainObject = (value: unknown): value is Record<string, unknown> =>
        Boolean(value) && typeof value === "object" && !Array.isArray(value);

      const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> => {
        const result: Record<string, unknown> = { ...target };
        for (const [k, sv] of Object.entries(source)) {
          const tv = result[k];
          if (isPlainObject(tv) && isPlainObject(sv)) {
            result[k] = deepMerge(tv, sv);
          } else {
            result[k] = sv;
          }
        }
        return result;
      };

      const mergePayload = (target: PatchPayload | null, source: PatchPayload): PatchPayload => {
        const next: PatchPayload = { ...(target ?? {}) };
        if (source.opencode) {
          const base = isPlainObject(next.opencode) ? next.opencode : {};
          next.opencode = deepMerge(base, source.opencode);
        }
        if (source.openwork) {
          const base = isPlainObject(next.openwork) ? next.openwork : {};
          next.openwork = deepMerge(base, source.openwork);
        }
        return next;
      };

      const enqueueMicrotask = (fn: () => void) => {
        if (typeof queueMicrotask === "function") {
          queueMicrotask(fn);
          return;
        }
        void Promise.resolve().then(fn);
      };

      const cleanupIfIdle = (workspaceId: string, state: QueueState) => {
        if (!state.flushing && !state.scheduled && !state.queued && state.waiters.length === 0) {
          queues.delete(workspaceId);
        }
      };

      const flush = async (workspaceId: string) => {
        const state = queues.get(workspaceId);
        if (!state || state.flushing || !state.queued) return;

        state.flushing = true;
        const body = state.queued;
        const waiters = state.waiters;
        state.queued = null;
        state.waiters = [];

        // Invalidate before sending so follow-up reads don't return stale cached content.
        configCache?.delete(workspaceId);

        try {
          const result = await requestJson<{ updatedAt?: number | null }>(
            baseUrl,
            `/workspace/${encodeURIComponent(workspaceId)}/config`,
            {
              token,
              hostToken,
              method: "PATCH",
              body,
              timeoutMs: timeouts.config,
            },
          );
          for (const waiter of waiters) waiter.resolve(result);
        } catch (error) {
          for (const waiter of waiters) waiter.reject(error);
        } finally {
          state.flushing = false;
          if (state.queued) {
            scheduleFlush(workspaceId, state);
          } else {
            cleanupIfIdle(workspaceId, state);
          }
        }
      };

      const scheduleFlush = (workspaceId: string, state: QueueState) => {
        if (state.scheduled) return;
        state.scheduled = true;
        enqueueMicrotask(() => {
          state.scheduled = false;
          void flush(workspaceId);
        });
      };

      return (workspaceId: string, payload: PatchPayload) => {
        let state = queues.get(workspaceId);
        if (!state) {
          state = { queued: null, waiters: [], flushing: false, scheduled: false };
          queues.set(workspaceId, state);
        }

        state.queued = mergePayload(state.queued, payload);
        // Invalidate cache immediately to avoid serving stale data during the coalesce window.
        configCache?.delete(workspaceId);

        const promise = new Promise<{ updatedAt?: number | null }>((resolve, reject) => {
          state!.waiters.push({ resolve, reject });
        });
        scheduleFlush(workspaceId, state);
        return promise;
      };
    })(),
    setOpenCodeRouterTelegramToken: (
      workspaceId: string,
      tokenValue: string,
      healthPort?: number | null,
    ) =>
      requestJson<OpenworkOpenCodeRouterTelegramResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/telegram-token`,
        {
          token,
          hostToken,
          method: "POST",
          body: { token: tokenValue, healthPort },
          timeoutMs: timeouts.opencodeRouter,
        },
      ),
    setOpenCodeRouterSlackTokens: (
      workspaceId: string,
      botToken: string,
      appToken: string,
      healthPort?: number | null,
    ) =>
      requestJson<OpenworkOpenCodeRouterSlackResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/slack-tokens`,
        {
          token,
          hostToken,
          method: "POST",
          body: { botToken, appToken, healthPort },
          timeoutMs: timeouts.opencodeRouter,
        },
      ),
    getOpenCodeRouterTelegram: (workspaceId: string) =>
      requestJson<OpenworkOpenCodeRouterTelegramInfo>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/telegram`,
        { token, hostToken, timeoutMs: timeouts.opencodeRouter },
      ),
    getOpenCodeRouterTelegramIdentities: (workspaceId: string, options?: { healthPort?: number | null }) => {
      const query = typeof options?.healthPort === "number" ? `?healthPort=${encodeURIComponent(String(options.healthPort))}` : "";
      return requestJson<OpenworkOpenCodeRouterTelegramIdentitiesResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/identities/telegram${query}`,
        { token, hostToken, timeoutMs: timeouts.opencodeRouter },
      );
    },
    upsertOpenCodeRouterTelegramIdentity: (
      workspaceId: string,
      input: { id?: string; token: string; enabled?: boolean; access?: "public" | "private"; pairingCode?: string },
      options?: { healthPort?: number | null },
    ) =>
      requestJson<OpenworkOpenCodeRouterTelegramIdentityUpsertResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/identities/telegram`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            ...(input.id?.trim() ? { id: input.id.trim() } : {}),
            token: input.token,
            ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
            ...(input.access ? { access: input.access } : {}),
            ...(input.pairingCode?.trim() ? { pairingCode: input.pairingCode.trim() } : {}),
            healthPort: options?.healthPort ?? null,
          },
        },
      ),
    deleteOpenCodeRouterTelegramIdentity: (workspaceId: string, identityId: string, options?: { healthPort?: number | null }) => {
      const query = typeof options?.healthPort === "number" ? `?healthPort=${encodeURIComponent(String(options.healthPort))}` : "";
      return requestJson<OpenworkOpenCodeRouterTelegramIdentityDeleteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/identities/telegram/${encodeURIComponent(identityId)}${query}`,
        { token, hostToken, method: "DELETE" },
      );
    },
    getOpenCodeRouterSlackIdentities: (workspaceId: string, options?: { healthPort?: number | null }) => {
      const query = typeof options?.healthPort === "number" ? `?healthPort=${encodeURIComponent(String(options.healthPort))}` : "";
      return requestJson<OpenworkOpenCodeRouterSlackIdentitiesResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/identities/slack${query}`,
        { token, hostToken },
      );
    },
    upsertOpenCodeRouterSlackIdentity: (
      workspaceId: string,
      input: { id?: string; botToken: string; appToken: string; enabled?: boolean },
      options?: { healthPort?: number | null },
    ) =>
      requestJson<OpenworkOpenCodeRouterSlackIdentityUpsertResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/identities/slack`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            ...(input.id?.trim() ? { id: input.id.trim() } : {}),
            botToken: input.botToken,
            appToken: input.appToken,
            ...(typeof input.enabled === "boolean" ? { enabled: input.enabled } : {}),
            healthPort: options?.healthPort ?? null,
          },
        },
      ),
    deleteOpenCodeRouterSlackIdentity: (workspaceId: string, identityId: string, options?: { healthPort?: number | null }) => {
      const query = typeof options?.healthPort === "number" ? `?healthPort=${encodeURIComponent(String(options.healthPort))}` : "";
      return requestJson<OpenworkOpenCodeRouterSlackIdentityDeleteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/identities/slack/${encodeURIComponent(identityId)}${query}`,
        { token, hostToken, method: "DELETE" },
      );
    },
    getOpenCodeRouterBindings: (
      workspaceId: string,
      filters?: { channel?: string; identityId?: string; healthPort?: number | null },
    ) => {
      const search = new URLSearchParams();
      if (filters?.channel?.trim()) search.set("channel", filters.channel.trim());
      if (filters?.identityId?.trim()) search.set("identityId", filters.identityId.trim());
      if (typeof filters?.healthPort === "number") search.set("healthPort", String(filters.healthPort));
      const suffix = search.toString();
      return requestJson<OpenworkOpenCodeRouterBindingsResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/bindings${suffix ? `?${suffix}` : ""}`,
        { token, hostToken },
      );
    },
    setOpenCodeRouterBinding: (
      workspaceId: string,
      input: { channel: string; identityId?: string; peerId: string; directory?: string },
      options?: { healthPort?: number | null },
    ) =>
      requestJson<OpenworkOpenCodeRouterBindingUpdateResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/bindings`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            channel: input.channel,
            ...(input.identityId?.trim() ? { identityId: input.identityId.trim() } : {}),
            peerId: input.peerId,
            ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
            healthPort: options?.healthPort ?? null,
          },
        },
      ),
    sendOpenCodeRouterMessage: (
      workspaceId: string,
      input: {
        channel: "telegram" | "slack";
        text: string;
        identityId?: string;
        directory?: string;
        peerId?: string;
        autoBind?: boolean;
      },
      options?: { healthPort?: number | null },
    ) => {
      const payload = {
        channel: input.channel,
        text: input.text,
        ...(input.identityId?.trim() ? { identityId: input.identityId.trim() } : {}),
        ...(input.directory?.trim() ? { directory: input.directory.trim() } : {}),
        ...(input.peerId?.trim() ? { peerId: input.peerId.trim() } : {}),
        ...(input.autoBind === true ? { autoBind: true } : {}),
        healthPort: options?.healthPort ?? null,
      };

      const primaryPath = `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/send`;
      const mountedWorkspaceId = parseOpenworkWorkspaceIdFromUrl(baseUrl);
      const fallbackPath =
        mountedWorkspaceId && mountedWorkspaceId === workspaceId
          ? `/opencode-router/send`
          : `/w/${encodeURIComponent(workspaceId)}/opencode-router/send`;

      return requestJson<OpenworkOpenCodeRouterSendResult>(baseUrl, primaryPath, {
        token,
        hostToken,
        method: "POST",
        body: payload,
        timeoutMs: timeouts.opencodeRouter,
      }).catch(async (error) => {
        if (!(error instanceof OpenworkServerError) || error.status !== 404) {
          throw error;
        }
        return requestJson<OpenworkOpenCodeRouterSendResult>(baseUrl, fallbackPath, {
          token,
          hostToken,
          method: "POST",
          body: payload,
          timeoutMs: timeouts.opencodeRouter,
        });
      });
    },
    setOpenCodeRouterTelegramEnabled: (
      workspaceId: string,
      enabled: boolean,
      options?: { clearToken?: boolean; healthPort?: number | null },
    ) =>
      requestJson<OpenworkOpenCodeRouterTelegramEnabledResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/opencode-router/telegram-enabled`,
        {
          token,
          hostToken,
          method: "POST",
          body: { enabled, clearToken: options?.clearToken ?? false, healthPort: options?.healthPort ?? null },
        },
      ),
    listReloadEvents: (workspaceId: string, options?: { since?: number }) => {
      const query = typeof options?.since === "number" ? `?since=${options.since}` : "";
      return requestJson<{ items: OpenworkReloadEvent[]; cursor?: number }>(
        baseUrl,
        `/workspace/${workspaceId}/events${query}`,
        { token, hostToken },
      );
    },
    reloadEngine: (workspaceId: string) =>
      requestJson<{ ok: boolean; reloadedAt?: number }>(baseUrl, `/workspace/${workspaceId}/engine/reload`, {
        token,
        hostToken,
        method: "POST",
      }),
    listPlugins: (workspaceId: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<{ items: OpenworkPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins${query}`,
        { token, hostToken },
      );
    },
    addPlugin: (workspaceId: string, spec: string) =>
      requestJson<{ items: OpenworkPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins`,
        { token, hostToken, method: "POST", body: { spec } },
      ),
    removePlugin: (workspaceId: string, name: string) =>
      requestJson<{ items: OpenworkPluginItem[]; loadOrder: string[] }>(
        baseUrl,
        `/workspace/${workspaceId}/plugins/${encodeURIComponent(name)}`,
        { token, hostToken, method: "DELETE" },
      ),
    listSkills: (workspaceId: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<{ items: OpenworkSkillItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/skills${query}`,
        { token, hostToken },
      );
    },
    listHubSkills: () =>
      requestJson<{ items: OpenworkHubSkillItem[] }>(baseUrl, `/hub/skills`, {
        token,
        hostToken,
      }),
    installHubSkill: (
      workspaceId: string,
      name: string,
      options?: { overwrite?: boolean; repo?: { owner?: string; repo?: string; ref?: string } },
    ) =>
      requestJson<{ ok: boolean; name: string; path: string; action: "added" | "updated"; written: number; skipped: number }>(
        baseUrl,
        `/workspace/${workspaceId}/skills/hub/${encodeURIComponent(name)}`,
        {
          token,
          hostToken,
          method: "POST",
          body: {
            ...(options?.overwrite ? { overwrite: true } : {}),
            ...(options?.repo ? { repo: options.repo } : {}),
          },
        },
      ),
    getSkill: (workspaceId: string, name: string, options?: { includeGlobal?: boolean }) => {
      const query = options?.includeGlobal ? "?includeGlobal=true" : "";
      return requestJson<OpenworkSkillContent>(
        baseUrl,
        `/workspace/${workspaceId}/skills/${encodeURIComponent(name)}${query}`,
        { token, hostToken },
      );
    },
    upsertSkill: (workspaceId: string, payload: { name: string; content: string; description?: string }) =>
      requestJson<OpenworkSkillItem>(baseUrl, `/workspace/${workspaceId}/skills`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    listMcp: (workspaceId: string) =>
      requestJson<{ items: OpenworkMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp`, { token, hostToken }),
    addMcp: (workspaceId: string, payload: { name: string; config: Record<string, unknown> }) =>
      requestJson<{ items: OpenworkMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    removeMcp: (workspaceId: string, name: string) =>
      requestJson<{ items: OpenworkMcpItem[] }>(baseUrl, `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),

    logoutMcpAuth: (workspaceId: string, name: string) =>
      requestJson<{ ok: true }>(baseUrl, `/workspace/${workspaceId}/mcp/${encodeURIComponent(name)}/auth`, {
        token,
        hostToken,
        method: "DELETE",
      }),
    getRagflowStatus: (workspaceId: string) =>
      requestJson<OpenworkRagflowStatus>(baseUrl, `/workspace/${workspaceId}/ragflow`, {
        token,
        hostToken,
      }),
    listRagflowDatasets: (workspaceId: string, options?: { query?: string; limit?: number }) => {
      const search = new URLSearchParams();
      if (options?.query?.trim()) search.set("query", options.query.trim());
      if (typeof options?.limit === "number" && Number.isFinite(options.limit)) search.set("limit", String(options.limit));
      const suffix = search.toString();
      return requestJson<{ items: OpenworkRagflowDataset[] }>(
        baseUrl,
        `/workspace/${workspaceId}/ragflow/datasets${suffix ? `?${suffix}` : ""}`,
        { token, hostToken },
      );
    },
    retrieveRagflow: (
      workspaceId: string,
      payload: {
        question: string;
        datasetIds: string[];
        page?: number;
        pageSize?: number;
        topK?: number;
        similarityThreshold?: number;
        vectorSimilarityWeight?: number;
        keyword?: boolean;
      },
    ) =>
      requestJson<OpenworkRagflowRetrieveResult>(
        baseUrl,
        `/workspace/${workspaceId}/ragflow/retrieve`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),

    listCommands: (workspaceId: string, scope: "workspace" | "global" = "workspace") =>
      requestJson<{ items: OpenworkCommandItem[] }>(
        baseUrl,
        `/workspace/${workspaceId}/commands?scope=${scope}`,
        { token, hostToken },
      ),
    listAudit: (workspaceId: string, limit = 50) =>
      requestJson<{ items: OpenworkAuditEntry[] }>(
        baseUrl,
        `/workspace/${workspaceId}/audit?limit=${limit}`,
        { token, hostToken },
      ),
    upsertCommand: (
      workspaceId: string,
      payload: { name: string; description?: string; template: string; agent?: string; model?: string | null; subtask?: boolean },
    ) =>
      requestJson<{ items: OpenworkCommandItem[] }>(baseUrl, `/workspace/${workspaceId}/commands`, {
        token,
        hostToken,
        method: "POST",
        body: payload,
      }),
    deleteCommand: (workspaceId: string, name: string) =>
      requestJson<{ ok: boolean }>(baseUrl, `/workspace/${workspaceId}/commands/${encodeURIComponent(name)}`, {
        token,
        hostToken,
        method: "DELETE",
      }),
    listScheduledJobs: (workspaceId: string) =>
      requestJson<{ items: ScheduledJob[] }>(baseUrl, `/workspace/${workspaceId}/scheduler/jobs`, { token, hostToken }),
    deleteScheduledJob: (workspaceId: string, name: string) =>
      requestJson<{ job: ScheduledJob }>(baseUrl, `/workspace/${workspaceId}/scheduler/jobs/${encodeURIComponent(name)}`,
        {
          token,
          hostToken,
          method: "DELETE",
        },
      ),
    getSoulStatus: (workspaceId: string) =>
      requestJson<OpenworkSoulStatus>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/soul/status`, {
        token,
        hostToken,
      }),
    listSoulHeartbeats: (workspaceId: string, limit = 20) =>
      requestJson<{ items: OpenworkSoulHeartbeatEntry[]; total: number; path: string }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/soul/heartbeats?limit=${encodeURIComponent(String(limit))}`,
        { token, hostToken },
      ),

    uploadInbox: async (workspaceId: string, file: File, options?: { path?: string }) => {
      const id = workspaceId.trim();
      if (!id) throw new Error("workspaceId is required");
      if (!file) throw new Error("file is required");
      const form = new FormData();
      form.append("file", file);
      if (options?.path?.trim()) {
        form.append("path", options.path.trim());
      }

      const result = await requestMultipartRaw(baseUrl, `/workspace/${encodeURIComponent(id)}/inbox`, {
        token,
        hostToken,
        method: "POST",
        body: form,
        timeoutMs: timeouts.binary,
      });

      if (!result.ok) {
        let message = result.text.trim();
        let details: any = null;
        try {
          const json = message ? JSON.parse(message) : null;
          if (json && typeof json.message === "string") {
            message = json.message;
          }
          details = json?.details ?? null;
        } catch {
          // ignore
        }
        if (result.status === 413 && details && typeof details === "object") {
          const maxBytes = typeof details.maxBytes === "number" ? details.maxBytes : null;
          const sizeBytes = typeof details.size === "number" ? details.size : null;
          if (maxBytes && Number.isFinite(maxBytes) && maxBytes > 0) {
            const sizeLabel = sizeBytes && Number.isFinite(sizeBytes) && sizeBytes > 0
              ? formatBytes(sizeBytes)
              : formatBytes(file.size);
            message = `${message || "File exceeds upload limit"} (max ${formatBytes(maxBytes)}, got ${sizeLabel})`;
          }
        }
        throw new OpenworkServerError(result.status, "request_failed", message || "Inbox upload failed");
      }

      const body = result.text.trim();
      if (body) {
        try {
          const parsed = JSON.parse(body) as Partial<OpenworkInboxUploadResult>;
          if (typeof parsed.path === "string" && parsed.path.trim()) {
            return {
              ok: parsed.ok ?? true,
              path: parsed.path.trim(),
              bytes: typeof parsed.bytes === "number" ? parsed.bytes : file.size,
            } satisfies OpenworkInboxUploadResult;
          }
        } catch {
          // ignore invalid JSON and fall back
        }
      }

      return {
        ok: true,
        path: options?.path?.trim() || file.name,
        bytes: file.size,
      } satisfies OpenworkInboxUploadResult;
    },

    listInbox: (workspaceId: string, options?: { prefix?: string }) => {
      const prefix = options?.prefix?.trim();
      const query = prefix ? `?prefix=${encodeURIComponent(prefix)}` : "";
      return requestJson<OpenworkInboxList>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/inbox${query}`,
        { token, hostToken },
      );
    },

    downloadInbox: (workspaceId: string, inboxId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/inbox/${encodeURIComponent(inboxId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),

    downloadInboxItem: (workspaceId: string, inboxId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/inbox/${encodeURIComponent(inboxId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),

    deleteInbox: (workspaceId: string, inboxId: string) =>
      requestJson<{ ok: boolean }>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/inbox/${encodeURIComponent(inboxId)}`,
        { token, hostToken, method: "DELETE" },
      ),
    getBidWorkbench: (workspaceId: string) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench`,
        { token, hostToken },
      ),
    setBidWorkbenchProjectSource: (
      workspaceId: string,
      payload: {
        sourcePath: string;
        sourceType: OpenworkBidWorkbenchSourceType;
        structureSourceKind: OpenworkBidWorkbenchStructureSourceKind;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/project`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchProjectRootOutput: (
      workspaceId: string,
      payload: { rootOutputPath: string | null },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/project/root-output`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchProjectWorkflowStage: (
      workspaceId: string,
      payload: { workflowStage: OpenworkBidWorkbenchWorkflowStage },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/project/stage`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchProjectConstraints: (
      workspaceId: string,
      payload: {
        formatRules: Record<string, unknown>;
        extractedFromPath: string | null;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/project/constraints`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    refreshBidWorkbench: (workspaceId: string) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/refresh`,
        {
          token,
          hostToken,
          method: "POST",
        },
      ),
    setBidWorkbenchSectionSession: (
      workspaceId: string,
      sectionId: string,
      payload: { sessionId: string | null },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/session`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchSectionLock: (
      workspaceId: string,
      sectionId: string,
      payload: { lockedBy: string | null },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/lock`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchSectionMergedState: (
      workspaceId: string,
      sectionId: string,
      payload: {
        mergeRequested?: boolean;
        mergeApplied?: boolean;
        mergeFailed?: boolean;
        mergedIntoMaster?: boolean;
        outputPath?: string | null;
        rootOutputPath?: string | null;
        errorSummary?: string | null;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/merge`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchSectionLink: (
      workspaceId: string,
      sectionId: string,
      payload: {
        kind: "reference" | "output" | "template" | "master-output";
        path: string;
        selected: boolean;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/links`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    addBidWorkbenchSectionRange: (
      workspaceId: string,
      sectionId: string,
      payload: {
        sourcePath: string;
        rangeKind: OpenworkBidWorkbenchSourceRangeKind;
        rangeValue: string;
        note?: string | null;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/ranges`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    deleteBidWorkbenchSectionRange: (
      workspaceId: string,
      rangeId: string,
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/ranges/${encodeURIComponent(rangeId)}`,
        {
          token,
          hostToken,
          method: "DELETE",
        },
      ),
    setBidWorkbenchSectionMetadata: (
      workspaceId: string,
      sectionId: string,
      payload: {
        compositionMode?: OpenworkBidWorkbenchCompositionMode;
        assignee?: string | null;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/metadata`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    setBidWorkbenchSectionPrimaryOutput: (
      workspaceId: string,
      sectionId: string,
      payload: { primaryOutputPath: string | null },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/primary-output`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    addBidWorkbenchSectionMark: (
      workspaceId: string,
      sectionId: string,
      payload: {
        author: string;
        kind: OpenworkBidWorkbenchMarkKind;
        text: string;
      },
    ) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/sections/${encodeURIComponent(sectionId)}/marks`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),
    deleteBidWorkbenchSectionMark: (workspaceId: string, markId: string) =>
      requestJson<OpenworkBidWorkbenchState>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/bid-workbench/marks/${encodeURIComponent(markId)}`,
        {
          token,
          hostToken,
          method: "DELETE",
        },
      ),
    readWorkspaceFile: (workspaceId: string, path: string) =>
      requestJson<OpenworkWorkspaceFileContent>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/content?path=${encodeURIComponent(path)}`,
        { token, hostToken },
      ),

    writeWorkspaceFile: (
      workspaceId: string,
      payload: { path: string; content: string; baseUpdatedAt?: number | null; force?: boolean },
    ) =>
      requestJson<OpenworkWorkspaceFileWriteResult>(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/files/content`,
        {
          token,
          hostToken,
          method: "POST",
          body: payload,
        },
      ),

    listArtifacts: (workspaceId: string) =>
      requestJson<OpenworkArtifactList>(baseUrl, `/workspace/${encodeURIComponent(workspaceId)}/artifacts`, {
        token,
        hostToken,
      }),

    downloadArtifact: (workspaceId: string, artifactId: string) =>
      requestBinary(
        baseUrl,
        `/workspace/${encodeURIComponent(workspaceId)}/artifacts/${encodeURIComponent(artifactId)}`,
        { token, hostToken, timeoutMs: timeouts.binary },
      ),
  };
}

export type OpenworkServerClient = ReturnType<typeof createOpenworkServerClient>;
