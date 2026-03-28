import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHostedOpenworkClientOptions,
  buildHostedSessionCreateBody,
  findHostedSessionRecord,
} from "./_util.mjs";

test("buildHostedOpenworkClientOptions omits directory so hosted sessions stay runtime-scoped", () => {
  const options = buildHostedOpenworkClientOptions({
    baseUrl: "http://example.com/openwork/",
    workspaceId: "user-123",
    token: "secret-token",
  });

  assert.equal(options.baseUrl, "http://example.com/openwork/w/user-123/opencode");
  assert.deepEqual(options.headers, { Authorization: "Bearer secret-token" });
  assert.equal(options.responseStyle, "data");
  assert.equal(options.throwOnError, true);
  assert.ok(!("directory" in options));
});

test("buildHostedSessionCreateBody includes explicit runtime profile hints only when provided", () => {
  assert.deepEqual(
    buildHostedSessionCreateBody({
      title: "writer session",
      enableDocumentState: true,
      preferredView: "document-writer",
      preferredAgent: "document-writer",
      preferredAgentLock: "document-writer",
    }),
    {
      title: "writer session",
      openworkEnableDocState: true,
      openworkPreferredView: "document-writer",
      openworkPreferredAgent: "document-writer",
      openworkPreferredAgentLock: "document-writer",
    },
  );

  assert.deepEqual(
    buildHostedSessionCreateBody({
      title: "default session",
      enableDocumentState: false,
      preferredView: null,
      preferredAgent: undefined,
      preferredAgentLock: "",
    }),
    {
      title: "default session",
    },
  );
});

test("findHostedSessionRecord returns the exact listed session and keeps profile preferences", () => {
  const record = findHostedSessionRecord(
    {
      items: [
        {
          id: "ses_other",
          openworkPreferredView: null,
          openworkPreferredAgent: null,
          openworkPreferredAgentLock: null,
        },
        {
          id: "ses_writer",
          openworkPreferredView: "document-writer",
          openworkPreferredAgent: "document-writer",
          openworkPreferredAgentLock: "document-writer",
        },
      ],
    },
    "ses_writer",
  );

  assert.deepEqual(record, {
    id: "ses_writer",
    openworkPreferredView: "document-writer",
    openworkPreferredAgent: "document-writer",
    openworkPreferredAgentLock: "document-writer",
  });
});
