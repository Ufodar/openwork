const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const ORPHAN_THINK_TAG_LINE_RE = /^\s*<\/?think\b[^>]*>\s*$/gim;
const MULTI_BLANK_LINE_RE = /\n{3,}/g;

export function stripReasoningArtifacts(text) {
  if (typeof text !== "string" || !text) return "";
  const normalized = text.replace(/\r\n?/g, "\n");
  const withoutBlocks = normalized.replace(THINK_BLOCK_RE, "");
  const withoutOrphanLines = withoutBlocks.replace(ORPHAN_THINK_TAG_LINE_RE, "");
  return withoutOrphanLines.replace(MULTI_BLANK_LINE_RE, "\n\n").trim();
}

export function joinVisibleAssistantText(parts) {
  const text = parts
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
  return stripReasoningArtifacts(text);
}
