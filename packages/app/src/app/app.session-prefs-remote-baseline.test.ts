import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

test("session preference persistence compares against a remote snapshot instead of merged local state", () => {
  const file = readFileSync(join(import.meta.dir, "app.tsx"), "utf8");

  expect(file).toContain("const [openworkRemoteSessionPrefsById, setOpenworkRemoteSessionPrefsById]");
  expect(file).toContain("setOpenworkRemoteSessionPrefsById(prefs);");
  expect(file).toContain("remotePrefs = openworkRemoteSessionPrefsById();");
  expect(file).toContain("const mergedBasePrefs = mergeSessionPrefsForRemotePatch(openworkSessionPrefsById(), id);");
});
