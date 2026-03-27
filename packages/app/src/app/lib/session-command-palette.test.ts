import { describe, expect, test } from "bun:test";

import type { SlashCommandOption, SkillCard } from "../types";
import {
  filterSessionSkillsForContext,
  filterSessionSlashCommandsForContext,
} from "./session-command-palette";

describe("filterSessionSkillsForContext", () => {
  const skills: SkillCard[] = [
    { name: "frontend-design", path: ".opencode/skills/frontend-design/SKILL.md", description: "Build flashy UI" },
    { name: "docx", path: ".opencode/skills/docx/SKILL.md", description: "Handle Word docs" },
    { name: "pdf", path: ".opencode/skills/pdf/SKILL.md", description: "Handle PDF files" },
    { name: "doc-normalize", path: ".opencode/skills/doc-normalize/SKILL.md", description: "Normalize headings" },
    { name: "content-research-writer", path: ".opencode/skills/content-research-writer/SKILL.md", description: "Research-backed writing" },
    { name: "openwork-debug", path: ".opencode/skills/openwork-debug/SKILL.md", description: "Debug sidecars" },
  ];

  test("keeps general sessions unchanged", () => {
    expect(filterSessionSkillsForContext(skills, { view: "session" })).toEqual(skills);
  });

  test("shows a document-focused subset for document-agent sessions", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "document-agent", agentLock: "common-work" }).map((entry) => entry.name),
    ).toEqual(["docx", "pdf", "doc-normalize", "content-research-writer"]);
  });

  test("treats locked common-work sessions as document-agent sessions even outside the dedicated route", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "session", agentLock: "common-work" }).map((entry) => entry.name),
    ).toEqual(["docx", "pdf", "doc-normalize", "content-research-writer"]);
  });
});

describe("filterSessionSlashCommandsForContext", () => {
  const commands: SlashCommandOption[] = [
    { id: "cmd:compact", name: "compact", description: "Summarize the session", source: "command" },
    { id: "skill:frontend-design", name: "frontend-design", description: "Build flashy UI", source: "skill" },
    { id: "skill:docx", name: "docx", description: "Work with Word docs", source: "skill" },
    { id: "skill:content-research-writer", name: "content-research-writer", description: "Research-backed writing", source: "skill" },
    { id: "skill:pdf", name: "pdf", description: "Handle PDF files", source: "skill" },
    { id: "skill:openwork-debug", name: "openwork-debug", description: "Debug sidecars", source: "skill" },
    { id: "mcp:search", name: "search", description: "Search external sources", source: "mcp" },
  ];

  test("keeps general-session slash commands unchanged", () => {
    expect(filterSessionSlashCommandsForContext(commands, { view: "session" })).toEqual(commands);
  });

  test("pins compact, keeps non-skill commands, and removes irrelevant skills for document-writer sessions", () => {
    expect(
      filterSessionSlashCommandsForContext(commands, { view: "document-writer", agentLock: "document-writer" }).map(
        (entry) => `${entry.source}:${entry.name}`,
      ),
    ).toEqual([
      "command:compact",
      "skill:docx",
      "skill:content-research-writer",
      "skill:pdf",
      "mcp:search",
    ]);
  });
});
