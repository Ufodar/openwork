import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const readPage = (name: string) => readFileSync(join(here, name), "utf8");

test("session view wires the shared session knowledge surface", () => {
  const source = readPage("session.tsx");
  expect(source).toContain('import SessionKnowledgeSurface from "../components/session/session-knowledge-surface"');
  expect(source).toContain("<SessionKnowledgeSurface");
});

test("document agent view wires the shared session knowledge surface", () => {
  const source = readPage("document-agent.tsx");
  expect(source).toContain('import SessionKnowledgeSurface from "../components/session/session-knowledge-surface"');
  expect(source).toContain("<SessionKnowledgeSurface");
});

test("document writer view wires the shared session knowledge surface", () => {
  const source = readPage("document-writer.tsx");
  expect(source).toContain('import SessionKnowledgeSurface from "../components/session/session-knowledge-surface"');
  expect(source).toContain("<SessionKnowledgeSurface");
  expect(source).not.toContain('import SessionKnowledgeStrip from "../components/session-knowledge-strip"');
});

test("dashboard exposes a dedicated knowledge tab", () => {
  const dashboard = readPage("dashboard.tsx");
  expect(dashboard).toContain('case "knowledge"');
  expect(dashboard).toContain('props.tab === "knowledge"');
  expect(dashboard).toContain('navItem("knowledge"');

  const app = readFileSync(join(here, "..", "app.tsx"), "utf8");
  expect(app).toContain('"knowledge"');
});
