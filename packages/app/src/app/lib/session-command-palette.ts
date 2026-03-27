import type { SlashCommandOption, SkillCard, View } from "../types";
import { isDocumentSessionView } from "./session-view-routing";

type SessionCommandPaletteContext = {
  view?: View | null;
  agent?: string | null;
  agentLock?: string | null;
};

type DocumentSessionMode = "document-agent" | "document-writer";

type SkillLike = {
  name: string;
  description?: string | null;
  trigger?: string | null;
};

const DOCUMENT_AGENT_SKILL_PRIORITY = [
  "docx",
  "pdf",
  "xlsx",
  "pptx",
  "doc-normalize",
  "doc-coauthoring",
  "content-research-writer",
  "internal-comms",
  "image-enhancer",
  "file-organizer",
] as const;

const DOCUMENT_WRITER_SKILL_PRIORITY = [
  "docx",
  "doc-normalize",
  "doc-coauthoring",
  "content-research-writer",
  "internal-comms",
  "pdf",
  "xlsx",
  "pptx",
  "image-enhancer",
  "file-organizer",
] as const;

const DOCUMENT_SKILL_EXACT_EXCLUDE = new Set([
  "algorithmic-art",
  "artifacts-builder",
  "brand-guidelines",
  "browser-setup-devtools",
  "cargo-lock-manager",
  "canvas-design",
  "changelog-generator",
  "competitive-ads-extractor",
  "developer-growth-analysis",
  "domain-name-brainstormer",
  "frontend-design",
  "get-started",
  "lead-research-assistant",
  "mcp-builder",
  "meeting-insights-analyzer",
  "openwork-core",
  "openwork-debug",
  "openwork-docker-chrome-mcp",
  "openwork-orchestrator-npm-publish",
  "opencode-bridge",
  "opencode-mirror",
  "opencode-primitives",
  "release",
  "skill-creator",
  "solidjs-patterns",
  "tailored-resume-generator",
  "tauri-solidjs",
]);

const DOCUMENT_SKILL_KEYWORDS = [
  "doc",
  "docx",
  "document",
  "writer",
  "writing",
  "proposal",
  "report",
  "memo",
  "letter",
  "word",
  "markdown",
  "normalize",
  "coauthor",
  "co-author",
  "pdf",
  "xlsx",
  "csv",
  "tsv",
  "spreadsheet",
  "table",
  "pptx",
  "slides",
  "presentation",
  "office",
  "research",
  "citation",
  "outline",
  "image",
] as const;

const normalizeKey = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeText = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase();

const resolveDocumentSessionMode = (
  context: SessionCommandPaletteContext,
): DocumentSessionMode | null => {
  if (context.view && isDocumentSessionView(context.view)) return context.view;
  const lockedAgent = normalizeKey(context.agentLock);
  if (lockedAgent === "document-writer") return "document-writer";
  if (lockedAgent === "common-work") return "document-agent";
  const selectedAgent = normalizeKey(context.agent);
  if (selectedAgent === "document-writer") return "document-writer";
  if (selectedAgent === "common-work") return "document-agent";
  return null;
};

const skillPriorityIndex = (name: string, mode: DocumentSessionMode) => {
  const priorities = mode === "document-writer" ? DOCUMENT_WRITER_SKILL_PRIORITY : DOCUMENT_AGENT_SKILL_PRIORITY;
  return priorities.indexOf(name as (typeof priorities)[number]);
};

const scoreDocumentSkill = (
  skill: SkillLike,
  mode: DocumentSessionMode,
): number | null => {
  const normalizedName = normalizeKey(skill.name);
  if (!normalizedName) return null;
  if (DOCUMENT_SKILL_EXACT_EXCLUDE.has(normalizedName)) return null;

  const priority = skillPriorityIndex(normalizedName, mode);
  if (priority !== -1) {
    return 10_000 - priority * 100;
  }

  const haystack = [skill.name, skill.description, skill.trigger]
    .map((entry) => normalizeText(entry))
    .filter(Boolean)
    .join(" ");

  if (!haystack) return null;

  let keywordHits = 0;
  for (const keyword of DOCUMENT_SKILL_KEYWORDS) {
    if (haystack.includes(keyword)) keywordHits += 1;
  }
  if (!keywordHits) return null;

  return 1_000 + keywordHits;
};

const compareRankedSkills = <T extends SkillLike>(mode: DocumentSessionMode) =>
  (left: T, right: T) => {
    const leftScore = scoreDocumentSkill(left, mode) ?? Number.NEGATIVE_INFINITY;
    const rightScore = scoreDocumentSkill(right, mode) ?? Number.NEGATIVE_INFINITY;
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.name.localeCompare(right.name);
  };

export function filterSessionSkillsForContext(
  skills: SkillCard[],
  context: SessionCommandPaletteContext,
): SkillCard[] {
  const mode = resolveDocumentSessionMode(context);
  if (!mode) return skills;
  const ranked = skills.filter((skill) => scoreDocumentSkill(skill, mode) !== null);
  if (!ranked.length) return skills;
  return ranked.slice().sort(compareRankedSkills(mode));
}

export function filterSessionSlashCommandsForContext(
  commands: SlashCommandOption[],
  context: SessionCommandPaletteContext,
): SlashCommandOption[] {
  const mode = resolveDocumentSessionMode(context);
  if (!mode) return commands;

  const pinnedCommands = commands.filter((entry) => entry.source !== "skill" && entry.name === "compact");
  const otherCommands = commands.filter((entry) => entry.source !== "skill" && entry.name !== "compact");
  const rankedSkills = commands
    .filter((entry) => entry.source === "skill" && scoreDocumentSkill(entry, mode) !== null)
    .slice()
    .sort(compareRankedSkills(mode));

  if (!rankedSkills.length) return commands;
  return [...pinnedCommands, ...rankedSkills, ...otherCommands];
}
