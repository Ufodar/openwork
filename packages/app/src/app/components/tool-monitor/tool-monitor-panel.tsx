import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type { Part } from "@opencode-ai/sdk/v2/client";
import { Activity, AlertTriangle, CheckCircle2 } from "lucide-solid";

import PartView from "../part-view";
import type { ToolMonitorTurnReport } from "../../lib/tool-monitor/types";

export type ToolMonitorPanelProps = {
  enabled: boolean;
  developerMode: boolean;
  reports: ToolMonitorTurnReport[];
  expanded: boolean;
  setExpanded: (next: boolean) => void;
  openDocument?: (path: string) => void;
};

const compactReportLabel = (report: ToolMonitorTurnReport) => {
  const time = new Date(report.createdAt).toISOString().slice(11, 19);
  const errors = report.summary.toolErrors;
  const tools = report.summary.toolCalls;
  const suffix = errors > 0 ? ` — ${errors} error(s)` : tools > 0 ? ` — ${tools} tool(s)` : "";
  return `${time}${suffix}`;
};

export default function ToolMonitorPanel(props: ToolMonitorPanelProps) {
  const [selectedId, setSelectedId] = createSignal<string>("");

  const latest = createMemo(() => props.reports[0] ?? null);

  createEffect(() => {
    const current = selectedId();
    const next = latest()?.assistantMessageId ?? "";
    if (!current && next) setSelectedId(next);
    if (current && next && current === next) return;
    if (!current && next) return;
    if (next) setSelectedId(next);
  });

  const selectedReport = createMemo(() => {
    const id = selectedId();
    if (!id) return latest();
    return props.reports.find((r) => r.assistantMessageId === id) ?? latest();
  });

  const headerBadge = createMemo(() => {
    const report = latest();
    if (!report) return null;
    if (report.summary.toolErrors > 0 || report.summary.invalidToolCalls > 0) {
      return { kind: "warn" as const, label: `${report.summary.toolErrors} error(s)` };
    }
    if (report.summary.toolCalls > 0) {
      return { kind: "ok" as const, label: `${report.summary.toolCalls} tool(s)` };
    }
    return { kind: "idle" as const, label: "0 tools" };
  });

  const markdownPart = createMemo<Part | null>(() => {
    const report = selectedReport();
    if (!report) return null;
    return { type: "text", text: report.markdown } as unknown as Part;
  });

  return (
    <Show when={props.enabled}>
      <div class="px-4">
        <div class="rounded-t-xl border border-b-0 border-gray-6/70 bg-gray-1/70 shadow-sm shadow-gray-12/5">
          <button
            type="button"
            class="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-9 hover:bg-gray-2/50 transition-colors rounded-t-xl"
            onClick={() => props.setExpanded(!props.expanded)}
          >
            <div class="flex items-center gap-2 min-w-0">
              <Activity size={14} class="text-gray-8 shrink-0" />
              <span class="text-gray-11 font-medium truncate">Tool Monitor</span>
              <Show when={headerBadge()}>
                {(badge) => (
                  <span
                    class={`ml-1 px-2 py-0.5 rounded-full text-[10px] border ${
                      badge().kind === "warn"
                        ? "border-amber-7/40 bg-amber-3/25 text-amber-11"
                        : badge().kind === "ok"
                          ? "border-green-7/40 bg-green-3/25 text-green-11"
                          : "border-gray-7/40 bg-gray-3/10 text-gray-9"
                    }`}
                  >
                    {badge().label}
                  </span>
                )}
              </Show>
            </div>
            <div class="text-[10px] text-gray-8 shrink-0">{props.expanded ? "Hide" : "Show"}</div>
          </button>

          <Show when={props.expanded}>
            <div class="px-4 pb-3 space-y-3 max-h-80 overflow-auto border-t border-gray-6/50">
              <Show
                when={props.reports.length > 0}
                fallback={<div class="pt-3 text-xs text-gray-8">Waiting for the next completed turn…</div>}
              >
                <div class="pt-3 flex flex-col gap-2">
                  <div class="flex items-center justify-between gap-3">
                    <div class="text-[11px] text-gray-8">Turn</div>
                    <select
                      class="text-[11px] bg-gray-1 border border-gray-6 rounded-lg px-2 py-1 text-gray-11"
                      value={selectedId()}
                      onChange={(e) => setSelectedId(e.currentTarget.value)}
                    >
                      <For each={props.reports}>
                        {(report) => (
                          <option value={report.assistantMessageId}>{compactReportLabel(report)}</option>
                        )}
                      </For>
                    </select>
                  </div>

                  <Show when={selectedReport()?.persisted?.path}>
                    {(path) => (
                      <div class="flex items-center justify-between gap-2">
                        <div class="text-[11px] text-gray-8 truncate">
                          Saved: <span class="font-mono text-gray-10">{path()}</span>
                        </div>
                        <button
                          type="button"
                          class="text-[11px] px-2 py-1 rounded-lg border border-gray-6 text-gray-10 hover:bg-gray-2/50"
                          onClick={() => {
                            const report = selectedReport();
                            const saved = report?.persisted?.path ?? "";
                            if (saved && props.openDocument) props.openDocument(saved);
                          }}
                        >
                          Open
                        </button>
                      </div>
                    )}
                  </Show>

                  <Show when={selectedReport()?.persisted?.status === "error"}>
                    <div class="flex items-start gap-2 text-[11px] text-amber-11">
                      <AlertTriangle size={14} class="shrink-0 mt-0.5" />
                      <div class="min-w-0">
                        <div class="font-medium">Report save failed</div>
                        <div class="text-amber-11/90 break-words">{selectedReport()?.persisted?.error ?? "Unknown error"}</div>
                      </div>
                    </div>
                  </Show>

                  <Show when={selectedReport()?.persisted?.status === "pending"}>
                    <div class="text-[11px] text-gray-8">Saving report…</div>
                  </Show>

                  <Show when={selectedReport()?.persisted?.status === "ok"}>
                    <div class="flex items-center gap-2 text-[11px] text-green-11">
                      <CheckCircle2 size={14} class="shrink-0" />
                      <div>Saved to session.</div>
                    </div>
                  </Show>
                </div>

                <Show when={markdownPart()}>
                  {(part) => (
                    <div class="rounded-xl border border-gray-6/60 bg-gray-1/60 p-3">
                      <PartView part={part()} developerMode={props.developerMode} renderMarkdown />
                    </div>
                  )}
                </Show>
              </Show>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
