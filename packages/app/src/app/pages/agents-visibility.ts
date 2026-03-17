export const HIDDEN_FEATURED_AGENT_IDS = new Set(["general-assistant"]);

export const SHOW_STANDALONE_NEW_SESSION_BUTTON = false;

export function filterVisibleFeaturedAgents<T extends { id: string }>(agents: readonly T[]): T[] {
  return agents.filter((agent) => !HIDDEN_FEATURED_AGENT_IDS.has(agent.id));
}
