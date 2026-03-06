import type { ToolMonitorTurnReport } from "./types";

const isoNoColon = (value: number) => new Date(value).toISOString().replace(/[:.]/g, "-");

const escapeInline = (value: string) => value.replace(/`/g, "\\`");

const renderCodeBlock = (value: string) => {
  const trimmed = value.trimEnd();
  if (!trimmed) return "";
  const fence = "```";
  const safe = trimmed.replace(/```/g, "``\\`");
  return `${fence}\n${safe}\n${fence}`;
};

export function renderToolMonitorMarkdown(
  report: ToolMonitorTurnReport,
  options?: { includeDebug?: boolean },
): string {
  const created = isoNoColon(report.createdAt);
  const title = `Tool Monitor — ${escapeInline(report.sessionId)} — ${escapeInline(report.assistantMessageId)}`;

  const frontmatter = [
    "---",
    "schemaVersion: 1",
    `createdAt: ${report.createdAt}`,
    `createdAtIso: ${created}`,
    `sessionId: ${report.sessionId}`,
    `agent: ${report.agent}`,
    report.userMessageId ? `userMessageId: ${report.userMessageId}` : null,
    `assistantMessageId: ${report.assistantMessageId}`,
    `toolCalls: ${report.summary.toolCalls}`,
    `toolErrors: ${report.summary.toolErrors}`,
    `invalidToolCalls: ${report.summary.invalidToolCalls}`,
    `trigger: ${report.retrospective.trigger}`,
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const summaryLines = [
    `- Tool calls: **${report.summary.toolCalls}**`,
    `- Tool errors: **${report.summary.toolErrors}**`,
    `- Invalid tool calls: **${report.summary.invalidToolCalls}**`,
    `- Trigger: **${report.retrospective.trigger === "manual_excellent" ? "Manual (Excellent Run)" : "Auto (Turn Complete)"}**`,
  ];

  const findings = report.findings.length
    ? report.findings
      .map((finding) => {
        const severity = finding.severity.toUpperCase();
        const parts = (finding.relatedPartIds ?? []).filter(Boolean);
        const partsLabel = parts.length ? ` (parts: ${parts.map(escapeInline).join(", ")})` : "";
        return `- [${severity}] ${finding.title}${partsLabel}\n  - ${finding.detail}`;
      })
      .join("\n")
    : "- (none)";

  const toolRows = report.tools.length
    ? report.tools
      .map((tool, idx) => {
        const status = tool.status.toUpperCase();
        const subtitle = tool.subtitle ? ` — ${tool.subtitle}` : "";
        const inputPreview = tool.input ? renderCodeBlock(JSON.stringify(tool.input, null, 2).slice(0, 2400)) : "";
        const outputPreview = tool.outputPreview ? renderCodeBlock(tool.outputPreview) : "";
        const errorPreview = tool.errorText ? renderCodeBlock(tool.errorText) : "";

        const blocks = [
          `### ${idx + 1}. ${escapeInline(tool.tool)} — ${status}`,
          tool.title ? `**Title:** ${escapeInline(tool.title)}${subtitle}` : "",
          `**Part:** \`${escapeInline(tool.partId)}\``,
          inputPreview ? `**Input:**\n\n${inputPreview}` : "",
          outputPreview ? `**Output (preview):**\n\n${outputPreview}` : "",
          errorPreview ? `**Error:**\n\n${errorPreview}` : "",
        ].filter(Boolean);
        return blocks.join("\n\n");
      })
      .join("\n\n")
    : "_No tool calls recorded in assistant message._";

  const errorsEncountered = report.retrospective.errorsEncountered.length
    ? report.retrospective.errorsEncountered
      .map(
        (item, index) =>
          `${index + 1}. **${escapeInline(item.tool)}**\n   - Error: ${escapeInline(item.message)}\n   - Avoid next time: ${escapeInline(item.avoidNextTime)}`,
      )
      .join("\n")
    : "_No major tool errors were captured in this turn._";

  const preventionChecklist = report.retrospective.preventionChecklist.length
    ? report.retrospective.preventionChecklist.map((item) => `- ${item}`).join("\n")
    : "- _No prevention checklist available._";

  const lessonsLearned = report.retrospective.lessonsLearned.length
    ? report.retrospective.lessonsLearned.map((item) => `- ${item}`).join("\n")
    : "- _No explicit lessons captured._";

  const applicableScenarios = report.retrospective.applicableScenarios.length
    ? report.retrospective.applicableScenarios.map((item) => `- ${item}`).join("\n")
    : "- _No scenario suggestions available._";

  const shortestPath = report.retrospective.shortestPath.length
    ? report.retrospective.shortestPath.map((step, index) => `${index + 1}. ${step}`).join("\n")
    : "_No shortest path generated._";

  const patchSuggestions = report.retrospective.patchSuggestions.length
    ? report.retrospective.patchSuggestions
      .map((patch, index) => {
        const actionLabel = patch.action === "add" ? "➕ Add" : patch.action === "modify" ? "✏️ Modify" : "🗑️ Remove";
        return [
          `${index + 1}. **${escapeInline(patch.target)}** → ${patch.section ? escapeInline(patch.section) : "(general)"}`,
          `   - Action: ${actionLabel}`,
          `   - Suggestion: ${escapeInline(patch.suggestion)}`,
          patch.evidence ? `   - Evidence: ${escapeInline(patch.evidence)}` : "",
        ].filter(Boolean).join("\n");
      })
      .join("\n")
    : "_No patch suggestions for this turn._";

  const conversation = (() => {
    const user = (report.userTextPreview ?? "").trim();
    const assistant = (report.assistantTextPreview ?? "").trim();
    const blocks: string[] = [];
    if (user) {
      blocks.push("### User (preview)");
      blocks.push(renderCodeBlock(user));
    }
    if (assistant) {
      blocks.push("### Assistant (preview)");
      blocks.push(renderCodeBlock(assistant));
    }
    return blocks.length ? blocks.join("\n\n") : "_No text preview available._";
  })();

  const debug = options?.includeDebug && report.debug
    ? [
      "## Debug",
      `- analyzedParts: ${report.debug.analyzedParts}`,
      `- analyzedMessages: ${report.debug.analyzedMessages}`,
    ].join("\n")
    : "";

  return [
    frontmatter,
    `# ${title}`,
    "",
    "## Summary",
    ...summaryLines,
    "",
    "## Conversation",
    conversation,
    "",
    "## Findings",
    findings,
    "",
    "## Retrospective",
    "### Errors Encountered",
    errorsEncountered,
    "",
    "### How To Avoid Next Time",
    preventionChecklist,
    "",
    "### Lessons Learned",
    lessonsLearned,
    "",
    "### Applicable Scenarios",
    applicableScenarios,
    "",
    "### Shortest Path",
    shortestPath,
    "",
    "### Patch Suggestions",
    patchSuggestions,
    "",
    "## Tool Calls",
    toolRows,
    debug ? `\n\n${debug}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
