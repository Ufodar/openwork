import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { AlertTriangle, Bot, Code2, FileText, Folder, Loader2, MessageSquare, RefreshCw, Search, Terminal } from "lucide-solid";

import Button from "../components/button";
import type { CreateSessionOptions, View } from "../types";
import { currentLocale, t } from "../../i18n";
import {
  filterVisibleFeaturedAgents,
  resolveFeaturedAgentLaunch,
  SHOW_STANDALONE_NEW_SESSION_BUTTON,
} from "./agents-visibility";

interface AgentType {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: typeof Bot;
  status: "available" | "coming-soon";
}

const agentTypes: AgentType[] = [
  {
    id: "general-assistant",
    nameKey: "agents.general_assistant_name",
    descriptionKey: "agents.general_assistant_desc",
    icon: Terminal,
    status: "available",
  },
  {
    id: "document-agent",
    nameKey: "agents.document_agent_name",
    descriptionKey: "agents.document_agent_desc",
    icon: Folder,
    status: "available",
  },
  {
    id: "document-writer",
    nameKey: "agents.document_writer_name",
    descriptionKey: "agents.document_writer_desc",
    icon: FileText,
    status: "available",
  },
];

export type AgentsViewProps = {
  setView: (view: View, sessionId?: string) => void;
  createSessionAndOpen: (options?: CreateSessionOptions) => void;
  listAgents: () => Promise<Agent[]>;
};

export default function AgentsView(props: AgentsViewProps) {
  const tr = (key: string) => t(key, currentLocale());
  const [agents, setAgents] = createSignal<Agent[]>([]);
  const [agentsBusy, setAgentsBusy] = createSignal(false);
  const [agentsError, setAgentsError] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const docWriterAgents = new Set(["document-writer"]);

  const normalizeAgentKey = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\.md$/i, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  const agentByKey = createMemo(() => {
    const map = new Map<string, Agent>();
    for (const entry of agents()) {
      const key = normalizeAgentKey(entry.name);
      if (!key || map.has(key)) continue;
      map.set(key, entry);
    }
    return map;
  });

  const isFeaturedAgentAvailable = (featured: AgentType) => {
    if (featured.status === "coming-soon") return false;
    if (featured.id === "general-assistant") return true;
    if (featured.id === "document-agent") return true;
    if (featured.id === "document-writer") return true;
    return agentByKey().has(normalizeAgentKey(featured.id));
  };

  const resolveFeaturedAgentName = (featured: AgentType): string | null => {
    if (featured.id === "general-assistant") return null;
    if (featured.id === "document-agent") {
      const match = agentByKey().get(normalizeAgentKey("common-work"));
      return match?.name ?? null;
    }
    if (featured.id === "document-writer") {
      const match = agentByKey().get(normalizeAgentKey("document-writer"));
      return match?.name ?? null;
    }
    const match = agentByKey().get(normalizeAgentKey(featured.id));
    return match?.name ?? null;
  };

  const filteredAgents = createMemo(() => {
    const q = searchQuery().trim().toLowerCase();
    if (!q) return agents();
    return agents().filter((agent) => {
      const name = agent.name.toLowerCase();
      const desc = (agent.description ?? "").toLowerCase();
      return name.includes(q) || desc.includes(q);
    });
  });

  const visibleAgentTypes = createMemo(() => filterVisibleFeaturedAgents(agentTypes));

  const refreshAgents = async (options?: { force?: boolean }) => {
    if (agentsBusy() && !options?.force) return;
    setAgentsBusy(true);
    setAgentsError(null);
    try {
      const list = await props.listAgents();
      setAgents(list);
    } catch (error) {
      const message = error instanceof Error ? error.message : tr("agents.failed_load_agents");
      setAgentsError(message);
    } finally {
      setAgentsBusy(false);
    }
  };

  onMount(() => {
    void refreshAgents();
  });

  function handleFeaturedClick(featured: AgentType) {
    if (featured.status === "coming-soon") return;
    if (!isFeaturedAgentAvailable(featured)) return;
    const agent = resolveFeaturedAgentName(featured);
    const launch = resolveFeaturedAgentLaunch(featured.id, agent);
    props.createSessionAndOpen(launch ?? undefined);
  }

  return (
    <div class="space-y-8">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 class="text-xl font-semibold text-dls-text">{tr("agents.hub_title")}</h2>
          <p class="mt-1 text-sm text-dls-secondary">
            {tr("agents.hub_subtitle")}
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={agentsBusy()}
            onClick={() => void refreshAgents({ force: true })}
            title={tr("agents.refresh_agents")}
          >
            <Show
              when={!agentsBusy()}
              fallback={<Loader2 size={16} class="animate-spin" />}
            >
              <RefreshCw size={16} />
            </Show>
            {tr("common.refresh")}
          </Button>
          <Show when={SHOW_STANDALONE_NEW_SESSION_BUTTON}>
            <Button onClick={() => props.createSessionAndOpen()}>{tr("agents.new_session")}</Button>
          </Show>
        </div>
      </div>

      <Show when={agentsError()}>
        <div class="rounded-xl border border-red-6 bg-red-2 px-4 py-3 text-xs text-red-11 whitespace-pre-wrap break-words">
          {agentsError()}
        </div>
      </Show>

      <div>
        <div class="flex items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-dls-text">{tr("agents.featured")}</h3>
          <Show when={agentsBusy()}>
            <div class="flex items-center gap-2 text-xs text-dls-secondary">
              <Loader2 size={14} class="animate-spin" />
              {tr("agents.loading")}
            </div>
          </Show>
        </div>

        <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={visibleAgentTypes()}>
            {(featured) => {
              const Icon = featured.icon;
              const available = () => isFeaturedAgentAvailable(featured);
              const disabled = () => featured.status === "coming-soon" || !available();
              return (
                <button
                  class={`group flex flex-col gap-3 rounded-xl border p-5 text-left transition-colors ${disabled()
                    ? "border-dls-border bg-dls-surface opacity-50 cursor-not-allowed"
                    : "border-dls-border bg-dls-surface hover:border-gray-8 hover:bg-dls-hover cursor-pointer"
                    }`}
                  onClick={() => handleFeaturedClick(featured)}
                  disabled={disabled()}
                >
                  <div class="flex items-center justify-between">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-dls-hover">
                      <Icon size={20} class="text-dls-text" />
                    </div>
                    <Show when={featured.status === "coming-soon"}>
                      <span class="rounded-full bg-dls-hover px-2 py-0.5 text-xs text-dls-secondary">
                        {tr("agents.soon")}
                      </span>
                    </Show>
                    <Show when={featured.status !== "coming-soon" && featured.id !== "general-assistant" && !available()}>
                      <span class="rounded-full bg-dls-hover px-2 py-0.5 text-xs text-dls-secondary">
                        {tr("agents.not_installed")}
                      </span>
                    </Show>
                    <Show when={featured.id === "general-assistant"}>
                      <span class="flex items-center gap-1 rounded-full bg-orange-3 px-2 py-0.5 text-xs text-orange-11">
                        <AlertTriangle size={12} />
                        {tr("agents.use_with_caution")}
                      </span>
                    </Show>
                  </div>
                  <div>
                    <h3 class="text-sm font-medium text-dls-text">{tr(featured.nameKey)}</h3>
                    <p class="mt-1 text-xs text-dls-secondary leading-relaxed">
                      {tr(featured.descriptionKey)}
                    </p>
                  </div>
                </button>
              );
            }}
          </For>
        </div>

        <Show when={!agentsBusy() && agents().length === 0 && !agentsError()}>
          <div class="mt-3 text-xs text-dls-secondary">
            {tr("agents.no_agents_found")}{" "}
            <span class="font-mono">.opencode/agents/</span>.
          </div>
        </Show>
      </div>

      {/* <div>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <h3 class="text-sm font-semibold text-dls-text">Installed agents</h3>
          <div class="relative">
            <Search size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-dls-secondary" />
            <input
              type="text"
              value={searchQuery()}
              onInput={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search agents"
              class="bg-dls-hover border border-dls-border rounded-lg py-1.5 pl-9 pr-4 text-xs w-56 focus:w-72 focus:outline-none transition-all"
            />
          </div>
        </div>

        <Show when={filteredAgents().length === 0 && agents().length > 0}>
          <div class="mt-3 text-xs text-dls-secondary">No agents match that search.</div>
        </Show>

        <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <For each={filteredAgents()}>
            {(agent) => {
              const Icon = (() => {
                const key = normalizeAgentKey(agent.name);
                if (key.includes("doc") || key.includes("document") || key.includes("writer")) return FileText;
                if (key.includes("code") || key.includes("review") || key.includes("bug")) return Code2;
                if (key.includes("research") || key.includes("search")) return Search;
                if (key.includes("assistant") || key.includes("chat")) return MessageSquare;
                return Bot;
              })();

              return (
                <button
                  class="group flex flex-col gap-3 rounded-xl border border-dls-border bg-dls-surface p-5 text-left transition-colors hover:border-gray-8 hover:bg-dls-hover"
                  onClick={() =>
                    props.createSessionAndOpen({
                      title: agent.name,
                      agent: agent.name,
                      agentLock: docWriterAgents.has(normalizeAgentKey(agent.name)) ? "document-writer" : null,
                      view: docWriterAgents.has(normalizeAgentKey(agent.name)) ? "document-writer" : "session",
                    })
                  }
                >
                  <div class="flex items-center justify-between">
                    <div class="flex h-10 w-10 items-center justify-center rounded-lg bg-dls-hover">
                      <Icon size={20} class="text-dls-text" />
                    </div>
                    <Show when={agent.native}>
                      <span class="rounded-full bg-dls-hover px-2 py-0.5 text-xs text-dls-secondary">
                        Built-in
                      </span>
                    </Show>
                  </div>
                  <div>
                    <h4 class="text-sm font-medium text-dls-text">{agent.name}</h4>
                    <Show when={agent.description}>
                      <p class="mt-1 text-xs text-dls-secondary leading-relaxed">
                        {agent.description}
                      </p>
                    </Show>
                  </div>
                </button>
              );
            }}
          </For>
        </div>
      </div> */}
    </div>
  );
}
