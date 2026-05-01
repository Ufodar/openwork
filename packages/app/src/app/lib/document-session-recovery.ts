import { createEffect, createSignal, on, type Accessor } from "solid-js";

import type { OpenworkServerStatus } from "./openwork-server";

export function resolveDocumentSessionReconnectRecoveryToken(input: {
  previousStatus: OpenworkServerStatus | undefined;
  nextStatus: OpenworkServerStatus;
  workspaceId: string;
  sessionId: string;
}) {
  const workspace = input.workspaceId.trim();
  const session = input.sessionId.trim();
  if (!workspace || !session) return null;
  if (input.nextStatus !== "connected" || input.previousStatus === "connected") return null;
  return `${workspace}:${session}:${input.previousStatus ?? "unknown"}->connected`;
}

export function resolveDocumentSessionTimedOutRecoveryToken(input: {
  error: string | null | undefined;
  workspaceId: string;
  sessionId: string;
}) {
  const workspace = input.workspaceId.trim();
  const session = input.sessionId.trim();
  const error = input.error?.trim() ?? "";
  if (!workspace || !session) return null;
  if (error !== "Request timed out.") return null;
  return `${workspace}:${session}:request-timeout`;
}

export function createDocumentSessionReconnectRecovery(options: {
  serverStatus: Accessor<OpenworkServerStatus>;
  workspaceId: Accessor<string>;
  sessionId: Accessor<string>;
  ready: Accessor<boolean>;
  recover: (sessionId: string) => Promise<void>;
}) {
  const [pendingRecoveryToken, setPendingRecoveryToken] = createSignal<string | null>(null);
  const [completedRecoveryToken, setCompletedRecoveryToken] = createSignal<string | null>(null);
  const [runningRecoveryToken, setRunningRecoveryToken] = createSignal<string | null>(null);

  createEffect(
    on([options.workspaceId, options.sessionId], () => {
      setPendingRecoveryToken(null);
      setCompletedRecoveryToken(null);
      setRunningRecoveryToken(null);
    }),
  );

  createEffect(
    on(options.serverStatus, (nextStatus, previousStatus) => {
      const token = resolveDocumentSessionReconnectRecoveryToken({
        previousStatus,
        nextStatus,
        workspaceId: options.workspaceId(),
        sessionId: options.sessionId(),
      });
      if (!token) return;
      setPendingRecoveryToken(token);
    }),
  );

  createEffect(() => {
    const token = pendingRecoveryToken();
    if (!token) return;
    if (!options.ready()) return;
    if (runningRecoveryToken() === token || completedRecoveryToken() === token) return;

    const session = options.sessionId().trim();
    if (!session) return;

    setRunningRecoveryToken(token);
    void (async () => {
      try {
        await options.recover(session);
        setCompletedRecoveryToken(token);
      } finally {
        setRunningRecoveryToken((current) => (current === token ? null : current));
        setPendingRecoveryToken((current) => (current === token ? null : current));
      }
    })();
  });
}

export function createDocumentSessionTimedOutRecovery(options: {
  error: Accessor<string | null | undefined>;
  workspaceId: Accessor<string>;
  sessionId: Accessor<string>;
  ready: Accessor<boolean>;
  recover: (sessionId: string) => Promise<void>;
}) {
  const [pendingRecoveryToken, setPendingRecoveryToken] = createSignal<string | null>(null);
  const [completedRecoveryToken, setCompletedRecoveryToken] = createSignal<string | null>(null);
  const [runningRecoveryToken, setRunningRecoveryToken] = createSignal<string | null>(null);

  createEffect(
    on([options.workspaceId, options.sessionId], () => {
      setPendingRecoveryToken(null);
      setCompletedRecoveryToken(null);
      setRunningRecoveryToken(null);
    }),
  );

  createEffect(
    on(options.error, (nextError) => {
      const token = resolveDocumentSessionTimedOutRecoveryToken({
        error: nextError,
        workspaceId: options.workspaceId(),
        sessionId: options.sessionId(),
      });
      if (!token) {
        setPendingRecoveryToken(null);
        setCompletedRecoveryToken(null);
        setRunningRecoveryToken(null);
        return;
      }
      setPendingRecoveryToken(token);
    }),
  );

  createEffect(() => {
    const token = pendingRecoveryToken();
    if (!token) return;
    if (!options.ready()) return;
    if (runningRecoveryToken() === token || completedRecoveryToken() === token) return;

    const session = options.sessionId().trim();
    if (!session) return;

    setRunningRecoveryToken(token);
    void (async () => {
      let succeeded = false;
      try {
        await options.recover(session);
        succeeded = true;
        setCompletedRecoveryToken(token);
      } finally {
        if (!succeeded) {
          setCompletedRecoveryToken((current) => (current === token ? null : current));
        }
        setRunningRecoveryToken((current) => (current === token ? null : current));
        setPendingRecoveryToken((current) => (current === token ? null : current));
      }
    })();
  });
}
