import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("repo opencode.json stays byte-identical to opencode.jsonc", () => {
  const json = readFileSync(new URL("../opencode.json", import.meta.url), "utf8");
  const jsonc = readFileSync(new URL("../opencode.jsonc", import.meta.url), "utf8");

  assert.equal(json, jsonc);
});
