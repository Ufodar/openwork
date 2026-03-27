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
    { name: "doc-coauthoring", path: ".opencode/skills/doc-coauthoring/SKILL.md", description: "Coauthor long docs" },
    { name: "content-research-writer", path: ".opencode/skills/content-research-writer/SKILL.md", description: "Research-backed writing" },
    { name: "internal-comms", path: ".opencode/skills/internal-comms/SKILL.md", description: "Write internal comms" },
    { name: "image-enhancer", path: ".opencode/skills/image-enhancer/SKILL.md", description: "Enhance screenshots" },
    { name: "status-report-writer", path: ".opencode/skills/status-report-writer/SKILL.md", description: "Write internal reports and documents" },
    { name: "openwork-debug", path: ".opencode/skills/openwork-debug/SKILL.md", description: "Debug sidecars" },
  ];

  test("keeps general sessions unchanged in developer mode", () => {
    expect(filterSessionSkillsForContext(skills, { view: "session", developerMode: true })).toEqual(skills);
  });

  test("hides internal-only skills for normal general sessions", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "session", developerMode: false }).map((entry) => entry.name),
    ).toEqual(["docx", "pdf", "doc-normalize", "doc-coauthoring", "status-report-writer"]);
  });

  test("keeps full skill list for developer mode general sessions", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "session", developerMode: true }).map((entry) => entry.name),
    ).toEqual(skills.map((entry) => entry.name));
  });

  test("shows a document-focused subset for document-agent sessions", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "document-agent", agentLock: "common-work" }).map((entry) => entry.name),
    ).toEqual(["docx", "pdf", "doc-normalize", "doc-coauthoring"]);
  });

  test("treats locked common-work sessions as document-agent sessions even outside the dedicated route", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "session", agentLock: "common-work" }).map((entry) => entry.name),
    ).toEqual(["docx", "pdf", "doc-normalize", "doc-coauthoring"]);
  });

  test("does not admit unrelated writing skills just because their descriptions mention reports or documents", () => {
    expect(
      filterSessionSkillsForContext(skills, { view: "document-agent", agentLock: "common-work" }).map((entry) => entry.name),
    ).not.toContain("status-report-writer");
  });

  test("hides removed generic support skills from normal user sessions", () => {
    const names = filterSessionSkillsForContext(skills, { view: "session", developerMode: false }).map((entry) => entry.name);
    expect(names).not.toContain("content-research-writer");
    expect(names).not.toContain("internal-comms");
    expect(names).not.toContain("image-enhancer");
  });
});

describe("filterSessionSlashCommandsForContext", () => {
  const commands: SlashCommandOption[] = [
    { id: "cmd:compact", name: "compact", description: "Summarize the session", source: "command" },
    { id: "skill:frontend-design", name: "frontend-design", description: "Build flashy UI", source: "skill" },
    { id: "skill:docx", name: "docx", description: "Work with Word docs", source: "skill" },
    { id: "skill:doc-coauthoring", name: "doc-coauthoring", description: "Coauthor long docs", source: "skill" },
    { id: "skill:content-research-writer", name: "content-research-writer", description: "Research-backed writing", source: "skill" },
    { id: "skill:internal-comms", name: "internal-comms", description: "Write internal comms", source: "skill" },
    { id: "skill:image-enhancer", name: "image-enhancer", description: "Enhance screenshots", source: "skill" },
    { id: "skill:status-report-writer", name: "status-report-writer", description: "Write internal reports and documents", source: "skill" },
    { id: "skill:pdf", name: "pdf", description: "Handle PDF files", source: "skill" },
    { id: "skill:openwork-debug", name: "openwork-debug", description: "Debug sidecars", source: "skill" },
    { id: "mcp:search", name: "search", description: "Search external sources", source: "mcp" },
  ];

  test("keeps general-session slash commands unchanged in developer mode", () => {
    expect(filterSessionSlashCommandsForContext(commands, { view: "session", developerMode: true })).toEqual(commands);
  });

  test("hides internal-only skill commands for normal general sessions", () => {
    expect(
      filterSessionSlashCommandsForContext(commands, { view: "session", developerMode: false }).map(
        (entry) => `${entry.source}:${entry.name}`,
      ),
    ).toEqual([
      "command:compact",
      "skill:docx",
      "skill:pdf",
      "skill:doc-coauthoring",
      "skill:status-report-writer",
      "mcp:search",
    ]);
  });

  test("keeps full slash command list for developer mode general sessions", () => {
    expect(
      filterSessionSlashCommandsForContext(commands, { view: "session", developerMode: true }).map(
        (entry) => `${entry.source}:${entry.name}`,
      ),
    ).toEqual(commands.map((entry) => `${entry.source}:${entry.name}`));
  });

  test("pins compact, keeps non-skill commands, and removes irrelevant skills for document-writer sessions", () => {
    expect(
      filterSessionSlashCommandsForContext(commands, { view: "document-writer", agentLock: "document-writer" }).map(
        (entry) => `${entry.source}:${entry.name}`,
      ),
    ).toEqual([
      "command:compact",
      "skill:docx",
      "skill:doc-coauthoring",
      "skill:pdf",
      "mcp:search",
    ]);
  });

  test("drops unrelated writer-style skill commands from document sessions", () => {
    expect(
      filterSessionSlashCommandsForContext(commands, { view: "document-agent", agentLock: "common-work" }).map(
        (entry) => `${entry.source}:${entry.name}`,
      ),
    ).not.toContain("skill:status-report-writer");
  });

  test("drops removed generic support skill commands from document sessions", () => {
    const names = filterSessionSlashCommandsForContext(commands, {
      view: "document-agent",
      agentLock: "common-work",
    }).map((entry) => `${entry.source}:${entry.name}`);

    expect(names).not.toContain("skill:content-research-writer");
    expect(names).not.toContain("skill:internal-comms");
    expect(names).not.toContain("skill:image-enhancer");
  });
});
