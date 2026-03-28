import { isAbsolute, relative, resolve } from "node:path";

const DISCOVERY_TOOLS = new Set([
  "glob",
  "list",
  "filesystem_list_directory",
  "grep",
]);

const OFFICE_FILE_RE = /\.(docx|doc|pptx|xlsx|xls|pdf)$/i;
const SYSTEM_TEMP_RE = /^(\/tmp\/|\/private\/tmp\/)/i;
const BROAD_GLOB_RE = /(^|\/)\*\*(\/\*)?$/;
const BROAD_FIND_RE = /\bfind\s+\.\s+-type\s+f\b/;
const ABSOLUTE_CD_RE = /\bcd\s+(['"]?)(\/[^'" ;]+)\1/g;
const COMMAND_SYSTEM_TEMP_RE = /(^|[\s"'=`])(?:\/private\/tmp\/|\/tmp\/)[^\s"'`;|&)]+/i;
const FETCH_FAILED_RE = /fetch failed/i;
const ACCESS_DENIED_RE = /access denied|prevents you from using this specific tool call/i;
const MCP_ERROR_RE = /mcp error/i;
const DELIVERABLE_PATH_RE = /(^|\/)(outputs|reports)(\/|$)/i;
const DELIVERABLE_TEXT_RE = /(^|[\s"'=`])(?:\.\/)?(?:outputs|reports)(?:\/|\b)/i;

function readStateInput(part) {
  if (part?.state?.input && typeof part.state.input === "object") return part.state.input;
  if (part?.input && typeof part.input === "object") return part.input;
  return {};
}

function normalizePath(value) {
  return typeof value === "string" ? value.trim() : "";
}

function pathWithinWorkspace(path, workspaceDir) {
  const candidate = normalizePath(path);
  const root = normalizePath(workspaceDir);
  if (!candidate || !root || !isAbsolute(candidate)) return false;
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function getBashCdTargets(command) {
  const text = normalizePath(command);
  if (!text) return [];
  const targets = [];
  for (const match of text.matchAll(ABSOLUTE_CD_RE)) {
    const target = normalizePath(match[2]);
    if (target) targets.push(target);
  }
  return targets;
}

function getPathCandidates(part) {
  const input = readStateInput(part);
  const paths = [
    input.filePath,
    input.path,
    input.directory,
    input.cwd,
  ]
    .map(normalizePath)
    .filter(Boolean);
  if (normalizePath(part?.tool).toLowerCase() === "bash") {
    paths.push(...getBashCdTargets(input.command));
  }
  return [...new Set(paths)];
}

function getCommand(part) {
  const input = readStateInput(part);
  return normalizePath(input.command);
}

function getPattern(part) {
  const input = readStateInput(part);
  return normalizePath(input.pattern || input.query);
}

function getUrl(part) {
  const input = readStateInput(part);
  return normalizePath(input.url);
}

function getErrorText(part) {
  const state = part?.state && typeof part.state === "object" ? part.state : {};
  return normalizePath(state.error);
}

function getOutputText(part) {
  const state = part?.state && typeof part.state === "object" ? part.state : {};
  return normalizePath(state.output);
}

function classifyIssueCodes(part, { workspaceDir } = {}) {
  const tool = normalizePath(part?.tool).toLowerCase();
  const codes = [];
  const paths = getPathCandidates(part);
  const pattern = getPattern(part);
  const command = getCommand(part);
  const errorText = getErrorText(part);
  const outputText = getOutputText(part);

  for (const path of paths) {
    if (SYSTEM_TEMP_RE.test(path)) {
      codes.push("system-temp-touch");
      continue;
    }
    if (isAbsolute(path) && workspaceDir && !pathWithinWorkspace(path, workspaceDir)) {
      codes.push("external-path-touch");
    }
  }

  if (tool === "bash" && COMMAND_SYSTEM_TEMP_RE.test(command)) {
    codes.push("system-temp-touch");
  }

  if (tool === "read" && paths.some((path) => OFFICE_FILE_RE.test(path))) {
    codes.push("direct-office-read");
  }

  if (tool === "glob" && BROAD_GLOB_RE.test(pattern)) {
    codes.push("broad-discovery");
  }

  if (tool === "bash" && BROAD_FIND_RE.test(command)) {
    codes.push("broad-discovery");
  }

  if (ACCESS_DENIED_RE.test(errorText)) codes.push("access-denied");
  if (FETCH_FAILED_RE.test(errorText) || FETCH_FAILED_RE.test(outputText)) codes.push("fetch-failed");
  if (MCP_ERROR_RE.test(errorText) || MCP_ERROR_RE.test(outputText)) codes.push("mcp-error");

  return [...new Set(codes)];
}

function isDiscoveryTool(part) {
  const tool = normalizePath(part?.tool).toLowerCase();
  if (DISCOVERY_TOOLS.has(tool)) return true;
  if (tool !== "bash") return false;
  return BROAD_FIND_RE.test(getCommand(part));
}

function isMeaningfulTool(part) {
  return !isDiscoveryTool(part);
}

function increment(map, key, amount = 1) {
  map[key] = (map[key] ?? 0) + amount;
}

function touchesDeliverable(part) {
  const paths = getPathCandidates(part);
  const pattern = getPattern(part);
  const command = getCommand(part);
  const url = getUrl(part);

  if (paths.some((path) => DELIVERABLE_PATH_RE.test(path))) return true;
  if (pattern && DELIVERABLE_TEXT_RE.test(pattern)) return true;
  if (command && DELIVERABLE_TEXT_RE.test(command)) return true;
  if (url && DELIVERABLE_TEXT_RE.test(url)) return true;
  return false;
}

export function buildCompactToolTrace(parts, options = {}) {
  const toolParts = Array.isArray(parts) ? parts.filter((part) => part?.type === "tool") : [];
  const maxEntries = Number.isFinite(options.maxEntries) ? Number(options.maxEntries) : toolParts.length;

  return toolParts.slice(0, maxEntries).map((part, index) => {
    const entry = {
      index,
      tool: normalizePath(part?.tool) || "unknown",
      status: normalizePath(part?.state?.status) || null,
      issueCodes: classifyIssueCodes(part, options),
    };
    const [firstPath] = getPathCandidates(part);
    const pattern = getPattern(part);
    const command = getCommand(part);
    const url = getUrl(part);

    if (firstPath) entry.filePath = firstPath;
    if (pattern) entry.pattern = pattern;
    if (url) entry.url = url;
    if (command) entry.command = command;

    return entry;
  });
}

export function summarizeConversationDiagnostics(parts, options = {}) {
  const toolParts = Array.isArray(parts) ? parts.filter((part) => part?.type === "tool") : [];
  const issueCounts = {};
  const issues = [];
  let leadingDiscoveryBurst = 0;
  let firstMeaningfulTool = null;
  let broadDiscoveryCount = 0;
  let systemTempTouchCount = 0;
  let externalPathTouchCount = 0;
  let directOfficeReadCount = 0;
  let deliverableTouchCount = 0;
  const failureKeys = new Map();

  for (const [index, part] of toolParts.entries()) {
    const codes = classifyIssueCodes(part, options);
    const tool = normalizePath(part?.tool) || "unknown";
    const pattern = getPattern(part);
    const command = getCommand(part);
    const paths = getPathCandidates(part);

    if (!firstMeaningfulTool && isMeaningfulTool(part)) {
      firstMeaningfulTool = tool;
    }
    if (!firstMeaningfulTool && isDiscoveryTool(part)) {
      leadingDiscoveryBurst += 1;
    }
    if (touchesDeliverable(part)) {
      deliverableTouchCount += 1;
    }

    for (const code of codes) {
      increment(issueCounts, code);
      if (code === "broad-discovery") broadDiscoveryCount += 1;
      if (code === "system-temp-touch") systemTempTouchCount += 1;
      if (code === "external-path-touch") externalPathTouchCount += 1;
      if (code === "direct-office-read") directOfficeReadCount += 1;
      issues.push({
        index,
        tool,
        code,
        path: paths[0] ?? null,
        pattern: pattern || null,
        command: command || null,
      });
    }

    const failureSignature = [
      tool,
      getErrorText(part),
      pattern,
      command,
      paths[0] ?? "",
    ].join("::");
    if (getErrorText(part)) {
      failureKeys.set(failureSignature, (failureKeys.get(failureSignature) ?? 0) + 1);
    }
  }

  const repeatedFailureCount = [...failureKeys.values()].filter((count) => count > 1).length;

  return {
    totalToolCalls: toolParts.length,
    leadingDiscoveryBurst,
    firstMeaningfulTool,
    broadDiscoveryCount,
    systemTempTouchCount,
    externalPathTouchCount,
    directOfficeReadCount,
    deliverableTouchCount,
    repeatedFailureCount,
    issueCounts,
    issues,
  };
}

export function shouldStopDiagnosticCapture(summary, options = {}) {
  const maxToolCalls = Number.isFinite(options.maxToolCalls) ? Number(options.maxToolCalls) : 8;
  const minToolCallsBeforeIssueStop = Number.isFinite(options.minToolCallsBeforeIssueStop)
    ? Number(options.minToolCallsBeforeIssueStop)
    : 4;
  const maxLeadingDiscoveryBurst = Number.isFinite(options.maxLeadingDiscoveryBurst)
    ? Number(options.maxLeadingDiscoveryBurst)
    : 5;

  if ((summary?.totalToolCalls ?? 0) >= maxToolCalls && (summary?.deliverableTouchCount ?? 0) === 0) {
    return { stop: true, reason: "max-tool-calls" };
  }

  if ((summary?.leadingDiscoveryBurst ?? 0) >= maxLeadingDiscoveryBurst) {
    return { stop: true, reason: "discovery-drift" };
  }

  const issueCount = Object.values(summary?.issueCounts ?? {}).reduce((sum, count) => sum + Number(count || 0), 0);
  if ((summary?.totalToolCalls ?? 0) >= minToolCallsBeforeIssueStop && issueCount > 0) {
    return { stop: true, reason: "issue-detected" };
  }

  return { stop: false, reason: null };
}
