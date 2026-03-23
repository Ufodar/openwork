import type { OpenworkServerStatus } from "./openwork-server";

export function resolveDashboardClientConnected(input: {
  clientConnected: boolean;
  globalReady: boolean;
  openworkServerStatus: OpenworkServerStatus;
  tab: string;
}): boolean {
  if (input.clientConnected) return true;
  return input.tab === "users" && input.globalReady && input.openworkServerStatus === "connected";
}
