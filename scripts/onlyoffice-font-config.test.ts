import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "..");
const composePath = path.join(repoRoot, "docker-compose.yml");
const aliasConfigPath = path.join(repoRoot, "packaging", "onlyoffice", "99-openwork-cjk-aliases.conf");
const dockerfilePath = path.join(repoRoot, "packaging", "onlyoffice", "Dockerfile");
const installScriptPath = path.join(repoRoot, "scripts", "onlyoffice-install-cjk-fonts.sh");
const syncScriptPath = path.join(repoRoot, "scripts", "onlyoffice-sync-host-fonts.sh");

function readUtf8(filePath: string): string {
  return readFileSync(filePath, "utf8");
}

describe("OnlyOffice font packaging", () => {
  test("builds a derived OnlyOffice image instead of pulling the stock image directly", () => {
    const compose = readUtf8(composePath);

    expect(compose).toContain("build:");
    expect(compose).toContain("dockerfile: packaging/onlyoffice/Dockerfile");
  });

  test("ships a shared alias config for common bid-template Chinese fonts", () => {
    const aliasConfig = readUtf8(aliasConfigPath);

    for (const family of [
      "宋体",
      "黑体",
      "微软雅黑",
      "等线",
      "仿宋",
      "仿宋_GB2312",
      "楷体",
      "楷体_GB2312",
    ]) {
      expect(aliasConfig).toContain(`<family>${family}</family>`);
    }
  });

  test("copies the shared alias config into the image and runtime patch scripts", () => {
    const dockerfile = readUtf8(dockerfilePath);
    const installScript = readUtf8(installScriptPath);
    const syncScript = readUtf8(syncScriptPath);

    expect(dockerfile).toContain("99-openwork-cjk-aliases.conf");
    expect(installScript).toContain("packaging/onlyoffice/99-openwork-cjk-aliases.conf");
    expect(syncScript).toContain("packaging/onlyoffice/99-openwork-cjk-aliases.conf");
  });
});
