import type { OpenworkServerStatus } from "./openwork-server";

export function shouldAutoConnectWebClient(input: {
  isTauri: boolean;
  hasClient: boolean;
  openworkServerStatus: OpenworkServerStatus;
  openworkUrlOverride: string;
  token: string;
  view: string;
  tab: string;
}): boolean {
  if (input.isTauri) return false;
  if (input.hasClient) return false;
  if (input.openworkServerStatus !== "connected") return false;
  if (!input.openworkUrlOverride.trim() || !input.token.trim()) return false;
  if (input.view === "dashboard" && input.tab === "users") return false;
  return true;
}
