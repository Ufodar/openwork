import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");

const read = (relativePath: string) => readFileSync(join(appRoot, relativePath), "utf8");

test("session sidebar formats generated session titles for display", () => {
  const source = read("components/session/sidebar.tsx");
  expect(source).toContain('import { formatSessionDisplayTitle } from "../../lib/session-title"');
  expect(source).toContain("const displaySessionTitle =");
  expect(source).toContain("displaySessionTitle(session.title)");
});

test("dashboard and session views share the display-title formatter", () => {
  const dashboard = read("pages/dashboard.tsx");
  expect(dashboard).toContain('import { formatSessionDisplayTitle } from "../lib/session-title"');
  expect(dashboard).toContain("const displaySessionTitle =");
  expect(dashboard).toContain("displaySessionTitle(session.title)");

  const session = read("pages/session.tsx");
  expect(session).toContain('import { formatSessionDisplayTitle } from "../lib/session-title"');
  expect(session).toContain("const displaySessionTitle =");
  expect(session).toContain("const selectedSessionDisplayTitle = createMemo");
});

test("admin users view formats generated session titles for display", () => {
  const source = read("pages/admin-users.tsx");
  expect(source).toContain('import { formatSessionDisplayTitle } from "../lib/session-title"');
  expect(source).toContain("const displaySessionTitle =");
  expect(source).toContain("displaySessionTitle(session.title)");
});
