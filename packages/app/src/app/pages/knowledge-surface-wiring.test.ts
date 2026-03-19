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
