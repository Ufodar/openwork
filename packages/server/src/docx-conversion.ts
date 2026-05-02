import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

import { ApiError } from "./errors.js";
import { ensureDir, exists, shortId } from "./utils.js";

const DOCX_ZIP_EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm"]);

function resolveDocxConversionCacheDir(workspacePath: string): string {
  return join(workspacePath, ".opencode", "openwork", "cache", "docx-convert");
}

export async function ensureDocxZipPath(workspacePath: string, inputPath: string): Promise<string> {
  const ext = extname(inputPath).toLowerCase();
  if (DOCX_ZIP_EXTENSIONS.has(ext)) return inputPath;

  if (ext !== ".doc") {
    throw new ApiError(
      400,
      "unsupported_docx_copy_source",
      "Only .docx/.docm/.dotx/.dotm sources are supported (or .doc with LibreOffice installed).",
    );
  }

  const cacheDir = resolveDocxConversionCacheDir(workspacePath);
  await ensureDir(cacheDir);

  const info = await stat(inputPath);
  const signature = createHash("sha256")
    .update(`${inputPath}:${info.size}:${info.mtimeMs}`)
    .digest("hex")
    .slice(0, 12);
  const dest = join(cacheDir, `converted-${signature}.docx`);
  if (await exists(dest)) return dest;

  const tempDir = join(tmpdir(), `openwork-docx-convert-${shortId()}`);
  await ensureDir(tempDir);
  try {
    const convert = spawnSync(
      "soffice",
      [
        "--headless",
        "--nologo",
        "--nofirststartwizard",
        "--convert-to",
        "docx",
        "--outdir",
        tempDir,
        inputPath,
      ],
      { encoding: "utf8" },
    );
    if (convert.status !== 0) {
      const stderr = String(convert.stderr || "").trim();
      const stdout = String(convert.stdout || "").trim();
      throw new ApiError(
        400,
        "docx_conversion_failed",
        stderr || stdout || "Failed to convert .doc to .docx (LibreOffice).",
      );
    }

    const expected = join(tempDir, `${basename(inputPath, ext)}.docx`);
    let source = (await exists(expected)) ? expected : null;
    if (!source) {
      const entries = await readdir(tempDir, { withFileTypes: true });
      const found = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".docx"));
      if (!found) {
        throw new ApiError(400, "docx_conversion_failed", "LibreOffice did not produce a .docx output.");
      }
      source = join(tempDir, found.name);
    }

    await rename(source, dest);
    return dest;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
