import { afterEach, describe, expect, test } from "bun:test";
import { createRoot, createSignal } from "solid-js";

import { createSessionStore, type SessionModelState } from "./session";

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createSessionStore runtime directory hydration", () => {
  let disposeCurrent: (() => void) | null = null;

  afterEach(() => {
    disposeCurrent?.();
    disposeCurrent = null;
  });

  test("hydrates the selected session directory before loading messages", async () => {
    const callOrder: string[] = [];

    const runtimeDirectory = "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-1";
    const workspaceRoot = "/root/.openwork/user-workspaces/user-1";

    const store = createRoot((dispose) => {
      disposeCurrent = dispose;
      const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
      const [sessionModelState, setSessionModelState] = createSignal<SessionModelState>({
        overrides: {},
        resolved: {},
      });

      const client = {
        event: {
          subscribe: async (_input?: { directory?: string }, options?: { signal?: AbortSignal }) => ({
            stream: (async function* () {
              await new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            })(),
          }),
        },
        global: {
          health: async () => {
            callOrder.push("global.health");
            return { data: { healthy: true } };
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.get:${sessionID}`);
            return {
              data: {
                id: sessionID,
                title: "Runtime session",
                slug: null,
                directory: runtimeDirectory,
                time: { created: 1, updated: 2 },
              },
            };
          },
          messages: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.messages:${sessionID}`);
            return { data: [] };
          },
          todo: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.todo:${sessionID}`);
            return { data: [] };
          },
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as any;

      const store = createSessionStore({
        client: () => client,
        activeWorkspaceRoot: () => workspaceRoot,
        selectedSessionId,
        setSelectedSessionId,
        sessionModelState,
        setSessionModelState: (updater) => {
          const next = updater(sessionModelState());
          setSessionModelState(next);
          return next;
        },
        lastUserModelFromMessages: () => null,
        developerMode: () => false,
        setError: () => undefined,
        setSseConnected: () => undefined,
      });

      store.setSessions([
        {
          id: "ses_1",
          title: "Runtime session",
          slug: null,
          directory: "",
          time: { created: 1, updated: 1 },
        } as any,
      ]);

      return store;
    });

    await wait();
    await store.selectSession("ses_1");
    await wait();

    expect(callOrder).toEqual([
      "global.health",
      "session.get:ses_1",
      "session.messages:ses_1",
      "session.todo:ses_1",
    ]);
    expect(store.sessions().find((session) => session.id === "ses_1")?.directory).toBe(runtimeDirectory);
  });

  test("retries transient message hydration failures before giving up", async () => {
    const callOrder: string[] = [];

    const runtimeDirectory = "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-1";
    const workspaceRoot = "/root/.openwork/user-workspaces/user-1";
    let messageAttempts = 0;

    const store = createRoot((dispose) => {
      disposeCurrent = dispose;
      const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>("ses_1");
      const [sessionModelState, setSessionModelState] = createSignal<SessionModelState>({
        overrides: {},
        resolved: {},
      });

      const client = {
        event: {
          subscribe: async (_input?: { directory?: string }, options?: { signal?: AbortSignal }) => ({
            stream: (async function* () {
              await new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            })(),
          }),
        },
        global: {
          health: async () => {
            callOrder.push("global.health");
            return { data: { healthy: true } };
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.get:${sessionID}`);
            return {
              data: {
                id: sessionID,
                title: "Runtime session",
                slug: null,
                directory: runtimeDirectory,
                time: { created: 1, updated: 2 },
              },
            };
          },
          messages: async ({ sessionID }: { sessionID: string }) => {
            messageAttempts += 1;
            callOrder.push(`session.messages:${sessionID}:${messageAttempts}`);
            if (messageAttempts < 3) {
              throw new Error("401 Unauthorized");
            }
            return { data: [] };
          },
          todo: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.todo:${sessionID}`);
            return { data: [] };
          },
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as any;

      const store = createSessionStore({
        client: () => client,
        activeWorkspaceRoot: () => workspaceRoot,
        selectedSessionId,
        setSelectedSessionId,
        sessionModelState,
        setSessionModelState: (updater) => {
          const next = updater(sessionModelState());
          setSessionModelState(next);
          return next;
        },
        lastUserModelFromMessages: () => null,
        developerMode: () => false,
        setError: () => undefined,
        setSseConnected: () => undefined,
      });

      store.setSessions([
        {
          id: "ses_1",
          title: "Runtime session",
          slug: null,
          directory: "",
          time: { created: 1, updated: 1 },
        } as any,
      ]);

      return store;
    });

    await wait();
    await store.selectSession("ses_1");
    await wait();

    expect(callOrder).toEqual([
      "global.health",
      "session.get:ses_1",
      "session.messages:ses_1:1",
      "session.messages:ses_1:2",
      "session.messages:ses_1:3",
      "session.todo:ses_1",
    ]);
    expect(store.sessions().find((session) => session.id === "ses_1")?.directory).toBe(runtimeDirectory);
  });

  test("surfaces an error when todo hydration fails after a prior successful load", async () => {
    const callOrder: string[] = [];
    const errors: Array<string | null> = [];

    const runtimeDirectory = "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-1";
    const workspaceRoot = "/root/.openwork/user-workspaces/user-1";
    let todoAttempts = 0;

    const store = createRoot((dispose) => {
      disposeCurrent = dispose;
      const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
      const [sessionModelState, setSessionModelState] = createSignal<SessionModelState>({
        overrides: {},
        resolved: {},
      });

      const client = {
        event: {
          subscribe: async (_input?: { directory?: string }, options?: { signal?: AbortSignal }) => ({
            stream: (async function* () {
              await new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            })(),
          }),
        },
        global: {
          health: async () => {
            callOrder.push("global.health");
            return { data: { healthy: true } };
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.get:${sessionID}`);
            return {
              data: {
                id: sessionID,
                title: "Runtime session",
                slug: null,
                directory: runtimeDirectory,
                time: { created: 1, updated: 2 },
              },
            };
          },
          messages: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.messages:${sessionID}`);
            return { data: [] };
          },
          todo: async ({ sessionID }: { sessionID: string }) => {
            todoAttempts += 1;
            callOrder.push(`session.todo:${sessionID}:${todoAttempts}`);
            if (todoAttempts === 1) {
              return { data: [] };
            }
            throw new Error("todo timed out");
          },
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as any;

      const store = createSessionStore({
        client: () => client,
        activeWorkspaceRoot: () => workspaceRoot,
        selectedSessionId,
        setSelectedSessionId,
        sessionModelState,
        setSessionModelState: (updater) => {
          const next = updater(sessionModelState());
          setSessionModelState(next);
          return next;
        },
        lastUserModelFromMessages: () => null,
        developerMode: () => false,
        setError: (message) => {
          errors.push(message);
        },
        setSseConnected: () => undefined,
      });

      store.setSessions([
        {
          id: "ses_1",
          title: "Runtime session",
          slug: null,
          directory: runtimeDirectory,
          time: { created: 1, updated: 1 },
        } as any,
      ]);

      return store;
    });

    await store.selectSession("ses_1");
    await wait();
    expect(callOrder).toEqual([
      "global.health",
      "session.messages:ses_1",
      "session.todo:ses_1:1",
    ]);

    await store.selectSession("ses_1");
    await wait();

    expect(callOrder).toEqual([
      "global.health",
      "session.messages:ses_1",
      "session.todo:ses_1:1",
      "global.health",
      "session.messages:ses_1",
      "session.todo:ses_1:2",
    ]);
    expect(errors).toContain("Failed to load session tasks: todo timed out");
  });

  test("skips session.get when the selected session already has a runtime directory", async () => {
    const callOrder: string[] = [];

    const runtimeDirectory = "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-1";
    const workspaceRoot = "/root/.openwork/user-workspaces/user-1";

    const store = createRoot((dispose) => {
      disposeCurrent = dispose;
      const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
      const [sessionModelState, setSessionModelState] = createSignal<SessionModelState>({
        overrides: {},
        resolved: {},
      });

      const client = {
        event: {
          subscribe: async (_input?: { directory?: string }, options?: { signal?: AbortSignal }) => ({
            stream: (async function* () {
              await new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            })(),
          }),
        },
        global: {
          health: async () => {
            callOrder.push("global.health");
            return { data: { healthy: true } };
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.get:${sessionID}`);
            return {
              data: {
                id: sessionID,
                title: "Runtime session",
                slug: null,
                directory: runtimeDirectory,
                time: { created: 1, updated: 2 },
              },
            };
          },
          messages: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.messages:${sessionID}`);
            return { data: [] };
          },
          todo: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.todo:${sessionID}`);
            return { data: [] };
          },
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as any;

      const store = createSessionStore({
        client: () => client,
        activeWorkspaceRoot: () => workspaceRoot,
        selectedSessionId,
        setSelectedSessionId,
        sessionModelState,
        setSessionModelState: (updater) => {
          const next = updater(sessionModelState());
          setSessionModelState(next);
          return next;
        },
        lastUserModelFromMessages: () => null,
        developerMode: () => false,
        setError: () => undefined,
        setSseConnected: () => undefined,
      });

      store.setSessions([
        {
          id: "ses_1",
          title: "Runtime session",
          slug: null,
          directory: runtimeDirectory,
          time: { created: 1, updated: 1 },
        } as any,
      ]);

      return store;
    });

    await wait();
    await store.selectSession("ses_1");
    await wait();

    expect(callOrder).toEqual([
      "global.health",
      "session.messages:ses_1",
      "session.todo:ses_1",
    ]);
  });

  test("hydrates the selected session when the cached directory is only the workspace root", async () => {
    const callOrder: string[] = [];

    const runtimeDirectory = "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-1";
    const workspaceRoot = "/root/.openwork/user-workspaces/user-1";

    const store = createRoot((dispose) => {
      disposeCurrent = dispose;
      const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
      const [sessionModelState, setSessionModelState] = createSignal<SessionModelState>({
        overrides: {},
        resolved: {},
      });

      const client = {
        event: {
          subscribe: async (_input?: { directory?: string }, options?: { signal?: AbortSignal }) => ({
            stream: (async function* () {
              await new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            })(),
          }),
        },
        global: {
          health: async () => {
            callOrder.push("global.health");
            return { data: { healthy: true } };
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.get:${sessionID}`);
            return {
              data: {
                id: sessionID,
                title: "Runtime session",
                slug: null,
                directory: runtimeDirectory,
                time: { created: 1, updated: 2 },
              },
            };
          },
          messages: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.messages:${sessionID}`);
            return { data: [] };
          },
          todo: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.todo:${sessionID}`);
            return { data: [] };
          },
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as any;

      const store = createSessionStore({
        client: () => client,
        activeWorkspaceRoot: () => workspaceRoot,
        selectedSessionId,
        setSelectedSessionId,
        sessionModelState,
        setSessionModelState: (updater) => {
          const next = updater(sessionModelState());
          setSessionModelState(next);
          return next;
        },
        lastUserModelFromMessages: () => null,
        developerMode: () => false,
        setError: () => undefined,
        setSseConnected: () => undefined,
      });

      store.setSessions([
        {
          id: "ses_1",
          title: "Runtime session",
          slug: null,
          directory: workspaceRoot,
          time: { created: 1, updated: 1 },
        } as any,
      ]);

      return store;
    });

    await wait();
    await store.selectSession("ses_1");
    await wait();

    expect(callOrder).toEqual([
      "global.health",
      "session.get:ses_1",
      "session.messages:ses_1",
      "session.todo:ses_1",
    ]);
    expect(store.sessions().find((session) => session.id === "ses_1")?.directory).toBe(runtimeDirectory);
  });

  test("hydrates the selected session when the cached directory is only the sessions root", async () => {
    const callOrder: string[] = [];

    const runtimeDirectory = "/root/.openwork/user-workspaces/user-1/documents/sessions/runtime-1";
    const workspaceRoot = "/root/.openwork/user-workspaces/user-1";
    const sessionsRoot = "/root/.openwork/user-workspaces/user-1/documents/sessions";

    const store = createRoot((dispose) => {
      disposeCurrent = dispose;
      const [selectedSessionId, setSelectedSessionId] = createSignal<string | null>(null);
      const [sessionModelState, setSessionModelState] = createSignal<SessionModelState>({
        overrides: {},
        resolved: {},
      });

      const client = {
        event: {
          subscribe: async (_input?: { directory?: string }, options?: { signal?: AbortSignal }) => ({
            stream: (async function* () {
              await new Promise<void>((resolve) => {
                options?.signal?.addEventListener("abort", () => resolve(), { once: true });
              });
            })(),
          }),
        },
        global: {
          health: async () => {
            callOrder.push("global.health");
            return { data: { healthy: true } };
          },
        },
        session: {
          get: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.get:${sessionID}`);
            return {
              data: {
                id: sessionID,
                title: "Runtime session",
                slug: null,
                directory: runtimeDirectory,
                time: { created: 1, updated: 2 },
              },
            };
          },
          messages: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.messages:${sessionID}`);
            return { data: [] };
          },
          todo: async ({ sessionID }: { sessionID: string }) => {
            callOrder.push(`session.todo:${sessionID}`);
            return { data: [] };
          },
        },
        permission: {
          list: async () => ({ data: [] }),
        },
        question: {
          list: async () => ({ data: [] }),
        },
      } as any;

      const store = createSessionStore({
        client: () => client,
        activeWorkspaceRoot: () => workspaceRoot,
        selectedSessionId,
        setSelectedSessionId,
        sessionModelState,
        setSessionModelState: (updater) => {
          const next = updater(sessionModelState());
          setSessionModelState(next);
          return next;
        },
        lastUserModelFromMessages: () => null,
        developerMode: () => false,
        setError: () => undefined,
        setSseConnected: () => undefined,
      });

      store.setSessions([
        {
          id: "ses_1",
          title: "Runtime session",
          slug: null,
          directory: sessionsRoot,
          time: { created: 1, updated: 1 },
        } as any,
      ]);

      return store;
    });

    await wait();
    await store.selectSession("ses_1");
    await wait();

    expect(callOrder).toEqual([
      "global.health",
      "session.get:ses_1",
      "session.messages:ses_1",
      "session.todo:ses_1",
    ]);
    expect(store.sessions().find((session) => session.id === "ses_1")?.directory).toBe(runtimeDirectory);
  });
});
