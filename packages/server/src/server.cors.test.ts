import { describe, expect, test } from "bun:test";

import { withCors } from "./server.js";
import type { ServerConfig } from "./types.js";

describe("withCors", () => {
  test("includes PUT in the allowed methods for browser preflight", () => {
    const config = {
      corsOrigins: ["*"],
    } as ServerConfig;

    const response = withCors(
      new Response(null, { status: 204 }),
      new Request("http://openwork.local/workspace/ws_1/sessions/ses_1/knowledge", {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:5173" },
      }),
      config,
    );

    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("PUT");
  });
});
