import { describe, expect, test } from "bun:test";

import {
  resolveDocumentSessionReconnectRecoveryToken,
  resolveDocumentSessionTimedOutRecoveryToken,
} from "./document-session-recovery";

describe("resolveDocumentSessionReconnectRecoveryToken", () => {
  test("queues recovery when a session returns from disconnected to connected", () => {
    expect(
      resolveDocumentSessionReconnectRecoveryToken({
        previousStatus: "disconnected",
        nextStatus: "connected",
        workspaceId: "ws_1",
        sessionId: "ses_1",
      }),
    ).toBe("ws_1:ses_1:disconnected->connected");
  });

  test("queues recovery when a limited session becomes fully connected", () => {
    expect(
      resolveDocumentSessionReconnectRecoveryToken({
        previousStatus: "limited",
        nextStatus: "connected",
        workspaceId: "ws_1",
        sessionId: "ses_1",
      }),
    ).toBe("ws_1:ses_1:limited->connected");
  });

  test("skips recovery when the page is already connected", () => {
    expect(
      resolveDocumentSessionReconnectRecoveryToken({
        previousStatus: "connected",
        nextStatus: "connected",
        workspaceId: "ws_1",
        sessionId: "ses_1",
      }),
    ).toBeNull();
  });

  test("skips recovery when the session identity is incomplete", () => {
    expect(
      resolveDocumentSessionReconnectRecoveryToken({
        previousStatus: "disconnected",
        nextStatus: "connected",
        workspaceId: "",
        sessionId: "ses_1",
      }),
    ).toBeNull();
    expect(
      resolveDocumentSessionReconnectRecoveryToken({
        previousStatus: "disconnected",
        nextStatus: "connected",
        workspaceId: "ws_1",
        sessionId: "",
      }),
    ).toBeNull();
  });
});

describe("resolveDocumentSessionTimedOutRecoveryToken", () => {
  test("queues recovery only for the explicit request timeout banner", () => {
    expect(
      resolveDocumentSessionTimedOutRecoveryToken({
        error: "Request timed out.",
        workspaceId: "ws_1",
        sessionId: "ses_1",
      }),
    ).toBe("ws_1:ses_1:request-timeout");
  });

  test("skips recovery for other errors or incomplete identities", () => {
    expect(
      resolveDocumentSessionTimedOutRecoveryToken({
        error: "OpenWork server not connected.",
        workspaceId: "ws_1",
        sessionId: "ses_1",
      }),
    ).toBeNull();
    expect(
      resolveDocumentSessionTimedOutRecoveryToken({
        error: "Request timed out.",
        workspaceId: "",
        sessionId: "ses_1",
      }),
    ).toBeNull();
    expect(
      resolveDocumentSessionTimedOutRecoveryToken({
        error: "Request timed out.",
        workspaceId: "ws_1",
        sessionId: "",
      }),
    ).toBeNull();
  });
});
