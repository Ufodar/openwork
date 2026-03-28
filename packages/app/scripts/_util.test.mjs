import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHostedOpenworkClientOptions,
  buildHostedSessionCreateBody,
  fetchHostedSessionRecord,
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

test("fetchHostedSessionRecord scopes the session list to the workspace path so runtime profile metadata is decorated", async () => {
  const originalFetch = globalThis.fetch;
  const seenUrls = [];
  globalThis.fetch = async (input) => {
    seenUrls.push(String(input));
    return new Response(
      JSON.stringify([
        {
          id: "ses_common",
          openworkPreferredView: "document-agent",
          openworkPreferredAgent: "common-work",
          openworkPreferredAgentLock: "common-work",
        },
      ]),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  };

  try {
    const record = await fetchHostedSessionRecord({
      baseUrl: "http://127.0.0.1:8789",
      workspaceId: "ws_1",
      token: "secret-token",
      sessionId: "ses_common",
      workspacePath: "/root/.openwork/user-workspaces/user-1",
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
      timeoutMs: 50,
      pollMs: 1,
    });

    assert.equal(seenUrls.length, 1);
    assert.equal(
      seenUrls[0],
      "http://127.0.0.1:8789/w/ws_1/opencode/session?directory=%2Froot%2F.openwork%2Fuser-workspaces%2Fuser-1",
    );
    assert.equal(record?.openworkPreferredView, "document-agent");
    assert.equal(record?.openworkPreferredAgent, "common-work");
    assert.equal(record?.openworkPreferredAgentLock, "common-work");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchHostedSessionRecord keeps polling until profile metadata matches the requested runtime hints", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = async () => {
    callCount += 1;
    const payload = callCount === 1
      ? [
          {
            id: "ses_common",
            openworkPreferredView: null,
            openworkPreferredAgent: null,
            openworkPreferredAgentLock: null,
          },
        ]
      : [
          {
            id: "ses_common",
            openworkPreferredView: "document-agent",
            openworkPreferredAgent: "common-work",
            openworkPreferredAgentLock: "common-work",
          },
        ];
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const record = await fetchHostedSessionRecord({
      baseUrl: "http://127.0.0.1:8789",
      workspaceId: "ws_1",
      token: "secret-token",
      sessionId: "ses_common",
      workspacePath: "/root/.openwork/user-workspaces/user-1",
      preferredView: "document-agent",
      preferredAgent: "common-work",
      preferredAgentLock: "common-work",
      timeoutMs: 50,
      pollMs: 1,
    });

    assert.equal(callCount, 2);
    assert.equal(record?.openworkPreferredView, "document-agent");
    assert.equal(record?.openworkPreferredAgent, "common-work");
    assert.equal(record?.openworkPreferredAgentLock, "common-work");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
