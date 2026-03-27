import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const rootDir = path.resolve(import.meta.dirname, "..", "..");
const pluginPath = path.join(rootDir, ".opencode", "plugins", "session-temp-root.js");

test("session temp-root plugin exists and forces shell temp env into workspace-local .tmp/system", async () => {
  assert.ok(fs.existsSync(pluginPath), "expected .opencode/plugins/session-temp-root.js to exist");

  const { SessionTempRootPlugin } = await import(pathToFileURL(pluginPath).href);
  const plugin = await SessionTempRootPlugin({ directory: rootDir });
  const output = { env: {} };

  await plugin["shell.env"]({ cwd: path.join(rootDir, "nested"), sessionID: "ses_test" }, output);

  const expected = path.join(rootDir, ".tmp", "system");
  assert.equal(output.env.TMPDIR, expected);
  assert.equal(output.env.TMP, expected);
  assert.equal(output.env.TEMP, expected);
  assert.ok(fs.existsSync(expected), "expected plugin to create workspace-local temp root");
});
