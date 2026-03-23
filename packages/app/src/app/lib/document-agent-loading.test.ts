import { expect, test } from "bun:test";

import { shouldShowDocumentAgentChatLoading } from "./document-agent-loading";

test("keeps the document agent chat visible once session documents have loaded", () => {
  expect(
    shouldShowDocumentAgentChatLoading({
      sessionHydrating: true,
      messageCount: 0,
      documentsReady: true,
    }),
  ).toBe(false);
});

test("shows the document agent chat loading state while the session is hydrating and documents are still loading", () => {
  expect(
    shouldShowDocumentAgentChatLoading({
      sessionHydrating: true,
      messageCount: 0,
      documentsReady: false,
    }),
  ).toBe(true);
});

test("hides the document agent chat loading state once there are chat messages", () => {
  expect(
    shouldShowDocumentAgentChatLoading({
      sessionHydrating: true,
      messageCount: 1,
      documentsReady: false,
    }),
  ).toBe(false);
});
