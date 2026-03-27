import type { View } from "../types";

export type OpenworkSessionPrefs = {
  view?: View | null;
  agent?: string | null;
  agentLock?: string | null;
  ragflowDatasetIds?: string[];
  ragflowDatasetNames?: string[];
  ragflowTopK?: number | null;
  [key: string]: unknown;
};

export type OpenworkSessionRagflowSelection = {
  datasetIds: string[];
  datasetNames: string[];
  topK: number | null;
};

export type ResolvedSessionView = "session" | "document-agent" | "document-writer";
export type ResolvedValueSource = "stored" | "legacy" | "default" | "none";

export type ResolvedSessionPreference<T> = {
  value: T;
  source: ResolvedValueSource;
};

export type ResolvedSessionPreferences = {
  view: ResolvedSessionPreference<ResolvedSessionView>;
  agent: ResolvedSessionPreference<string | null>;
  agentLock: ResolvedSessionPreference<string | null>;
};

export const normalizeStoredView = (value: unknown): View | null => {
  switch (value) {
    case "onboarding":
    case "dashboard":
    case "session":
    case "proto":
    case "document-writer":
    case "document-agent":
      return value;
    default:
      return null;
  }
};

export const normalizeStoredAgent = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
};

export const normalizeStoredStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  return next;
};

export const normalizeStoredRagflowTopK = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const next = Math.round(value);
  if (next < 1 || next > 64) return null;
  return next;
};

export const resolveStoredRagflowSelection = (
  stored?: OpenworkSessionPrefs | null,
): OpenworkSessionRagflowSelection | null => {
  const datasetIds = normalizeStoredStringList(stored?.ragflowDatasetIds);
  if (!datasetIds.length) return null;
  return {
    datasetIds,
    datasetNames: normalizeStoredStringList(stored?.ragflowDatasetNames),
    topK: normalizeStoredRagflowTopK(stored?.ragflowTopK),
  };
};

export const mergeOpenworkSessionPrefs = (
  local?: Record<string, OpenworkSessionPrefs> | null,
  remote?: Record<string, OpenworkSessionPrefs> | null,
): Record<string, OpenworkSessionPrefs> => {
  const merged: Record<string, OpenworkSessionPrefs> = {
    ...(local ?? {}),
  };

  for (const [sessionId, prefs] of Object.entries(remote ?? {})) {
    merged[sessionId] = { ...prefs };
  }

  return merged;
};

const resolveStoredSessionView = (value: unknown): ResolvedSessionView | null => {
  const view = normalizeStoredView(value);
  if (view === "document-writer") return "document-writer";
  if (view === "document-agent") return "document-agent";
  if (view === "session") return "session";
  return null;
};

const inferLegacySessionPreferences = (title?: string | null): {
  view: ResolvedSessionView | null;
  agent: string | null;
  agentLock: string | null;
} => {
  const normalized = (title ?? "").trim().toLowerCase();
  if (!normalized) {
    return { view: null, agent: null, agentLock: null };
  }

  if (normalized.includes("document writer")) {
    return { view: "document-writer", agent: "document-writer", agentLock: "document-writer" };
  }

  if (normalized.includes("bid writer")) {
    return { view: "document-writer", agent: "document-writer", agentLock: "document-writer" };
  }

  if (normalized.includes("bid dedupe")) {
    return { view: "document-agent", agent: "bid-dedupe", agentLock: null };
  }

  if (normalized.includes("document agent") || normalized.includes("文档智能体")) {
    return { view: "document-agent", agent: "common-work", agentLock: "common-work" };
  }

  if (normalized.includes("标书写作助手")) {
    return { view: "document-writer", agent: "document-writer", agentLock: "document-writer" };
  }

  return { view: null, agent: null, agentLock: null };
};

export const resolveSessionPreferences = (input: {
  stored?: OpenworkSessionPrefs | null;
  hint?: OpenworkSessionPrefs | null;
  title?: string | null;
}): ResolvedSessionPreferences => {
  const stored = {
    ...(input.hint ?? {}),
    ...(input.stored ?? {}),
  } satisfies OpenworkSessionPrefs;
  const storedView = resolveStoredSessionView(stored?.view);
  const storedAgent = normalizeStoredAgent(stored?.agent);
  const storedAgentLock = normalizeStoredAgent(stored?.agentLock);
  const legacy = inferLegacySessionPreferences(input.title);
  const storedDocumentAgentDefault = storedView === "document-agent" && storedAgent === null && storedAgentLock === null;
  const storedDocumentWriterDefault = storedView === "document-writer" && storedAgent === null && storedAgentLock === null;
  const defaultDocumentAgent = "common-work";
  const defaultDocumentWriter = "document-writer";

  const disableLegacyAgentHints = storedView === "session";

  const view =
    storedView !== null
      ? { value: storedView, source: "stored" as const }
      : legacy.view !== null
        ? { value: legacy.view, source: "legacy" as const }
        : { value: "session" as const, source: "default" as const };

  const agentLock =
    storedAgentLock !== null
      ? { value: storedAgentLock, source: "stored" as const }
      : storedView === "document-writer"
      ? { value: defaultDocumentWriter, source: "default" as const }
      : storedDocumentAgentDefault
        ? { value: defaultDocumentAgent, source: "default" as const }
      : storedDocumentWriterDefault
        ? { value: defaultDocumentWriter, source: "default" as const }
      : !disableLegacyAgentHints && legacy.agentLock !== null
        ? { value: legacy.agentLock, source: "legacy" as const }
        : { value: null, source: "none" as const };

  const agent =
    storedAgent !== null
      ? { value: storedAgent, source: "stored" as const }
      : storedView === "document-writer"
      ? { value: defaultDocumentWriter, source: "default" as const }
      : storedDocumentAgentDefault
        ? { value: defaultDocumentAgent, source: "default" as const }
      : storedDocumentWriterDefault
        ? { value: defaultDocumentWriter, source: "default" as const }
      : !disableLegacyAgentHints && legacy.agent !== null
        ? { value: legacy.agent, source: "legacy" as const }
        : { value: null, source: "none" as const };

  return { view, agent, agentLock };
};
