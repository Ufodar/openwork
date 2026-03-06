import type { MessageWithParts } from "../../types";
import type { ToolMonitorPatchSuggestion, ToolMonitorRetrospective, ToolMonitorToolCall } from "./types";
import { buildWorkspaceUrl } from "./persist";

type ReflectionCallResult = {
  retrospective: ToolMonitorRetrospective;
  source: "model" | "fallback";
  error?: string;
  rawText?: string;
};

const truncateText = (value: string, max = 320) => {
  const text = value.trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 3))}...` : text;
};

const normalizeStringList = (value: unknown, fallback: string[], maxItems = 8, maxLen = 280) => {
  if (!Array.isArray(value)) return fallback;
  const next: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const normalized = truncateText(item, maxLen);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(normalized);
    if (next.length >= maxItems) break;
  }
  return next.length ? next : fallback;
};

const normalizeErrors = (value: unknown, fallback: ToolMonitorRetrospective["errorsEncountered"]) => {
  if (!Array.isArray(value)) return fallback;
  const next: ToolMonitorRetrospective["errorsEncountered"] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const tool = truncateText(typeof (item as any).tool === "string" ? (item as any).tool : "", 120);
    const message = truncateText(typeof (item as any).message === "string" ? (item as any).message : "", 260);
    const avoidNextTime = truncateText(typeof (item as any).avoidNextTime === "string" ? (item as any).avoidNextTime : "", 260);
    if (!tool || !message || !avoidNextTime) continue;
    const key = `${tool.toLowerCase()}|${message.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ tool, message, avoidNextTime });
    if (next.length >= 8) break;
  }
  return next.length ? next : fallback;
};

const normalizePatchSuggestions = (value: unknown, fallback: ToolMonitorPatchSuggestion[]): ToolMonitorPatchSuggestion[] => {
  if (!Array.isArray(value)) return fallback;
  const next: ToolMonitorPatchSuggestion[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const target = truncateText(typeof (item as any).target === "string" ? (item as any).target : "", 200);
    const section = truncateText(typeof (item as any).section === "string" ? (item as any).section : "", 200);
    const rawAction = typeof (item as any).action === "string" ? (item as any).action.trim().toLowerCase() : "";
    const action: ToolMonitorPatchSuggestion["action"] =
      rawAction === "add" || rawAction === "modify" || rawAction === "remove" ? rawAction : "add";
    const suggestion = truncateText(typeof (item as any).suggestion === "string" ? (item as any).suggestion : "", 500);
    const evidence = truncateText(typeof (item as any).evidence === "string" ? (item as any).evidence : "", 400);
    if (!target || !suggestion) continue;
    const key = `${target.toLowerCase()}|${suggestion.toLowerCase().slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ target, section, action, suggestion, evidence });
    if (next.length >= 6) break;
  }
  return next.length ? next : fallback;
};

const parseJsonFromText = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const direct = (() => {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  })();
  if (direct && typeof direct === "object") return direct as Record<string, unknown>;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? "";
  if (fenced) {
    try {
      const parsed = JSON.parse(fenced);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // no-op
    }
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    const candidate = trimmed.slice(first, last + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
    } catch {
      // no-op
    }
  }
  return null;
};

const buildMessagesContext = (messages: MessageWithParts[], _focusAssistantMessageId: string) => {
  return messages.map((message) => {
    const info = (message.info ?? {}) as Record<string, unknown>;
    const role = typeof info.role === "string" ? info.role : "unknown";
    const id = typeof info.id === "string" ? info.id : "";
    const text = (message.parts ?? [])
      .filter((part) => part.type === "text")
      .map((part) => {
        const value = (part as any)?.text;
        return typeof value === "string" ? value : "";
      })
      .filter(Boolean)
      .join("\n\n");
    const tools = (message.parts ?? [])
      .filter((part) => part.type === "tool")
      .map((part) => {
        const tool = typeof (part as any)?.tool === "string" ? (part as any).tool : "tool";
        const status = typeof (part as any)?.state?.status === "string" ? (part as any).state.status : "unknown";
        const title = typeof (part as any)?.state?.title === "string" ? (part as any).state.title : "";
        return { tool: truncateText(tool, 100), status: truncateText(status, 24), title: truncateText(title, 140) };
      });

    return {
      id,
      role,
      text: truncateText(text, 650),
      tools,
    };
  });
};

const buildToolContext = (tools: ToolMonitorToolCall[]) =>
  tools.map((call) => ({
    tool: truncateText(call.tool, 100),
    status: call.status,
    title: truncateText(call.title, 180),
    subtitle: truncateText(call.subtitle ?? "", 200),
    errorText: truncateText(call.errorText ?? "", 240),
  }));

const buildReflectionPrompt = (input: {
  sessionId: string;
  agent: string;
  assistantMessageId: string;
  trigger: ToolMonitorRetrospective["trigger"];
  messages: MessageWithParts[];
  tools: ToolMonitorToolCall[];
}) => {
  const context = {
    sessionId: input.sessionId,
    agent: input.agent,
    assistantMessageId: input.assistantMessageId,
    trigger: input.trigger,
    recentConversation: buildMessagesContext(input.messages, input.assistantMessageId),
    latestTurnTools: buildToolContext(input.tools),
  };

  return [
    "You are a strict execution reviewer for an AI coding agent.",
    "Analyze the provided session context and identify where the agent made mistakes, drifted, or took unnecessary detours.",
    "Return JSON only (no markdown, no explanation) using this exact schema:",
    '{\"errorsEncountered\":[{\"tool\":\"string\",\"message\":\"string\",\"avoidNextTime\":\"string\"}],\"preventionChecklist\":[\"string\"],\"lessonsLearned\":[\"string\"],\"applicableScenarios\":[\"string\"],\"shortestPath\":[\"string\"],\"patchSuggestions\":[{\"target\":\"string\",\"section\":\"string\",\"action\":\"add|modify|remove\",\"suggestion\":\"string\",\"evidence\":\"string\"}]}',
    "Rules:",
    "- Base your analysis only on the provided context.",
    "- Mention concrete mistakes and how to avoid them.",
    "- shortestPath must be the minimum viable step sequence to reach the same outcome, max 5 steps.",
    "- patchSuggestions: propose specific changes to agent instructions or skill files. target is a file path (e.g., '.opencode/agent/document-writer.md' or '.opencode/skills/docx/SKILL.md'). section is the section name to modify. action is add/modify/remove. suggestion is the concrete text to add or change. evidence is the tool call or error that justifies this change. Max 4 suggestions, only for clear improvements.",
    "- If there are no clear errors, still provide lessons, shortestPath, and patchSuggestions.",
    "Context JSON:",
    JSON.stringify(context, null, 2),
  ].join("\n");
};

const parseErrorMessage = async (response: Response) => {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text.trim()) return fallback;
    return text.length > 900 ? `${text.slice(0, 897)}...` : text;
  } catch {
    return fallback;
  }
};

const buildServerUrl = (baseUrl: string, pathname: string, query?: URLSearchParams) => {
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  parsed.pathname = `${basePath}${normalizedPath}`.replace(/\/{2,}/g, "/");
  parsed.search = query ? query.toString() : "";
  return parsed.toString();
};

const requestJson = async <T>(url: string, token: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.body) headers.set("Content-Type", "application/json");
  if (token.trim()) headers.set("Authorization", `Bearer ${token.trim()}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    throw new Error(await parseErrorMessage(response));
  }
  const text = await response.text();
  if (!text.trim()) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error("Invalid JSON response.");
  }
};

const getLatestAssistantText = (messages: unknown[]) => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as any;
    const role = message?.info?.role;
    if (role !== "assistant") continue;
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const text = parts
      .filter((part: any) => part?.type === "text" && typeof part?.text === "string")
      .map((part: any) => part.text as string)
      .join("\n\n")
      .trim();
    if (!text) continue;
    const completed = message?.info?.time?.completed;
    return { text, completed: typeof completed === "number" && Number.isFinite(completed) };
  }
  return null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const waitForReflectionText = async (input: {
  baseUrl: string;
  token: string;
  workspaceId: string;
  reflectionSessionId: string;
  timeoutMs: number;
  pollIntervalMs: number;
}) => {
  const url = buildWorkspaceUrl(
    input.baseUrl,
    input.workspaceId,
    `/opencode/session/${encodeURIComponent(input.reflectionSessionId)}/message`,
    new URLSearchParams({ limit: "50" }),
  );
  const deadline = Date.now() + input.timeoutMs;
  let partialText = "";
  while (Date.now() < deadline) {
    const data = await requestJson<unknown>(url, input.token);
    const messages = Array.isArray(data) ? data : Array.isArray((data as any)?.items) ? (data as any).items : [];
    const latest = getLatestAssistantText(messages);
    if (latest?.text) {
      partialText = latest.text;
      if (latest.completed) return { ok: true as const, text: latest.text };
    }
    await sleep(input.pollIntervalMs);
  }
  if (partialText) return { ok: true as const, text: partialText };
  return { ok: false as const, error: "Timed out waiting for reflection response." };
};

const mergeWithFallback = (
  fallback: ToolMonitorRetrospective,
  parsed: Record<string, unknown> | null,
): ToolMonitorRetrospective => {
  if (!parsed) return fallback;
  return {
    trigger: fallback.trigger,
    errorsEncountered: normalizeErrors(parsed.errorsEncountered, fallback.errorsEncountered),
    preventionChecklist: normalizeStringList(parsed.preventionChecklist, fallback.preventionChecklist),
    lessonsLearned: normalizeStringList(parsed.lessonsLearned, fallback.lessonsLearned),
    applicableScenarios: normalizeStringList(parsed.applicableScenarios, fallback.applicableScenarios),
    shortestPath: normalizeStringList(parsed.shortestPath, fallback.shortestPath, 5, 240),
    patchSuggestions: normalizePatchSuggestions(parsed.patchSuggestions, fallback.patchSuggestions),
  };
};

export async function requestToolMonitorModelRetrospective(input: {
  baseUrl: string;
  token: string;
  workspaceId: string;
  sessionId: string;
  assistantMessageId: string;
  agent: string;
  messages: MessageWithParts[];
  tools: ToolMonitorToolCall[];
  fallback: ToolMonitorRetrospective;
  timeoutMs?: number;
  pollIntervalMs?: number;
}): Promise<ReflectionCallResult> {
  const prompt = buildReflectionPrompt({
    sessionId: input.sessionId,
    agent: input.agent,
    assistantMessageId: input.assistantMessageId,
    trigger: input.fallback.trigger,
    messages: input.messages,
    tools: input.tools,
  });

  const createUrl = buildWorkspaceUrl(input.baseUrl, input.workspaceId, "/opencode/session");
  const timeoutMs =
    Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0 ? (input.timeoutMs as number) : 28_000;
  const pollIntervalMs =
    Number.isFinite(input.pollIntervalMs) && (input.pollIntervalMs ?? 0) > 0
      ? (input.pollIntervalMs as number)
      : 1_200;

  let reflectionSessionId = "";
  try {
    const created = await requestJson<{ id?: string }>(createUrl, input.token, {
      method: "POST",
      body: JSON.stringify({ title: "Tool Monitor Reflection (temp)" }),
    });
    reflectionSessionId = typeof created?.id === "string" ? created.id.trim() : "";
    if (!reflectionSessionId) {
      return { retrospective: input.fallback, source: "fallback", error: "Reflection session was not created." };
    }

    const promptUrl = buildWorkspaceUrl(
      input.baseUrl,
      input.workspaceId,
      `/opencode/session/${encodeURIComponent(reflectionSessionId)}/prompt_async`,
    );
    await requestJson<unknown>(promptUrl, input.token, {
      method: "POST",
      body: JSON.stringify({ parts: [{ type: "text", text: prompt }] }),
    });

    const reflection = await waitForReflectionText({
      baseUrl: input.baseUrl,
      token: input.token,
      workspaceId: input.workspaceId,
      reflectionSessionId,
      timeoutMs,
      pollIntervalMs,
    });
    if (!reflection.ok) {
      return { retrospective: input.fallback, source: "fallback", error: reflection.error };
    }

    const parsed = parseJsonFromText(reflection.text);
    const merged = mergeWithFallback(input.fallback, parsed);
    return { retrospective: merged, source: "model", rawText: reflection.text };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Model reflection failed.";
    return { retrospective: input.fallback, source: "fallback", error: message };
  } finally {
    if (reflectionSessionId) {
      const cleanupUrl = buildServerUrl(
        input.baseUrl,
        `/workspace/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(reflectionSessionId)}`,
      );
      try {
        await requestJson<unknown>(cleanupUrl, input.token, { method: "DELETE" });
      } catch {
        // no-op
      }
    }
  }
}
