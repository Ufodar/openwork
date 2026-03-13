import type { View } from "../types";

export type OpenworkSessionPrefs = {
  view?: View | null;
  agent?: string | null;
  agentLock?: string | null;
  [key: string]: unknown;
};

export type ResolvedSessionView = "session" | "document-agent";
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

const resolveStoredSessionView = (value: unknown): ResolvedSessionView | null => {
  const view = normalizeStoredView(value);
  if (view === "document-writer" || view === "document-agent") return "document-agent";
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
    return { view: "document-agent", agent: "document-writer", agentLock: "document-writer" };
  }

  if (normalized.includes("bid writer")) {
    return { view: "document-agent", agent: "bid-writer", agentLock: "document-writer" };
  }

  if (normalized.includes("bid dedupe")) {
    return { view: "document-agent", agent: "bid-dedupe", agentLock: null };
  }

  if (normalized.includes("document agent") || normalized.includes("文档智能体")) {
    return { view: "document-agent", agent: "common-work", agentLock: "common-work" };
  }

  if (normalized.includes("标书写作助手")) {
    return { view: "document-agent", agent: "document-writer", agentLock: "document-writer" };
  }

  return { view: null, agent: null, agentLock: null };
};

export const resolveSessionPreferences = (input: {
  stored?: OpenworkSessionPrefs | null;
  title?: string | null;
}): ResolvedSessionPreferences => {
  const stored = input.stored ?? null;
  const storedView = resolveStoredSessionView(stored?.view);
  const storedAgent = normalizeStoredAgent(stored?.agent);
  const storedAgentLock = normalizeStoredAgent(stored?.agentLock);
  const legacy = inferLegacySessionPreferences(input.title);

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
      : !disableLegacyAgentHints && legacy.agentLock !== null
        ? { value: legacy.agentLock, source: "legacy" as const }
        : { value: null, source: "none" as const };

  const agent =
    storedAgent !== null
      ? { value: storedAgent, source: "stored" as const }
      : !disableLegacyAgentHints && legacy.agent !== null
        ? { value: legacy.agent, source: "legacy" as const }
        : { value: null, source: "none" as const };

  return { view, agent, agentLock };
};
