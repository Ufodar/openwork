import { expect, test } from "bun:test";

import { MCP_QUICK_CONNECT } from "./constants";

test("MCP quick connect stays focused on project-relevant tools", () => {
  const names = MCP_QUICK_CONNECT.map((entry) => entry.name);

  expect(names).toContain("Context7");
  expect(names).toContain("Control Chrome");

  expect(names).not.toContain("Notion");
  expect(names).not.toContain("GitHub");
  expect(names).not.toContain("Linear");
  expect(names).not.toContain("Sentry");
  expect(names).not.toContain("Stripe");
  expect(names).not.toContain("HubSpot");
});
