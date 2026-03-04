import type { Part } from "@opencode-ai/sdk/v2/client";

export type ToolMonitorToolCall = {
  partId: string;
  messageId: string;
  tool: string;
  status: "completed" | "running" | "error" | "unknown";
  title: string;
  subtitle?: string;
  input?: unknown;
  outputPreview?: string;
  errorText?: string;
};

export type ToolMonitorFindingSeverity = "info" | "warn" | "error";

export type ToolMonitorFinding = {
  severity: ToolMonitorFindingSeverity;
  code: string;
  title: string;
  detail: string;
  relatedPartIds?: string[];
};

export type ToolMonitorTurnReport = {
  schemaVersion: 1;
  createdAt: number;
  sessionId: string;
  agent: string;
  userMessageId?: string;
  assistantMessageId: string;
  summary: {
    toolCalls: number;
    toolErrors: number;
    invalidToolCalls: number;
  };
  userTextPreview?: string;
  assistantTextPreview?: string;
  tools: ToolMonitorToolCall[];
  findings: ToolMonitorFinding[];
  markdown: string;
  persisted?: {
    path: string;
    status: "pending" | "ok" | "error";
    error?: string;
  };
  debug?: {
    analyzedParts: number;
    analyzedMessages: number;
    sourceAssistantParts?: Part[];
  };
};
