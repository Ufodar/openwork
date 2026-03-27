import { expect, test } from "bun:test";

import { MCP_QUICK_CONNECT } from "./constants";

test("MCP quick connect stays focused on project-relevant tools", () => {
  const names = MCP_QUICK_CONNECT.map((entry) => entry.name);

  expect(names).toContain("Notion");
  expect(names).toContain("Linear");
  expect(names).toContain("Sentry");
  expect(names).toContain("Context7");
  expect(names).toContain("Control Chrome");

  expect(names).not.toContain("Stripe");
  expect(names).not.toContain("HubSpot");
});
