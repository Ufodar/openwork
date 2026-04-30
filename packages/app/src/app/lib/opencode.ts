import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

import { isTauriRuntime } from "../utils";
import { resolveAbortLikeError } from "./request-abort";

type FieldsResult<T> =
  | ({ data: T; error?: undefined } & { request: Request; response: Response })
  | ({ data?: undefined; error: unknown } & { request: Request; response: Response });

export type OpencodeAuth = {
  username?: string;
  password?: string;
  token?: string;
  mode?: "basic" | "openwork";
};

const DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS = 60_000;

async function fetchWithTimeout(
  fetchImpl: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number,
) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fetchImpl(input, init);
  }

  const upstreamSignal = init?.signal;
  const timeoutController = typeof AbortController !== "undefined" ? new AbortController() : null;
  const canComposeSignals = typeof AbortSignal !== "undefined" && typeof AbortSignal.any === "function";
  const signal =
    upstreamSignal && timeoutController && canComposeSignals
      ? AbortSignal.any([upstreamSignal, timeoutController.signal])
      : timeoutController?.signal ?? upstreamSignal;
  const initWithSignal = signal ? { ...(init ?? {}), signal } : init;

  // Fallback for runtimes without AbortController support.
  if (!timeoutController) {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("Request timed out.")), timeoutMs);
    });
    try {
      return await Promise.race([fetchImpl(input, initWithSignal), timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  try {
    let didTimeout = false;
    // Fallback linking when AbortSignal.any is unavailable.
    if (upstreamSignal && !canComposeSignals) {
      const relayAbort = () => {
        try {
          timeoutController.abort((upstreamSignal as { reason?: unknown }).reason);
        } catch {
          try {
            timeoutController.abort();
          } catch {
            // ignore
          }
        }
      };
      if (upstreamSignal.aborted) {
        relayAbort();
      } else {
        // Use once:true and do not remove in finally so long-lived streaming
        // requests (e.g. SSE) still observe upstream cancellation after headers.
        try {
          upstreamSignal.addEventListener("abort", relayAbort, { once: true });
        } catch {
          // ignore
        }
      }
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    timeoutId = setTimeout(() => {
      didTimeout = true;
      try {
        timeoutController.abort(new Error("Request timed out."));
      } catch {
        try {
          timeoutController.abort();
        } catch {
          // ignore
        }
      }
    }, timeoutMs);

    try {
      return await fetchImpl(input, initWithSignal);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  } catch (error) {
    const name = (error && typeof error === "object" && "name" in error ? (error as any).name : "") as string;
    if (name === "AbortError") {
      throw resolveAbortLikeError(error, {
        didTimeout,
        upstreamAborted: Boolean(upstreamSignal?.aborted),
      });
    }
    throw error;
  }
}

const encodeBasicAuth = (auth?: OpencodeAuth) => {
  if (!auth?.username || !auth?.password) return null;
  const token = `${auth.username}:${auth.password}`;
  if (typeof btoa === "function") return btoa(token);
  const buffer = (globalThis as { Buffer?: { from: (input: string, encoding: string) => { toString: (encoding: string) => string } } })
    .Buffer;
  return buffer ? buffer.from(token, "utf8").toString("base64") : null;
};

const resolveAuthHeader = (auth?: OpencodeAuth) => {
  if (auth?.mode === "openwork" && auth.token) {
    return `Bearer ${auth.token}`;
  }
  const encoded = encodeBasicAuth(auth);
  return encoded ? `Basic ${encoded}` : null;
};

const createTauriFetch = (auth?: OpencodeAuth) => {
  const authHeader = resolveAuthHeader(auth);
  const addAuth = (headers: Headers) => {
    if (!authHeader || headers.has("Authorization")) return;
    headers.set("Authorization", authHeader);
  };

  return (input: RequestInfo | URL, init?: RequestInit) => {
    if (input instanceof Request) {
      const headers = new Headers(input.headers);
      addAuth(headers);
      const request = new Request(input, { headers });
      return fetchWithTimeout(
        tauriFetch as unknown as typeof globalThis.fetch,
        request,
        undefined,
        DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS,
      );
    }

    const headers = new Headers(init?.headers);
    addAuth(headers);
    return fetchWithTimeout(
      tauriFetch as unknown as typeof globalThis.fetch,
      input,
      {
        ...init,
        headers,
      },
      DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS,
    );
  };
};

export function unwrap<T>(result: FieldsResult<T>): NonNullable<T> {
  if (result.data !== undefined) {
    return result.data as NonNullable<T>;
  }
  const message =
    result.error instanceof Error
      ? result.error.message
      : typeof result.error === "string"
        ? result.error
        : JSON.stringify(result.error);
  throw new Error(message || "Unknown error");
}

export function createClient(baseUrl: string, directory?: string, auth?: OpencodeAuth) {
  const headers: Record<string, string> = {};
  if (!isTauriRuntime()) {
    const authHeader = resolveAuthHeader(auth);
    if (authHeader) {
      headers.Authorization = authHeader;
    }
  }

  const fetchImpl = isTauriRuntime()
    ? createTauriFetch(auth)
    : (input: RequestInfo | URL, init?: RequestInit) =>
        fetchWithTimeout(globalThis.fetch, input, init, DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS);
  return createOpencodeClient({
    baseUrl,
    directory,
    headers: Object.keys(headers).length ? headers : undefined,
    fetch: fetchImpl,
  });
}

export async function waitForHealthy(
  client: ReturnType<typeof createClient>,
  options?: { timeoutMs?: number; pollMs?: number },
) {
  const timeoutMs = options?.timeoutMs ?? 60_000;
  const pollMs = options?.pollMs ?? 250;

  const start = Date.now();
  let lastError: string | null = null;

  while (Date.now() - start < timeoutMs) {
    try {
      const health = unwrap(await client.global.health());
      if (health.healthy) {
        return health;
      }
      lastError = "Server reported unhealthy";
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown error";
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error(lastError ?? "Timed out waiting for server health");
}
