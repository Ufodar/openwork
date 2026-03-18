import type { Part } from "@opencode-ai/sdk/v2/client";

import type { MessageInfo } from "../types";

export type ToolPartDisplayStatus = "completed" | "running" | "pending" | "error" | "stale" | "unknown";

type ResolveToolPartDisplayStatusOptions = {
  sessionStatus?: string | null;
  messageInfo?: MessageInfo | null;
  now?: number;
  staleAfterMs?: number;
};

const DEFAULT_STALE_AFTER_MS = 15_000;

const normalizeStatus = (value: unknown): ToolPartDisplayStatus => {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "completed" || text === "done") return "completed";
  if (text === "running") return "running";
  if (text === "pending") return "pending";
  if (text === "error" || text === "failed") return "error";
  return "unknown";
};

const getMessageCreatedAt = (messageInfo: MessageInfo | null | undefined): number | null => {
  const time = (messageInfo?.time ?? null) as { created?: number; completed?: number } | null;
  const created = time?.created;
  return typeof created === "number" ? created : null;
};

const getMessageCompletedAt = (messageInfo: MessageInfo | null | undefined): number | null => {
  const time = (messageInfo?.time ?? null) as { created?: number; completed?: number } | null;
  const completed = time?.completed;
  return typeof completed === "number" ? completed : null;
};

const hasMeaningfulInput = (value: unknown): boolean => {
  if (value == null) return false;
  if (typeof value !== "object") return true;
  return Object.keys(value as Record<string, unknown>).length > 0;
};

export function resolveToolPartDisplayStatus(
  part: Part | null | undefined,
  options: ResolveToolPartDisplayStatusOptions = {},
): ToolPartDisplayStatus {
  if (!part || part.type !== "tool") return "unknown";

  const record = part as any;
  const state = record.state ?? {};
  const normalized = normalizeStatus(state.status);
  if (normalized !== "pending" && normalized !== "running") return normalized;

  const messageInfo = options.messageInfo ?? null;
  if (getMessageCompletedAt(messageInfo) !== null) return "stale";

  const createdAt = getMessageCreatedAt(messageInfo);
  const ageMs =
    createdAt === null
      ? null
      : Math.max(0, (options.now ?? Date.now()) - createdAt);
  const staleAfterMs =
    typeof options.staleAfterMs === "number" && Number.isFinite(options.staleAfterMs) && options.staleAfterMs >= 0
      ? options.staleAfterMs
      : DEFAULT_STALE_AFTER_MS;
  const sessionStatus = typeof options.sessionStatus === "string" ? options.sessionStatus.trim().toLowerCase() : "";
  const isIdleSession = sessionStatus === "idle";
  const input = state.input;

  if (ageMs !== null && ageMs >= staleAfterMs) {
    if (isIdleSession) return "stale";
    if (normalized === "pending" && !hasMeaningfulInput(input)) return "stale";
  }

  return normalized;
}

export function isToolPartActive(
  part: Part | null | undefined,
  options: ResolveToolPartDisplayStatusOptions = {},
): boolean {
  const status = resolveToolPartDisplayStatus(part, options);
  return status === "pending" || status === "running";
}
