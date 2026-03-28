import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_DOCUMENT_WORKFLOW_COMPARE_OUTPUT_PATH = fileURLToPath(
  new URL("../../../tmp/compare-agents/document-live-compare.json", import.meta.url),
);

export function resolveDocumentWorkflowCompareOutputPath({
  cwd = process.cwd(),
  outputOverride,
} = {}) {
  if (typeof outputOverride === "string" && outputOverride.trim()) {
    const trimmed = outputOverride.trim();
    return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
  }

  return DEFAULT_DOCUMENT_WORKFLOW_COMPARE_OUTPUT_PATH;
}

export async function withAsyncTimeout(run, timeoutMs, label = "async operation") {
  const operation = typeof run === "function" ? run() : run;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return operation;
  }

  let timer = null;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
