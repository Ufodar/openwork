import { describe, expect, test } from "bun:test";

import { resolveAppRouteView, routeForSessionView } from "./session-view-routing";

describe("session view routing", () => {
  test("resolves /document-writer routes to the document-writer view", () => {
    expect(resolveAppRouteView("/document-writer/ses_123")).toBe("document-writer");
  });

  test("resolves /document-agent routes to the document-agent view", () => {
    expect(resolveAppRouteView("/document-agent/ses_123")).toBe("document-agent");
  });

  test("builds the document-writer route for locked writer sessions", () => {
    expect(routeForSessionView("document-writer", "ses_123")).toBe("/document-writer/ses_123");
  });
});
