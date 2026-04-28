import type { ModelRef, SuggestedPlugin } from "./types";

export const MODEL_PREF_KEY = "openwork.defaultModel";
export const SESSION_MODEL_PREF_KEY = "openwork.sessionModels";
export const THINKING_PREF_KEY = "openwork.showThinking";
export const TOOL_MONITOR_PREF_KEY = "openwork.toolMonitorEnabled";
export const LANGUAGE_PREF_KEY = "openwork.language";
export const HIDE_TITLEBAR_PREF_KEY = "openwork.hideTitlebar";

export const DEFAULT_MODEL: ModelRef = {
  providerID: "my-company",
  modelID: "DeepSeek-V4",
};

export const SUGGESTED_PLUGINS: SuggestedPlugin[] = [
  {
    name: "opencode-scheduler",
    packageName: "opencode-scheduler",
    description: "Run scheduled jobs with the OpenCode scheduler plugin.",
    tags: ["automation", "jobs"],
    installMode: "simple",
  },
];

export type McpDirectoryInfo = {
  name: string;
  description: string;
  url?: string;
  type?: "remote" | "local";
  command?: string[];
  oauth: boolean;
};

export const MCP_QUICK_CONNECT: McpDirectoryInfo[] = [
  {
    name: "Context7",
    description: "Search product docs with richer context.",
    url: "https://mcp.context7.com/mcp",
    type: "remote",
    oauth: false,
  },
  {
    name: "Control Chrome",
    description: "Drive Chrome tabs with browser automation.",
    type: "local",
    command: ["chrome-devtools-mcp"],
    oauth: false,
  },
];
