import { copyFile, readFile, writeFile, readdir, stat, rm, rename, mkdtemp } from "node:fs/promises";
import { dirname, join, resolve, relative, basename, extname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import jwt from "jsonwebtoken";
import type { ServerConfig, WorkspaceInfo, Actor } from "./types.js";
import { ApiError } from "./errors.js";
import { ensureDir, exists, shortId } from "./utils.js";
import type { SessionWorkspaceService } from "./session-workspaces.js";

// Local types to avoid circular dependencies
interface RequestContext {
    request: Request;
    url: URL;
    params: Record<string, string>;
    config: ServerConfig;
    actor?: Actor;
    [key: string]: any; // Allow other properties
}

interface Route {
    method: string;
    regex: RegExp;
    keys: string[];
    auth: "none" | "token" | "host" | "client" | "user" | string;
    handler: (ctx: RequestContext) => Promise<Response>;
}

// Types for OnlyOffice
interface OnlyOfficeConfig {
    document: {
        fileType: string;
        key: string;
        title: string;
        url: string;
        permissions: {
            download: boolean;
            edit: boolean;
            print: boolean;
            review: boolean;
        };
    };
    documentType: "word" | "cell" | "slide";
    editorConfig: {
        callbackUrl: string;
        user: {
            id: string;
            name: string;
        };
        mode: "edit" | "view";
        lang: string;
        customization: {
            autosave: boolean;
            forcesave: boolean;
            spellcheck: boolean;
            features: {
                spellcheck: boolean;
            };
        };
    };
    token?: string;
}

interface OnlyOfficeCallback {
    key: string;
    status: number;
    url?: string;
    changesurl?: string;
    history?: {
        serverVersion: string;
        changes: Array<{
            created: string;
            user: {
                id: string;
                name: string;
            };
        }>;
    };
    users?: string[];
    userdata?: string;
    lastsave?: string;
    notmodified?: boolean;
}

const WORD_EXTENSIONS = [
    ".doc",
    ".docx",
    ".docm",
    ".dot",
    ".dotx",
    ".dotm",
    ".odt",
    ".fodt",
    ".ott",
    ".rtf",
    ".txt",
    ".html",
    ".htm",
    ".mht",
    ".pdf",
    ".djvu",
    ".fb2",
    ".epub",
    ".xps",
];
const CELL_EXTENSIONS = [
    ".xls",
    ".xlsx",
    ".xlsm",
    ".xlt",
    ".xltx",
    ".xltm",
    ".ods",
    ".fods",
    ".ots",
    ".csv",
];
const SLIDE_EXTENSIONS = [
    ".pps",
    ".ppsx",
    ".ppsm",
    ".ppt",
    ".pptx",
    ".pptm",
    ".pot",
    ".potx",
    ".potm",
    ".odp",
    ".fodp",
    ".otp",
];

const DOCX_ZIP_EXTENSIONS = new Set([".docx", ".docm", ".dotx", ".dotm"]);
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const BOOTSTRAP_STATE_DIR = ".worktree";
const BOOTSTRAP_SOURCE_MANIFEST_PATH = join(BOOTSTRAP_STATE_DIR, "sources", "manifest.json");
const BOOTSTRAP_INDEX_PATH = join(BOOTSTRAP_STATE_DIR, "index.json");
const BOOTSTRAP_CONVENTIONS_PATH = join(BOOTSTRAP_STATE_DIR, "conventions.md");
const BOOTSTRAP_IGNORED_TOP_LEVEL = new Set([
    ".opencode",
    ".openwork-runtime",
    ".worktree",
    ".tmp",
    "artifacts",
    "reports",
    "outputs",
    "tmp",
]);
const BOOTSTRAP_ALLOWED_EXTENSIONS = new Set([
    ...WORD_EXTENSIONS,
    ...CELL_EXTENSIONS,
    ...SLIDE_EXTENSIONS,
    ".pdf",
]);
const BOOTSTRAP_DIRECT_TEXT_EXTENSIONS = new Set([
    ".txt",
    ".md",
    ".markdown",
    ".csv",
    ".tsv",
]);
const SESSION_SOURCE_FILE_BASENAME = /^src-(\d+)(\.[^./]+)?$/i;
type BootstrapCommandRunner = typeof spawnSync;

interface RefreshBootstrapDocumentStateOptions {
    runCommand?: BootstrapCommandRunner;
}

// Helper to get document type from extension
function getDocumentType(filename: string): "word" | "cell" | "slide" {
    const ext = extname(filename).toLowerCase();
    if (WORD_EXTENSIONS.includes(ext)) {
        return "word";
    }
    if (CELL_EXTENSIONS.includes(ext)) {
        return "cell";
    }
    if (SLIDE_EXTENSIONS.includes(ext)) {
        return "slide";
    }
    return "word"; // Default
}

function parseDocumentSessionId(rawSessionId: string | null): string | null {
    const value = (rawSessionId ?? "").trim();
    if (!value) return null;
    if (!SESSION_ID_PATTERN.test(value)) {
        throw new ApiError(400, "invalid_request", "Invalid session id");
    }
    return value;
}

async function resolveDocumentsDir(
    workspacePath: string,
    sessionId?: string | null,
    options?: { workspaceId?: string; sessionWorkspaces?: SessionWorkspaceService },
): Promise<string> {
    const root = join(workspacePath, "documents");
    if (!sessionId) return root;
    if (options?.workspaceId && options.sessionWorkspaces) {
        return await options.sessionWorkspaces.resolveDocumentsDir(options.workspaceId, workspacePath, sessionId);
    }
    return join(root, "sessions", sessionId);
}

function resolveInboxDir(workspacePath: string): string {
    return join(workspacePath, ".opencode", "openwork", "inbox");
}

function resolveDocxConversionCacheDir(workspacePath: string): string {
    return join(workspacePath, ".opencode", "openwork", "cache", "docx-convert");
}

function decodeInboxId(id: string): string {
    const raw = (id ?? "").trim();
    if (!raw) {
        throw new ApiError(400, "invalid_inbox_file", "Inbox file id is required");
    }
    try {
        return Buffer.from(raw, "base64url").toString("utf8");
    } catch {
        throw new ApiError(400, "invalid_inbox_file", "Inbox file id is invalid");
    }
}

function encodeInboxId(path: string): string {
    return Buffer.from(path, "utf8").toString("base64url");
}

export async function persistUploadedDocumentFile(destPath: string, file: File) {
    await ensureDir(dirname(destPath));
    const tmpPath = `${destPath}.tmp-${shortId()}`;
    if (typeof Bun !== "undefined" && typeof Bun.write === "function") {
        await Bun.write(tmpPath, file);
    } else {
        await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()));
    }
    await rename(tmpPath, destPath);
}

async function readJsonRecord(path: string): Promise<Record<string, any> | null> {
    try {
        const raw = await readFile(path, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed as Record<string, any> : null;
    } catch {
        return null;
    }
}

async function writeJsonAtomic(path: string, payload: unknown): Promise<void> {
    await ensureDir(dirname(path));
    const tmpPath = `${path}.tmp-${shortId()}`;
    await writeFile(tmpPath, JSON.stringify(payload, null, 2) + "\n", "utf8");
    await rename(tmpPath, path);
}

function nextSessionSourceFilename(existingPaths: string[], originalFilename: string): string {
    const extension = extname(originalFilename).toLowerCase();
    const used = new Set<number>();
    for (const path of existingPaths) {
        const leaf = basename(path.trim());
        const match = leaf.match(SESSION_SOURCE_FILE_BASENAME);
        if (!match) continue;
        const value = Number.parseInt(match[1] || "", 10);
        if (Number.isFinite(value) && value > 0) used.add(value);
    }
    let next = 1;
    while (used.has(next)) next += 1;
    return `src-${String(next).padStart(3, "0")}${extension}`;
}

async function reserveSessionSourceUploadPath(docsDir: string, originalFilename: string): Promise<string> {
    const entries = await readdir(docsDir, { withFileTypes: true }).catch(() => []);
    const existingPaths = entries
        .filter((entry) => entry.isFile())
        .map((entry) => entry.name);
    let candidate = nextSessionSourceFilename(existingPaths, originalFilename);
    for (let attempt = 0; attempt < 64; attempt += 1) {
        const absPath = resolveDocumentPathSafe(docsDir, candidate);
        if (!(await exists(absPath))) return candidate;
        const nextIndex = Number.parseInt((candidate.match(SESSION_SOURCE_FILE_BASENAME)?.[1] || "0"), 10) + 1;
        const extension = extname(originalFilename).toLowerCase();
        candidate = `src-${String(nextIndex).padStart(3, "0")}${extension}`;
    }
    throw new ApiError(409, "document_conflict", "Unable to reserve a machine document name");
}

async function seedBootstrapSourceMetadata(runtimeDir: string, source: {
    relativePath: string;
    originalName: string;
    originalRelativePath: string;
    title: string;
    kind: string;
}) {
    const manifestPath = join(runtimeDir, BOOTSTRAP_SOURCE_MANIFEST_PATH);
    const existingManifest = await readJsonRecord(manifestPath);
    const sources = Array.isArray(existingManifest?.sources) ? existingManifest.sources as Array<Record<string, any>> : [];
    const nextSources = sources.filter((item) => String(item?.relativePath || "").trim() !== source.relativePath);
    nextSources.push({
        ...sources.find((item) => String(item?.relativePath || "").trim() === source.relativePath),
        relativePath: source.relativePath,
        originalName: source.originalName,
        originalRelativePath: source.originalRelativePath,
        title: source.title,
        kind: source.kind,
        status: "uploaded",
    });
    await writeJsonAtomic(manifestPath, {
        generated_at: typeof existingManifest?.generated_at === "string" ? existingManifest.generated_at : new Date().toISOString(),
        goal: typeof existingManifest?.goal === "string" ? existingManifest.goal : "Compile uploaded source documents into structured state",
        target_doc: typeof existingManifest?.target_doc === "string" ? existingManifest.target_doc : null,
        sources: nextSources,
        blockers: Array.isArray(existingManifest?.blockers) ? existingManifest.blockers : [],
    });
}

function isBootstrapVisibleSegment(name: string): boolean {
    if (!name || name === "." || name === "..") return false;
    if (name.startsWith(".")) return false;
    if (BOOTSTRAP_IGNORED_TOP_LEVEL.has(name)) return false;
    if (name === "opencode.json" || name === "opencode.jsonc") return false;
    return true;
}

async function listBootstrapSourceFiles(rootDir: string, relativeDir = ""): Promise<string[]> {
    const absDir = relativeDir ? join(rootDir, relativeDir) : rootDir;
    const entries = await readdir(absDir, { withFileTypes: true }).catch(() => []);
    const next: string[] = [];
    for (const entry of entries) {
        if (!isBootstrapVisibleSegment(entry.name)) continue;
        const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            next.push(...await listBootstrapSourceFiles(rootDir, relPath));
            continue;
        }
        if (!entry.isFile()) continue;
        const ext = extname(entry.name).toLowerCase();
        if (!BOOTSTRAP_ALLOWED_EXTENSIONS.has(ext)) continue;
        next.push(relPath);
    }
    return next.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
}

function inferBootstrapRole(relativePath: string): string {
    const lower = relativePath.toLowerCase();
    if (lower.includes("招标") || lower.includes("tender")) return "招标文件";
    if (lower.includes("终版") || lower.includes("final")) return "终版材料";
    if (lower.includes("响应") || lower.includes("response")) return "响应材料";
    if (lower.includes("方案") || lower.includes("solution")) return "方案材料";
    return "参考材料";
}

function normalizeBootstrapTitle(relativePath: string): string {
    return basename(relativePath, extname(relativePath))
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function buildBootstrapDocId(relativePath: string): string {
    const stem = basename(relativePath, extname(relativePath))
        .normalize("NFKD")
        .replace(/[^\w]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase()
        .slice(0, 48);
    if (stem) return `doc-${stem}`;
    return `doc-${createHash("sha1").update(relativePath).digest("hex").slice(0, 12)}`;
}

function buildBootstrapProjectName(sources: Array<Record<string, any>>): string {
    const firstTitle = typeof sources[0]?.title === "string" ? sources[0].title.trim() : "";
    return firstTitle || "document-workspace";
}

function sanitizeBootstrapTextStem(value: string): string {
    return value
        .trim()
        .replace(/[^\p{L}\p{N}._-]+/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_.]+|[-_.]+$/g, "");
}

function buildBootstrapTextRelativePath(input: { relativePath: string; docId: string }): string {
    const sourceStem = sanitizeBootstrapTextStem(basename(input.relativePath, extname(input.relativePath)));
    const fallbackStem = sanitizeBootstrapTextStem(input.docId);
    const stem = sourceStem || fallbackStem || "source";
    return `${BOOTSTRAP_STATE_DIR}/text/${stem}.txt`;
}

function buildBootstrapTextExtractionPlan(input: {
    relativePath: string;
    docId: string;
}): {
    textRelativePath: string;
    extractor: string;
    command: string | null;
    args: string[];
    copySource: boolean;
} | null {
    const extension = extname(input.relativePath).toLowerCase();
    const textRelativePath = buildBootstrapTextRelativePath(input);
    if (BOOTSTRAP_DIRECT_TEXT_EXTENSIONS.has(extension)) {
        return {
            textRelativePath,
            extractor: "copy",
            command: null,
            args: [],
            copySource: true,
        };
    }
    if (DOCX_ZIP_EXTENSIONS.has(extension)) {
        return {
            textRelativePath,
            extractor: "pandoc",
            command: "pandoc",
            args: [],
            copySource: false,
        };
    }
    if (extension === ".pdf") {
        return {
            textRelativePath,
            extractor: "pdftotext",
            command: "pdftotext",
            args: [],
            copySource: false,
        };
    }
    return null;
}

async function ensureBootstrapSourceText(
    runtimeDir: string,
    source: {
        docId: string;
        relativePath: string;
    },
    previous: Record<string, any>,
    runCommand: BootstrapCommandRunner,
): Promise<Record<string, any>> {
    const priorTextRelativePath = typeof previous.textRelativePath === "string"
        ? normalizeDocumentPath(previous.textRelativePath)
        : "";
    if (priorTextRelativePath) {
        const priorTextAbsPath = resolveDocumentPathSafe(runtimeDir, priorTextRelativePath);
        if (await exists(priorTextAbsPath)) {
            return {
                textRelativePath: priorTextRelativePath,
                textStatus: typeof previous.textStatus === "string" && previous.textStatus.trim()
                    ? previous.textStatus.trim()
                    : "ready",
                textExtractor: typeof previous.textExtractor === "string" && previous.textExtractor.trim()
                    ? previous.textExtractor.trim()
                    : null,
            };
        }
    }

    const plan = buildBootstrapTextExtractionPlan(source);
    if (!plan) return {};

    const sourceAbsPath = resolveDocumentPathSafe(runtimeDir, source.relativePath);
    const textAbsPath = resolveDocumentPathSafe(runtimeDir, plan.textRelativePath);
    if (await exists(textAbsPath)) {
        return {
            textRelativePath: plan.textRelativePath,
            textStatus: "ready",
            textExtractor: plan.extractor,
        };
    }

    await ensureDir(dirname(textAbsPath));

    if (plan.copySource) {
        await copyFile(sourceAbsPath, textAbsPath);
        return {
            textRelativePath: plan.textRelativePath,
            textStatus: "ready",
            textExtractor: plan.extractor,
        };
    }

    let args: string[] = [];
    if (plan.command === "pandoc") {
        args = [sourceAbsPath, "-t", "plain", "-o", textAbsPath];
    } else if (plan.command === "pdftotext") {
        args = ["-layout", "-nopgbrk", sourceAbsPath, textAbsPath];
    } else {
        return {};
    }

    const result = runCommand(plan.command, args, { encoding: "utf8" });
    if (result.status === 0 && await exists(textAbsPath)) {
        return {
            textRelativePath: plan.textRelativePath,
            textStatus: "ready",
            textExtractor: plan.extractor,
        };
    }

    await rm(textAbsPath, { force: true }).catch(() => undefined);
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    return {
        textStatus: "unavailable",
        textExtractor: plan.extractor,
        textError: stderr || stdout || `${plan.command} failed`,
    };
}

function buildBootstrapConventionsMarkdown(input: {
    targetDoc: string | null;
    sources: Array<Record<string, any>>;
}): string {
    const lines = [
        "# Document State Conventions",
        "",
        "This file is a deterministic bootstrap created from uploaded filenames.",
        "",
        "Rules:",
        "- Prefer `.worktree/sources/manifest.json` as the initial source inventory.",
        "- Treat roles inferred from filenames as provisional until reader/merger artifacts refine them.",
        "- Keep generated deliverables under `outputs/`.",
        `- Current target deliverable: ${input.targetDoc ?? "(pending user target)"}`,
        "",
        "Uploaded source roles:",
    ];
    for (const source of input.sources) {
        const textRef = typeof source.textRelativePath === "string" && source.textRelativePath.trim()
            ? ` · text=${source.textRelativePath.trim()}`
            : "";
        lines.push(`- ${source.docId}: ${source.role} · ${source.relativePath}${textRef}`);
    }
    return lines.join("\n") + "\n";
}

export async function refreshBootstrapDocumentState(
    runtimeDir: string,
    options: RefreshBootstrapDocumentStateOptions = {},
): Promise<void> {
    const sourcePaths = await listBootstrapSourceFiles(runtimeDir);
    if (!sourcePaths.length) return;

    const indexPath = join(runtimeDir, BOOTSTRAP_INDEX_PATH);
    const manifestPath = join(runtimeDir, BOOTSTRAP_SOURCE_MANIFEST_PATH);
    const conventionsPath = join(runtimeDir, BOOTSTRAP_CONVENTIONS_PATH);

    const existingIndex = await readJsonRecord(indexPath);
    const existingManifest = await readJsonRecord(manifestPath);
    const existingSources = Array.isArray(existingManifest?.sources) ? existingManifest?.sources as Array<Record<string, any>> : [];
    const existingByPath = new Map<string, Record<string, any>>();
    for (const source of existingSources) {
        const relativePath = typeof source?.relativePath === "string" ? source.relativePath.trim() : "";
        if (!relativePath) continue;
        existingByPath.set(relativePath, source);
    }

    const mergedSources: Array<Record<string, any>> = [];
    for (const relativePath of sourcePaths) {
        const previous = existingByPath.get(relativePath) ?? {};
        const extension = extname(relativePath).toLowerCase();
        const title = typeof previous.title === "string" && previous.title.trim()
            ? previous.title.trim()
            : normalizeBootstrapTitle(relativePath);
        const role = typeof previous.role === "string" && previous.role.trim()
            ? previous.role.trim()
            : inferBootstrapRole(relativePath);
        const status = typeof previous.status === "string" && previous.status.trim()
            ? previous.status.trim()
            : "uploaded";
        const docId = typeof previous.docId === "string" && previous.docId.trim()
            ? previous.docId.trim()
            : buildBootstrapDocId(relativePath);
        const textState = await ensureBootstrapSourceText(
            runtimeDir,
            { docId, relativePath },
            previous,
            options.runCommand ?? spawnSync,
        );
        mergedSources.push({
            ...previous,
            docId,
            title,
            relativePath,
            kind: typeof previous.kind === "string" && previous.kind.trim()
                ? previous.kind.trim()
                : (extension.startsWith(".") ? extension.slice(1) : extension || "file"),
            role,
            status,
            ...textState,
        });
    }

    const targetDoc = typeof existingIndex?.target_doc === "string" && existingIndex.target_doc.trim()
        ? existingIndex.target_doc.trim()
        : typeof existingManifest?.target_doc === "string" && existingManifest.target_doc.trim()
        ? existingManifest.target_doc.trim()
        : null;
    const phase = typeof existingIndex?.phase === "string" && existingIndex.phase.trim()
        ? existingIndex.phase.trim()
        : "intake";
    const preserveNarration = phase !== "intake";
    const bootstrapSummary = `Uploaded ${mergedSources.length} source documents. Bootstrap state is ready for source compilation.`;
    const bootstrapFocus = "Compile uploaded documents into per-source state artifacts.";

    const indexPayload = {
        version: typeof existingIndex?.version === "number" ? existingIndex.version : 1,
        project: typeof existingIndex?.project === "string" && existingIndex.project.trim()
            ? existingIndex.project.trim()
            : buildBootstrapProjectName(mergedSources),
        target_doc: targetDoc,
        phase,
        summary: preserveNarration && typeof existingIndex?.summary === "string" && existingIndex.summary.trim()
            ? existingIndex.summary.trim()
            : bootstrapSummary,
        current_focus: preserveNarration && typeof existingIndex?.current_focus === "string" && existingIndex.current_focus.trim()
            ? existingIndex.current_focus.trim()
            : bootstrapFocus,
        conventions_ref: typeof existingIndex?.conventions_ref === "string" && existingIndex.conventions_ref.trim()
            ? existingIndex.conventions_ref.trim()
            : BOOTSTRAP_CONVENTIONS_PATH,
        children: Array.isArray(existingIndex?.children) ? existingIndex.children : [],
    };

    const manifestPayload = {
        generated_at: new Date().toISOString(),
        goal: typeof existingManifest?.goal === "string" && existingManifest.goal.trim()
            ? existingManifest.goal.trim()
            : "Compile uploaded source documents into structured state",
        target_doc: targetDoc,
        sources: mergedSources,
        blockers: Array.isArray(existingManifest?.blockers) ? existingManifest.blockers : [],
    };

    await writeJsonAtomic(indexPath, indexPayload);
    await writeJsonAtomic(manifestPath, manifestPayload);
    if (!(await exists(conventionsPath))) {
        await ensureDir(dirname(conventionsPath));
        await writeFile(
            conventionsPath,
            buildBootstrapConventionsMarkdown({ targetDoc, sources: mergedSources }),
            "utf8",
        );
    }
}

async function ensureDocxZipPath(workspacePath: string, inputPath: string): Promise<string> {
    const ext = extname(inputPath).toLowerCase();
    if (DOCX_ZIP_EXTENSIONS.has(ext)) return inputPath;

    if (ext !== ".doc") {
        throw new ApiError(400, "unsupported_docx_copy_source", "Only .docx/.docm/.dotx/.dotm sources are supported (or .doc with LibreOffice installed).");
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

    const tmpDir = join(cacheDir, `tmp-${shortId()}`);
    await ensureDir(tmpDir);
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
                tmpDir,
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

        const expected = join(tmpDir, `${basename(inputPath, ext)}.docx`);
        const convertedPath = (await exists(expected))
            ? expected
            : (() => {
                // Best-effort fallback: pick the first .docx file in the output dir.
                return null;
            })();

        let source = convertedPath;
        if (!source) {
            const entries = await readdir(tmpDir, { withFileTypes: true });
            const found = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".docx"));
            if (!found) {
                throw new ApiError(400, "docx_conversion_failed", "LibreOffice did not produce a .docx output.");
            }
            source = join(tmpDir, found.name);
        }

        await rename(source, dest);
        return dest;
    } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
}

async function resolveSessionInboxFilePath({
    workspace,
    sessionId,
    inboxId,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    inboxId: string;
}): Promise<{ absPath: string; relPath: string }> {
    const inboxRoot = resolveInboxDir(workspace.path);
    const decoded = decodeInboxId(inboxId);
    const prefix = `sessions/${sessionId}/`;
    if (!decoded.startsWith(prefix)) {
        throw new ApiError(403, "forbidden", "Inbox file is not in this session");
    }
    const inboxAbs = resolveDocumentPathSafe(inboxRoot, decoded);
    if (!(await exists(inboxAbs))) throw new ApiError(404, "not_found", "Inbox file not found");
    return { absPath: inboxAbs, relPath: decoded };
}

/**
 * Resolve a file reference that may come as either a docPath (relative to session docs dir)
 * or a legacy inboxId. Prefers docPath; falls back to inboxId for backward compatibility.
 */
async function resolveSessionFileRef({
    workspace,
    sessionId,
    docPath,
    inboxId,
    sessionWorkspaces,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    docPath?: string;
    inboxId?: string;
    sessionWorkspaces?: SessionWorkspaceService;
}): Promise<{ absPath: string }> {
    if (docPath) {
        const docsDir = await resolveDocumentsDir(workspace.path, sessionId, {
            workspaceId: workspace.id,
            sessionWorkspaces,
        });
        const absPath = resolveDocumentPathSafe(docsDir, docPath);
        if (!(await exists(absPath))) throw new ApiError(404, "not_found", `Document file not found: ${docPath}`);
        return { absPath };
    }
    if (inboxId) {
        const { absPath } = await resolveSessionInboxFilePath({ workspace, sessionId, inboxId });
        return { absPath };
    }
    throw new ApiError(400, "invalid_request", "Either docPath or inboxId is required");
}

function nowStampForFilename(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeSessionReport({
    workspace,
    sessionId,
    moduleId,
    content,
    sessionWorkspaces,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    moduleId: string;
    content: string;
    sessionWorkspaces?: SessionWorkspaceService;
}): Promise<{ docPath: string }> {
    const docsDir = await resolveDocumentsDir(workspace.path, sessionId, {
        workspaceId: workspace.id,
        sessionWorkspaces,
    });
    const stamp = nowStampForFilename();
    const relPath = `reports/${moduleId}/${stamp}.md`;
    const absPath = resolveDocumentPathSafe(docsDir, relPath);
    await ensureDir(dirname(absPath));
    const tmp = `${absPath}.tmp-${shortId()}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, absPath);
    return { docPath: relPath };
}

async function writeSessionArtifactFromFile({
    workspace,
    sessionId,
    moduleId,
    filename,
    absSourcePath,
    sessionWorkspaces,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    moduleId: string;
    filename: string;
    absSourcePath: string;
    sessionWorkspaces?: SessionWorkspaceService;
}): Promise<{ docPath: string }> {
    const docsDir = await resolveDocumentsDir(workspace.path, sessionId, {
        workspaceId: workspace.id,
        sessionWorkspaces,
    });
    const stamp = nowStampForFilename();
    const safeName = (filename || "artifact").trim().replace(/[\\/]+/g, "-");
    const relPath = `reports/${moduleId}/${stamp}-${safeName}`;
    const absPath = resolveDocumentPathSafe(docsDir, relPath);
    await ensureDir(dirname(absPath));
    const tmp = `${absPath}.tmp-${shortId()}`;
    await copyFile(absSourcePath, tmp);
    await rename(tmp, absPath);
    return { docPath: relPath };
}

async function writeSessionVisibleArtifactFromFile({
    workspace,
    sessionId,
    moduleId,
    filename,
    absSourcePath,
    sessionWorkspaces,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    moduleId: string;
    filename: string;
    absSourcePath: string;
    sessionWorkspaces?: SessionWorkspaceService;
}): Promise<{ docPath: string }> {
    const docsDir = await resolveDocumentsDir(workspace.path, sessionId, {
        workspaceId: workspace.id,
        sessionWorkspaces,
    });
    await ensureDir(docsDir);
    const stamp = nowStampForFilename();
    const safeName = (filename || "artifact").trim().replace(/[\\/]+/g, "-");
    const relPath = `artifacts/${moduleId}/${stamp}-${safeName}`;
    const absPath = resolveDocumentPathSafe(docsDir, relPath);
    await ensureDir(dirname(absPath));
    const tmp = `${absPath}.tmp-${shortId()}`;
    await copyFile(absSourcePath, tmp);
    await rename(tmp, absPath);
    return { docPath: relPath };
}

function resolveDocumentPathSafe(docsDir: string, relPath: string): string {
    const root = resolve(docsDir);
    const trimmed = relPath.trim();
    const resolvedPath = resolve(root, trimmed);
    const rel = relative(root, resolvedPath);
    // Prevent path traversal and absolute paths.
    const segments = rel.split(/[\\/]+/).filter(Boolean);
    if (!segments.length || segments.includes("..") || isAbsolute(rel)) {
        throw new ApiError(400, "invalid_request", "Invalid document path");
    }
    return resolvedPath;
}

function normalizeDocumentPath(value: string): string {
    const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    const parts = normalized
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => Boolean(segment) && segment !== "." && segment !== "..");
    return parts.join("/");
}

function sanitizeUploadedDocumentSegment(value: string, fallback: string): string {
    const cleaned = value
        .normalize("NFKC")
        .trim()
        .replace(/[\\/]+/g, "-")
        .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
        .replace(/-+/g, "-")
        .replace(/^-+|-+$/g, "");
    return cleaned || fallback;
}

function sanitizeUploadedDocumentLeafName(filename: string): string {
    const ext = extname(filename).toLowerCase();
    const stem = basename(filename, ext);
    const safeStem = sanitizeUploadedDocumentSegment(stem, "file");
    return `${safeStem}${ext}`;
}

function sanitizeUploadedDocumentRelativePath(relativePath: string, fallbackFilename: string): string {
    const normalized = normalizeDocumentPath(relativePath);
    const segments = normalized.split("/").filter(Boolean);
    if (!segments.length) return sanitizeUploadedDocumentLeafName(fallbackFilename);
    return segments
        .map((segment, index) => {
            if (index === segments.length - 1) {
                return sanitizeUploadedDocumentLeafName(segment);
            }
            return sanitizeUploadedDocumentSegment(segment, "folder");
        })
        .join("/");
}

async function ensureUniqueUploadedDocumentPath(docsDir: string, relPath: string): Promise<string> {
    let candidate = normalizeDocumentPath(relPath);
    if (!candidate) {
        throw new ApiError(400, "invalid_request", "Document path is required");
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
        const absPath = resolveDocumentPathSafe(docsDir, candidate);
        if (!(await exists(absPath))) return candidate;
        const ext = extname(candidate);
        const stem = basename(candidate, ext);
        const dir = dirname(candidate);
        const suffix = shortId().replace(/-/g, "").slice(0, 8);
        const uniqueName = `${stem}-${suffix}${ext}`;
        candidate = dir && dir !== "." ? `${dir}/${uniqueName}` : uniqueName;
    }
    throw new ApiError(409, "document_conflict", "Unable to generate a unique document name");
}

const ALLOWED_HIDDEN_FILE_NAMES = new Set([
    ".env",
    ".gitignore",
    ".dockerignore",
    ".editorconfig",
    ".npmrc",
    ".gitconfig",
    ".bashrc",
    ".zshrc",
]);

const RESERVED_DOCUMENT_ROOT_FILES = new Set(["opencode.json", "opencode.jsonc"]);

function isAllowedHiddenLeafName(name: string): boolean {
    const lower = name.trim().toLowerCase();
    if (!lower.startsWith(".")) return false;
    if (ALLOWED_HIDDEN_FILE_NAMES.has(lower)) return true;
    if (lower.startsWith(".env.")) return true;
    return false;
}

function shouldHideDocumentEntry(entryName: string, isDirectory: boolean): boolean {
    if (!entryName.startsWith(".")) return false;
    if (isDirectory) return true;
    return !isAllowedHiddenLeafName(entryName);
}

function shouldHideListedDocumentPath(relPath: string): boolean {
    const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalized) return false;
    const leaf = basename(normalized).trim().toLowerCase();
    if (leaf.startsWith(".")) return true;
    return RESERVED_DOCUMENT_ROOT_FILES.has(normalized);
}

function validateDocumentMutationPath(relPath: string, options?: { allowHiddenLeafFile?: boolean }): void {
    const segments = relPath.split("/").filter(Boolean);
    if (!segments.length) {
        throw new ApiError(400, "invalid_request", "Document path is required");
    }
    const allowHiddenLeafFile = Boolean(options?.allowHiddenLeafFile);
    const hasDisallowedHiddenSegment = segments.some((segment, index) => {
        if (!segment.startsWith(".")) return false;
        const isLeaf = index === segments.length - 1;
        if (allowHiddenLeafFile && isLeaf && isAllowedHiddenLeafName(segment)) {
            return false;
        }
        return true;
    });
    if (hasDisallowedHiddenSegment) {
        throw new ApiError(400, "invalid_request", "Hidden paths are not allowed");
    }
}

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

const LOCAL_ONLYOFFICE_DOCUMENT_SERVER_URL = "http://localhost:8080";
const LOCAL_ONLYOFFICE_DOCKER_HOSTNAME = "host.docker.internal";

const DEFAULT_POD_NODE_IP = "192.168.5.10";
const DEFAULT_POD_ONLYOFFICE_PUBLIC_PORT = 32764;
const DEFAULT_POD_OPENWORK_PUBLIC_PORT = 32765;
const DEFAULT_POD_ONLYOFFICE_INTERNAL_URL = "http://onlyoffice:80";
const DEFAULT_POD_OPENWORK_PUBLIC_PATH = "/openwork";

function normalizeOriginUrl(raw: string | null | undefined): string | null {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        return new URL(withProtocol).origin;
    } catch {
        return trimmed.replace(/\/+$/, "");
    }
}

function normalizeHostname(raw: string | null | undefined): string {
    const value = (raw ?? "").trim().toLowerCase();
    if (!value) return "";
    if (value.startsWith("[")) {
        const end = value.indexOf("]");
        if (end > 1) return value.slice(1, end);
    }
    const firstColon = value.indexOf(":");
    const lastColon = value.lastIndexOf(":");
    if (firstColon > -1 && firstColon === lastColon) {
        return value.slice(0, firstColon);
    }
    return value.replace(/^\[|\]$/g, "");
}

function isLoopbackHostname(raw: string | null | undefined): boolean {
    const hostname = normalizeHostname(raw);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isLoopbackOrigin(raw: string | null | undefined): boolean {
    const normalized = normalizeOriginUrl(raw);
    if (!normalized) return false;
    try {
        return isLoopbackHostname(new URL(normalized).hostname);
    } catch {
        return false;
    }
}

function normalizeBaseUrl(raw: string | null | undefined): string | null {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return null;
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    try {
        const url = new URL(withProtocol);
        url.search = "";
        url.hash = "";
        url.pathname = url.pathname.replace(/\/+$/, "");
        return url.toString().replace(/\/+$/, "");
    } catch {
        return withProtocol.replace(/\/+$/, "");
    }
}

function resolveOnlyOfficeNetworkMode(): "local" | "pod" {
    const raw = (
        process.env.OPENWORK_DOC_NETWORK_MODE ??
        process.env.OPENWORK_NETWORK_MODE ??
        process.env.OPENWORK_MODE ??
        ""
    )
        .trim()
        .toLowerCase();
    return raw === "pod" ? "pod" : "local";
}

function resolvePodNodeIp(): string {
    const explicit = (process.env.OPENWORK_POD_IP ?? "").trim();
    if (explicit) return explicit;

    const candidates = [
        normalizeOriginUrl(process.env.OPENWORK_ONLYOFFICE_URL),
        normalizeBaseUrl(process.env.OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL),
        normalizeBaseUrl(process.env.OPENWORK_BASE_URL),
    ].filter(Boolean) as string[];

    for (const candidate of candidates) {
        try {
            return new URL(candidate).hostname;
        } catch {
            // ignore
        }
    }

    return DEFAULT_POD_NODE_IP;
}

function resolveOnlyOfficeDocumentServerUrl(): string {
    const networkMode = resolveOnlyOfficeNetworkMode();
    const explicit = normalizeOriginUrl(process.env.OPENWORK_ONLYOFFICE_URL ?? process.env.ONLYOFFICE_URL);
    if (explicit) {
        if (networkMode !== "pod" || !isLoopbackOrigin(explicit)) {
            return explicit;
        }
    }

    if (networkMode !== "pod") return LOCAL_ONLYOFFICE_DOCUMENT_SERVER_URL;

    // In pod mode we never expose loopback-only document server URLs.
    const host = resolvePodNodeIp();
    return `http://${host}:${DEFAULT_POD_ONLYOFFICE_PUBLIC_PORT}`;
}

function resolveOnlyOfficeDocumentServerInternalUrl(): string {
    const explicit = normalizeOriginUrl(process.env.OPENWORK_ONLYOFFICE_INTERNAL_URL ?? process.env.ONLYOFFICE_INTERNAL_URL);
    if (explicit) return explicit;
    if (resolveOnlyOfficeNetworkMode() !== "pod") return LOCAL_ONLYOFFICE_DOCUMENT_SERVER_URL;
    return DEFAULT_POD_ONLYOFFICE_INTERNAL_URL;
}

function getOnlyOfficeJwtSecret(): string {
    return (process.env.ONLYOFFICE_JWT_SECRET ?? "").trim();
}

function resolveOnlyOfficeOpenworkPublicBaseUrl(request: Request): string {
    const explicit =
        normalizeBaseUrl(process.env.ONLYOFFICE_CALLBACK_URL) ??
        normalizeBaseUrl(process.env.OPENWORK_ONLYOFFICE_CALLBACK_URL) ??
        normalizeBaseUrl(process.env.OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL) ??
        normalizeBaseUrl(process.env.OPENWORK_BASE_URL);
    if (explicit) return explicit;

    const networkMode = resolveOnlyOfficeNetworkMode();
    if (networkMode === "pod") {
        const host = resolvePodNodeIp();
        return `http://${host}:${DEFAULT_POD_OPENWORK_PUBLIC_PORT}${DEFAULT_POD_OPENWORK_PUBLIC_PATH}`;
    }

    let origin: string | null = null;
    try {
        origin = new URL(request.url).origin;
    } catch {
        origin = null;
    }

    const normalizedOrigin = normalizeBaseUrl(origin) ?? origin;
    if (!normalizedOrigin) return `http://${LOCAL_ONLYOFFICE_DOCKER_HOSTNAME}`;

    try {
        const url = new URL(normalizedOrigin);
        if (url.hostname === "0.0.0.0" || isLoopbackHostname(url.hostname)) {
            url.hostname = LOCAL_ONLYOFFICE_DOCKER_HOSTNAME;
        }
        return url.toString().replace(/\/+$/, "");
    } catch {
        return normalizedOrigin;
    }
}

function buildDocumentQuery(docId: string, sessionId?: string | null): string {
    const query = new URLSearchParams();
    query.set("docId", docId);
    if (sessionId) query.set("session", sessionId);
    return query.toString();
}

function resolveOnlyOfficeLang(request: Request): string {
    const raw = (request.headers.get("accept-language") ?? "").toLowerCase();
    if (raw.includes("zh")) return "zh";
    if (raw.includes("en")) return "en";
    return "en";
}

function getCallbackUrl(request: Request, workspaceId: string, docId: string, sessionId?: string | null): string {
    const baseUrl = resolveOnlyOfficeOpenworkPublicBaseUrl(request);
    return `${baseUrl}/w/${workspaceId}/document/callback?${buildDocumentQuery(docId, sessionId)}`;
}

function getDownloadUrl(request: Request, workspaceId: string, docId: string, sessionId?: string | null): string {
    const baseUrl = resolveOnlyOfficeOpenworkPublicBaseUrl(request);
    return `${baseUrl}/w/${workspaceId}/document/file?${buildDocumentQuery(docId, sessionId)}`;
}

function buildOnlyOfficeDownloadCandidates(rawUrl: string): string[] {
    const candidates: string[] = [];
    const push = (value: string | null | undefined) => {
        const normalized = typeof value === "string" ? value.trim() : "";
        if (!normalized) return;
        if (!candidates.includes(normalized)) candidates.push(normalized);
    };

    push(rawUrl);

    let parsed: URL;
    try {
        parsed = new URL(rawUrl);
    } catch {
        return candidates;
    }

    const replaceOrigin = (baseUrl: string | null | undefined) => {
        if (!baseUrl) return;
        try {
            const base = new URL(baseUrl);
            const next = new URL(rawUrl);
            next.protocol = base.protocol;
            next.host = base.host;
            push(next.toString());
        } catch {
            // Ignore invalid fallback URL
        }
    };

    const host = parsed.hostname.toLowerCase();
    const isLoopbackHost = host === "localhost" || host === "127.0.0.1" || host === "::1";
    const internalBaseUrl = resolveOnlyOfficeDocumentServerInternalUrl();
    const publicBaseUrl = resolveOnlyOfficeDocumentServerUrl();

    if (isLoopbackHost) {
        replaceOrigin(internalBaseUrl);
        replaceOrigin(publicBaseUrl);
    }

    replaceOrigin(internalBaseUrl);

    return candidates;
}

export function createDocumentRoutes(routes: unknown[], sessionWorkspaces?: SessionWorkspaceService) {
    const docsDirFor = (workspace: WorkspaceInfo, sessionId?: string | null) =>
        resolveDocumentsDir(workspace.path, sessionId, {
            workspaceId: workspace.id,
            sessionWorkspaces,
        });

    // List documents
    routes.push({
        method: "GET",
        regex: /^\/w\/([^/]+)\/documents$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);
            const manifest = await readJsonRecord(join(docsDir, BOOTSTRAP_SOURCE_MANIFEST_PATH));
            const manifestSources = Array.isArray(manifest?.sources) ? manifest.sources as Array<Record<string, any>> : [];
            const metadataByPath = new Map<string, Record<string, any>>();
            for (const source of manifestSources) {
                const relativePath = typeof source?.relativePath === "string" ? source.relativePath.trim() : "";
                if (!relativePath) continue;
                metadataByPath.set(relativePath, source);
            }

            const docs: Array<{ name: string; updatedAt: number; size: number; type: string; originalName?: string; title?: string }> = [];
            const dirs = new Set<string>();

            const walk = async (dir: string) => {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (shouldHideDocumentEntry(entry.name, entry.isDirectory())) continue;
                    const fullPath = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        const relDir = relative(docsDir, fullPath).replace(/\\/g, "/");
                        if (relDir) dirs.add(relDir);
                        await walk(fullPath);
                        continue;
                    }
                    if (!entry.isFile()) continue;

                    const info = await stat(fullPath);
                    const relName = relative(docsDir, fullPath).replace(/\\/g, "/");
                    if (shouldHideListedDocumentPath(relName)) continue;
                    const sourceMetadata = metadataByPath.get(relName);
                    docs.push({
                        name: relName,
                        updatedAt: info.mtimeMs,
                        size: info.size,
                        type: getDocumentType(entry.name),
                        originalName: typeof sourceMetadata?.originalName === "string" && sourceMetadata.originalName.trim()
                            ? sourceMetadata.originalName.trim()
                            : undefined,
                        title: typeof sourceMetadata?.title === "string" && sourceMetadata.title.trim()
                            ? sourceMetadata.title.trim()
                            : undefined,
                    });
                }
            };

            await walk(docsDir);
            docs.sort((a, b) => b.updatedAt - a.updatedAt);
            return jsonResponse({ items: docs, dirs: Array.from(dirs).sort((a, b) => a.localeCompare(b)) });
        },
    });

    // Archive documents (move into a hidden `.archive/` folder under the session docs dir)
    //
    // This is a safety feature for Document Writer sessions to avoid clutter from
    // many generated drafts. We move files instead of deleting them.
    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/archive$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const payload = (await ctx.request.json().catch(() => null)) as any;
            if (!payload || typeof payload !== "object") {
                throw new ApiError(400, "invalid_payload", "Expected JSON body");
            }

            const keep = typeof payload.keep === "string" ? payload.keep.trim().replace(/^\/+/, "") : "";
            const includeRefs = Boolean(payload.includeRefs);
            if (!keep) throw new ApiError(400, "invalid_request", "keep is required");

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const keepAbs = resolveDocumentPathSafe(docsDir, keep);
            if (!(await exists(keepAbs))) throw new ApiError(404, "not_found", "Keep document not found");

            const archiveId = new Date().toISOString().replace(/[:.]/g, "-");
            const archiveRoot = join(docsDir, ".archive", archiveId);
            await ensureDir(archiveRoot);

            const archived: string[] = [];

            const walk = async (dir: string) => {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (shouldHideDocumentEntry(entry.name, entry.isDirectory())) continue;
                    const fullPath = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                        continue;
                    }
                    if (!entry.isFile()) continue;

                    const relName = relative(docsDir, fullPath).replace(/\\/g, "/");
                    if (relName === keep) continue;
                    if (!includeRefs && relName.startsWith("refs/")) continue;

                    const srcAbs = resolveDocumentPathSafe(docsDir, relName);
                    const destAbs = resolve(join(archiveRoot, relName));
                    await ensureDir(dirname(destAbs));
                    await rename(srcAbs, destAbs);
                    archived.push(relName);
                }
            };

            await walk(docsDir);
            return jsonResponse({ ok: true, archiveDir: `.archive/${archiveId}`, archived });
        },
    });

    // Import a file from the workspace inbox into documents (so it can be opened in OnlyOffice)
    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/import$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const inboxId = ctx.url.searchParams.get("inboxId");
            if (!inboxId) throw new ApiError(400, "invalid_request", "inboxId is required");
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const mode = (ctx.url.searchParams.get("mode") ?? "").trim().toLowerCase() || "reuse";
            if (!["reuse", "copy", "overwrite"].includes(mode)) {
                throw new ApiError(400, "invalid_request", "Invalid import mode");
            }

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const inboxRoot = resolveInboxDir(workspace.path);
            const decoded = decodeInboxId(inboxId);
            const inboxAbs = resolveDocumentPathSafe(inboxRoot, decoded);
            if (!(await exists(inboxAbs))) throw new ApiError(404, "not_found", "Inbox file not found");

            const inboxInfo = await stat(inboxAbs);
            if (!inboxInfo.isFile()) throw new ApiError(404, "not_found", "Inbox file not found");

            const inboxRel = relative(resolve(inboxRoot), inboxAbs).replace(/\\/g, "/");
            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const destOverride = (ctx.url.searchParams.get("dest") ?? "").trim();
            const deriveDestRel = () => {
                if (destOverride) return destOverride;
                if (sessionId) {
                    const prefix = `sessions/${sessionId}/`;
                    if (inboxRel.startsWith(prefix)) return inboxRel.slice(prefix.length);
                }
                return basename(inboxRel);
            };

            const initialDestRel = deriveDestRel().replace(/^\/+/, "");
            let destRel = initialDestRel;
            validateDocumentMutationPath(destRel, { allowHiddenLeafFile: true });
            let destAbs = resolveDocumentPathSafe(docsDir, destRel);
            if (await exists(destAbs)) {
                const destInfo = await stat(destAbs).catch(() => null);
                if (destInfo && !destInfo.isFile()) {
                    throw new ApiError(409, "conflict", "Document path is occupied");
                }
                if (mode === "reuse") {
                    return jsonResponse({ ok: true, doc: destRel, reused: true });
                }
                if (mode === "copy") {
                    const ext = extname(destRel).toLowerCase();
                    const dirRel = dirname(destRel).replace(/\\/g, "/");
                    const base = basename(destRel, ext);
                    const unique = `${base}-${shortId()}${ext}`;
                    destRel = dirRel && dirRel !== "." ? `${dirRel}/${unique}` : unique;
                    validateDocumentMutationPath(destRel, { allowHiddenLeafFile: true });
                    destAbs = resolveDocumentPathSafe(docsDir, destRel);
                }
            }

            await ensureDir(dirname(destAbs));
            await copyFile(inboxAbs, destAbs);

            return jsonResponse({ ok: true, doc: destRel });
        },
    });

    // Get OnlyOffice Config
    routes.push({
        method: "GET",
        regex: /^\/w\/([^/]+)\/document\/config$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const docName = ctx.url.searchParams.get("doc");
            if (!docName) throw new ApiError(400, "invalid_request", "Document name is required");
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const readonlyParam = (ctx.url.searchParams.get("readonly") ?? "").trim().toLowerCase();
            const readOnly = readonlyParam === "1" || readonlyParam === "true" || readonlyParam === "yes";

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = await docsDirFor(workspace, sessionId);
            const filePath = resolveDocumentPathSafe(docsDir, docName);

            if (!(await exists(filePath))) {
                // Create if not exists ? For now, throw error
                throw new ApiError(404, "not_found", "Document not found");
            }

            const stats = await stat(filePath);
            const key = createHash("sha256").update(`${sessionId ?? "workspace"}:${docName}:${stats.mtimeMs}`).digest("hex");

            const canEdit = !readOnly;
            const config: OnlyOfficeConfig = {
                document: {
                    fileType: extname(docName).slice(1).toLowerCase(),
                    key: key,
                    title: docName,
                    url: getDownloadUrl(ctx.request, workspaceId, docName, sessionId),
                    permissions: {
                        download: true,
                        edit: canEdit,
                        print: true,
                        review: canEdit,
                    },
                },
                documentType: getDocumentType(docName),
                editorConfig: {
                    callbackUrl: getCallbackUrl(ctx.request, workspaceId, docName, sessionId),
                    user: {
                        id: ctx.actor?.clientId || "anonymous",
                        name: "AI User", // TODO: Get actual user name
                    },
                    mode: canEdit ? "edit" : "view",
                    lang: resolveOnlyOfficeLang(ctx.request),
                    customization: {
                        autosave: canEdit,
                        forcesave: canEdit,
                        // Red proofing underlines are noisy for mixed-language bid docs.
                        spellcheck: false,
                        features: {
                            spellcheck: false,
                        },
                    },
                },
            };

            const jwtSecret = getOnlyOfficeJwtSecret();
            if (jwtSecret) {
                const token = jwt.sign(config, jwtSecret, { expiresIn: "5m" });
                config.token = token;
            }

            return jsonResponse({ documentServerUrl: resolveOnlyOfficeDocumentServerUrl(), config });
        },
    });

    // Serve File content
    routes.push({
        method: "GET",
        regex: /^\/w\/([^/]+)\/document\/file$/,
        keys: ["id"],
        auth: "none", // OnlyOffice needs to access this without auth headers usually, or via token query param
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const docName = ctx.url.searchParams.get("docId");
            if (!docName) throw new ApiError(400, "invalid_request", "Document ID is required");
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));

            // Validate workspace exists in config (even though we don't auth, we need path)
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = await docsDirFor(workspace, sessionId);
            const filePath = resolveDocumentPathSafe(docsDir, docName);

            if (!(await exists(filePath))) throw new ApiError(404, "not_found", "File not found");

            const buffer = await readFile(filePath);
            const ext = extname(filePath).toLowerCase();
            const mimeTypes: Record<string, string> = {
                ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                ".doc": "application/msword",
                ".xls": "application/vnd.ms-excel",
                ".ppt": "application/vnd.ms-powerpoint",
                ".csv": "text/csv",
                ".txt": "text/plain",
                ".rtf": "application/rtf",
                ".pdf": "application/pdf",
                ".odt": "application/vnd.oasis.opendocument.text",
                ".ods": "application/vnd.oasis.opendocument.spreadsheet",
                ".odp": "application/vnd.oasis.opendocument.presentation",
            };
            const filename = basename(filePath);
            return new Response(buffer, {
                headers: {
                    "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
                    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
                },
            });
        },
    });

    // Handle Callback
    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/callback$/,
        keys: ["id"],
        auth: "none",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const docName = ctx.url.searchParams.get("docId");
            if (!docName) return jsonResponse({ error: 0 }); // OnlyOffice expects { error: 0 }
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) return jsonResponse({ error: 1 });

            const body = await ctx.request.json() as OnlyOfficeCallback;

            // value 2 = ready for saving, 6 = force save
            if (body.status === 2 || body.status === 6) {
                console.log("[onlyoffice] Callback received", { document: docName, status: body.status });
                if (body.url) {
                    const docsDir = await docsDirFor(workspace, sessionId);
                    await ensureDir(docsDir);
                    const filePath = resolveDocumentPathSafe(docsDir, docName);
                    const candidateUrls = buildOnlyOfficeDownloadCandidates(body.url);
                    let lastError: unknown = null;

                    try {
                        let saved = false;
                        for (const candidateUrl of candidateUrls) {
                            try {
                                const resp = await fetch(candidateUrl);
                                if (!resp.ok) {
                                    throw new Error(`Failed to download (HTTP ${resp.status})`);
                                }
                                const buffer = await resp.arrayBuffer();
                                await writeFile(filePath, Buffer.from(buffer));
                                saved = true;
                                break;
                            } catch (error) {
                                lastError = error;
                            }
                        }
                        if (!saved) {
                            throw lastError ?? new Error("Failed to download OnlyOffice callback file");
                        }
                    } catch (error) {
                        console.error("Failed to save document:", error);
                        return jsonResponse({ error: 1 });
                    }
                }
            }

            return jsonResponse({ error: 0 });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/folder\/download$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const payload = (await ctx.request.json().catch(() => null)) as any;
            const requestedPath = typeof payload?.path === "string" ? payload.path : "";
            const dirPath = normalizeDocumentPath(requestedPath);
            if (!dirPath) throw new ApiError(400, "invalid_request", "Folder path is required");
            validateDocumentMutationPath(dirPath);

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const absPath = resolveDocumentPathSafe(docsDir, dirPath);
            if (!(await exists(absPath))) throw new ApiError(404, "not_found", "Folder not found");
            const info = await stat(absPath);
            if (!info.isDirectory()) throw new ApiError(400, "invalid_request", "Path is not a folder");

            const archiveBase = await mkdtemp(join(tmpdir(), "openwork-doc-folder-"));
            try {
                const folderName = basename(absPath) || "folder";
                const zipPath = join(archiveBase, `${folderName}.zip`);
                const parentDir = dirname(absPath);
                const zipResult = spawnSync("zip", ["-r", "-q", zipPath, folderName], {
                    cwd: parentDir,
                    encoding: "utf8",
                });

                if (zipResult.status !== 0 || !(await exists(zipPath))) {
                    const stderr = typeof zipResult.stderr === "string" ? zipResult.stderr.trim() : "";
                    const stdout = typeof zipResult.stdout === "string" ? zipResult.stdout.trim() : "";
                    const message = stderr || stdout || "Failed to create folder archive";
                    throw new ApiError(400, "folder_zip_failed", message);
                }

                const filename = `${folderName}.zip`;
                const data = await readFile(zipPath);
                return new Response(data, {
                    headers: {
                        "Content-Type": "application/zip",
                        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
                    },
                });
            } finally {
                await rm(archiveBase, { recursive: true, force: true }).catch(() => undefined);
            }
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/mkdir$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const payload = (await ctx.request.json().catch(() => null)) as any;
            const requestedPath = typeof payload?.path === "string" ? payload.path : "";
            const dirPath = normalizeDocumentPath(requestedPath);
            if (!dirPath) throw new ApiError(400, "invalid_request", "Folder path is required");
            validateDocumentMutationPath(dirPath);

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const absPath = resolveDocumentPathSafe(docsDir, dirPath);
            await ensureDir(absPath);
            const info = await stat(absPath);
            if (!info.isDirectory()) {
                throw new ApiError(400, "invalid_request", "Target path is not a folder");
            }

            return jsonResponse({ ok: true, path: dirPath });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/move$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const payload = (await ctx.request.json().catch(() => null)) as any;
            const fromRequested = typeof payload?.from === "string" ? payload.from : "";
            const toRequested = typeof payload?.to === "string" ? payload.to : "";
            const fromPath = normalizeDocumentPath(fromRequested);
            const toPath = normalizeDocumentPath(toRequested);
            if (!fromPath) throw new ApiError(400, "invalid_request", "Source path is required");
            if (!toPath) throw new ApiError(400, "invalid_request", "Target path is required");
            if (fromPath === toPath) throw new ApiError(400, "invalid_request", "Source and target paths are the same");

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const fromAbs = resolveDocumentPathSafe(docsDir, fromPath);
            if (!(await exists(fromAbs))) throw new ApiError(404, "not_found", "Source path not found");
            const fromInfo = await stat(fromAbs);
            if (!fromInfo.isFile() && !fromInfo.isDirectory()) {
                throw new ApiError(400, "invalid_request", "Source path must be a file or folder");
            }
            const isDirectory = fromInfo.isDirectory();

            if (isDirectory) {
                validateDocumentMutationPath(fromPath);
                validateDocumentMutationPath(toPath);
                if (toPath === fromPath || toPath.startsWith(`${fromPath}/`)) {
                    throw new ApiError(400, "invalid_request", "Cannot move a folder into itself");
                }
            } else {
                validateDocumentMutationPath(fromPath, { allowHiddenLeafFile: true });
                validateDocumentMutationPath(toPath, { allowHiddenLeafFile: true });
            }

            const toAbs = resolveDocumentPathSafe(docsDir, toPath);
            if (await exists(toAbs)) {
                throw new ApiError(409, "conflict", "Target path already exists");
            }

            await ensureDir(dirname(toAbs));
            await rename(fromAbs, toAbs);

            return jsonResponse({ ok: true, from: fromPath, to: toPath, isDirectory });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/delete$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const payload = (await ctx.request.json().catch(() => null)) as any;
            const requestedPath = typeof payload?.path === "string" ? payload.path : "";
            const relPath = normalizeDocumentPath(requestedPath);
            if (!relPath) throw new ApiError(400, "invalid_request", "File path is required");
            validateDocumentMutationPath(relPath, { allowHiddenLeafFile: true });

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const absPath = resolveDocumentPathSafe(docsDir, relPath);
            if (!(await exists(absPath))) throw new ApiError(404, "not_found", "File not found");
            const info = await stat(absPath);
            if (!info.isFile()) throw new ApiError(400, "invalid_request", "Path is not a file");
            await rm(absPath, { force: true });

            return jsonResponse({ ok: true, path: relPath });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/rmdir$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const payload = (await ctx.request.json().catch(() => null)) as any;
            const requestedPath = typeof payload?.path === "string" ? payload.path : "";
            const dirPath = normalizeDocumentPath(requestedPath);
            if (!dirPath) throw new ApiError(400, "invalid_request", "Folder path is required");
            validateDocumentMutationPath(dirPath);

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const absPath = resolveDocumentPathSafe(docsDir, dirPath);
            if (!(await exists(absPath))) throw new ApiError(404, "not_found", "Folder not found");
            const info = await stat(absPath);
            if (!info.isDirectory()) throw new ApiError(400, "invalid_request", "Path is not a folder");

            await rm(absPath, { recursive: true, force: true });
            return jsonResponse({ ok: true, path: dirPath });
        },
    });

    // Upload Document
    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/upload$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const formData = await ctx.request.formData();
            const file = formData.get("file");

            if (!file || !(file instanceof File)) {
                throw new ApiError(400, "invalid_request", "File is required");
            }

            const docsDir = await docsDirFor(workspace, sessionId);
            await ensureDir(docsDir);

            const legacyPath = typeof formData.get("path") === "string" ? String(formData.get("path")) : "";
            const requestedBaseDir = typeof formData.get("baseDir") === "string" ? normalizeDocumentPath(String(formData.get("baseDir"))) : "";
            const requestedRelativePath = typeof formData.get("relativePath") === "string"
                ? normalizeDocumentPath(String(formData.get("relativePath")))
                : "";

            let destRel = "";
            if (sessionId) {
                destRel = await reserveSessionSourceUploadPath(docsDir, requestedRelativePath || file.name);
            } else if (requestedBaseDir || requestedRelativePath) {
                const safeRelativePath = sanitizeUploadedDocumentRelativePath(requestedRelativePath || file.name, file.name);
                destRel = requestedBaseDir ? `${requestedBaseDir}/${safeRelativePath}` : safeRelativePath;
            } else {
                const name = sanitizeUploadedDocumentLeafName(file.name);
                let requestedPath = normalizeDocumentPath(legacyPath);
                if (!requestedPath) {
                    requestedPath = name;
                } else {
                    const tail = requestedPath.split("/").pop() ?? "";
                    if (!tail || !extname(tail)) {
                        requestedPath = `${requestedPath}/${name}`;
                    }
                }
                destRel = sanitizeUploadedDocumentRelativePath(requestedPath, name);
            }

            validateDocumentMutationPath(destRel, { allowHiddenLeafFile: true });
            destRel = await ensureUniqueUploadedDocumentPath(docsDir, destRel);

            const filePath = resolveDocumentPathSafe(docsDir, destRel);
            await persistUploadedDocumentFile(filePath, file);
            if (sessionId) {
                const originalRelativePath = normalizeDocumentPath(requestedRelativePath || legacyPath || file.name) || file.name;
                await seedBootstrapSourceMetadata(docsDir, {
                    relativePath: destRel,
                    originalName: file.name,
                    originalRelativePath,
                    title: normalizeBootstrapTitle(originalRelativePath || file.name),
                    kind: extname(file.name).toLowerCase().replace(/^\./, "") || "file",
                });
                await refreshBootstrapDocumentState(docsDir);
            }

            return jsonResponse({ ok: true, name: destRel });
        },
    });
}
