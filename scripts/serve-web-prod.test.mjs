import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  contentTypeForPath,
  resolveProxyPath,
  resolveStaticFilePath,
  shouldServeSpaFallback,
} from "./serve-web-prod.mjs";

test("resolveProxyPath strips the /openwork prefix", () => {
  assert.equal(resolveProxyPath("/openwork/health?check=1"), "/health?check=1");
  assert.equal(resolveProxyPath("/openwork"), "/");
  assert.equal(resolveProxyPath("/openwork/"), "/");
});

test("shouldServeSpaFallback only returns true for route-like paths", () => {
  assert.equal(shouldServeSpaFallback("/document-agent/ses_123"), true);
  assert.equal(shouldServeSpaFallback("/dashboard/agents"), true);
  assert.equal(shouldServeSpaFallback("/assets/app.js"), false);
  assert.equal(shouldServeSpaFallback("/favicon.ico"), false);
});

test("resolveStaticFilePath blocks path traversal and falls back to index.html for SPA routes", () => {
  const root = mkdtempSync(join(tmpdir(), "openwork-prod-web-"));
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<html></html>", "utf8");
  writeFileSync(join(root, "assets", "app.js"), "console.log('ok')", "utf8");

  assert.equal(resolveStaticFilePath(root, "/assets/app.js"), join(root, "assets", "app.js"));
  assert.equal(resolveStaticFilePath(root, "/document-agent/ses_123"), join(root, "index.html"));
  assert.equal(resolveStaticFilePath(root, "/%2e%2e/%2e%2e/etc/passwd"), null);
});

test("contentTypeForPath returns expected common asset types", () => {
  assert.equal(contentTypeForPath("/index.html"), "text/html; charset=utf-8");
  assert.equal(contentTypeForPath("/assets/app.js"), "application/javascript; charset=utf-8");
  assert.equal(contentTypeForPath("/assets/app.css"), "text/css; charset=utf-8");
  assert.equal(contentTypeForPath("/assets/logo.svg"), "image/svg+xml");
});
