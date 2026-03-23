import { For, Show, createEffect, createSignal, on, onCleanup } from "solid-js";

import Button from "../components/button";
import type {
  OpenworkAdminSession,
  OpenworkAdminUser,
  OpenworkAdminWarning,
  OpenworkServerClient,
} from "../lib/openwork-server";
import { isTransientRequestError } from "../lib/request-abort";

type SessionStatus = "idle" | "loading" | "ready" | "error";

export type AdminUsersViewProps = {
  active: boolean;
  enabled: boolean;
  client: OpenworkServerClient | null;
  onOpenSession: (session: OpenworkAdminSession) => Promise<void>;
};

function formatDateTime(value: number | null | undefined): string {
  if (!value || !Number.isFinite(value)) return "未知";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(value);
  } catch {
    return new Date(value).toLocaleString();
  }
}

export default function AdminUsersView(props: AdminUsersViewProps) {
  const [users, setUsers] = createSignal<OpenworkAdminUser[]>([]);
  const [warnings, setWarnings] = createSignal<OpenworkAdminWarning[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [initialLoadAttempted, setInitialLoadAttempted] = createSignal(false);
  const [expandedUserId, setExpandedUserId] = createSignal<string | null>(null);
  const [sessionsByUserId, setSessionsByUserId] = createSignal<Record<string, OpenworkAdminSession[]>>({});
  const [sessionWarningsByUserId, setSessionWarningsByUserId] = createSignal<Record<string, OpenworkAdminWarning[]>>({});
  const [sessionStatusByUserId, setSessionStatusByUserId] = createSignal<Record<string, SessionStatus>>({});
  const [sessionErrorByUserId, setSessionErrorByUserId] = createSignal<Record<string, string | null>>({});
  const [openingSessionId, setOpeningSessionId] = createSignal<string | null>(null);
  let usersRetryTimer: ReturnType<typeof setTimeout> | null = null;
  const sessionRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const clearUsersRetryTimer = () => {
    if (!usersRetryTimer) return;
    clearTimeout(usersRetryTimer);
    usersRetryTimer = null;
  };

  const clearSessionRetryTimer = (userId: string) => {
    const timer = sessionRetryTimers.get(userId);
    if (!timer) return;
    clearTimeout(timer);
    sessionRetryTimers.delete(userId);
  };

  const scheduleUsersRetry = () => {
    if (usersRetryTimer || !props.active || !props.enabled || !props.client) return;
    usersRetryTimer = setTimeout(() => {
      usersRetryTimer = null;
      void loadUsers(true);
    }, 750);
  };

  const scheduleSessionRetry = (userId: string) => {
    if (sessionRetryTimers.has(userId) || !props.active || !props.enabled || !props.client) return;
    const timer = setTimeout(() => {
      sessionRetryTimers.delete(userId);
      void loadSessions(userId, true);
    }, 750);
    sessionRetryTimers.set(userId, timer);
  };

  const loadUsers = async (force = false) => {
    if (!props.enabled) return;
    if (!props.client) {
      setError("OpenWork 服务未连接。");
      return;
    }
    if (busy() && !force) return;

    setBusy(true);
    setError(null);
    try {
      const response = await props.client.adminListUsers();
      clearUsersRetryTimer();
      setUsers(Array.isArray(response.items) ? response.items : []);
      setWarnings(Array.isArray(response.warnings) ? response.warnings : []);
    } catch (err) {
      if (isTransientRequestError(err)) {
        if (!force && users().length === 0) {
          scheduleUsersRetry();
        }
        return;
      }
      setError(err instanceof Error ? err.message : "读取用户列表失败。");
    } finally {
      setBusy(false);
    }
  };

  const loadSessions = async (userId: string, force = false) => {
    const id = userId.trim();
    if (!id || !props.enabled) return;
    if (!props.client) {
      setSessionErrorByUserId((prev) => ({ ...prev, [id]: "OpenWork 服务未连接。" }));
      setSessionStatusByUserId((prev) => ({ ...prev, [id]: "error" }));
      return;
    }
    const status = sessionStatusByUserId()[id] ?? "idle";
    if (!force && (status === "loading" || status === "ready")) return;

    setSessionStatusByUserId((prev) => ({ ...prev, [id]: "loading" }));
    setSessionErrorByUserId((prev) => ({ ...prev, [id]: null }));
    setError(null);
    try {
      const response = await props.client.adminListUserSessions(id);
      clearSessionRetryTimer(id);
      setSessionsByUserId((prev) => ({
        ...prev,
        [id]: Array.isArray(response.items) ? response.items : [],
      }));
      setSessionWarningsByUserId((prev) => ({
        ...prev,
        [id]: Array.isArray(response.warnings) ? response.warnings : [],
      }));
      setSessionStatusByUserId((prev) => ({ ...prev, [id]: "ready" }));
    } catch (err) {
      if (isTransientRequestError(err)) {
        setSessionStatusByUserId((prev) => ({ ...prev, [id]: "idle" }));
        if (!force && (sessionsByUserId()[id]?.length ?? 0) === 0) {
          scheduleSessionRetry(id);
        }
        return;
      }
      setSessionErrorByUserId((prev) => ({
        ...prev,
        [id]: err instanceof Error ? err.message : "读取会话失败。",
      }));
      setSessionStatusByUserId((prev) => ({ ...prev, [id]: "error" }));
    }
  };

  const toggleUser = async (userId: string) => {
    const id = userId.trim();
    if (!id) return;
    setError(null);
    if (expandedUserId() === id) {
      setExpandedUserId(null);
      return;
    }
    setExpandedUserId(id);
    await loadSessions(id);
  };

  const openSession = async (session: OpenworkAdminSession) => {
    if (openingSessionId()) return;
    setError(null);
    setOpeningSessionId(session.id);
    try {
      await props.onOpenSession(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "打开会话失败。");
    } finally {
      setOpeningSessionId(null);
    }
  };

  createEffect(
    on(
      () => [props.enabled, props.client] as const,
      ([enabled, client]) => {
        if (!enabled || !client) {
          setInitialLoadAttempted(false);
        }
      },
    ),
  );

  createEffect(() => {
    if (!props.active || !props.enabled || !props.client) return;
    if (initialLoadAttempted()) return;
    setInitialLoadAttempted(true);
    void loadUsers();
  });

  onCleanup(() => {
    clearUsersRetryTimer();
    for (const userId of sessionRetryTimers.keys()) {
      clearSessionRetryTimer(userId);
    }
  });

  return (
    <div class="mx-auto max-w-5xl px-6 md:px-10 py-8 space-y-6">
      <div class="flex flex-col gap-3 rounded-2xl border border-gray-6 bg-gray-2/60 p-5">
        <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div class="space-y-1">
            <div class="text-lg font-semibold text-gray-12">用户会话</div>
            <div class="text-sm text-gray-10">
              仅管理员可查看全部账号，以及每个账号名下的历史会话。
            </div>
          </div>
          <Button
            variant="secondary"
            class="w-full md:w-auto"
            onClick={() => void loadUsers(true)}
            disabled={!props.enabled || busy()}
          >
            {busy() ? "刷新中..." : "刷新列表"}
          </Button>
        </div>

        <Show when={!props.enabled}>
          <div class="rounded-xl border border-yellow-7/30 bg-yellow-2/50 px-4 py-3 text-sm text-yellow-11">
            当前账号不是管理员，无法查看用户会话。
          </div>
        </Show>

        <Show when={props.enabled && !props.client}>
          <div class="rounded-xl border border-red-7/30 bg-red-2/50 px-4 py-3 text-sm text-red-11">
            OpenWork 服务未连接，无法读取用户列表。
          </div>
        </Show>

        <Show when={error()}>
          <div class="rounded-xl border border-red-7/30 bg-red-2/50 px-4 py-3 text-sm text-red-11">
            {error()}
          </div>
        </Show>

        <Show when={warnings().length}>
          <div class="rounded-xl border border-yellow-7/30 bg-yellow-2/50 px-4 py-3 text-sm text-yellow-11 space-y-1">
            <div class="font-medium">部分工作区读取失败</div>
            <For each={warnings()}>
              {(warning) => (
                <div>{warning.workspaceName}：{warning.message}</div>
              )}
            </For>
          </div>
        </Show>
      </div>

      <div class="space-y-3">
        <Show when={!busy() && !users().length && !error() && props.enabled}>
          <div class="rounded-2xl border border-gray-6 bg-gray-2/50 px-5 py-6 text-sm text-gray-10">
            暂无可显示的用户。
          </div>
        </Show>

        <For each={users()}>
          {(user) => {
            const expanded = () => expandedUserId() === user.id;
            const sessionStatus = () => sessionStatusByUserId()[user.id] ?? "idle";
            const sessionError = () => sessionErrorByUserId()[user.id] ?? null;
            const sessionWarnings = () => sessionWarningsByUserId()[user.id] ?? [];
            const sessionList = () => sessionsByUserId()[user.id] ?? [];

            return (
              <div class="rounded-2xl border border-gray-6 bg-gray-2/50 overflow-hidden">
                <button
                  class="w-full px-5 py-4 text-left flex flex-col gap-3 md:flex-row md:items-center md:justify-between hover:bg-gray-3/40 transition-colors"
                  onClick={() => void toggleUser(user.id)}
                >
                  <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="text-base font-medium text-gray-12">{user.username}</span>
                      <Show when={user.isAdmin}>
                        <span class="rounded-full bg-blue-3 px-2 py-0.5 text-[11px] font-medium text-blue-11">
                          管理员
                        </span>
                      </Show>
                    </div>
                    <div class="text-xs text-gray-10">
                      注册时间：{formatDateTime(user.createdAt)}，最近登录：{formatDateTime(user.lastLoginAt)}
                    </div>
                  </div>

                  <div class="flex items-center justify-between gap-4 text-sm">
                    <span class="text-gray-11">会话数：{user.sessionCount}</span>
                    <span class="text-gray-10">{expanded() ? "收起" : "查看会话"}</span>
                  </div>
                </button>

                <Show when={expanded()}>
                  <div class="border-t border-gray-6 bg-gray-1/50 px-5 py-4 space-y-3">
                    <Show when={sessionWarnings().length}>
                      <div class="rounded-xl border border-yellow-7/30 bg-yellow-2/50 px-4 py-3 text-sm text-yellow-11 space-y-1">
                        <For each={sessionWarnings()}>
                          {(warning) => (
                            <div>{warning.workspaceName}：{warning.message}</div>
                          )}
                        </For>
                      </div>
                    </Show>

                    <Show when={sessionStatus() === "loading"}>
                      <div class="text-sm text-gray-10">正在读取会话...</div>
                    </Show>

                    <Show when={sessionError()}>
                      <div class="rounded-xl border border-red-7/30 bg-red-2/50 px-4 py-3 text-sm text-red-11">
                        {sessionError()}
                      </div>
                    </Show>

                    <Show when={sessionStatus() === "ready" && !sessionList().length}>
                      <div class="text-sm text-gray-10">这个用户当前没有可见会话。</div>
                    </Show>

                    <div class="space-y-2">
                      <For each={sessionList()}>
                        {(session) => (
                          <button
                            class="w-full rounded-xl border border-gray-6 bg-gray-2/70 px-4 py-3 text-left hover:bg-gray-3/50 transition-colors disabled:opacity-60"
                            onClick={() => void openSession(session)}
                            disabled={Boolean(openingSessionId())}
                          >
                            <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                              <div class="space-y-1">
                                <div class="text-sm font-medium text-gray-12">{session.title}</div>
                                <div class="text-xs text-gray-10">
                                  工作区：{session.workspaceName}
                                  <Show when={session.directory}>
                                    <span> · 目录：{session.directory}</span>
                                  </Show>
                                </div>
                              </div>
                              <div class="text-xs text-gray-10">
                                最近更新时间：{formatDateTime(session.updatedAt ?? session.createdAt)}
                              </div>
                            </div>
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
