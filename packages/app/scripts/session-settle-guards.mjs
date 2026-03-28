export function extractToolParts(messages) {
  return messages
    .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
    .filter((part) => part?.type === "tool");
}

export function summarizePendingToolStates(messages) {
  return extractToolParts(messages)
    .filter((part) => {
      const status = typeof part?.state?.status === "string" ? part.state.status : "";
      return status === "pending" || status === "running";
    })
    .map((part) => {
      const raw = typeof part?.state?.raw === "string" ? part.state.raw : "";
      const input = part?.state?.input && typeof part.state.input === "object" ? part.state.input : {};
      const inputKeys = Object.keys(input);
      return {
        tool: typeof part?.tool === "string" ? part.tool : "unknown",
        status: typeof part?.state?.status === "string" ? part.state.status : null,
        raw,
        inputKeys,
        malformed: !raw.trim() && inputKeys.length === 0,
      };
    });
}

export function detectStalledPendingTools({
  messages,
  lastProgressAt,
  now,
  malformedPendingToolTimeoutMs = 30_000,
  stalledPendingToolTimeoutMs = 120_000,
}) {
  const pendingTools = summarizePendingToolStates(messages);
  if (!pendingTools.length) return null;

  const elapsedSinceProgress = now - lastProgressAt;
  const malformedPendingTools = pendingTools.filter((tool) => tool.malformed);
  if (malformedPendingTools.length && elapsedSinceProgress >= malformedPendingToolTimeoutMs) {
    return {
      kind: "malformed-pending-tool",
      pendingTools: malformedPendingTools,
    };
  }

  if (elapsedSinceProgress >= stalledPendingToolTimeoutMs) {
    return {
      kind: "stalled-pending-tool",
      pendingTools,
    };
  }

  return null;
}
