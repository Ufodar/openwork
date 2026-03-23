import { createContext, createEffect, useContext, type ParentProps } from "solid-js";
import { createStore, type SetStoreFunction, type Store } from "solid-js/store";

import type {
  Config,
  ConfigProvidersResponse,
  Event,
  GlobalHealthResponse,
  LspStatus,
  Project,
  ProviderListResponse,
  ProviderAuthResponse,
  Message,
  Part,
  Session,
  VcsInfo,
} from "@opencode-ai/sdk/v2/client";

import type { McpStatusMap, TodoItem } from "../types";
import { unwrap } from "../lib/opencode";
import { resolveAbortLikeError } from "../lib/request-abort";
import { safeStringify } from "../utils";
import { mapConfigProvidersToList } from "../utils/providers";
import { useGlobalSDK } from "./global-sdk";

export type WorkspaceState = {
  status: "idle" | "loading" | "partial" | "ready";
  session: Session[];
  session_status: Record<string, string>;
  message: Record<string, Message[]>;
  part: Record<string, Part[]>;
  todo: Record<string, TodoItem[]>;
};

type WorkspaceStore = [Store<WorkspaceState>, SetStoreFunction<WorkspaceState>];

type ProjectMeta = {
  name?: string;
  icon?: Project["icon"];
};

type GlobalState = {
  ready: boolean;
  error?: string;
  serverVersion?: string;
  config: Config;
  provider: ProviderListResponse;
  providerAuth: ProviderAuthResponse;
  mcp: Record<string, McpStatusMap>;
  lsp: Record<string, LspStatus[]>;
  project: Project[];
  projectMeta: Record<string, ProjectMeta>;
  vcs: Record<string, VcsInfo | null>;
};

type GlobalSyncContextValue = {
  data: Store<GlobalState>;
  set: SetStoreFunction<GlobalState>;
  child: (directory: string) => WorkspaceStore;
  refresh: () => Promise<void>;
  refreshDirectory: (directory: string) => Promise<void>;
};

const GlobalSyncContext = createContext<GlobalSyncContextValue | undefined>(undefined);

const createWorkspaceState = (): WorkspaceState => ({
  status: "idle",
  session: [],
  session_status: {},
  message: {},
  part: {},
  todo: {},
});

const PROVIDER_LIST_TIMEOUT_MS = 4_000;
const OPENCODE_GLOBAL_HEALTH_TIMEOUT_MS = 4_000;
const OPENCODE_CONFIG_TIMEOUT_MS = 4_000;
const OPENCODE_PROVIDER_AUTH_TIMEOUT_MS = 4_000;
const OPENCODE_PROVIDER_LIST_TIMEOUT_MS = 6_000;
const OPENCODE_MCP_STATUS_TIMEOUT_MS = 6_000;
const OPENCODE_LSP_STATUS_TIMEOUT_MS = 6_000;
const OPENCODE_PROJECT_LIST_TIMEOUT_MS = 6_000;
const OPENCODE_VCS_GET_TIMEOUT_MS = 4_000;
const VCS_REFRESH_BATCH_SIZE = 3;

const withAbortTimeout = async <T,>(
  runner: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return await runner(undefined);
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  if (!controller) {
    return await runner(undefined);
  }

  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    try {
      controller.abort();
    } catch {
      // ignore
    }
  }, timeoutMs);

  try {
    return await runner(controller.signal);
  } catch (error) {
    const next = resolveAbortLikeError(error, {
      didTimeout,
      upstreamAborted: Boolean(controller.signal.aborted && !didTimeout),
    });
    if (next !== error) {
      if (next instanceof Error && next.message === "Request timed out.") {
        throw new Error(`${label} timed out.`);
      }
      throw next;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

export function GlobalSyncProvider(props: ParentProps) {
  const globalSDK = useGlobalSDK();
  const defaultProvider: ProviderListResponse = { all: [], connected: [], default: {} };
  const [globalStore, setGlobalStore] = createStore<GlobalState>({
    ready: false,
    error: undefined,
    serverVersion: undefined,
    config: {},
    provider: defaultProvider,
    providerAuth: {},
    mcp: {},
    lsp: {},
    project: [],
    projectMeta: {},
    vcs: {},
  });
  const children = new Map<string, WorkspaceStore>();
  const subscriptions = new Map<string, () => void>();
  let refreshInFlight: Promise<void> | null = null;

  const keyFor = (directory: string) => directory || "global";

  const setError = (error: unknown) => {
    const message = error instanceof Error ? error.message : safeStringify(error);
    setGlobalStore("error", message || "Unknown error");
  };

  const setProjectMeta = (projects: Project[]) => {
    const next: Record<string, ProjectMeta> = {};
    for (const project of projects) {
      if (!project?.worktree) continue;
      next[project.worktree] = {
        name: project.name,
        icon: project.icon,
      };
    }
    setGlobalStore("projectMeta", next);
  };

  const refreshConfig = async () => {
    const result = unwrap(
      await withAbortTimeout(
        (signal) => globalSDK.client().config.get(undefined, signal ? { signal } : undefined),
        OPENCODE_CONFIG_TIMEOUT_MS,
        "config.get",
      ),
    );
    setGlobalStore("config", result);
  };

  const refreshProviders = async (options?: { full?: boolean }) => {
    let seededFromConfig = false;
    try {
      const fallback = unwrap(
        await withAbortTimeout(
          (signal) => globalSDK.client().config.providers(undefined, signal ? { signal } : undefined),
          OPENCODE_CONFIG_TIMEOUT_MS,
          "config.providers",
        ),
      ) as ConfigProvidersResponse;
      setGlobalStore("provider", {
        all: mapConfigProvidersToList(fallback.providers),
        connected: globalStore.provider.connected ?? [],
        default: fallback.default,
      });
      seededFromConfig = true;
    } catch {
      // Keep current provider state if the lightweight source fails.
    }

    if (!options?.full) {
      if (!seededFromConfig && !globalStore.provider.all.length) {
        setGlobalStore("provider", defaultProvider);
      }
      return;
    }

    try {
      const result = unwrap(
        await withAbortTimeout(
          (signal) => globalSDK.client().provider.list(undefined, signal ? { signal } : undefined),
          Math.max(PROVIDER_LIST_TIMEOUT_MS, OPENCODE_PROVIDER_LIST_TIMEOUT_MS),
          "provider.list",
        ),
      ) as ProviderListResponse;
      setGlobalStore("provider", result);
    } catch {
      if (!seededFromConfig && !globalStore.provider.all.length) {
        setGlobalStore("provider", defaultProvider);
      }
    }
  };

  const refreshProviderAuth = async () => {
    try {
      const result = await withAbortTimeout(
        (signal) => globalSDK.client().provider.auth(undefined, signal ? { signal } : undefined),
        OPENCODE_PROVIDER_AUTH_TIMEOUT_MS,
        "provider.auth",
      );
      setGlobalStore("providerAuth", result.data ?? {});
    } catch {
      setGlobalStore("providerAuth", {});
    }
  };

  const refreshMcp = async (directory?: string) => {
    const result = unwrap(
      await withAbortTimeout(
        (signal) => globalSDK.client().mcp.status({ directory }, signal ? { signal } : undefined),
        OPENCODE_MCP_STATUS_TIMEOUT_MS,
        "mcp.status",
      ),
    ) as McpStatusMap;
    setGlobalStore("mcp", keyFor(directory ?? ""), result as McpStatusMap);
  };

  const refreshLsp = async (directory?: string) => {
    const result = unwrap(
      await withAbortTimeout(
        (signal) => globalSDK.client().lsp.status({ directory }, signal ? { signal } : undefined),
        OPENCODE_LSP_STATUS_TIMEOUT_MS,
        "lsp.status",
      ),
    ) as LspStatus[];
    setGlobalStore("lsp", keyFor(directory ?? ""), result as LspStatus[]);
  };

  const refreshVcs = async (directory: string) => {
    try {
      const result = unwrap(
        await withAbortTimeout(
          (signal) => globalSDK.client().vcs.get({ directory }, signal ? { signal } : undefined),
          OPENCODE_VCS_GET_TIMEOUT_MS,
          "vcs.get",
        ),
      ) as VcsInfo;
      setGlobalStore("vcs", keyFor(directory), result ?? null);
    } catch {
      setGlobalStore("vcs", keyFor(directory), null);
    }
  };

  const refreshProjects = async () => {
    const projects = unwrap(
      await withAbortTimeout(
        (signal) => globalSDK.client().project.list(undefined, signal ? { signal } : undefined),
        OPENCODE_PROJECT_LIST_TIMEOUT_MS,
        "project.list",
      ),
    ) as Project[];
    setGlobalStore("project", projects);
    setProjectMeta(projects);

    const worktrees = Array.from(
      new Set(
        projects
          .map((project) => project.worktree?.trim() ?? "")
          .filter((worktree): worktree is string => Boolean(worktree)),
      ),
    ).filter((worktree) => worktree !== "/");

    for (let index = 0; index < worktrees.length; index += VCS_REFRESH_BATCH_SIZE) {
      const chunk = worktrees.slice(index, index + VCS_REFRESH_BATCH_SIZE);
      await Promise.allSettled(chunk.map((worktree) => refreshVcs(worktree)));
    }
  };

  const refreshDirectory = async (directory: string) => {
    if (!directory) return;
    await Promise.allSettled([refreshMcp(directory), refreshLsp(directory)]);
  };

  const runRefresh = async () => {
    setGlobalStore("ready", false);
    setGlobalStore("error", undefined);

    try {
      const health = unwrap(
        await withAbortTimeout(
          (signal) => globalSDK.client().global.health(signal ? { signal } : undefined),
          OPENCODE_GLOBAL_HEALTH_TIMEOUT_MS,
          "global.health",
        ),
      ) as GlobalHealthResponse;
      if (!health?.healthy) {
        setGlobalStore("error", "Server reported unhealthy status.");
        return;
      }

      if (globalStore.serverVersion && health.version !== globalStore.serverVersion) {
        setGlobalStore("mcp", {});
        setGlobalStore("lsp", {});
        setGlobalStore("project", []);
        setGlobalStore("projectMeta", {});
        setGlobalStore("vcs", {});
      }
      setGlobalStore("serverVersion", health.version);
    } catch (error) {
      setError(error);
      return;
    }

    const criticalResults = await Promise.allSettled([refreshConfig(), refreshProviders(), refreshProviderAuth()]);
    for (const result of criticalResults) {
      if (result.status === "rejected") setError(result.reason);
    }
    setGlobalStore("ready", true);

    const scheduleBackground = (fn: () => void) => {
      if (typeof window === "undefined") {
        fn();
        return;
      }

      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback;
      if (typeof ric === "function") {
        ric(fn, { timeout: 1000 });
        return;
      }
      setTimeout(fn, 250);
    };

    scheduleBackground(() => {
      void Promise.allSettled([refreshProviders({ full: true }), refreshMcp(), refreshLsp(), refreshProjects()]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") setError(result.reason);
        }
      });
    });
  };

  const refresh = async () => {
    if (refreshInFlight) return refreshInFlight;
    const task = runRefresh().finally(() => {
      if (refreshInFlight === task) refreshInFlight = null;
    });
    refreshInFlight = task;
    return task;
  };

  const child = (directory: string): WorkspaceStore => {
    const key = keyFor(directory);
    const existing = children.get(key);
    if (existing) return existing;
    const store = createStore<WorkspaceState>(createWorkspaceState());
    children.set(key, store);
    void refreshDirectory(directory);
    if (!subscriptions.has(key)) {
      const unsubscribe = globalSDK.event.listen((payload) => {
        if (payload.name !== key) return;
        const event = payload.details as Event;
        if (event.type === "lsp.updated") {
          void refreshLsp(directory);
        }
        if (event.type === "mcp.tools.changed") {
          void refreshMcp(directory);
        }
      });
      subscriptions.set(key, unsubscribe);
    }
    return store;
  };

  const value: GlobalSyncContextValue = {
    data: globalStore,
    set: setGlobalStore,
    child,
    refresh,
    refreshDirectory,
  };

  createEffect(() => {
    const url = globalSDK.url();
    if (!url) return;
    void refresh();
  });

  const globalKey = keyFor("");
  if (!subscriptions.has(globalKey)) {
    const unsubscribe = globalSDK.event.listen((payload) => {
      if (payload.name !== globalKey) return;
      const event = payload.details as Event;
      if (event.type === "lsp.updated") {
        void refreshLsp();
      }
      if (event.type === "mcp.tools.changed") {
        void refreshMcp();
      }
    });
    subscriptions.set(globalKey, unsubscribe);
  }

  return <GlobalSyncContext.Provider value={value}>{props.children}</GlobalSyncContext.Provider>;
}

export function useGlobalSync() {
  const context = useContext(GlobalSyncContext);
  if (!context) {
    throw new Error("Global sync context is missing");
  }
  return context;
}
