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

const DOCUMENT_SKILL_EXACT_ALLOW = new Set<string>([
  ...DOCUMENT_AGENT_SKILL_PRIORITY,
  ...DOCUMENT_WRITER_SKILL_PRIORITY,
]);

const normalizeKey = (value: string | null | undefined) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\.md$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

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

  const priority = skillPriorityIndex(normalizedName, mode);
  if (priority !== -1) {
    return 10_000 - priority * 100;
  }
  if (DOCUMENT_SKILL_EXACT_ALLOW.has(normalizedName)) return 1_000;
  if (normalizedName.startsWith("doc-")) return 900;
  return null;
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
