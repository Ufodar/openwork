import type { OpenworkServerStatus } from "./openwork-server";

export type OpenworkServerActionReadyResult =
  | { ok: true; status: "connected" | "limited" }
  | { ok: false; reason: "disconnected" | "limited" | "reconnect_failed" };

type EnsureOpenworkServerActionReadyOptions = {
  getStatus: () => OpenworkServerStatus;
  getHasClient: () => boolean;
  reconnect?: () => Promise<boolean>;
  allowLimited?: boolean;
};

const isReady = (
  status: OpenworkServerStatus,
  hasClient: boolean,
  allowLimited: boolean,
): OpenworkServerActionReadyResult => {
  if (status === "connected" && hasClient) {
    return { ok: true, status: "connected" };
  }

  if (status === "limited") {
    return allowLimited && hasClient
      ? { ok: true, status: "limited" }
      : { ok: false, reason: "limited" };
  }

  return { ok: false, reason: "disconnected" };
};

export async function ensureOpenworkServerActionReady(
  options: EnsureOpenworkServerActionReadyOptions,
): Promise<OpenworkServerActionReadyResult> {
  const allowLimited = Boolean(options.allowLimited);
  const initial = isReady(options.getStatus(), options.getHasClient(), allowLimited);
  if (initial.ok || !options.reconnect) {
    return initial;
  }

  const reconnected = await options.reconnect();
  const afterReconnect = isReady(options.getStatus(), options.getHasClient(), allowLimited);
  if (afterReconnect.ok) {
    return afterReconnect;
  }

  if (!reconnected) {
    return { ok: false, reason: "reconnect_failed" };
  }

  return afterReconnect.reason === "limited"
    ? afterReconnect
    : { ok: false, reason: "reconnect_failed" };
}
