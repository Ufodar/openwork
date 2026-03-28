import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";

const root = resolve(import.meta.dir, "..", "..", "..");
const scriptPath = resolve(root, ".opencode", "references", "check_document_delivery.py");

function runGate(targets, cwd) {
  const args = [scriptPath];
  for (const target of targets) {
    args.push("--target", target);
  }
  const result = spawnSync("python3", args, {
    cwd,
    encoding: "utf8",
  });
  return {
    ...result,
    json: JSON.parse(result.stdout || "{}"),
  };
}

test("delivery gate fails on placeholder domains in markdown deliverables", () => {
  const workspace = mkdtempSync(join(tmpdir(), "openwork-delivery-gate-"));
  try {
    mkdirSync(join(workspace, "outputs"), { recursive: true });
    writeFileSync(
      join(workspace, "outputs", "final.md"),
      "接口地址：https://kubernetes.example.com:6443\n",
      "utf8",
    );

    const result = runGate(["outputs"], workspace);
    expect(result.status).toBe(1);
    expect(result.json.ok).toBe(false);
    expect(result.json.issueCount).toBeGreaterThan(0);
    expect(JSON.stringify(result.json.issues)).toContain("placeholder-example-domain");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("delivery gate ignores .opencode examples when scanning a workspace root", () => {
  const workspace = mkdtempSync(join(tmpdir(), "openwork-delivery-gate-"));
  try {
    mkdirSync(join(workspace, ".opencode"), { recursive: true });
    mkdirSync(join(workspace, "outputs"), { recursive: true });
    writeFileSync(join(workspace, ".opencode", "policy.md"), "不要写 example.com\n", "utf8");
    writeFileSync(join(workspace, "outputs", "final.md"), "正式交付内容\n", "utf8");

    const result = runGate(["."], workspace);
    expect(result.status).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.scannedFiles.some((item) => item.endsWith(".opencode/policy.md"))).toBe(false);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("delivery gate does not drop valid files just because an ancestor path contains tmp", () => {
  const outer = mkdtempSync(join(tmpdir(), "openwork-delivery-gate-parent-"));
  const workspace = join(outer, "tmp-wrapper", "workspace");
  try {
    mkdirSync(join(workspace, "outputs"), { recursive: true });
    writeFileSync(join(workspace, "outputs", "final.md"), "正式交付内容\n", "utf8");

    const result = runGate(["outputs"], workspace);
    expect(result.status).toBe(0);
    expect(result.json.ok).toBe(true);
    expect(result.json.scannedFiles.some((item) => item.endsWith("outputs/final.md"))).toBe(true);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

test("delivery gate extracts docx text before scanning", () => {
  const workspace = mkdtempSync(join(tmpdir(), "openwork-delivery-gate-"));
  try {
    mkdirSync(join(workspace, "outputs"), { recursive: true });
    const docxPath = join(workspace, "outputs", "final.docx");
    const creator = spawnSync(
      "python3",
      [
        "-c",
        `
from pathlib import Path
from zipfile import ZipFile
import sys
target = Path(sys.argv[1])
with ZipFile(target, "w") as zf:
    zf.writestr("[Content_Types].xml", "<?xml version='1.0' encoding='UTF-8'?><Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'><Default Extension='rels' ContentType='application/vnd.openxmlformats-package.relationships+xml'/><Default Extension='xml' ContentType='application/xml'/><Override PartName='/word/document.xml' ContentType='application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'/></Types>")
    zf.writestr("_rels/.rels", "<?xml version='1.0' encoding='UTF-8'?><Relationships xmlns='http://schemas.openxmlformats.org/package/2006/relationships'><Relationship Id='rId1' Type='http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument' Target='word/document.xml'/></Relationships>")
    zf.writestr("word/document.xml", "<?xml version='1.0' encoding='UTF-8'?><w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body><w:p><w:r><w:t>Authorization: Bearer &lt;access_token&gt;</w:t></w:r></w:p></w:body></w:document>")
`,
        docxPath,
      ],
      { encoding: "utf8" },
    );
    expect(creator.status).toBe(0);

    const result = runGate(["outputs/final.docx"], workspace);
    expect(result.status).toBe(1);
    expect(result.json.ok).toBe(false);
    expect(JSON.stringify(result.json.issues)).toContain("placeholder-access-token");
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
