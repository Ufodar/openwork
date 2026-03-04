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
    "---",
  ]
    .filter(Boolean)
    .join("\n");

  const summaryLines = [
    `- Tool calls: **${report.summary.toolCalls}**`,
    `- Tool errors: **${report.summary.toolErrors}**`,
    `- Invalid tool calls: **${report.summary.invalidToolCalls}**`,
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
    "## Tool Calls",
    toolRows,
    debug ? `\n\n${debug}\n` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

