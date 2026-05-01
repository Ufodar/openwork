import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

describe("workspace route preservation wiring", () => {
  test("connect flow does not override explicit bid-workbench routes back to the generic session view", () => {
    const file = readFileSync(join(import.meta.dir, "workspace.ts"), "utf8");

    expect(file).toContain('pathname.startsWith("/bid-workbench")');
    expect(file).toContain('hash.startsWith("#/bid-workbench")');
    expect(file).toContain("const preservesExplicitRoute =");
  });
});
