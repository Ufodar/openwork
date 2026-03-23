import { describe, expect, test } from "bun:test";

import { isAbortLikeError, resolveAbortLikeError } from "./request-abort";

describe("resolveAbortLikeError", () => {
  test("maps timed out aborts to a timeout error", () => {
    const error = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

    const next = resolveAbortLikeError(error, {
      didTimeout: true,
      upstreamAborted: false,
    });

    expect(next).toBeInstanceOf(Error);
    expect(next.message).toBe("Request timed out.");
  });

  test("preserves caller-triggered aborts", () => {
    const error = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });

    const next = resolveAbortLikeError(error, {
      didTimeout: false,
      upstreamAborted: true,
    });

    expect(next).toBe(error);
  });

  test("preserves non-timeout aborts so callers can ignore them", () => {
    const error = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });

    const next = resolveAbortLikeError(error, {
      didTimeout: false,
      upstreamAborted: false,
    });

    expect(next).toBe(error);
  });
});

describe("isAbortLikeError", () => {
  test("recognizes AbortError instances", () => {
    const error = Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    expect(isAbortLikeError(error)).toBe(true);
  });

  test("does not treat generic errors as aborts", () => {
    expect(isAbortLikeError(new Error("Request timed out."))).toBe(false);
  });
});
