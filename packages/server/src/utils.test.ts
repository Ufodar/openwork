import { describe, expect, test } from "bun:test";
import { createAscendingPrefixedId, hashToken, shortId, parseList, ensureDir, exists } from "./utils.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("hashToken", () => {
  test("returns consistent hash for same input", () => {
    const a = hashToken("my-secret-token");
    const b = hashToken("my-secret-token");
    expect(a).toBe(b);
  });

  test("returns different hashes for different inputs", () => {
    const a = hashToken("token-a");
    const b = hashToken("token-b");
    expect(a).not.toBe(b);
  });

  test("returns a hex string", () => {
    const hash = hashToken("test");
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});

describe("shortId", () => {
  test("returns a non-empty string", () => {
    const id = shortId();
    expect(id.length).toBeGreaterThan(0);
  });

  test("returns unique values", () => {
    const ids = new Set(Array.from({ length: 100 }, () => shortId()));
    expect(ids.size).toBe(100);
  });
});

describe("createAscendingPrefixedId", () => {
  test("returns an OpenCode-compatible prefixed id", () => {
    const id = createAscendingPrefixedId("msg", 1_700_000_000_000);
    expect(id).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
  });

  test("preserves lexical ordering within the same timestamp", () => {
    const first = createAscendingPrefixedId("msg", 1_700_000_000_123);
    const second = createAscendingPrefixedId("msg", 1_700_000_000_123);
    expect(first < second).toBe(true);
  });
});

describe("parseList", () => {
  test("splits comma-separated values", () => {
    expect(parseList("a,b,c")).toEqual(["a", "b", "c"]);
  });

  test("trims whitespace", () => {
    expect(parseList(" a , b , c ")).toEqual(["a", "b", "c"]);
  });

  test("filters empty entries", () => {
    expect(parseList("a,,b,")).toEqual(["a", "b"]);
  });

  test("returns empty array for falsy input", () => {
    expect(parseList(undefined)).toEqual([]);
    expect(parseList("")).toEqual([]);
  });
});

describe("ensureDir + exists", () => {
  test("creates nested directory and reports it exists", async () => {
    const dir = join(tmpdir(), `openwork-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const nested = join(dir, "a", "b", "c");

    expect(await exists(nested)).toBe(false);
    await ensureDir(nested);
    expect(await exists(nested)).toBe(true);
  });
});
