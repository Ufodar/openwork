export function extractToolParts(messages) {
  return messages
    .flatMap((message) => (Array.isArray(message?.parts) ? message.parts : []))
    .filter((part) => part?.type === "tool");
}

function messageRole(message) {
  return typeof message?.role === "string"
    ? message.role
    : typeof message?.info?.role === "string"
      ? message.info.role
      : "";
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
        delegated: String(part?.tool ?? "").toLowerCase() === "task",
      };
    });
}

export function shouldTreatFingerprintChangeAsProgress(messages) {
  const last = Array.isArray(messages) ? messages[messages.length - 1] : null;
  if (!last) return false;
  if (messageRole(last) !== "assistant") return false;

  const parts = Array.isArray(last?.parts) ? last.parts : [];
  const toolParts = parts.filter((part) => part?.type === "tool");
  if (!toolParts.length) return true;

  let sawPendingTool = false;
  let sawNonMalformedPendingTool = false;
  let sawSettledTool = false;
  let sawMalformedPendingPlaceholder = false;

  for (const part of toolParts) {
    const status = typeof part?.state?.status === "string" ? part.state.status : "";
    if (status === "pending" || status === "running") {
      sawPendingTool = true;
      const raw = typeof part?.state?.raw === "string" ? part.state.raw : "";
      const input = part?.state?.input && typeof part.state.input === "object" ? part.state.input : {};
      if (raw.trim() || Object.keys(input).length > 0) {
        sawNonMalformedPendingTool = true;
      } else {
        // OpenCode can emit short-lived placeholder pending tool steps before
        // it attaches concrete input. Count the new step as progress once, but
        // still let the malformed timeout catch it if the placeholder actually
        // persists with empty input.
        sawMalformedPendingPlaceholder = true;
      }
      continue;
    }

    sawSettledTool = true;
  }

  if (!sawPendingTool) return true;
  if (sawNonMalformedPendingTool || sawSettledTool || sawMalformedPendingPlaceholder) return true;
  return false;
}

export function detectStalledPendingTools({
  messages,
  lastProgressAt,
  now,
  malformedPendingToolTimeoutMs = 60_000,
  stalledPendingToolTimeoutMs = 120_000,
}) {
  const pendingTools = summarizePendingToolStates(messages);
  if (!pendingTools.length) return null;

  const elapsedSinceProgress = now - lastProgressAt;
  const malformedPendingTools = pendingTools.filter(
    (tool) => tool.malformed && !tool.delegated && tool.tool !== "glob",
  );
  if (malformedPendingTools.length && elapsedSinceProgress >= malformedPendingToolTimeoutMs) {
    return {
      kind: "malformed-pending-tool",
      pendingTools: malformedPendingTools,
    };
  }

  const guardablePendingTools = pendingTools.filter((tool) => !tool.delegated);
  if (guardablePendingTools.length && elapsedSinceProgress >= stalledPendingToolTimeoutMs) {
    return {
      kind: "stalled-pending-tool",
      pendingTools: guardablePendingTools,
    };
  }

  return null;
}
