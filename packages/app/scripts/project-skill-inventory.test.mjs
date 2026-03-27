import { expect, test } from "bun:test";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..", "..", "..");

const removedSkills = [
  "algorithmic-art",
  "artifacts-builder",
  "brand-guidelines",
  "canvas-design",
  "changelog-generator",
  "competitive-ads-extractor",
  "developer-growth-analysis",
  "domain-name-brainstormer",
  "file-organizer",
  "invoice-organizer",
  "lead-research-assistant",
  "meeting-insights-analyzer",
  "tailored-resume-generator",
];

const keptSkills = [
  "content-research-writer",
  "doc-coauthoring",
  "doc-normalize",
  "docx",
  "frontend-design",
  "internal-comms",
  "mcp-builder",
  "openwork-core",
  "pdf",
  "pptx",
  "skill-creator",
  "xlsx",
];

async function pathExists(path) {
  try {
    await access(path, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

test("project skill inventory removes off-scope marketing, art, and personal productivity skills", async () => {
  for (const skill of removedSkills) {
    expect(await pathExists(resolve(root, ".opencode", "skills", skill))).toBe(false);
  }
});

test("project skill inventory keeps OpenWork-dev and document-focused skills", async () => {
  for (const skill of keptSkills) {
    expect(await pathExists(resolve(root, ".opencode", "skills", skill, "SKILL.md"))).toBe(true);
  }
});
