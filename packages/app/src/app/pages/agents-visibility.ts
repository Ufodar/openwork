import type { CreateSessionOptions } from "../types";

export const HIDDEN_FEATURED_AGENT_IDS = new Set(["general-assistant"]);

export const SHOW_STANDALONE_NEW_SESSION_BUTTON = false;

export function filterVisibleFeaturedAgents<T extends { id: string }>(agents: readonly T[]): T[] {
  return agents.filter((agent) => !HIDDEN_FEATURED_AGENT_IDS.has(agent.id));
}

export function resolveFeaturedAgentLaunch(
  featuredId: string,
  agent: string | null,
): CreateSessionOptions | null {
  if (featuredId === "general-assistant") {
    return { view: "session" };
  }
  if (featuredId === "document-agent") {
    const resolved = agent ?? "common-work";
    return { agent: resolved, agentLock: resolved, view: "document-agent" };
  }
  if (featuredId === "document-writer") {
    const resolved = agent ?? "document-writer";
    return { agent: resolved, agentLock: resolved, view: "document-writer", enableDocumentState: true };
  }
  if (featuredId === "bid-workbench") {
    const resolved = agent ?? "common-work";
    return { agent: resolved, agentLock: resolved, view: "bid-workbench" };
  }
  return agent ? { agent } : null;
}
