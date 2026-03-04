import type { MessageWithParts } from "../../types";
import type { Part } from "@opencode-ai/sdk/v2/client";

import type { ToolMonitorFinding, ToolMonitorToolCall, ToolMonitorTurnReport } from "./types";
import { renderToolMonitorMarkdown } from "./markdown";

type ToolPartRecord = Part & {
  tool?: unknown;
  state?: unknown;
  id?: unknown;
  messageID?: unknown;
};

const normalizeToolStatus = (value: unknown): ToolMonitorToolCall["status"] => {
  if (typeof value !== "string") return "unknown";
  const lowered = value.trim().toLowerCase();
  if (lowered === "completed" || lowered === "done") return "completed";
  if (lowered === "running" || lowered === "pending") return "running";
  if (lowered === "error" || lowered === "failed") return "error";
  return "unknown";
};

const safeString = (value: unknown) => (typeof value === "string" ? value : "");

const truncateText = (value: string, max = 600) => {
  const text = value.trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
};

const safeJsonPreview = (value: unknown, max = 900) => {
  if (value == null) return "";
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return truncateText(text, max);
  } catch {
    return "";
  }
};

const toolErrorText = (part: ToolPartRecord) => {
  const state = (part.state ?? {}) as Record<string, unknown>;
  const title = safeString(state.title);
  const error = safeString(state.error);
  const detail = safeString(state.detail);
  return [title, error, detail].filter(Boolean).join("\n");
};

const isInvalidToolError = (part: ToolPartRecord) => {
  const haystack = toolErrorText(part).toLowerCase();
  if (!haystack) return false;
  return (
    haystack.includes("invalid tool") ||
    haystack.includes("model tried to call") ||
    haystack.includes("unavailable tool") ||
    haystack.includes("unknown tool") ||
    haystack.includes("tool not found")
  );
};

const pickTextPreviewFromParts = (parts: Part[]) => {
  const textParts = parts
    .filter((part) => part.type === "text")
    .map((part) => (part as any)?.text)
    .filter((value) => typeof value === "string" && value.trim());
  if (!textParts.length) return "";
  return truncateText(textParts.join("\n\n"), 700);
};

const extractToolCalls = (parts: Part[]): ToolMonitorToolCall[] => {
  const calls: ToolMonitorToolCall[] = [];
  for (const p of parts) {
    if (p.type !== "tool") continue;
    const part = p as ToolPartRecord;
    const id = typeof part.id === "string" ? part.id : "";
    const messageId = typeof part.messageID === "string" ? part.messageID : "";
    const tool = typeof part.tool === "string" ? part.tool.trim() : "tool";
    const state = (part.state ?? {}) as Record<string, unknown>;
    const status = normalizeToolStatus(state.status);
    const title = safeString(state.title) || tool;
    const subtitle = safeString(state.subtitle || state.summary || state.detail);
    const input = state.input;
    const outputPreview = safeString(state.output) ? truncateText(safeString(state.output), 1200) : "";
    const errorText = toolErrorText(part);
    calls.push({
      partId: id || "(unknown part)",
      messageId: messageId || "(unknown message)",
      tool,
      status,
      title: title.trim() || tool,
      subtitle: subtitle.trim() || undefined,
      input,
      outputPreview: outputPreview || undefined,
      errorText: errorText ? truncateText(errorText, 900) : undefined,
    });
  }
  return calls;
};

const buildFindings = (calls: ToolMonitorToolCall[]) => {
  const findings: ToolMonitorFinding[] = [];
  const invalidCalls = calls.filter((call) => call.status === "error" && (call.errorText ?? "").length > 0)
    .filter((call) => {
      const lowered = (call.errorText ?? "").toLowerCase();
      return (
        lowered.includes("invalid tool") ||
        lowered.includes("unknown tool") ||
        lowered.includes("tool not found") ||
        lowered.includes("unavailable tool")
      );
    });

  for (const call of invalidCalls) {
    findings.push({
      severity: "error",
      code: "invalid_tool_call",
      title: `Invalid tool call: ${call.tool}`,
      detail: truncateText(call.errorText ?? "", 800) || "Tool call failed.",
      relatedPartIds: [call.partId],
    });
  }

  const errorCalls = calls.filter((call) => call.status === "error").filter((call) => !invalidCalls.includes(call));
  if (errorCalls.length > 0) {
    findings.push({
      severity: "warn",
      code: "tool_errors_present",
      title: "Tool errors detected",
      detail: `${errorCalls.length} tool call(s) returned errors in this turn.`,
      relatedPartIds: errorCalls.map((c) => c.partId),
    });
  }

  if (invalidCalls.length > 0) {
    const idx = calls.findIndex((c) => invalidCalls.some((x) => x.partId === c.partId));
    const nextSuccess = idx >= 0 ? calls.slice(idx + 1).find((c) => c.status === "completed") : null;
    if (nextSuccess) {
      findings.push({
        severity: "info",
        code: "recovery_after_invalid_tool",
        title: "Recovered after invalid tool call",
        detail: `After an invalid tool call, the run continued and completed a subsequent tool call (${nextSuccess.tool}). Consider adding a guardrail to avoid the invalid tool earlier.`,
        relatedPartIds: [...invalidCalls.map((c) => c.partId), nextSuccess.partId],
      });
    }
  }

  return findings;
};

export function buildToolMonitorTurnReport(input: {
  sessionId: string;
  agent: string;
  messages: MessageWithParts[];
  assistantMessageId: string;
  userMessageId?: string;
  assistantParts: Part[];
  userParts?: Part[];
  createdAt?: number;
  developerMode?: boolean;
}): ToolMonitorTurnReport {
  const createdAt = typeof input.createdAt === "number" ? input.createdAt : Date.now();
  const tools = extractToolCalls(input.assistantParts);
  const invalidToolCallsCount = tools.filter((call) => call.status === "error")
    .filter((call) => {
      const lowered = (call.errorText ?? "").toLowerCase();
      return (
        lowered.includes("invalid tool") ||
        lowered.includes("unknown tool") ||
        lowered.includes("tool not found") ||
        lowered.includes("unavailable tool") ||
        lowered.includes("model tried to call")
      );
    }).length;

  const findings = buildFindings(tools);
  const report: ToolMonitorTurnReport = {
    schemaVersion: 1,
    createdAt,
    sessionId: input.sessionId,
    agent: input.agent,
    userMessageId: input.userMessageId,
    assistantMessageId: input.assistantMessageId,
    summary: {
      toolCalls: tools.length,
      toolErrors: tools.filter((call) => call.status === "error").length,
      invalidToolCalls: invalidToolCallsCount,
    },
    userTextPreview: input.userParts ? pickTextPreviewFromParts(input.userParts) : undefined,
    assistantTextPreview: pickTextPreviewFromParts(input.assistantParts) || undefined,
    tools,
    findings,
    markdown: "",
    ...(input.developerMode
      ? {
        debug: {
          analyzedParts: input.assistantParts.length,
          analyzedMessages: input.messages.length,
          sourceAssistantParts: input.assistantParts,
        },
      }
      : null),
  };

  report.markdown = renderToolMonitorMarkdown(report, { includeDebug: Boolean(input.developerMode) });
  return report;
}

export function selectLatestAssistantTurn(messages: MessageWithParts[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    const role = (msg.info as any)?.role;
    if (role !== "assistant") continue;
    const id = (msg.info as any)?.id;
    if (typeof id !== "string" || !id.trim()) continue;
    return { message: msg, index: i };
  }
  return null;
}

export function selectNearestUserMessage(messages: MessageWithParts[], beforeIndex: number) {
  for (let i = Math.min(beforeIndex - 1, messages.length - 1); i >= 0; i -= 1) {
    const msg = messages[i];
    const role = (msg.info as any)?.role;
    if (role !== "user") continue;
    const id = (msg.info as any)?.id;
    if (typeof id !== "string" || !id.trim()) continue;
    return { message: msg, index: i };
  }
  return null;
}

export function shouldAnalyzeForAgent(agent: string | null | undefined) {
  return (agent ?? "").trim().toLowerCase() === "document-writer";
}

export function detectInvalidToolParts(parts: Part[]) {
  const invalid: ToolPartRecord[] = [];
  for (const p of parts) {
    if (p.type !== "tool") continue;
    const part = p as ToolPartRecord;
    if (isInvalidToolError(part)) invalid.push(part);
  }
  return invalid;
}

export function getToolMonitorDebugSnapshot(report: ToolMonitorTurnReport) {
  return safeJsonPreview(report, 5000);
}

