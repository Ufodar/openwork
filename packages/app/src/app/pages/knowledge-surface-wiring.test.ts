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
  expect(source).toContain('editingLocked={showRunIndicator() || props.messages.some((message) => message.info?.role === "user" || message.info?.role === "assistant")}');
});

test("document agent view wires the shared session knowledge surface", () => {
  const source = readPage("document-agent.tsx");
  expect(source).toContain('import SessionKnowledgeSurface from "../components/session/session-knowledge-surface"');
  expect(source).toContain("<SessionKnowledgeSurface");
  expect(source).toContain('editingLocked={isAgentRunning() || props.messages.some((message) => message.info?.role === "user" || message.info?.role === "assistant")}');
});

test("document writer view wires the shared session knowledge surface", () => {
  const source = readPage("document-writer.tsx");
  expect(source).toContain('import SessionKnowledgeSurface from "../components/session/session-knowledge-surface"');
  expect(source).toContain("<SessionKnowledgeSurface");
  expect(source).toContain('editingLocked={isAgentRunning() || props.messages.some((message) => message.info?.role === "user" || message.info?.role === "assistant")}');
  expect(source).not.toContain('import SessionKnowledgeStrip from "../components/session-knowledge-strip"');
});

test("dashboard exposes a dedicated knowledge tab", () => {
  const dashboard = readPage("dashboard.tsx");
  expect(dashboard).toContain('case "knowledge"');
  expect(dashboard).toContain('props.tab === "knowledge"');
  expect(dashboard).toContain('navItem("knowledge"');
  expect(dashboard).toContain('tr("dashboard.knowledge")');

  const app = readFileSync(join(here, "..", "app.tsx"), "utf8");
  expect(app).toContain('"knowledge"');
});

test("knowledge page uses i18n keys for visible copy", () => {
  const source = readPage("knowledge.tsx");
  expect(source).toContain('tr("knowledge.title")');
  expect(source).toContain('tr("knowledge.refresh")');
  expect(source).toContain('tr("knowledge.create_title")');
  expect(source).toContain('tr("knowledge.mine_title")');
  expect(source).toContain('tr("knowledge.others_title")');
  expect(source).toContain('tr("knowledge.files_title")');
  expect(source).toContain('tr("knowledge.refresh_files")');
  expect(source).toContain('tr("knowledge.details_empty_title")');
  expect(source).toContain('tr("knowledge.delete_knowledge_action")');
  expect(source).toContain('tr("knowledge.delete_document_action")');
});

test("knowledge page uses stable reload keys and ignores stale async results", () => {
  const source = readPage("knowledge.tsx");
  expect(source).toContain("const knowledgeLoadKey = createMemo");
  expect(source).toContain("let knowledgeLoadRequestSeq = 0");
  expect(source).toContain("const requestId = ++knowledgeLoadRequestSeq");
  expect(source).toContain("if (requestId !== knowledgeLoadRequestSeq) return");
  expect(source).toContain("const nextSelection = pickKnowledgeSelection(selectedKnowledgeRef(), mine.items, others.items)");
  expect(source).toContain("setSelectedKnowledgeRef(nextSelection)");
  expect(source).not.toContain("() => [props.client, props.workspaceId] as const");
});

test("knowledge page wires document listing and delete actions through the server client", () => {
  const source = readPage("knowledge.tsx");
  expect(source).toContain("client.listKnowledgeDocuments");
  expect(source).toContain("client.deleteKnowledgeDocument");
  expect(source).toContain("client.deleteKnowledge");
});

test("knowledge page drives a focused detail pane from a selected knowledge item", () => {
  const source = readPage("knowledge.tsx");
  expect(source).toContain("const [selectedKnowledgeRef, setSelectedKnowledgeRef] = createSignal");
  expect(source).toContain("pickKnowledgeSelection(");
  expect(source).toContain("selectedKnowledgeDetails = createMemo");
  expect(source).toContain("xl:grid-cols-[360px_minmax(0,1fr)]");
  expect(source).toContain("when={selectedKnowledgeDetails()}");
  expect(source).toContain("selectedKnowledgeDetails()?.item.title");
  expect(source).toContain("selectedKnowledgeDetails()?.scope === \"mine\"");
  expect(source).not.toContain("when={selectedKnowledgeItem() && selectedKnowledgeScope()}");
});

test("knowledge page reselects another knowledge base after deleting the current one", () => {
  const source = readPage("knowledge.tsx");
  expect(source).toContain("const nextMineItems = removeKnowledgeItem(mineItems(), knowledgeId)");
  expect(source).toContain("setSelectedKnowledgeRef(pickKnowledgeSelection(selectedKnowledgeRef(), nextMineItems, othersItems()))");
});

test("knowledge strip disables editing actions when the scope is locked", () => {
  const strip = readFileSync(join(here, "..", "components", "session", "knowledge-strip.tsx"), "utf8");
  const surface = readFileSync(join(here, "..", "components", "session", "session-knowledge-surface.tsx"), "utf8");
  expect(strip).toContain("disabled={props.editingLocked}");
  expect(surface).toContain("if (!knowledgeAvailable() || knowledgeEditingLocked()) return;");
});

test("knowledge strip keeps attached knowledge visible during transient refreshes", () => {
  const strip = readFileSync(join(here, "..", "components", "session", "knowledge-strip.tsx"), "utf8");
  expect(strip).toContain('when={props.attachedItems.length > 0}');
  expect(strip).toContain('when={props.loading && props.attachedItems.length === 0}');
  expect(strip).toContain('class="animate-spin"');
  expect(strip).not.toContain("when={!props.loading}");
});

test("knowledge strip is collapsed by default and resets when switching sessions", () => {
  const strip = readFileSync(join(here, "..", "components", "session", "knowledge-strip.tsx"), "utf8");
  const surface = readFileSync(join(here, "..", "components", "session", "session-knowledge-surface.tsx"), "utf8");
  expect(strip).toContain("expanded: boolean;");
  expect(strip).toContain("onToggle: () => void;");
  expect(strip).toContain("aria-expanded={props.expanded}");
  expect(strip).toContain('when={props.expanded}');
  expect(surface).toContain("const [knowledgeStripExpanded, setKnowledgeStripExpanded] = createSignal(false);");
  expect(surface).toContain("setKnowledgeStripExpanded(false);");
  expect(surface).toContain("expanded={knowledgeStripExpanded()}");
  expect(surface).toContain("onToggle={() => setKnowledgeStripExpanded((current) => !current)}");
});
