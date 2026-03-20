import type { OpenworkServerCapabilities, OpenworkServerStatus } from "./openwork-server";

export type OpenworkServerProbeState = {
  status: OpenworkServerStatus;
  capabilities: OpenworkServerCapabilities | null;
  disconnectStreak: number;
};

export function reconcileOpenworkServerProbe(
  current: OpenworkServerProbeState,
  next: { status: OpenworkServerStatus; capabilities: OpenworkServerCapabilities | null },
  options?: { disconnectThreshold?: number },
): OpenworkServerProbeState {
  const disconnectThreshold = Math.max(1, options?.disconnectThreshold ?? 2);

  if (next.status === "connected" || next.status === "limited") {
    return {
      status: next.status,
      capabilities: next.capabilities,
      disconnectStreak: 0,
    };
  }

  const disconnectStreak = current.disconnectStreak + 1;
  if (
    (current.status === "connected" || current.status === "limited") &&
    disconnectStreak < disconnectThreshold
  ) {
    return {
      status: current.status,
      capabilities: current.capabilities,
      disconnectStreak,
    };
  }

  return {
    status: "disconnected",
    capabilities: null,
    disconnectStreak,
  };
}
