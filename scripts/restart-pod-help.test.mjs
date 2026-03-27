import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const cwd = new URL("..", import.meta.url);

test("restart-pod help documents reuse-build mode", () => {
  const result = spawnSync("bash", ["scripts/restart-pod.sh", "--help"], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /--reuse-build/);
  assert.match(result.stdout, /--skip-runtime-control/);
  assert.match(result.stdout, /OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS/);
});

test("recover-pod-runtime help documents no-build recovery intent", () => {
  const result = spawnSync("bash", ["scripts/recover-pod-runtime.sh", "--help"], {
    cwd,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /fast pod recovery/i);
  assert.match(result.stdout, /OPENWORK_REUSE_BUILD=1/);
  assert.match(result.stdout, /OPENWORK_SERVER_HEALTH_TIMEOUT_SECONDS=60/);
});

test("pod restart and recovery scripts default managed OpenCode source to downloaded", () => {
  const restartScript = readFileSync(new URL("./restart-pod.sh", import.meta.url), "utf8");
  const recoverScript = readFileSync(new URL("./recover-pod-runtime.sh", import.meta.url), "utf8");
  const startScript = readFileSync(new URL("./start-pod.sh", import.meta.url), "utf8");
  const externalFallbackRegex = new RegExp(
    String.raw`elif \[ -n "\$\{OPENWORK_OPENCODE_BIN:-\}" \] \|\| command -v opencode >/dev/null 2>&1; then\s+requested="external"`,
  );
  const explicitBinRegex = new RegExp(String.raw`elif \[ -n "\$\{OPENWORK_OPENCODE_BIN:-\}" \]; then\s+requested="external"`);
  const downloadedDefaultRegex = new RegExp(String.raw`else\s+requested="downloaded"`);

  assert.match(startScript, /OPENWORK_POD_OPENCODE_SOURCE="\$\{OPENWORK_POD_OPENCODE_SOURCE:-downloaded\}"/);
  assert.match(recoverScript, /OPENWORK_POD_OPENCODE_SOURCE="\$\{OPENWORK_POD_OPENCODE_SOURCE:-downloaded\}"/);
  assert.doesNotMatch(restartScript, externalFallbackRegex);
  assert.match(restartScript, explicitBinRegex);
  assert.match(restartScript, downloadedDefaultRegex);
});

test("restart-pod launches long-lived services under nohup with stable log files", () => {
  const restartScript = readFileSync(new URL("./restart-pod.sh", import.meta.url), "utf8");

  assert.match(restartScript, /OPENWORK_RUNTIME_LOG_DIR="\$\{OPENWORK_RUNTIME_LOG_DIR:-\$PROJECT_DIR\/tmp\}"/);
  assert.match(restartScript, /OPENWORK_ORCHESTRATOR_LOG="\$\{OPENWORK_ORCHESTRATOR_LOG:-\$OPENWORK_RUNTIME_LOG_DIR\/manual-orchestrator\.log\}"/);
  assert.match(restartScript, /OPENWORK_WEB_LOG="\$\{OPENWORK_WEB_LOG:-\$OPENWORK_RUNTIME_LOG_DIR\/manual-web-\$\{OPENWORK_WEB_PORT\}\.log\}"/);
  assert.match(restartScript, /launch_detached_process\(\)/);
  assert.match(restartScript, /nohup "\$@" >"\$log_file" 2>&1 <\/dev\/null &/);
  assert.match(restartScript, /launch_detached_process\s+\\\s+WEB_PID/);
  assert.match(restartScript, /launch_detached_process\s+\\\s+ORCHESTRATOR_PID/);
});

test("restart-pod releases cleanup traps after health checks succeed", () => {
  const restartScript = readFileSync(new URL("./restart-pod.sh", import.meta.url), "utf8");

  assert.match(restartScript, /Deployment is up\./);
  assert.match(restartScript, /trap - EXIT INT TERM/);
  assert.match(restartScript, /WEB_PID=""\s+PUBLIC_WEB_PID=""\s+ORCHESTRATOR_PID=""\s+exit 0/s);
});
