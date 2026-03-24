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
    const resolved = agent ?? "doc-orchestrator";
    return { agent: resolved, agentLock: resolved, view: "document-agent" };
  }
  if (featuredId === "document-writer") {
    return { agent: "document-writer", agentLock: "document-writer", view: "document-writer" };
  }
  return agent ? { agent } : null;
}
