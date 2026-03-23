export function isAbortLikeError(error: unknown): boolean {
  const name = (error && typeof error === "object" && "name" in error ? (error as any).name : "") as string;
  if (name === "AbortError") return true;
  if (error instanceof Error) {
    return /\babort(ed|ing)?\b/i.test(error.message);
  }
  return false;
}

export function isTransientRequestError(error: unknown): boolean {
  if (isAbortLikeError(error)) return true;
  return error instanceof Error && error.message === "Request timed out.";
}

export function resolveAbortLikeError(
  error: unknown,
  options: { didTimeout: boolean; upstreamAborted: boolean },
): unknown {
  if (!isAbortLikeError(error)) return error;
  if (options.didTimeout) {
    return new Error("Request timed out.");
  }
  if (options.upstreamAborted) {
    return error;
  }
  return error;
}
