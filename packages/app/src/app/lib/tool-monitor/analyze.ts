import type { MessageWithParts } from "../../types";
import type { Part } from "@opencode-ai/sdk/v2/client";

import type {
  ToolMonitorFinding,
  ToolMonitorPatchSuggestion,
  ToolMonitorRetrospective,
  ToolMonitorToolCall,
  ToolMonitorTurnReport,
} from "./types";
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

const uniqueTrimmed = (items: string[], max = 8) => {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(value);
    if (next.length >= max) break;
  }
  return next;
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

const classifyErrorKind = (message: string) => {
  const lowered = message.toLowerCase();
  if (
    lowered.includes("invalid tool") ||
    lowered.includes("unknown tool") ||
    lowered.includes("tool not found") ||
    lowered.includes("unavailable tool")
  ) {
    return "invalid_tool";
  }
  if (
    lowered.includes("permission") ||
    lowered.includes("forbidden") ||
    lowered.includes("denied") ||
    lowered.includes("not allowed")
  ) {
    return "permission";
  }
  if (lowered.includes("timeout") || lowered.includes("timed out")) return "timeout";
  if (lowered.includes("rate limit") || lowered.includes("429")) return "rate_limit";
  if (lowered.includes("invalid json") || lowered.includes("schema") || lowered.includes("parse")) return "payload";
  return "generic";
};

const avoidanceTipForError = (message: string) => {
  const kind = classifyErrorKind(message);
  if (kind === "invalid_tool") {
    return "Validate available tools before the first call and keep a strict allow-list for tool names.";
  }
  if (kind === "permission") {
    return "Pre-check required permissions and fail fast with a clear permission request before execution.";
  }
  if (kind === "timeout") {
    return "Split the task into smaller calls and add a lightweight preflight call before heavy operations.";
  }
  if (kind === "rate_limit") {
    return "Throttle repeated calls and add retry with backoff instead of immediate retries.";
  }
  if (kind === "payload") {
    return "Validate input shape locally before dispatching the tool call.";
  }
  return "Use a short preflight call to validate assumptions before committing to a long tool sequence.";
};

const inferScenarioFromTool = (tool: string): string | null => {
  const lowered = tool.toLowerCase();
  if (
    lowered.includes("read") ||
    lowered.includes("find") ||
    lowered.includes("search") ||
    lowered.includes("list") ||
    lowered.includes("glob")
  ) {
    return "Discovery-heavy tasks where quick context gathering is required.";
  }
  if (
    lowered.includes("write") ||
    lowered.includes("edit") ||
    lowered.includes("patch") ||
    lowered.includes("create") ||
    lowered.includes("replace")
  ) {
    return "Document or code change tasks that need controlled edits.";
  }
  if (
    lowered.includes("test") ||
    lowered.includes("lint") ||
    lowered.includes("build") ||
    lowered.includes("typecheck")
  ) {
    return "Verification-focused tasks before merge or release.";
  }
  if (lowered.includes("fetch") || lowered.includes("http") || lowered.includes("request")) {
    return "External integration checks and API verification flows.";
  }
  return null;
};

const buildShortestPath = (calls: ToolMonitorToolCall[]) => {
  const completed = calls.filter((call) => call.status === "completed");
  const fallback = calls.filter((call) => call.status !== "error");
  const source = (completed.length ? completed : fallback).filter((call) => call.tool.trim());

  const compact: ToolMonitorToolCall[] = [];
  for (const call of source) {
    if (compact[compact.length - 1]?.tool === call.tool) continue;
    compact.push(call);
    if (compact.length >= 4) break;
  }

  if (!compact.length) {
    return [
      "Define output + acceptance criteria before any tool call.",
      "Run one targeted call that directly advances the output.",
      "Validate immediately and stop when acceptance criteria are met.",
    ];
  }

  return compact.map((call, index) => {
    const note = call.title && call.title !== call.tool ? ` (${truncateText(call.title, 96)})` : "";
    if (index === 0) return `Start with ${call.tool}${note} to establish the minimum required context.`;
    if (index === compact.length - 1) return `Finish with ${call.tool}${note} to finalize and verify the outcome.`;
    return `Then run ${call.tool}${note} for the core execution step.`;
  });
};

const buildPatchSuggestions = (
  calls: ToolMonitorToolCall[],
  findings: ToolMonitorFinding[],
): ToolMonitorPatchSuggestion[] => {
  const suggestions: ToolMonitorPatchSuggestion[] = [];

  // Detect repeated bash failures with scripts (code generation reflex)
  const bashErrors = calls.filter(
    (c) => c.status === "error" && c.tool === "bash" && c.errorText,
  );
  const scriptCreationErrors = bashErrors.filter((c) => {
    const input = typeof c.input === "object" && c.input ? JSON.stringify(c.input) : "";
    return /python.*-c|node.*-e|\.py\b|\.js\b|\.sh\b/i.test(input);
  });
  if (scriptCreationErrors.length >= 2) {
    suggestions.push({
      target: ".opencode/agent/document-writer.md",
      section: "Core Principles / Principle #7",
      action: "modify",
      suggestion: `Agent generated scripts ${scriptCreationErrors.length} times and failed. Strengthen the no-script constraint with concrete error pattern: "${truncateText(scriptCreationErrors[0].errorText ?? "", 120)}"`,
      evidence: `${scriptCreationErrors.length} failed bash calls with script generation (parts: ${scriptCreationErrors.map((c) => c.partId).join(", ")})`,
    });
  }

  // Detect invalid tool calls — agent tried tools that don't exist
  const invalidFindings = findings.filter((f) => f.code === "invalid_tool_call");
  for (const finding of invalidFindings) {
    suggestions.push({
      target: ".opencode/agent/document-writer.md",
      section: "Available Skills",
      action: "add",
      suggestion: `Agent attempted non-existent tool. Add explicit note: "${finding.title}" is not available. Use the correct alternative.`,
      evidence: finding.detail,
    });
  }

  // Detect repeated failures on same operation (2-strike pattern)
  const errorsByTool = new Map<string, ToolMonitorToolCall[]>();
  for (const call of calls.filter((c) => c.status === "error")) {
    const existing = errorsByTool.get(call.tool) ?? [];
    existing.push(call);
    errorsByTool.set(call.tool, existing);
  }
  for (const [tool, errors] of errorsByTool) {
    if (errors.length >= 3) {
      suggestions.push({
        target: ".opencode/agent/document-writer.md",
        section: "Error Handling / 2-Strike Rule",
        action: "modify",
        suggestion: `Tool "${tool}" failed ${errors.length} times in one turn. The 2-strike rule may need reinforcement or the agent is not reading it. Consider adding a concrete example for this failure pattern.`,
        evidence: `${errors.length} failures: ${errors.map((e) => truncateText(e.errorText ?? "", 80)).join(" | ")}`,
      });
    }
  }

  // Detect docx-related errors that could improve the docx skill
  const docxErrors = bashErrors.filter((c) => {
    const combined = `${JSON.stringify(c.input ?? "")} ${c.errorText ?? ""}`.toLowerCase();
    return combined.includes("docx") || combined.includes("xml") || combined.includes("unpack") || combined.includes("pack");
  });
  if (docxErrors.length > 0) {
    const errorSummary = docxErrors.map((c) => truncateText(c.errorText ?? "", 100)).join(" | ");
    suggestions.push({
      target: ".opencode/skills/docx/SKILL.md",
      section: "Common Pitfalls",
      action: "add",
      suggestion: `New docx error pattern encountered. Consider adding pitfall entry: "${truncateText(errorSummary, 200)}"`,
      evidence: `${docxErrors.length} docx-related bash error(s) in this turn`,
    });
  }

  return suggestions.slice(0, 6);
};

const buildRetrospective = (
  calls: ToolMonitorToolCall[],
  findings: ToolMonitorFinding[],
  trigger: ToolMonitorRetrospective["trigger"],
): ToolMonitorRetrospective => {
  const errorCalls = calls.filter((call) => call.status === "error");
  const completedCalls = calls.filter((call) => call.status === "completed");

  const errorsEncountered = errorCalls.slice(0, 8).map((call) => {
    const message = truncateText(call.errorText || call.subtitle || call.title || "Tool call failed.", 240);
    return {
      tool: call.tool,
      message,
      avoidNextTime: avoidanceTipForError(message),
    };
  });

  const preventionChecklist = uniqueTrimmed(
    [
      ...errorsEncountered.map((item) => item.avoidNextTime),
      errorCalls.length > 0
        ? "Insert a short preflight check before the first irreversible tool call."
        : "Reuse this turn's successful tool order as the default path for similar tasks.",
    ],
    8,
  );

  const lessonCandidates: string[] = [];
  if (errorCalls.length > 0 && completedCalls.length > 0) {
    lessonCandidates.push("The run recovered after failures; fallback behavior is working and should be formalized.");
  }
  if (errorCalls.length > 0 && completedCalls.length === 0) {
    lessonCandidates.push("Errors blocked completion; preflight validation should happen before execution.");
  }
  if (errorCalls.length === 0 && completedCalls.length > 0) {
    lessonCandidates.push("This turn stayed stable end-to-end and is a good candidate for a reusable template.");
  }
  if (findings.some((item) => item.code === "invalid_tool_call")) {
    lessonCandidates.push("Tool-name validation needs to happen earlier to avoid avoidable detours.");
  }

  const applicableScenarios = uniqueTrimmed(
    [
      ...calls.map((call) => inferScenarioFromTool(call.tool) ?? ""),
      errorCalls.length > 0 ? "Troubleshooting tasks where recovery after a failed step matters." : "",
    ],
    8,
  );

  return {
    trigger,
    errorsEncountered,
    preventionChecklist,
    lessonsLearned: uniqueTrimmed(
      lessonCandidates.length
        ? lessonCandidates
        : ["Keep goals narrow and use the minimum viable tool sequence to avoid drift."],
      8,
    ),
    applicableScenarios: applicableScenarios.length
      ? applicableScenarios
      : ["General tool-assisted execution where concise, low-detour workflows are preferred."],
    shortestPath: buildShortestPath(calls),
    patchSuggestions: buildPatchSuggestions(calls, findings),
  };
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
  trigger?: ToolMonitorRetrospective["trigger"];
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
  const trigger = input.trigger === "manual_excellent" ? "manual_excellent" : "auto";
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
    retrospective: buildRetrospective(tools, findings, trigger),
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
