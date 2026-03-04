#!/usr/bin/env node

import { readFile } from "node:fs/promises"
import path from "node:path"

const ROOT = process.cwd()

const ACTIVE_DOCS = [
  ".opencode/agent/document-writer.md",
  ".opencode/agent/common-work.md",
  ".opencode/skills/bid-analysis/SKILL.md",
  ".opencode/skills/bid-drafting/SKILL.md",
  ".opencode/skills/bid-qc/SKILL.md",
  ".opencode/skills/bid-dedupe/SKILL.md",
  "design-bid-writer.md",
  "docs/contracts/bid-session-file-contract.md",
]

const TRIAGE_DOCS = [
  ".opencode/skills/bid-analysis/SKILL.md",
  "docs/contracts/bid-session-file-contract.md",
]

function lineViolations(content, matcher) {
  const lines = content.split(/\r?\n/)
  const hits = []
  for (let i = 0; i < lines.length; i += 1) {
    if (matcher(lines[i])) {
      hits.push({ line: i + 1, text: lines[i] })
    }
  }
  return hits
}

function pushIssue(issues, file, line, message) {
  issues.push({ file, line, message })
}

async function main() {
  const issues = []

  for (const rel of ACTIVE_DOCS) {
    const abs = path.join(ROOT, rel)
    const content = await readFile(abs, "utf8")

    const factsViolations = lineViolations(content, (line) => {
      if (!line.includes("facts.json")) return false
      if (line.includes(".bid/facts.json")) return false
      if (line.includes("facts-template.json")) return false
      if (line.toLowerCase().includes("legacy")) return false
      return true
    })
    for (const hit of factsViolations) {
      pushIssue(issues, rel, hit.line, "found non-canonical facts.json reference (expected .bid/facts.json)")
    }

    if (rel !== "docs/contracts/bid-session-file-contract.md") {
      const hardcodedSession = lineViolations(content, (line) => line.includes("documents/sessions/<sessionId>"))
      for (const hit of hardcodedSession) {
        pushIssue(issues, rel, hit.line, "found hardcoded documents/sessions/<sessionId> example (use <SESSION_ROOT>)")
      }
    }
  }

  {
    const rel = ".opencode/agent/document-writer.md"
    const content = await readFile(path.join(ROOT, rel), "utf8")
    const visibility = lineViolations(content, (line) => line.includes("所有文件") && (line.includes("看到") || line.includes("可见")))
    for (const hit of visibility) {
      pushIssue(issues, rel, hit.line, "visibility wording conflicts with hidden-directory behavior")
    }
  }

  for (const rel of TRIAGE_DOCS) {
    const content = await readFile(path.join(ROOT, rel), "utf8")

    if (/file-triage\.json[\s\S]{0,600}"version"\s*:\s*1/.test(content)) {
      pushIssue(issues, rel, 1, "file-triage schema appears to use version 1 in active guidance")
    }

    if (/"tender_main"\s*:\s*\[\s*"/.test(content)) {
      pushIssue(issues, rel, 1, "file-triage by_category appears to use legacy string-array entries")
    }
  }

  if (issues.length > 0) {
    console.error("[bid-contract] consistency check failed")
    for (const issue of issues) {
      console.error(`- ${issue.file}:${issue.line} ${issue.message}`)
    }
    process.exit(1)
  }

  console.log("[bid-contract] consistency check passed")
}

main().catch((error) => {
  console.error("[bid-contract] unexpected error")
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
