import { ErrorBoundary, For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { JSX } from "solid-js";
import type { Part } from "@opencode-ai/sdk/v2/client";
import { Check, ChevronDown, ChevronRight, Copy, Eye, File, FileEdit, FolderSearch, Pencil, Search, Sparkles, Terminal } from "lucide-solid";

import type { MessageGroup, MessageInfo, MessageWithParts } from "../../types";
import { groupMessageParts, summarizeStep } from "../../utils";
import PartView from "../part-view";
import { preserveScrollPositionOnToggle } from "../../lib/chat-scroll";
import { perfNow, recordPerfLog } from "../../lib/perf-log";
import { isToolPartActive, resolveToolPartDisplayStatus } from "../../lib/tool-part-status";
import { currentLocale, t } from "../../../i18n";

export type MessageListProps = {
  messages: MessageWithParts[];
  isStreaming?: boolean;
  sessionStatus?: string;
  developerMode: boolean;
  showThinking: boolean;
  expandedStepIds: Set<string>;
  setExpandedStepIds: (updater: (current: Set<string>) => Set<string>) => void;
  openSessionById?: (sessionId: string) => void;
  searchMatchMessageIds?: ReadonlySet<string>;
  activeSearchMessageId?: string | null;
  searchHighlightQuery?: string;
  workspaceRoot?: string;
  footer?: JSX.Element;
  compact?: boolean;
  scrollContainer?: () => HTMLElement | undefined;
};

type StepClusterBlock = {
  kind: "steps-cluster";
  id: string;
  stepIds: string[];
  partsGroups: Part[][];
  messageIds: string[];
  isUser: boolean;
};

type MessageBlock = {
  kind: "message";
  message: MessageWithParts;
  renderableParts: Part[];
  groups: MessageGroup[];
  isUser: boolean;
  messageId: string;
};

type MessageBlockItem = MessageBlock | StepClusterBlock;

/** Icon for a given tool category */
function ToolIcon(props: { category: string; size?: number }) {
  const s = () => props.size ?? 12;
  switch (props.category) {
    case "read":
      return <Eye size={s()} />;
    case "edit":
      return <Pencil size={s()} />;
    case "write":
      return <FileEdit size={s()} />;
    case "search":
      return <Search size={s()} />;
    case "terminal":
      return <Terminal size={s()} />;
    case "glob":
      return <FolderSearch size={s()} />;
    case "task":
      return <Sparkles size={s()} />;
    case "skill":
      return <Sparkles size={s()} />;
    default:
      return <File size={s()} />;
  }
}

/** Status dot color */
function statusDotClass(status?: string): string {
  switch (status) {
    case "completed":
    case "done":
      return "bg-green-9";
    case "running":
    case "pending":
      return "session-running-dot";
    case "stale":
      return "bg-amber-8 shadow-[0_0_0_1px_rgba(245,158,11,0.16)]";
    case "error":
      return "bg-red-9";
    default:
      return "bg-gray-8";
  }
}

function latestStepPart(partsGroups: Part[][]): Part | undefined {
  for (let groupIndex = partsGroups.length - 1; groupIndex >= 0; groupIndex -= 1) {
    const parts = partsGroups[groupIndex] ?? [];
    for (let partIndex = parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = parts[partIndex];
      if (part.type === "tool" || part.type === "reasoning") {
        return part;
      }
    }
  }
  return undefined;
}

type TaskStepInfo = {
  isTask: boolean;
  agentType?: string;
  sessionId?: string;
};

function formatAgentType(agentType: string): string {
  const clean = agentType.trim().replace(/[_-]+/g, " ");
  if (!clean) return "";
  return clean
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function getTaskStepInfo(part: Part): TaskStepInfo {
  if (part.type !== "tool") return { isTask: false };

  const record = part as any;
  const tool = typeof record.tool === "string" ? record.tool.toLowerCase() : "";
  if (tool !== "task") return { isTask: false };

  const state = record.state ?? {};
  const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : {};
  const metadata = state.metadata && typeof state.metadata === "object" ? (state.metadata as Record<string, unknown>) : {};

  const rawAgentType = typeof input.subagent_type === "string" ? input.subagent_type.trim() : "";
  const agentType = rawAgentType ? formatAgentType(rawAgentType) : undefined;
  const rawSessionId =
    metadata.sessionId ??
    metadata.sessionID ??
    state.sessionId ??
    state.sessionID;
  const sessionId = typeof rawSessionId === "string" && rawSessionId.trim() ? rawSessionId.trim() : undefined;

  return { isTask: true, agentType, sessionId };
}

export default function MessageList(props: MessageListProps) {
  const tr = (key: string) => t(key, currentLocale());
  const format = (key: string, vars?: Record<string, string | number>) => {
    let text = tr(key);
    if (!vars) return text;
    for (const [name, value] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${name}\\}`, "g"), String(value));
    }
    return text;
  };
  const localizeStepText = (raw: string) => {
    const text = raw.trim();
    if (!text) return text;
    const compactPathToken = (value: string) => {
      const token = value
        .trim()
        .replace(/^[`'"([{]+|[`'"\])},.;:]+$/g, "");
      const segments = token.split(/[\\/]/).filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : token;
    };

    const thinking = text.match(/^Thinking:\s*(.+)$/i);
    if (thinking) return `${tr("session.thinking")}: ${thinking[1]}`;

    const patterns: Array<{ pattern: RegExp; render: (value: string) => string }> = [
      { pattern: /^Read (.+)$/i, render: (value) => format("session.tool_read_file", { target: value }) },
      { pattern: /^Edit (.+)$/i, render: (value) => format("session.tool_edit_file", { target: value }) },
      { pattern: /^(?:Write|Update) (.+)$/i, render: (value) => format("session.tool_update_file", { target: value }) },
      { pattern: /^List (.+)$/i, render: (value) => format("session.tool_list_target", { target: value }) },
      { pattern: /^Search (.+)$/i, render: (value) => format("session.tool_search_target", { target: value }) },
      { pattern: /^Fetch (.+)$/i, render: (value) => format("session.tool_fetch_target", { target: value }) },
      { pattern: /^Load skill (.+)$/i, render: (value) => format("session.tool_load_skill_target", { target: value }) },
      { pattern: /^Delegate (.+)$/i, render: (value) => format("session.tool_delegate_target", { target: value }) },
      { pattern: /^Run (.+)$/i, render: (value) => format("session.tool_run_command_target", { target: value }) },
      {
        pattern: /^filesystem\s+read(?:\s+text)?\s+file(?:\s+(.+))?$/i,
        render: (value) =>
          value ? format("session.tool_read_file", { target: compactPathToken(value) }) : tr("session.tool_read_file_generic"),
      },
      {
        pattern: /^filesystem\s+write\s+file(?:\s+(.+))?$/i,
        render: (value) =>
          value
            ? format("session.tool_update_file", { target: compactPathToken(value) })
            : tr("session.tool_write_file_generic"),
      },
      {
        pattern: /^filesystem\s+list\s+directory(?:\s+(.+))?$/i,
        render: (value) =>
          value ? format("session.tool_list_target", { target: compactPathToken(value) }) : tr("session.tool_list_files"),
      },
      {
        pattern: /^filesystem\s+get\s+file\s+info(?:\s+(.+))?$/i,
        render: (value) =>
          value ? format("session.tool_read_file", { target: compactPathToken(value) }) : tr("session.tool_file_info"),
      },
    ];

    for (const entry of patterns) {
      const match = text.match(entry.pattern);
      if (match) return entry.render((match[1] ?? "").trim());
    }

    const exact = new Map<string, string>([
      ["Read file", tr("session.tool_read_file_generic")],
      ["Edit file", tr("session.tool_edit_file_generic")],
      ["Write file", tr("session.tool_write_file_generic")],
      ["Update file", tr("session.tool_update_file_generic")],
      ["List files", tr("session.tool_list_files")],
      ["Search code", tr("session.tool_search_code")],
      ["Fetch web page", tr("session.tool_fetch_web")],
      ["Run command", tr("session.tool_run_command")],
      ["Task", tr("session.tool_task")],
      ["Load skill", tr("session.tool_load_skill")],
      ["Compact session context", tr("session.status_compacting_context")],
    ]);
    const direct = exact.get(text);
    if (direct) return direct;

    const normalizedLower = text.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
    const lowerExact = new Map<string, string>([
      ["filesystem list directory", tr("session.tool_list_files")],
      ["filesystem read text file", tr("session.tool_read_file_generic")],
      ["filesystem write file", tr("session.tool_write_file_generic")],
      ["filesystem get file info", tr("session.tool_file_info")],
    ]);
    return lowerExact.get(normalizedLower) ?? text;
  };
  const messageInfoById = createMemo(() => {
    const map = new Map<string, MessageInfo>();
    for (const message of props.messages) {
      const id = String((message.info as any)?.id ?? "");
      if (!id) continue;
      map.set(id, message.info);
    }
    return map;
  });
  const [copyingId, setCopyingId] = createSignal<string | null>(null);
  let previousMessagePartCountById = new Map<string, number>();
  let autoExpandedStepIds = new Set<string>();
  let copyTimeout: number | undefined;
  const isAttachmentPart = (part: Part) => {
    if (part.type !== "file") return false;
    const url = (part as { url?: string }).url;
    return typeof url === "string" && !url.startsWith("file://");
  };
  const attachmentsForMessage = (message: MessageWithParts) =>
    message.parts
      .filter(isAttachmentPart)
      .map((part) => {
        const record = part as { url?: string; filename?: string; mime?: string };
        return {
          url: record.url ?? "",
          filename: record.filename ?? "attachment",
          mime: record.mime ?? "application/octet-stream",
        };
      })
      .filter((attachment) => !!attachment.url);
  const isImageAttachment = (mime: string) => mime.startsWith("image/");
  onCleanup(() => {
    if (copyTimeout !== undefined) {
      window.clearTimeout(copyTimeout);
    }
  });

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyingId(id);
      if (copyTimeout !== undefined) {
        window.clearTimeout(copyTimeout);
      }
      copyTimeout = window.setTimeout(() => {
        setCopyingId(null);
        copyTimeout = undefined;
      }, 2000);
    } catch {
      // ignore
    }
  };

  const partToText = (part: Part) => {
    if (part.type === "text") {
      return String((part as { text?: string }).text ?? "");
    }
    if (part.type === "agent") {
      const name = (part as { name?: string }).name ?? "";
      return name ? `@${name}` : "@agent";
    }
    if (part.type === "file") {
      const record = part as { label?: string; path?: string; filename?: string };
      const label = record.label ?? record.path ?? record.filename ?? "";
      return label ? `@${label}` : "@file";
    }
    return "";
  };

  const toggleSteps = (id: string, relatedIds: string[] = []) => {
    preserveScrollPositionOnToggle(props.scrollContainer?.(), () => {
      props.setExpandedStepIds((current) => {
        const next = new Set(current);
        const isExpanded = next.has(id) || relatedIds.some((relatedId) => next.has(relatedId));
        if (isExpanded) {
          next.delete(id);
          relatedIds.forEach((relatedId) => next.delete(relatedId));
        } else {
          next.add(id);
          relatedIds.forEach((relatedId) => next.add(relatedId));
        }
        return next;
      });
    });
  };

  const isStepsExpanded = (id: string, relatedIds: string[] = []) =>
    props.expandedStepIds.has(id) ||
    relatedIds.some((relatedId) => props.expandedStepIds.has(relatedId));

  const renderablePartsForMessage = (message: MessageWithParts) =>
    message.parts.filter((part) => {
      if (part.type === "reasoning") {
        return props.showThinking;
      }

      if (part.type === "step-start") {
        return false;
      }

      // step-finish carries per-step token/cost data — always show
      if (part.type === "step-finish") {
        return true;
      }

      if (part.type === "text" || part.type === "tool" || part.type === "agent" || part.type === "file") {
        return true;
      }

      return props.developerMode;
    });

  const messageBlocks = createMemo<MessageBlockItem[]>(() => {
    const startedAt = perfNow();
    const blocks: MessageBlockItem[] = [];
    const nextMessagePartCountById = new Map<string, number>();
    let changedMessageCount = 0;
    let addedMessageCount = 0;
    let toolPartCount = 0;
    let stepGroupCount = 0;

    props.messages.forEach((message, index) => {
      const renderableParts = renderablePartsForMessage(message);
      if (!renderableParts.length) return;

      const messageId = String((message.info as any).id ?? "");
      const idKey = messageId || `idx:${index}`;
      const totalParts = message.parts.length;
      nextMessagePartCountById.set(idKey, totalParts);
      const previousPartCount = previousMessagePartCountById.get(idKey);
      if (previousPartCount === undefined) {
        addedMessageCount += 1;
      } else if (previousPartCount !== totalParts) {
        changedMessageCount += 1;
      }

      toolPartCount += renderableParts.reduce((count, part) => (part.type === "tool" ? count + 1 : count), 0);
      const groupId = String((message.info as any).id ?? "message");
      const groups = groupMessageParts(renderableParts, groupId);
      const isUser = (message.info as any).role === "user";
      const isStepsOnly = groups.length > 0 && groups.every((group) => group.kind === "steps");
      const stepGroups = isStepsOnly ? (groups as { kind: "steps"; id: string; parts: Part[]; segment: "execution" }[]) : [];
      stepGroupCount += groups.reduce((count, group) => (group.kind === "steps" ? count + 1 : count), 0);

      if (isStepsOnly) {
        const nextCluster: StepClusterBlock = {
          kind: "steps-cluster",
          id: stepGroups[0].id,
          stepIds: stepGroups.map((group) => group.id),
          partsGroups: stepGroups.map((group) => group.parts),
          messageIds: [messageId],
          isUser,
        };
        const previous = blocks[blocks.length - 1];
        if (previous?.kind === "steps-cluster" && previous.isUser === nextCluster.isUser) {
          previous.stepIds = [...previous.stepIds, ...nextCluster.stepIds];
          previous.partsGroups = [...previous.partsGroups, ...nextCluster.partsGroups];
          previous.messageIds = [...previous.messageIds, ...nextCluster.messageIds];
        } else {
          blocks.push(nextCluster);
        }
        return;
      }

      blocks.push({
        kind: "message",
        message,
        renderableParts,
        groups,
        isUser,
        messageId,
      });
    });

    let removedMessageCount = 0;
    previousMessagePartCountById.forEach((_partCount, id) => {
      if (!nextMessagePartCountById.has(id)) {
        removedMessageCount += 1;
      }
    });
    previousMessagePartCountById = nextMessagePartCountById;

    const elapsedMs = Math.round((perfNow() - startedAt) * 100) / 100;
    if (
      props.developerMode &&
      (
        elapsedMs >= 6 ||
        (Boolean(props.isStreaming) && props.messages.length >= 16 && changedMessageCount <= 2 && addedMessageCount <= 1 && removedMessageCount === 0) ||
        (Boolean(props.isStreaming) && toolPartCount >= 10)
      )
    ) {
      recordPerfLog(true, "session.render", "message-blocks", {
        messageCount: props.messages.length,
        blockCount: blocks.length,
        changedMessageCount,
        addedMessageCount,
        removedMessageCount,
        toolPartCount,
        stepGroupCount,
        streaming: Boolean(props.isStreaming),
        ms: elapsedMs,
      });
    }

    return blocks;
  });

  createEffect(() => {
    if (props.developerMode) return;
    const blocks = messageBlocks();
    const toExpand: string[] = [];
    for (const block of blocks) {
      if (block.kind !== "steps-cluster") continue;
      const ids = [block.id, ...block.stepIds];
      for (const id of ids) {
        if (!id || autoExpandedStepIds.has(id)) continue;
        autoExpandedStepIds.add(id);
        toExpand.push(id);
      }
    }
    if (!toExpand.length) return;
    props.setExpandedStepIds((current) => {
      const next = new Set(current);
      toExpand.forEach((id) => next.add(id));
      return next;
    });
  });

  const latestAssistantMessageId = createMemo(() => {
    for (let index = props.messages.length - 1; index >= 0; index -= 1) {
      const message = props.messages[index];
      if ((message.info as any).role === "assistant") {
        return String((message.info as any).id ?? "");
      }
    }
    return "";
  });

  const shouldUseContentVisibility = createMemo(() => messageBlocks().length > 80);
  const blockPerfStyle = (index: number): JSX.CSSProperties | undefined => {
    if (!shouldUseContentVisibility()) return undefined;
    const total = messageBlocks().length;
    if (index >= total - 24) return undefined;
    return {
      "content-visibility": "auto",
      "contain-intrinsic-size": "220px",
    };
  };

  /** Compact single-line step row */
  const StepRow = (rowProps: { part: Part; isUser: boolean }) => {
    const summary = createMemo(() => summarizeStep(rowProps.part));
    const category = createMemo(() => summary().toolCategory ?? "tool");
    const messageInfo = createMemo(() => {
      const messageId = typeof (rowProps.part as any)?.messageID === "string" ? String((rowProps.part as any).messageID) : "";
      return messageInfoById().get(messageId) ?? null;
    });
    const status = createMemo(() =>
      rowProps.part.type === "tool"
        ? resolveToolPartDisplayStatus(rowProps.part, {
            sessionStatus: props.sessionStatus,
            messageInfo: messageInfo(),
          })
        : summary().status,
    );
    const task = createMemo(() => getTaskStepInfo(rowProps.part));
    const localizedTitle = createMemo(() => {
      const base = localizeStepText(summary().title);
      if (rowProps.part.type === "tool" && status() === "stale") {
        return `${base} · ${tr("session.tool_status_interrupted")}`;
      }
      return base;
    });
    const localizedDetail = createMemo(() => localizeStepText(summary().detail ?? ""));

    if (rowProps.part.type === "reasoning") {
      return (
        <div class="py-2">
          <div class="rounded-2xl border border-gray-6/60 bg-gray-2/40 px-3 py-2.5">
            <div class="text-[12px] font-medium text-gray-12">{localizedTitle()}</div>
            <Show when={localizedDetail()}>
              {(detail) => (
                <p class="mt-1 text-[12px] leading-relaxed text-gray-10 whitespace-pre-wrap break-words">
                  {detail()}
                </p>
              )}
            </Show>
          </div>
        </div>
      );
    }

    // step-finish: show per-step token/cost summary
    if (rowProps.part.type === "step-finish") {
      const finishPart = rowProps.part as any;
      const tokens = finishPart.tokens ?? {};
      const cost = typeof finishPart.cost === "number" ? finishPart.cost : 0;
      const reason = typeof finishPart.reason === "string" ? finishPart.reason : "";
      const totalTokens = (tokens.input ?? 0) + (tokens.output ?? 0) + (tokens.reasoning ?? 0);
      const cacheRead = tokens.cache?.read ?? 0;
      const cacheWrite = tokens.cache?.write ?? 0;
      const costLabel = cost > 0
        ? cost < 0.01
          ? `${(cost * 100).toFixed(2)}¢`
          : `$${cost.toFixed(4)}`
        : "";

      // Only render if there is any data to show
      if (totalTokens === 0 && !costLabel && !reason) return null;

      return (
        <div class={`flex items-center ${props.compact ? "gap-1.5" : "gap-2"} py-1 text-[11px] text-gray-9 border-t border-gray-6/30`}>
          <span class="text-gray-8">{tr("session.step_finished")}</span>
          <Show when={reason}>
            <span class="text-gray-9">· {reason}</span>
          </Show>
          <span class={`ml-auto flex items-center ${props.compact ? "gap-1.5" : "gap-3"} text-[10px] text-gray-8`}>
            <Show when={totalTokens > 0}>
              <span title={`In: ${(tokens.input ?? 0).toLocaleString()} | Out: ${(tokens.output ?? 0).toLocaleString()} | Reasoning: ${(tokens.reasoning ?? 0).toLocaleString()} | Cache R: ${cacheRead.toLocaleString()} W: ${cacheWrite.toLocaleString()}`}>
                {totalTokens.toLocaleString()} tokens
              </span>
            </Show>
            <Show when={costLabel}>
              <span>{costLabel}</span>
            </Show>
          </span>
        </div>
      );
    }

    // Tool execution duration
    const duration = createMemo(() => {
      if (rowProps.part.type !== "tool") return null;
      const state = (rowProps.part as any).state ?? {};
      const start = state.time?.start;
      const end = state.time?.end;
      if (typeof start !== "number" || typeof end !== "number") return null;
      const ms = end - start;
      if (ms < 1000) return `${ms}ms`;
      return `${(ms / 1000).toFixed(1)}s`;
    });

    return (
      <div class={`flex items-center ${props.compact ? "gap-1.5 py-1 min-h-[24px]" : "gap-2.5 py-1.5 min-h-[28px]"} group/step`}>
        {/* Status dot */}
        <div class={`w-2 h-2 rounded-full shrink-0 ${statusDotClass(status())}`} />
        {/* Tool icon */}
        <div class={`shrink-0 ${summary().isSkill
            ? "text-purple-10"
            : "text-gray-9"
          }`}>
          <ToolIcon category={category()} size={13} />
        </div>
        {/* Title */}
        <span class={`text-gray-12 font-medium truncate min-w-0 ${props.compact ? "text-[12px] max-w-[45%]" : "text-[13px] max-w-[260px]"}`}>
          {localizedTitle()}
        </span>
        {/* Skill badge */}
        <Show when={summary().isSkill}>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-3 text-purple-11 shrink-0">
            {tr("session.step_badge_skill")}
          </span>
        </Show>
        <Show when={task().isTask}>
          <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-3 text-blue-11 shrink-0">
            {tr("session.step_badge_subagent")}
          </span>
        </Show>
        {/* Detail - truncated to single line */}
        <Show when={localizedDetail()}>
          <span class="text-[12px] text-gray-9 truncate min-w-0">
            {localizedDetail()}
          </span>
        </Show>
        <Show when={task().agentType && !localizedDetail()}>
          {(agentType) => (
            <span class="text-[12px] text-gray-9 truncate min-w-0">
              {format("session.tool_agent_suffix", { agent: String(agentType()) })}
            </span>
          )}
        </Show>
        <Show when={Boolean(task().sessionId && props.openSessionById)}>
          <button
            type="button"
            class="ml-auto text-[11px] text-blue-11 hover:text-blue-10 underline underline-offset-2"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              const sessionId = task().sessionId;
              if (!sessionId) return;
              props.openSessionById?.(sessionId);
            }}
          >
            {tr("session.open_session")}
          </button>
        </Show>
        {/* Tool execution duration */}
        <Show when={duration()}>
          <span class="text-[10px] text-gray-8 ml-auto shrink-0">{duration()}</span>
        </Show>
      </div>
    );
  };

  /** Compact steps list */
  const StepsList = (listProps: { parts: Part[]; isUser: boolean }) => {
    const shouldShowPartView = (part: Part) =>
      part.type === "tool" || part.type === "reasoning" || (props.developerMode && part.type !== "step-finish");

    /** Single step item — reasoning is always expanded, tool is collapsed by default */
    const StepItem = (itemProps: { part: Part }) => {
      const isReasoning = () => itemProps.part.type === "reasoning";
      const [toolExpanded, setToolExpanded] = createSignal(false);
      // Reasoning steps already render an inline summary card in StepRow.
      // Keep the expandable PartView for tool steps only to avoid duplicated "Thinking" content.
      const showContent = () => !isReasoning() && toolExpanded();

      return (
        <div>
          <div
            class={isReasoning() ? "" : "cursor-pointer"}
            onClick={() => { if (!isReasoning()) setToolExpanded((v) => !v); }}
          >
            <StepRow part={itemProps.part} isUser={listProps.isUser} />
          </div>
          <Show when={shouldShowPartView(itemProps.part) && showContent()}>
            <div class="pl-6 pb-2 text-xs text-gray-10">
              <PartView
                part={itemProps.part}
                messageInfo={messageInfoById().get(String((itemProps.part as any)?.messageID ?? "")) ?? null}
                sessionStatus={props.sessionStatus}
                developerMode={props.developerMode}
                showThinking={props.showThinking}
                workspaceRoot={props.workspaceRoot}
                tone={listProps.isUser ? "dark" : "light"}
              />
            </div>
          </Show>
        </div>
      );
    };

    return (
      <div class="divide-y divide-gray-6/40">
        <For each={listProps.parts}>
          {(part) => <StepItem part={part} />}
        </For>
      </div>
    );
  };

  /** Compact metadata line for assistant messages */
  const MessageMeta = (metaProps: { message: MessageWithParts }) => {
    const info = () => metaProps.message.info as any;
    const isAssistant = () => info().role === "assistant";
    const modelLabel = () => {
      if (!isAssistant()) return "";
      const modelID = info().modelID ?? info().model ?? "";
      if (!modelID) return "";
      const providerID = info().providerID ?? "";
      return providerID ? `${providerID}/${modelID}` : modelID;
    };
    const totalTokens = () => {
      if (!isAssistant()) return 0;
      const t = info().tokens;
      if (!t) return 0;
      return (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0);
    };
    const costLabel = () => {
      if (!isAssistant()) return "";
      const c = info().cost;
      if (typeof c !== "number" || c <= 0) return "";
      return c < 0.01 ? `${(c * 100).toFixed(2)}¢` : `$${c.toFixed(4)}`;
    };
    const durationLabel = () => {
      if (!isAssistant()) return "";
      const created = info().time?.created;
      const completed = info().time?.completed;
      if (typeof created !== "number" || typeof completed !== "number") return "";
      const ms = completed - created;
      if (ms < 1000) return `${ms}ms`;
      if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
      return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
    };

    return (
      <Show when={isAssistant() && (modelLabel() || totalTokens() > 0)}>
        <div class={`flex items-center ${props.compact ? "gap-1.5 mt-1" : "gap-3 mt-2"} text-[10px] text-gray-8 select-none`}>
          <Show when={modelLabel()}>
            <span title="Model">{modelLabel()}</span>
          </Show>
          <Show when={totalTokens() > 0}>
            <span title={`Input: ${(info().tokens?.input ?? 0).toLocaleString()} | Output: ${(info().tokens?.output ?? 0).toLocaleString()} | Reasoning: ${(info().tokens?.reasoning ?? 0).toLocaleString()}`}>
              {totalTokens().toLocaleString()} tokens
            </span>
          </Show>
          <Show when={costLabel()}>
            <span>{costLabel()}</span>
          </Show>
          <Show when={durationLabel()}>
            <span>{durationLabel()}</span>
          </Show>
        </div>
      </Show>
    );
  };

  /** Expandable steps container */
  const StepsContainer = (containerProps: {
    id: string;
    relatedIds?: string[];
    partsGroups: Part[][];
    isUser: boolean;
    isInline?: boolean;
  }) => {
    const relatedIds = () => containerProps.relatedIds ?? [];
    const expanded = () => isStepsExpanded(containerProps.id, relatedIds());
    const latestStep = () => latestStepPart(containerProps.partsGroups);
    const toolCallCount = () =>
      containerProps.partsGroups.reduce(
        (sum, parts) => sum + parts.reduce((count, part) => (part.type === "tool" ? count + 1 : count), 0),
        0,
      );
    const reasoningCount = () =>
      containerProps.partsGroups.reduce(
        (sum, parts) => sum + parts.reduce((count, part) => (part.type === "reasoning" ? count + 1 : count), 0),
        0,
      );

    const executionSummary = () => {
      const tools = toolCallCount();
      const reasoning = reasoningCount();
      if (tools > 0 && reasoning > 0) {
        return tr("session.execution_summary_tools_reasoning")
          .replace("{tools}", tools.toLocaleString())
          .replace("{reasoning}", reasoning.toLocaleString());
      }
      if (tools > 0) {
        return tr("session.execution_summary_tools").replace("{tools}", tools.toLocaleString());
      }
      if (reasoning > 0) {
        return tr("session.execution_summary_reasoning").replace("{reasoning}", reasoning.toLocaleString());
      }
      return tr("session.execution_summary_updates");
    };

    // Aggregate per-step token/cost from step-finish parts
    const stepFinishSummary = () => {
      let totalCost = 0;
      let totalTokens = 0;
      for (const parts of containerProps.partsGroups) {
        for (const part of parts) {
          if (part.type !== "step-finish") continue;
          const fp = part as any;
          if (typeof fp.cost === "number") totalCost += fp.cost;
          const t = fp.tokens;
          if (t) totalTokens += (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0);
        }
      }
      const costLabel = totalCost > 0
        ? totalCost < 0.01
          ? `${(totalCost * 100).toFixed(2)}¢`
          : `$${totalCost.toFixed(4)}`
        : "";
      return { totalTokens, costLabel };
    };

    const compactPathToken = (value: string) => {
      const token = value
        .trim()
        .replace(/^[`'"([{]+|[`'"\])},.;:]+$/g, "");
      const segments = token.split(/[\\/]/).filter(Boolean);
      return segments.length > 0 ? segments[segments.length - 1] : token;
    };

    const compactText = (value: string, max = 64) => {
      const singleLine = value.replace(/\s+/g, " ").trim();
      if (!singleLine) return "";
      return singleLine.length > max ? `${singleLine.slice(0, Math.max(0, max - 3))}...` : singleLine;
    };

    const isPathLike = (value: string) =>
      /^(?:[A-Za-z]:[\\/]|~[\\/]|\/[\w_\-~]|\.\.?[\\/])/.test(value) ||
      /[\\/](?:\.opencode|Users|Library|workspaces)[\\/]/.test(value);

    const toolHeadline = (part: Part) => {
      if (part.type !== "tool") return "";

      const record = part as any;
      const state = record.state ?? {};
      const input = state.input && typeof state.input === "object" ? (state.input as Record<string, unknown>) : {};
      const tool = typeof record.tool === "string" ? record.tool.toLowerCase() : "";

      const pick = (...keys: string[]) => {
        for (const key of keys) {
          const value = input[key];
          if (typeof value === "string" && value.trim()) return value.trim();
        }
        return "";
      };

      const target = (...keys: string[]) => {
        const raw = pick(...keys);
        if (!raw) return "";
        return isPathLike(raw) ? compactPathToken(raw) : raw;
      };

      if (tool === "bash") {
        const description = pick("description");
        if (description) return compactText(description);
        const command = pick("command", "cmd");
        return command
          ? compactText(format("session.tool_run_command_target", { target: command }), 56)
          : tr("session.tool_run_command");
      }

      if (tool === "read") {
        const file = target("filePath", "path", "file");
        return file ? format("session.tool_read_file", { target: file }) : tr("session.tool_read_file_generic");
      }

      if (tool === "edit") {
        const file = target("filePath", "path", "file");
        return file ? format("session.tool_edit_file", { target: file }) : tr("session.tool_edit_file_generic");
      }

      if (tool === "write" || tool === "apply_patch") {
        const file = target("filePath", "path", "file");
        return file ? format("session.tool_update_file", { target: file }) : tr("session.tool_update_file_generic");
      }

      if (tool === "grep" || tool === "glob") {
        const pattern = pick("pattern", "query");
        return pattern
          ? format("session.tool_search_target", { target: compactText(pattern, 36) })
          : tr("session.tool_search_code");
      }

      if (tool === "list") {
        const path = target("path");
        return path ? format("session.tool_list_target", { target: path }) : tr("session.tool_list_files");
      }

      if (tool === "task") {
        const description = pick("description");
        if (description) return compactText(description);
        const agent = pick("subagent_type");
        return agent ? format("session.tool_delegate_target", { target: agent }) : tr("session.status_delegating");
      }

      if (tool === "webfetch") {
        const url = pick("url");
        return url
          ? format("session.tool_fetch_target", { target: compactText(url, 36) })
          : tr("session.tool_fetch_web");
      }

      if (tool === "skill") {
        const name = pick("name");
        return name ? format("session.tool_load_skill_target", { target: name }) : tr("session.tool_load_skill");
      }

      return "";
    };

    const latestStepLabel = () => {
      const step = latestStep();
      if (!step) return tr("session.last_step");
      const messageInfo =
        step.type === "tool" || step.type === "reasoning"
          ? messageInfoById().get(String((step as any)?.messageID ?? "")) ?? null
          : null;
      const effectiveStatus =
        step.type === "tool"
          ? resolveToolPartDisplayStatus(step, {
              sessionStatus: props.sessionStatus,
              messageInfo,
            })
          : null;
      const interruptedSuffix = effectiveStatus === "stale" ? ` · ${tr("session.tool_status_interrupted")}` : "";

      const fromTool = toolHeadline(step);
      if (fromTool) return compactText(`${fromTool}${interruptedSuffix}`);

      if (step.type === "tool") {
        const toolName = String((step as any).tool ?? "").trim();
        if (toolName) {
          const friendlyTool = toolName.replace(/[_-]+/g, " ");
          return compactText(`${localizeStepText(friendlyTool)}${interruptedSuffix}`);
        }
      }

      const summary = summarizeStep(step);
      const title = compactText(localizeStepText(summary.title));
      const detail = compactText(localizeStepText(summary.detail ?? ""));
      const generic = /^(application|tool|step|working|done|completed|success)$/i.test(title);

      if (title && !generic) return `${title}${interruptedSuffix}`;
      if (detail) return isPathLike(detail) ? compactPathToken(detail) : detail;
      if (title) return `${title}${interruptedSuffix}`;
      return tr("session.last_step");
    };
    const hasRunning = () =>
      containerProps.partsGroups.some((parts) =>
        parts.some((part) => {
          if (part.type !== "tool") return false;
          const messageInfo = messageInfoById().get(String((part as any)?.messageID ?? "")) ?? null;
          return isToolPartActive(part, {
            sessionStatus: props.sessionStatus,
            messageInfo,
          });
        }),
      );

    return (
      <div class={containerProps.isInline ? (containerProps.isUser ? "mt-2" : "mt-3 pt-3") : ""}>
        {/* Toggle button - clean, compact */}
        <button
          type="button"
          class={`flex items-center ${props.compact ? "gap-1.5 py-1 text-[12px]" : "gap-2 py-1.5 text-[13px]"} transition-colors ${containerProps.isUser
              ? "text-gray-10 hover:text-gray-11"
              : "text-gray-10 hover:text-gray-12"
            }`}
          onClick={() => toggleSteps(containerProps.id, relatedIds())}
        >
          <ChevronRight
            size={14}
            class={`transition-transform duration-200 ${expanded() ? "rotate-90" : ""}`}
          />
          <span class={`font-medium inline-flex items-center gap-1.5 text-xs ${props.compact ? "" : "sm:text-[13px]"} text-gray-11`}>
            <Show when={hasRunning()}>
              <span class="inline-flex h-2 w-2 rounded-full session-running-dot" />
            </Show>
            <span class={`truncate ${props.compact ? "max-w-[90%]" : "max-w-[58ch]"}`}>
              {expanded() ? tr("session.hide_timeline") : tr("session.execution_timeline")}
            </span>
          </span>
          <Show when={!expanded()}>
            <span class={`text-[11px] text-gray-9 truncate ${props.compact ? "max-w-[85%]" : "max-w-[56ch]"}`}>{`${executionSummary()}${stepFinishSummary().totalTokens > 0 ? ` · ${stepFinishSummary().totalTokens.toLocaleString()} tokens` : ""}${stepFinishSummary().costLabel ? ` · ${stepFinishSummary().costLabel}` : ""} - ${latestStepLabel()}`}</span>
          </Show>
          <Show when={expanded()}>
            <span class={`text-[11px] text-gray-9 truncate ${props.compact ? "max-w-[85%]" : "max-w-[56ch]"}`}>{executionSummary()}</span>
          </Show>
        </button>

        {/* Expanded content */}
        <Show when={expanded()}>
          <div
            class={`mt-1 ${props.compact ? "ml-0 pl-2" : "ml-1 pl-3"} border-l-2 ${containerProps.isUser
                ? "border-gray-6"
                : "border-gray-6/60"
              }`}
          >
            <For each={containerProps.partsGroups}>
              {(parts, index) => (
                <div
                  class={
                    index() === 0
                      ? ""
                      : "mt-2 pt-2 border-t border-gray-6/40"
                  }
                >
                  <StepsList parts={parts} isUser={containerProps.isUser} />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    );
  };

  return (
    <ErrorBoundary fallback={(err) => {
      console.error("[MessageList] Render error:", err);
      return (
        <div class="p-4 text-red-11 text-sm">
          <p>Render error: {String(err?.message ?? err)}</p>
          <pre class="mt-2 text-[10px] text-gray-9 whitespace-pre-wrap">{err?.stack}</pre>
        </div>
      );
    }}>
    <div class={props.compact ? "space-y-3 pb-16 px-3" : "space-y-6 pb-32"} style={{ contain: "layout paint style" }}>
      <For each={messageBlocks()}>
        {(block, blockIndex) => {
          const blockMessageIds = block.kind === "steps-cluster" ? block.messageIds : [block.messageId];
          const hasSearchMatch = blockMessageIds.some((id) => props.searchMatchMessageIds?.has(id));
          const hasActiveSearchMatch = blockMessageIds.some((id) => id === props.activeSearchMessageId);
          const searchOutlineClass = hasActiveSearchMatch
            ? "outline outline-2 outline-amber-8/70 outline-offset-2 rounded-2xl"
            : hasSearchMatch
              ? "outline outline-1 outline-amber-7/50 outline-offset-1 rounded-2xl"
              : "";

          if (block.kind === "steps-cluster") {
            return (
              <div
                class={`flex group ${block.isUser ? "justify-end" : "justify-start"}`.trim()}
                data-message-role={block.isUser ? "user" : "assistant"}
                data-message-id={block.messageIds[0] ?? ""}
                style={blockPerfStyle(blockIndex())}
              >
                <div
                  class={`w-full relative ${block.isUser
                      ? (props.compact
                        ? "max-w-full px-3.5 py-2.5 rounded-2xl bg-gray-3 text-gray-12 text-[14px] leading-normal"
                        : "max-w-2xl px-6 py-4 rounded-[24px] bg-gray-3 text-gray-12 text-[15px] leading-relaxed")
                      : (props.compact
                        ? "w-full text-[13px] leading-6 text-gray-12 group"
                        : "max-w-[68ch] text-[15px] leading-7 text-gray-12 group pl-2")
                    } ${searchOutlineClass}`}
                >
                  <StepsContainer
                    id={block.id}
                    relatedIds={block.stepIds.filter((stepId) => stepId !== block.id)}
                    partsGroups={block.partsGroups}
                    isUser={block.isUser}
                  />
                </div>
              </div>
            );
          }

          const groupSpacing = block.isUser ? "mb-3" : "mb-4";
          return (
            <div
              class={`flex group ${block.isUser ? "justify-end" : "justify-start"}`.trim()}
              data-message-role={block.isUser ? "user" : "assistant"}
              data-message-id={block.messageId}
              style={blockPerfStyle(blockIndex())}
            >
              <div
                class={`w-full relative ${block.isUser
                    ? (props.compact
                      ? "max-w-full px-3.5 py-2.5 rounded-2xl bg-gray-3 text-gray-12 text-[14px] leading-normal"
                      : "max-w-2xl px-6 py-4 rounded-[24px] bg-gray-3 text-gray-12 text-[15px] leading-relaxed")
                    : (props.compact
                      ? "w-full text-[13px] leading-6 text-gray-12 group"
                      : "max-w-[68ch] text-[15px] leading-7 text-gray-12 group pl-2")
                  } ${searchOutlineClass}`}
              >
                <Show when={attachmentsForMessage(block.message).length > 0}>
                  <div class={block.isUser ? "mb-3 flex flex-wrap gap-2" : "mb-4 flex flex-wrap gap-2"}>
                    <For each={attachmentsForMessage(block.message)}>
                      {(attachment) => (
                        <div class="flex items-center gap-2 rounded-2xl border border-gray-6 bg-gray-1/70 px-3 py-2 text-xs text-gray-11">
                          <Show
                            when={isImageAttachment(attachment.mime)}
                            fallback={<File size={14} class="text-gray-9" />}
                          >
                            <div class="h-12 w-12 rounded-xl bg-gray-2 overflow-hidden border border-gray-6">
                              <img
                                src={attachment.url}
                                alt={attachment.filename}
                                class="h-full w-full object-cover"
                              />
                            </div>
                          </Show>
                          <div class="max-w-[180px]">
                            <div class="truncate text-gray-12">{attachment.filename}</div>
                            <div class="text-[10px] text-gray-9">{attachment.mime}</div>
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
                <For each={block.groups}>
                  {(group, idx) => (
                    <div class={idx() === block.groups.length - 1 ? "" : groupSpacing}>
                      <Show when={group.kind === "text"}>
                        {(() => {
                          const isStreamingLatestAssistant =
                            !block.isUser && props.isStreaming && block.messageId === latestAssistantMessageId();
                          const markdownThrottleMs = isStreamingLatestAssistant ? 550 : 100;
                          return (
                            <PartView
                              part={(group as { kind: "text"; part: Part; segment: "intent" | "result" }).part}
                              developerMode={props.developerMode}
                              showThinking={props.showThinking}
                              workspaceRoot={props.workspaceRoot}
                              tone={block.isUser ? "dark" : "light"}
                              renderMarkdown={!block.isUser}
                              markdownThrottleMs={markdownThrottleMs}
                              highlightQuery={hasSearchMatch ? props.searchHighlightQuery : undefined}
                            />
                          );
                        })()}
                      </Show>
                      {group.kind === "steps" &&
                        (() => {
                          const stepGroup = group as { kind: "steps"; id: string; parts: Part[]; segment: "execution" };
                          return (
                            <StepsContainer
                              id={stepGroup.id}
                              partsGroups={[stepGroup.parts]}
                              isUser={block.isUser}
                              isInline={true}
                            />
                          );
                        })()}
                    </div>
                  )}
                </For>
                <Show when={!block.isUser}>
                  <MessageMeta message={block.message} />
                </Show>
                <div class="absolute bottom-2 right-2 flex justify-end opacity-100 pointer-events-auto md:opacity-0 md:pointer-events-none md:group-hover:opacity-100 md:group-hover:pointer-events-auto md:group-focus-within:opacity-100 md:group-focus-within:pointer-events-auto transition-opacity select-none">
                  <button
                    class="text-dls-secondary hover:text-dls-text p-1 rounded hover:bg-dls-hover transition-colors"
                    title="Copy message"
                    onClick={() => {
                      const text = block.renderableParts
                        .map((part) => partToText(part))
                        .join("\n");
                      handleCopy(text, block.messageId);
                    }}
                  >
                    <Show when={copyingId() === block.messageId} fallback={<Copy size={12} />}>
                      <Check size={12} class="text-green-10" />
                    </Show>
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </For>
      <Show when={props.footer}>{props.footer}</Show>
    </div>
    </ErrorBoundary>
  );
}
