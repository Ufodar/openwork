import { describe, expect, test } from "bun:test";

import { getEventSubscriptionDirectories } from "../utils";

describe("getEventSubscriptionDirectories", () => {
  test("includes the workspace root and the selected session runtime directory", () => {
    expect(
      getEventSubscriptionDirectories(
        "/root/.openwork/user-workspaces/user-1",
        "/root/.openwork/user-workspaces/user-1/documents/sessions/ses_123",
      ),
    ).toEqual([
      "/root/.openwork/user-workspaces/user-1",
      "/root/.openwork/user-workspaces/user-1/documents/sessions/ses_123",
    ]);
  });

  test("dedupes identical directory targets after normalization", () => {
    expect(
      getEventSubscriptionDirectories(
        "/root/.openwork/user-workspaces/user-1/",
        "/root/.openwork/user-workspaces/user-1",
      ),
    ).toEqual(["/root/.openwork/user-workspaces/user-1"]);
  });

  test("falls back to the session directory when the workspace root is unavailable", () => {
    expect(
      getEventSubscriptionDirectories(
        "",
        "/root/.openwork/user-workspaces/user-1/documents/sessions/ses_123/",
      ),
    ).toEqual(["/root/.openwork/user-workspaces/user-1/documents/sessions/ses_123"]);
  });
});
