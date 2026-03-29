import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cwd = new URL("..", import.meta.url);

test("open-hosted-session resolves runtime env and execs opencode with the requested session id", () => {
  const root = mkdtempSync(join(tmpdir(), "open-hosted-session-"));
  const mappingDir = join(root, "session-workspaces");
  const runtimeDir = join(root, "user-workspaces", "user-1", "documents", "sessions", "runtime-1");
  const fakeBin = join(root, "bin");
  const capturePath = join(root, "capture.txt");
  const sessionId = "ses_test_runtime_1";

  mkdirSync(mappingDir, { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "config"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "config-home"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "data"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "state"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "cache"), { recursive: true });
  mkdirSync(join(runtimeDir, ".tmp", "system"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(
    join(mappingDir, "user-1.json"),
    JSON.stringify({
      [sessionId]: {
        runtimeId: "runtime-1",
        runtimeDir,
      },
    }),
    "utf8",
  );

  writeFileSync(
    join(fakeBin, "opencode"),
    `#!/usr/bin/env bash
set -euo pipefail
{
  printf 'pwd=%s\\n' "$PWD"
  printf 'arg1=%s\\n' "$1"
  printf 'arg2=%s\\n' "$2"
  printf 'OPENCODE_CONFIG_DIR=%s\\n' "\${OPENCODE_CONFIG_DIR:-}"
  printf 'XDG_CONFIG_HOME=%s\\n' "\${XDG_CONFIG_HOME:-}"
  printf 'XDG_DATA_HOME=%s\\n' "\${XDG_DATA_HOME:-}"
  printf 'XDG_STATE_HOME=%s\\n' "\${XDG_STATE_HOME:-}"
  printf 'XDG_CACHE_HOME=%s\\n' "\${XDG_CACHE_HOME:-}"
  printf 'TMPDIR=%s\\n' "\${TMPDIR:-}"
} > "$FAKE_CAPTURE"
`,
    { encoding: "utf8", mode: 0o755 },
  );

  const result = spawnSync("bash", ["scripts/open-hosted-session.sh", sessionId], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENWORK_SESSION_WORKSPACES_DIR: mappingDir,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      FAKE_CAPTURE: capturePath,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const capture = readFileSync(capturePath, "utf8");
  assert.match(capture, new RegExp(`^pwd=${runtimeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(capture, /^arg1=-s$/m);
  assert.match(capture, new RegExp(`^arg2=${sessionId}$`, "m"));
  assert.match(
    capture,
    new RegExp(`^OPENCODE_CONFIG_DIR=${join(runtimeDir, ".openwork-runtime", "opencode", "config").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
  );
  assert.match(
    capture,
    new RegExp(`^TMPDIR=${join(runtimeDir, ".tmp", "system").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"),
  );
});

test("open-hosted-session exits non-zero when the session id cannot be found", () => {
  const root = mkdtempSync(join(tmpdir(), "open-hosted-session-missing-"));
  const mappingDir = join(root, "session-workspaces");

  mkdirSync(mappingDir, { recursive: true });
  writeFileSync(join(mappingDir, "user-1.json"), JSON.stringify({}), "utf8");

  const result = spawnSync("bash", ["scripts/open-hosted-session.sh", "ses_missing"], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENWORK_SESSION_WORKSPACES_DIR: mappingDir,
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /session not found/i);
});

test("open-hosted-session resolves runtimeDir from schemaVersion=2 workspaces mappings", () => {
  const root = mkdtempSync(join(tmpdir(), "open-hosted-session-v2-"));
  const mappingDir = join(root, "session-workspaces");
  const runtimeDir = join(root, "user-workspaces", "user-1", "documents", "sessions", "runtime-v2");
  const fakeBin = join(root, "bin");
  const capturePath = join(root, "capture-v2.txt");
  const sessionId = "ses_test_runtime_v2";

  mkdirSync(mappingDir, { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "config"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "config-home"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "data"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "state"), { recursive: true });
  mkdirSync(join(runtimeDir, ".openwork-runtime", "opencode", "cache"), { recursive: true });
  mkdirSync(join(runtimeDir, ".tmp", "system"), { recursive: true });
  mkdirSync(fakeBin, { recursive: true });

  writeFileSync(
    join(mappingDir, "user-1.json"),
    JSON.stringify({
      schemaVersion: 2,
      updatedAt: Date.now(),
      workspaces: {
        [sessionId]: {
          runtimeId: "runtime-v2",
          runtimeDir,
        },
      },
    }),
    "utf8",
  );

  writeFileSync(
    join(fakeBin, "opencode"),
    `#!/usr/bin/env bash
set -euo pipefail
printf 'pwd=%s\\n' "$PWD" > "$FAKE_CAPTURE"
printf 'arg1=%s\\n' "$1" >> "$FAKE_CAPTURE"
printf 'arg2=%s\\n' "$2" >> "$FAKE_CAPTURE"
`,
    { encoding: "utf8", mode: 0o755 },
  );

  const result = spawnSync("bash", ["scripts/open-hosted-session.sh", sessionId], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      OPENWORK_SESSION_WORKSPACES_DIR: mappingDir,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      FAKE_CAPTURE: capturePath,
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const capture = readFileSync(capturePath, "utf8");
  assert.match(capture, new RegExp(`^pwd=${runtimeDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  assert.match(capture, /^arg1=-s$/m);
  assert.match(capture, new RegExp(`^arg2=${sessionId}$`, "m"));
});
