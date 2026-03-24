import { describe, expect, test } from "bun:test";

import {
  resolveFeaturedAgentLaunch,
  SHOW_STANDALONE_NEW_SESSION_BUTTON,
  filterVisibleFeaturedAgents,
} from "./agents-visibility";

describe("agents visibility", () => {
  test("hides the general assistant featured card", () => {
    const visible = filterVisibleFeaturedAgents([
      { id: "general-assistant" },
      { id: "document-agent" },
      { id: "document-writer" },
    ]);

    expect(visible).toEqual([
      { id: "document-agent" },
      { id: "document-writer" },
    ]);
  });

  test("hides the standalone new session button", () => {
    expect(SHOW_STANDALONE_NEW_SESSION_BUTTON).toBe(false);
  });

  test("routes the featured writer card into the dedicated document-writer view with a lock", () => {
    expect(resolveFeaturedAgentLaunch("document-writer", "document-writer")).toEqual({
      agent: "document-writer",
      agentLock: "document-writer",
      enableDocumentState: true,
      view: "document-writer",
    });
  });

  test("routes the featured document agent card back to common-work by default", () => {
    expect(resolveFeaturedAgentLaunch("document-agent", null)).toEqual({
      agent: "common-work",
      agentLock: "common-work",
      view: "document-agent",
    });
  });
});
