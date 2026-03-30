import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

const readPage = (name: string) => readFileSync(join(here, name), "utf8");

for (const pageName of ["document-agent.tsx", "document-writer.tsx"] as const) {
  test(`${pageName} wires pending session questions through the shared modal`, () => {
    const source = readPage(pageName);
    expect(source).toContain('import QuestionModal from "../components/question-modal"');
    expect(source).toContain("<QuestionModal");
    expect(source).toContain("open={Boolean(props.activeQuestion)}");
    expect(source).toContain("questions={props.activeQuestion?.questions ?? []}");
    expect(source).toContain("busy={props.questionReplyBusy}");
    expect(source).toContain("props.respondQuestion(props.activeQuestion.id, answers);");
  });
}
