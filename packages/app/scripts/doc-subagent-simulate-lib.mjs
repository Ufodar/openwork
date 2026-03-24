const FATAL_PATTERNS = [
  /system message must be at the beginning/i,
  /session not found/i,
  /provider[_\s-]?error/i,
  /model.+error/i,
  /timed out waiting for session/i,
];

function normalizeHeading(value) {
  return String(value ?? "")
    .replace(/^\s{0,3}#{1,6}\s+/, "")
    .replace(/^[（(]?[0-9一二三四五六七八九十]+(?:\.[0-9]+)*[)）]?[、.\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasHeading(headings, expected) {
  const target = normalizeHeading(expected);
  return headings.some((heading) => normalizeHeading(heading) === target);
}

function includesFile(files, expected) {
  return files.includes(expected);
}

export function summarizeArtifactFiles(files, expectedOutput) {
  const sourceArtifacts = files.filter((file) =>
    file.startsWith(".worktree/sources/") &&
    file.endsWith(".json") &&
    file !== ".worktree/sources/manifest.json",
  );

  return {
    files: [...files].sort((a, b) => a.localeCompare(b)),
    sourceArtifactCount: sourceArtifacts.length,
    sourceArtifacts,
    hasIndex: includesFile(files, ".worktree/index.json"),
    hasManifest: includesFile(files, ".worktree/sources/manifest.json"),
    hasFacts: includesFile(files, ".worktree/facts.json"),
    hasConflicts: includesFile(files, ".worktree/merge/conflicts.json"),
    hasPlan: includesFile(files, ".worktree/plan/solution-plan.json"),
    hasCoverage: includesFile(files, ".worktree/coverage.json"),
    hasVerifyCoverage: includesFile(files, ".worktree/verify/coverage.json"),
    hasExpectedOutput: expectedOutput ? includesFile(files, expectedOutput) : false,
  };
}

export function extractMarkdownHeadings(markdown) {
  return String(markdown ?? "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/)?.[1]?.trim())
    .filter(Boolean);
}

function findFatalText(promptRun) {
  const haystacks = [
    promptRun.assistantText,
    ...(Array.isArray(promptRun.toolErrors) ? promptRun.toolErrors : []),
  ]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);

  for (const text of haystacks) {
    if (FATAL_PATTERNS.some((pattern) => pattern.test(text))) {
      return text;
    }
  }
  return null;
}

export function validateScenarioResult(scenario, result) {
  const errors = [];
  const warnings = [];
  const promptRuns = Array.isArray(result.promptRuns) ? result.promptRuns : [];
  const expectedSourceCount = Array.isArray(scenario.docs) ? scenario.docs.length : 0;
  const expectedOutput = scenario.expectedOutput ?? null;
  const totalTaskCalls = promptRuns.reduce(
    (count, promptRun) => count + (Array.isArray(promptRun.taskCalls) ? promptRun.taskCalls.length : 0),
    0,
  );
  const allTaskAgents = new Set(
    promptRuns.flatMap((promptRun) =>
      (Array.isArray(promptRun.taskCalls) ? promptRun.taskCalls : [])
        .map((taskCall) => taskCall?.agent)
        .filter(Boolean),
    ),
  );
  const unexpectedAgents = [...allTaskAgents].filter((agent) => typeof agent === "string" && agent && !agent.startsWith("doc-"));

  if (promptRuns.length !== (Array.isArray(scenario.prompts) ? scenario.prompts.length : promptRuns.length)) {
    errors.push(
      `Expected ${scenario.prompts.length} prompt runs for ${scenario.id}, but observed ${promptRuns.length}.`,
    );
  }

  promptRuns.forEach((promptRun, index) => {
    const label = `Prompt ${index + 1}`;
    const state = promptRun.state ?? summarizeArtifactFiles(result.keyFiles ?? [], expectedOutput);
    const taskCalls = Array.isArray(promptRun.taskCalls) ? promptRun.taskCalls : [];
    const assistantText = typeof promptRun.assistantText === "string" ? promptRun.assistantText.trim() : "";
    const fatalText = findFatalText(promptRun);
    const requiredHeadings = Array.isArray(scenario.requiredHeadingsByPrompt?.[index])
      ? scenario.requiredHeadingsByPrompt[index]
      : [];
    const outputHeadings = Array.isArray(promptRun.outputHeadings) ? promptRun.outputHeadings : [];

    if (!taskCalls.length && !assistantText) {
      errors.push(`${label} did not launch any subagent tasks and produced no assistant receipt.`);
    }

    if (fatalText) {
      errors.push(`${label} surfaced a fatal model/runtime error: "${fatalText}"`);
    }

    if (Array.isArray(promptRun.toolErrors) && promptRun.toolErrors.length && !fatalText) {
      warnings.push(`${label} observed tool errors: ${promptRun.toolErrors.join(" | ")}`);
    }

    if (index === 0) {
      if (state.sourceArtifactCount < expectedSourceCount) {
        errors.push(
          `${label} compiled only ${state.sourceArtifactCount}/${expectedSourceCount} source artifacts.`,
        );
      }
      if (!(state.hasFacts && state.hasConflicts && state.hasPlan && state.hasCoverage)) {
        errors.push(`${label} did not produce all required planning artifacts.`);
      }
    }

    if (index >= 1) {
      if (expectedOutput && !state.hasExpectedOutput) {
        errors.push(`${label} did not produce the expected deliverable: ${expectedOutput}`);
      }
      if (!state.hasVerifyCoverage) {
        errors.push(`${label} did not leave verifier coverage state behind.`);
      }
      for (const heading of requiredHeadings) {
        if (!hasHeading(outputHeadings, heading)) {
          errors.push(`${label} is missing required output heading: ${heading}`);
        }
      }
    }
  });

  if (totalTaskCalls === 0) {
    errors.push("No subagent task calls were observed across the scenario.");
  }

  if (unexpectedAgents.length) {
    errors.push(`Observed unexpected non-doc subagents: ${unexpectedAgents.sort((a, b) => a.localeCompare(b)).join(", ")}`);
  }

  const finalState = summarizeArtifactFiles(result.keyFiles ?? [], expectedOutput);
  if (finalState.sourceArtifactCount < expectedSourceCount) {
    errors.push(
      `Final workspace snapshot is missing compiled source artifacts (${finalState.sourceArtifactCount}/${expectedSourceCount}).`,
    );
  }
  if (!(finalState.hasFacts && finalState.hasConflicts && finalState.hasPlan && finalState.hasCoverage)) {
    errors.push("Final workspace snapshot is missing one or more state artifacts required before writing.");
  }
  if (expectedOutput && !finalState.hasExpectedOutput) {
    errors.push(`Final workspace snapshot is missing the expected deliverable: ${expectedOutput}`);
  }
  if (!finalState.hasVerifyCoverage) {
    errors.push("Final workspace snapshot is missing verifier coverage state.");
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    observedAgents: [...allTaskAgents].sort((a, b) => a.localeCompare(b)),
    finalState,
  };
}
