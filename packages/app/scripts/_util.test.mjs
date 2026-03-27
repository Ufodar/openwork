import test from "node:test";
import assert from "node:assert/strict";

import { buildHostedOpenworkClientOptions } from "./_util.mjs";

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
