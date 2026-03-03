import { copyFile, readFile, writeFile, readdir, stat, rm, rename, mkdtemp } from "node:fs/promises";
import { dirname, join, resolve, relative, basename, extname, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import jwt from "jsonwebtoken";
import type { ServerConfig, WorkspaceInfo, Actor } from "./types.js";
import { ApiError } from "./errors.js";
import { ensureDir, exists, shortId } from "./utils.js";

const DEFAULT_BID_FORMS_HEADINGS = [
    "开标一览表",
    "开标分项一览表",
    "投标产品点对点应答表",
    "投标产品配置清单",
    "售后服务承诺",
] as const;

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

type DocHeading = {
    level: number;
    text: string;
    elementCount: number;
};

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

function resolveDocumentsDir(workspacePath: string, sessionId?: string | null): string {
    const root = join(workspacePath, "documents");
    if (!sessionId) return root;
    return join(root, "sessions", sessionId);
}

function resolveInboxDir(workspacePath: string): string {
    return join(workspacePath, ".opencode", "openwork", "inbox");
}

function resolveDocxConversionCacheDir(workspacePath: string): string {
    return join(workspacePath, ".opencode", "openwork", "cache", "docx-convert");
}

function resolveDocxSectionCopyScriptPath(workspacePath: string): string {
    return join(workspacePath, ".opencode", "skills", "bid-drafting", "scripts", "copy_docx_section.py");
}

function resolveBidFillTablesScriptPath(workspacePath: string): string {
    return join(workspacePath, ".opencode", "skills", "bid-drafting", "scripts", "fill_bid_tables_mvp.py");
}

function resolveBidTenderFactsScriptPath(workspacePath: string): string {
    return join(workspacePath, ".opencode", "skills", "bid-drafting", "scripts", "tender_facts_mvp.py");
}

function resolveBidQcScriptPath(workspacePath: string): string {
    return join(workspacePath, ".opencode", "skills", "bid-drafting", "scripts", "qc_bid_mvp.py");
}

function resolveBidDedupeScriptPath(workspacePath: string): string {
    return join(workspacePath, ".opencode", "skills", "bid-dedupe", "scripts", "compare_bids.py");
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

function nowStampForFilename(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeSessionReport({
    workspace,
    sessionId,
    moduleId,
    content,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    moduleId: string;
    content: string;
}): Promise<{ inboxId: string; inboxPath: string }> {
    const inboxRoot = resolveInboxDir(workspace.path);
    const stamp = nowStampForFilename();
    const relPath = `sessions/${sessionId}/reports/${moduleId}/${stamp}.md`;
    const absPath = resolveDocumentPathSafe(inboxRoot, relPath);
    await ensureDir(dirname(absPath));
    const tmp = `${absPath}.tmp-${shortId()}`;
    await writeFile(tmp, content, "utf8");
    await rename(tmp, absPath);
    return { inboxId: encodeInboxId(relPath), inboxPath: relPath };
}

async function writeSessionArtifactFromFile({
    workspace,
    sessionId,
    moduleId,
    filename,
    absSourcePath,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    moduleId: string;
    filename: string;
    absSourcePath: string;
}): Promise<{ inboxId: string; inboxPath: string }> {
    const inboxRoot = resolveInboxDir(workspace.path);
    const stamp = nowStampForFilename();
    const safeName = (filename || "artifact").trim().replace(/[\\/]+/g, "-");
    const relPath = `sessions/${sessionId}/reports/${moduleId}/${stamp}-${safeName}`;
    const absPath = resolveDocumentPathSafe(inboxRoot, relPath);
    await ensureDir(dirname(absPath));
    const tmp = `${absPath}.tmp-${shortId()}`;
    await copyFile(absSourcePath, tmp);
    await rename(tmp, absPath);
    return { inboxId: encodeInboxId(relPath), inboxPath: relPath };
}

async function writeSessionVisibleArtifactFromFile({
    workspace,
    sessionId,
    moduleId,
    filename,
    absSourcePath,
}: {
    workspace: WorkspaceInfo;
    sessionId: string;
    moduleId: string;
    filename: string;
    absSourcePath: string;
}): Promise<{ docPath: string }> {
    const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

const LOCAL_ONLYOFFICE_URL = "http://localhost:8080";
const POD_IP = process.env.OPENWORK_POD_IP ?? "192.168.5.250";
const POD_ONLYOFFICE_URL = process.env.OPENWORK_ONLYOFFICE_URL?.trim() || `http://${POD_IP}:30080`;
const POD_ONLYOFFICE_INTERNAL_URL = process.env.OPENWORK_ONLYOFFICE_INTERNAL_URL?.trim() || "http://onlyoffice:80";
const LOCAL_ONLYOFFICE_PUBLIC_BASE_URL = "http://host.docker.internal:8789";
const POD_ONLYOFFICE_PUBLIC_BASE_URL =
    process.env.OPENWORK_ONLYOFFICE_PUBLIC_BASE_URL?.trim() ||
    process.env.OPENWORK_BASE_URL?.trim() ||
    `http://${POD_IP}:30789`;

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

function getOnlyOfficeUrl(_request?: Request): string {
    return resolveOnlyOfficeNetworkMode() === "pod" ? POD_ONLYOFFICE_URL : LOCAL_ONLYOFFICE_URL;
}

function getOnlyOfficeInternalUrl(): string {
    return resolveOnlyOfficeNetworkMode() === "pod" ? POD_ONLYOFFICE_INTERNAL_URL : LOCAL_ONLYOFFICE_URL;
}

function getOnlyOfficeJwtSecret(): string {
    return (process.env.ONLYOFFICE_JWT_SECRET ?? "").trim();
}

function resolveOnlyOfficePublicBaseUrl(_host: string, _port: number): string {
    return resolveOnlyOfficeNetworkMode() === "pod" ? POD_ONLYOFFICE_PUBLIC_BASE_URL : LOCAL_ONLYOFFICE_PUBLIC_BASE_URL;
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

function getCallbackUrl(host: string, port: number, workspaceId: string, docId: string, sessionId?: string | null): string {
    const baseUrl = resolveOnlyOfficePublicBaseUrl(host, port);
    return `${baseUrl}/w/${workspaceId}/document/callback?${buildDocumentQuery(docId, sessionId)}`;
}

function getDownloadUrl(host: string, port: number, workspaceId: string, docId: string, sessionId?: string | null): string {
    const baseUrl = resolveOnlyOfficePublicBaseUrl(host, port);
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
    const internalBaseUrl = getOnlyOfficeInternalUrl();
    const publicBaseUrl = getOnlyOfficeUrl();

    if (isLoopbackHost) {
        replaceOrigin(internalBaseUrl);
        replaceOrigin(publicBaseUrl);
    }

    replaceOrigin(internalBaseUrl);

    return candidates;
}

export function createDocumentRoutes(routes: unknown[]) {
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            await ensureDir(docsDir);

            const docs: Array<{ name: string; updatedAt: number; size: number; type: string }> = [];
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
                    docs.push({
                        name: relName,
                        updatedAt: info.mtimeMs,
                        size: info.size,
                        type: getDocumentType(entry.name),
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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
            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

    // List headings in a DOCX document (source inbox or session document)
    routes.push({
        method: "GET",
        regex: /^\/w\/([^/]+)\/document\/headings$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            const inboxId = (ctx.url.searchParams.get("inboxId") ?? "").trim();
            const docName = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!inboxId && !docName) {
                throw new ApiError(400, "invalid_request", "inboxId or doc is required");
            }
            if (inboxId && docName) {
                throw new ApiError(400, "invalid_request", "Provide either inboxId or doc, not both");
            }

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            let sourcePath: string;
            if (inboxId) {
                if (!sessionId) {
                    throw new ApiError(400, "invalid_request", "session is required for inbox headings");
                }
                const inboxRoot = resolveInboxDir(workspace.path);
                const decoded = decodeInboxId(inboxId);
                const prefix = `sessions/${sessionId}/`;
                if (!decoded.startsWith(prefix)) {
                    throw new ApiError(403, "forbidden", "Inbox file is not in this session");
                }
                const inboxAbs = resolveDocumentPathSafe(inboxRoot, decoded);
                if (!(await exists(inboxAbs))) throw new ApiError(404, "not_found", "Inbox file not found");
                sourcePath = await ensureDocxZipPath(workspace.path, inboxAbs);
            } else {
                if (!sessionId) {
                    throw new ApiError(400, "invalid_request", "session is required for document headings");
                }
                const docsDir = resolveDocumentsDir(workspace.path, sessionId);
                const docAbs = resolveDocumentPathSafe(docsDir, docName);
                if (!(await exists(docAbs))) throw new ApiError(404, "not_found", "Document not found");
                const ext = extname(docAbs).toLowerCase();
                if (!DOCX_ZIP_EXTENSIONS.has(ext)) {
                    throw new ApiError(400, "unsupported_docx_copy_target", "Only .docx/.docm/.dotx/.dotm documents are supported.");
                }
                sourcePath = docAbs;
            }

            const scriptPath = resolveDocxSectionCopyScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "copy_docx_section.py is missing in this workspace");
            }

            const result = spawnSync(
                "python3",
                [scriptPath, "--source", sourcePath, "--list-headings", "--json"],
                { encoding: "utf8" },
            );
            if (result.status !== 0) {
                const stderr = String(result.stderr || "").trim();
                const stdout = String(result.stdout || "").trim();
                throw new ApiError(400, "headings_failed", stderr || stdout || "Failed to list headings");
            }

            const stdout = String(result.stdout || "").trim();
            let items: unknown;
            try {
                items = JSON.parse(stdout) as unknown;
            } catch {
                throw new ApiError(500, "headings_failed", "Failed to parse headings output");
            }
            if (!Array.isArray(items)) {
                throw new ApiError(500, "headings_failed", "Unexpected headings output");
            }
            return jsonResponse({ items });
        },
    });

    // Copy a heading-delimited section from an inbox DOCX into a target session DOCX
    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/document\/copy-section$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");
            const targetExt = extname(targetAbs).toLowerCase();
            if (!DOCX_ZIP_EXTENSIONS.has(targetExt)) {
                throw new ApiError(400, "unsupported_docx_copy_target", "Only .docx/.docm/.dotx/.dotm targets are supported.");
            }

            const body = (await ctx.request.json().catch(() => null)) as any;
            if (!body || typeof body !== "object") {
                throw new ApiError(400, "invalid_payload", "Expected JSON body");
            }

            const sourceInboxId = (body.sourceInboxId ?? "").trim();
            const sourceHeading = (body.sourceHeading ?? "").trim();
            const sourceHeadingIndex = Number.isFinite(body.sourceHeadingIndex) ? Number(body.sourceHeadingIndex) : null;
            const targetHeading = typeof body.targetHeading === "string" ? body.targetHeading.trim() : "";
            const targetHeadingIndex = Number.isFinite(body.targetHeadingIndex) ? Number(body.targetHeadingIndex) : null;
            const excludeSourceHeading = Boolean(body.excludeSourceHeading);
            const matchMode = typeof body.matchMode === "string" ? body.matchMode.trim().toLowerCase() : "exact";

            if (!sourceInboxId) throw new ApiError(400, "invalid_request", "sourceInboxId is required");
            if (!sourceHeading) throw new ApiError(400, "invalid_request", "sourceHeading is required");
            if (!["exact", "contains", "startswith"].includes(matchMode)) {
                throw new ApiError(400, "invalid_request", "Invalid matchMode");
            }

            const inboxRoot = resolveInboxDir(workspace.path);
            const decoded = decodeInboxId(sourceInboxId);
            const prefix = `sessions/${sessionId}/`;
            if (!decoded.startsWith(prefix)) {
                throw new ApiError(403, "forbidden", "Inbox file is not in this session");
            }
            const inboxAbs = resolveDocumentPathSafe(inboxRoot, decoded);
            if (!(await exists(inboxAbs))) throw new ApiError(404, "not_found", "Source inbox file not found");

            const sourceAbs = await ensureDocxZipPath(workspace.path, inboxAbs);
            const scriptPath = resolveDocxSectionCopyScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "copy_docx_section.py is missing in this workspace");
            }

            const tmpOutput = `${targetAbs}.tmp-${shortId()}`;
            const args = [
                scriptPath,
                "--source",
                sourceAbs,
                "--target",
                targetAbs,
                "--output",
                tmpOutput,
                "--source-heading",
                sourceHeading,
                "--match-mode",
                matchMode,
            ];
            if (sourceHeadingIndex && Number.isFinite(sourceHeadingIndex)) {
                args.push("--source-heading-index", String(Math.trunc(sourceHeadingIndex)));
            }
            if (targetHeading) {
                args.push("--target-heading", targetHeading);
                if (targetHeadingIndex && Number.isFinite(targetHeadingIndex)) {
                    args.push("--target-heading-index", String(Math.trunc(targetHeadingIndex)));
                }
            }
            if (excludeSourceHeading) {
                args.push("--exclude-source-heading");
            }

            const result = spawnSync("python3", args, { encoding: "utf8" });
            if (result.status !== 0) {
                await rm(tmpOutput, { force: true }).catch(() => undefined);
                const stderr = String(result.stderr || "").trim();
                const stdout = String(result.stdout || "").trim();
                throw new ApiError(400, "copy_section_failed", stderr || stdout || "Failed to copy section");
            }

            await rename(tmpOutput, targetAbs);

            const stdout = String(result.stdout || "").trim();
            const match = stdout.match(/Copied:\s*(\d+)\s+paragraphs,\s*(\d+)\s+tables,\s*(\d+)\s+images,\s*(\d+)\s+styles/i);
            const stats = match
                ? {
                    paragraphs: Number(match[1]),
                    tables: Number(match[2]),
                    images: Number(match[3]),
                    styles: Number(match[4]),
                }
                : null;

            const warnings = String(result.stderr || "")
                .split("\n")
                .map((line) => line.trim())
                .filter(Boolean)
                .filter((line) => line.toLowerCase().startsWith("warning:"))
                .map((line) => line.replace(/^warning:\s*/i, ""));

            return jsonResponse({ ok: true, stats, warnings });
        },
    });

    // Assemble bid MVP modules (deterministic, report-driven)
    // - assemble: copy baseline bid forms into the target (DOCX -> DOCX, format-preserving)
    // - fill: fill pre-formatted tables from XLSX inputs (XLSX -> DOCX)
    // - facts: extract "hard facts" from the tender and (optionally) fill the template (DOCX -> DOCX + JSON + report)
    // - qc: quality-check the current target doc (gate + report)

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/bid\/assemble$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");
            const targetExt = extname(targetAbs).toLowerCase();
            if (targetExt !== ".docx") {
                throw new ApiError(400, "unsupported_target", "bid/assemble currently supports .docx targets only.");
            }

            const body = (await ctx.request.json().catch(() => null)) as any;
            if (!body || typeof body !== "object") {
                throw new ApiError(400, "invalid_payload", "Expected JSON body");
            }

            const partnerInboxId = typeof body.partnerInboxId === "string" ? body.partnerInboxId.trim() : "";
            const matchMode = typeof body.matchMode === "string" ? body.matchMode.trim().toLowerCase() : "contains";
            const force = Boolean(body.force);
            const seedTarget = Boolean(body.seedTarget);
            if (!["exact", "contains", "startswith"].includes(matchMode)) {
                throw new ApiError(400, "invalid_request", "Invalid matchMode");
            }
            if (!partnerInboxId) {
                throw new ApiError(400, "invalid_request", "partnerInboxId is required");
            }

            const scriptPath = resolveDocxSectionCopyScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "copy_docx_section.py is missing in this workspace");
            }

            const { absPath: partnerInboxAbs } = await resolveSessionInboxFilePath({
                workspace,
                sessionId,
                inboxId: partnerInboxId,
            });
            const partnerAbs = await ensureDocxZipPath(workspace.path, partnerInboxAbs);

            const listHeadings = (sourcePath: string) => {
                const result = spawnSync(
                    "python3",
                    [scriptPath, "--source", sourcePath, "--list-headings", "--json"],
                    { encoding: "utf8", cwd: workspace.path },
                );
                if (result.status !== 0) {
                    const stderr = String(result.stderr || "").trim();
                    const stdout = String(result.stdout || "").trim();
                    throw new ApiError(400, "headings_failed", stderr || stdout || "Failed to list headings");
                }
                const stdout = String(result.stdout || "").trim();
                let items: unknown;
                try {
                    items = JSON.parse(stdout) as unknown;
                } catch {
                    throw new ApiError(500, "headings_failed", "Failed to parse headings output");
                }
                if (!Array.isArray(items)) {
                    throw new ApiError(500, "headings_failed", "Unexpected headings output");
                }
                return items as DocHeading[];
            };

            type HeadingMatch = { occurrence: number; item: DocHeading };

            const findBestMatch = (items: DocHeading[], needle: string): HeadingMatch | null => {
                const matches = items
                    .map((item, idx) => ({ item, idx }))
                    .filter(({ item }) => {
                        const text = item.text ?? "";
                        if (matchMode === "exact") return text === needle;
                        if (matchMode === "contains") return text.includes(needle);
                        return text.startsWith(needle);
                    });
                if (!matches.length) return null;
                if (matches.length === 1) return { occurrence: 1, item: matches[0].item };

                // Prefer headings with the largest section size (TOC-like headings tend to have 0 elements).
                matches.sort((a, b) => {
                    const aCount = Number.isFinite(a.item.elementCount) ? a.item.elementCount : 0;
                    const bCount = Number.isFinite(b.item.elementCount) ? b.item.elementCount : 0;
                    if (aCount !== bCount) return bCount - aCount;
                    // Tie-breaker: later in the document usually beats earlier (TOC tends to be early).
                    return b.idx - a.idx;
                });

                const best = matches[0];
                const bestText = best.item.text ?? "";
                // Compute occurrence among matches in document order.
                const ordered = matches.slice().sort((a, b) => a.idx - b.idx);
                const occurrence = ordered.findIndex((m) => m.idx === best.idx && (m.item.text ?? "") === bestText) + 1;
                return { occurrence: occurrence > 0 ? occurrence : 1, item: best.item };
            };

            const partnerHeadings = listHeadings(partnerAbs);

            const tmpDir = join(docsDir, ".tmp");
            await ensureDir(tmpDir);
            const workAbs = join(tmpDir, `assemble-${shortId()}.docx`);
            let seedSnapshotRel: string | null = null;
            if (seedTarget) {
                const historyDir = join(docsDir, ".history");
                await ensureDir(historyDir);
                const snapshotName = `${basename(targetAbs, ".docx")}-seed-${new Date().toISOString().replace(/[:.]/g, "-")}.docx`;
                const snapshotAbs = join(historyDir, snapshotName);
                await copyFile(targetAbs, snapshotAbs);
                seedSnapshotRel = `.history/${snapshotName}`;
                await copyFile(partnerAbs, workAbs);
            } else {
                await copyFile(targetAbs, workAbs);
            }
            const targetHeadings = listHeadings(workAbs);

            type StepResult = { heading: string; skipped?: boolean; stats?: { paragraphs: number; tables: number; images: number; styles: number } | null; warnings: string[]; };
            const steps: StepResult[] = [];

            try {
                for (const heading of DEFAULT_BID_FORMS_HEADINGS) {
                    const targetMatch = findBestMatch(targetHeadings, heading);
                    const targetElementCount = targetMatch && Number.isFinite(targetMatch.item.elementCount)
                        ? Math.max(0, Math.trunc(targetMatch.item.elementCount ?? 0))
                        : 0;
                    if (!force && targetMatch && targetElementCount > 0) {
                        steps.push({ heading, skipped: true, warnings: ["Target section appears non-empty"] });
                        continue;
                    }

                    const sourceMatch = findBestMatch(partnerHeadings, heading);
                    if (!sourceMatch) {
                        steps.push({ heading, skipped: true, warnings: ["Source heading not found"] });
                        continue;
                    }

                    const stepOutput = join(tmpDir, `assemble-step-${shortId()}.docx`);
                    const args = [
                        scriptPath,
                        "--source",
                        partnerAbs,
                        "--target",
                        workAbs,
                        "--output",
                        stepOutput,
                        "--source-heading",
                        heading,
                        "--match-mode",
                        matchMode,
                        "--source-heading-index",
                        String(sourceMatch.occurrence),
                        "--max-paragraphs",
                        "300",
                        "--max-tables",
                        "25",
                        "--max-body-elements",
                        "600",
                    ];
                    if (targetMatch) {
                        args.push(
                            "--target-heading",
                            heading,
                            "--target-heading-index",
                            String(targetMatch.occurrence),
                            "--exclude-source-heading",
                        );
                    } else {
                        // When appending a missing section to the end of the document, start it on a
                        // new page if there's already visible content. For insertions under an
                        // existing target heading we *don't* do this, otherwise we'd end up
                        // splitting the heading from its content (blank/heading-only pages).
                        args.push("--page-break-before");
                    }
                    const result = spawnSync("python3", args, { encoding: "utf8", cwd: workspace.path });
                    if (result.status !== 0) {
                        await rm(stepOutput, { force: true }).catch(() => undefined);
                        const stderr = String(result.stderr || "").trim();
                        const stdout = String(result.stdout || "").trim();
                        throw new ApiError(400, "assemble_failed", stderr || stdout || `Failed to copy section '${heading}'`);
                    }

                    await rename(stepOutput, workAbs);

                    const stdout = String(result.stdout || "").trim();
                    const match = stdout.match(/Copied:\s*(\d+)\s+paragraphs,\s*(\d+)\s+tables,\s*(\d+)\s+images,\s*(\d+)\s+styles/i);
                    const stats = match
                        ? {
                            paragraphs: Number(match[1]),
                            tables: Number(match[2]),
                            images: Number(match[3]),
                            styles: Number(match[4]),
                        }
                        : null;

                    const warnings = String(result.stderr || "")
                        .split("\n")
                        .map((line) => line.trim())
                        .filter(Boolean)
                        .filter((line) => line.toLowerCase().startsWith("warning:"))
                        .map((line) => line.replace(/^warning:\s*/i, ""));

                    steps.push({ heading, stats, warnings });
                }

                await rename(workAbs, targetAbs);
            } catch (error) {
                await rm(workAbs, { force: true }).catch(() => undefined);
                throw error;
            }

            const reportLines: string[] = [];
            reportLines.push(`# Assemble report: ${basename(targetAbs)}`);
            reportLines.push("");
            reportLines.push(`- session: \`${sessionId}\``);
            reportLines.push(`- target: \`${targetDoc}\``);
            reportLines.push(`- partner: \`${basename(partnerAbs)}\``);
            reportLines.push(`- matchMode: \`${matchMode}\``);
            reportLines.push(`- force: \`${force}\``);
            reportLines.push(`- seedTarget: \`${seedTarget}\``);
            if (seedSnapshotRel) reportLines.push(`- seedSnapshot: \`${seedSnapshotRel}\``);
            reportLines.push("");
            reportLines.push("## Steps");
            for (const step of steps) {
                if (step.skipped) {
                    reportLines.push(`- ${step.heading}: skipped${step.warnings.length ? ` (${step.warnings.join("; ")})` : ""}`);
                    continue;
                }
                const statText = step.stats
                    ? ` (${step.stats.paragraphs}p, ${step.stats.tables}t, ${step.stats.images}i)`
                    : "";
                reportLines.push(`- ${step.heading}: inserted${statText}`);
                for (const w of step.warnings) {
                    reportLines.push(`  - warning: ${w}`);
                }
            }
            reportLines.push("");

            const report = await writeSessionReport({
                workspace,
                sessionId,
                moduleId: "assemble",
                content: reportLines.join("\n"),
            });

            return jsonResponse({
                ok: true,
                steps,
                report,
            });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/bid\/fill$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");
            const targetExt = extname(targetAbs).toLowerCase();
            if (targetExt !== ".docx") {
                throw new ApiError(400, "unsupported_target", "bid/fill currently supports .docx targets only.");
            }

            const scriptPath = resolveBidFillTablesScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "fill_bid_tables_mvp.py is missing in this workspace");
            }

            const body = (await ctx.request.json().catch(() => null)) as any;
            if (!body || typeof body !== "object") {
                throw new ApiError(400, "invalid_payload", "Expected JSON body");
            }

            const techXlsxInboxId = typeof body.techXlsxInboxId === "string" ? body.techXlsxInboxId.trim() : "";
            const equipXlsxInboxId = typeof body.equipXlsxInboxId === "string" ? body.equipXlsxInboxId.trim() : "";
            const brand = typeof body.brand === "string" ? body.brand.trim() : "";
            const manufacturer = typeof body.manufacturer === "string" ? body.manufacturer.trim() : "";
            const origin = typeof body.origin === "string" ? body.origin.trim() : "";
            const unit = typeof body.unit === "string" ? body.unit.trim() : "";
            const pricePlaceholder = typeof body.pricePlaceholder === "string" ? body.pricePlaceholder.trim() : "";
            const specPlaceholder = typeof body.specPlaceholder === "string" ? body.specPlaceholder.trim() : "";

            const args = [scriptPath, "--docx"];

            const tmpDir = join(docsDir, ".tmp");
            await ensureDir(tmpDir);
            const tmpOutput = join(tmpDir, `fill-${shortId()}.docx`);
            await copyFile(targetAbs, tmpOutput);

            let techAbs: string | null = null;
            let equipAbs: string | null = null;
            try {
                if (techXlsxInboxId) {
                    const { absPath } = await resolveSessionInboxFilePath({
                        workspace,
                        sessionId,
                        inboxId: techXlsxInboxId,
                    });
                    techAbs = absPath;
                }
                if (equipXlsxInboxId) {
                    const { absPath } = await resolveSessionInboxFilePath({
                        workspace,
                        sessionId,
                        inboxId: equipXlsxInboxId,
                    });
                    equipAbs = absPath;
                }

                args.push(tmpOutput);
                if (techAbs) {
                    args.push("--tech-xlsx", techAbs);
                }
                if (equipAbs) {
                    args.push("--equip-xlsx", equipAbs);
                }
                if (brand) args.push("--brand", brand);
                if (manufacturer) args.push("--manufacturer", manufacturer);
                if (origin) args.push("--origin", origin);
                if (unit) args.push("--unit", unit);
                if (pricePlaceholder) args.push("--price-placeholder", pricePlaceholder);
                if (specPlaceholder) args.push("--spec-placeholder", specPlaceholder);

                const result = spawnSync("python3", args, { encoding: "utf8", cwd: workspace.path });
                const stdout = String(result.stdout || "").trim();
                const stderr = String(result.stderr || "").trim();

                const reportText = [
                    `# Fill tables report: ${basename(targetAbs)}`,
                    "",
                    `- session: \`${sessionId}\``,
                    `- target: \`${targetDoc}\``,
                    `- techXlsx: \`${techAbs ? basename(techAbs) : "—"}\``,
                    `- equipXlsx: \`${equipAbs ? basename(equipAbs) : "—"}\``,
                    "",
                    "## Output",
                    "",
                    "```",
                    stdout || "(no stdout)",
                    stderr ? `\n\n[stderr]\n${stderr}` : "",
                    "```",
                    "",
                ].join("\n");

                const report = await writeSessionReport({
                    workspace,
                    sessionId,
                    moduleId: "fill",
                    content: reportText,
                });

                if (result.status !== 0) {
                    await rm(tmpOutput, { force: true }).catch(() => undefined);
                    throw new ApiError(400, "fill_failed", stderr || stdout || "Failed to fill bid tables", { report });
                }

                await rename(tmpOutput, targetAbs);
                return jsonResponse({ ok: true, report, stdout, stderr });
            } catch (error) {
                await rm(tmpOutput, { force: true }).catch(() => undefined);
                throw error;
            }
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/bid\/facts$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");
            const targetExt = extname(targetAbs).toLowerCase();
            if (targetExt !== ".docx") {
                throw new ApiError(400, "unsupported_target", "bid/facts currently supports .docx targets only.");
            }

            const scriptPath = resolveBidTenderFactsScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "tender_facts_mvp.py is missing in this workspace");
            }

            const body = (await ctx.request.json().catch(() => null)) as any;
            if (!body || typeof body !== "object") {
                throw new ApiError(400, "invalid_payload", "Expected JSON body");
            }

            const tenderInboxId = typeof body.tenderInboxId === "string" ? body.tenderInboxId.trim() : "";
            const applyToTarget = body.applyToTarget === undefined ? true : Boolean(body.applyToTarget);
            const force = Boolean(body.force);
            const ensureProjectInfoBlock = body.ensureProjectInfoBlock === undefined ? true : Boolean(body.ensureProjectInfoBlock);
            if (!tenderInboxId) throw new ApiError(400, "invalid_request", "tenderInboxId is required");

            const { absPath: tenderAbs } = await resolveSessionInboxFilePath({
                workspace,
                sessionId,
                inboxId: tenderInboxId,
            });
            const tenderDocxAbs = await ensureDocxZipPath(workspace.path, tenderAbs);

            const bidDir = join(docsDir, ".bid");
            await ensureDir(bidDir);
            const factsAbs = join(bidDir, "facts.json");

            const tmpDir = join(docsDir, ".tmp");
            await ensureDir(tmpDir);
            const tmpTarget = join(tmpDir, `facts-${shortId()}.docx`);
            const tmpFacts = join(tmpDir, `facts-${shortId()}.json`);
            const tmpReport = join(tmpDir, `facts-${shortId()}.md`);

            if (applyToTarget) {
                await copyFile(targetAbs, tmpTarget);
            }

            const args = [
                scriptPath,
                "--tender-docx",
                tenderDocxAbs,
                "--out-facts",
                tmpFacts,
                "--out-report",
                tmpReport,
            ];
            if (applyToTarget) {
                args.push("--target-docx", tmpTarget);
            }
            if (force) {
                args.push("--force");
            }
            if (applyToTarget && ensureProjectInfoBlock) {
                args.push("--insert-block");
            }

            const result = spawnSync("python3", args, { encoding: "utf8", cwd: workspace.path });
            const stdout = String(result.stdout || "").trim();
            const stderr = String(result.stderr || "").trim();
            if (result.status !== 0) {
                await rm(tmpTarget, { force: true }).catch(() => undefined);
                await rm(tmpFacts, { force: true }).catch(() => undefined);
                await rm(tmpReport, { force: true }).catch(() => undefined);
                throw new ApiError(400, "facts_failed", stderr || stdout || "Failed to extract tender facts", { stdout, stderr });
            }

            if (applyToTarget) {
                await rename(tmpTarget, targetAbs);
            }

            await rename(tmpFacts, factsAbs);

            const facts = await writeSessionArtifactFromFile({
                workspace,
                sessionId,
                moduleId: "facts",
                filename: "facts.json",
                absSourcePath: factsAbs,
            });

            let reportContent = "";
            if (await exists(tmpReport)) {
                reportContent = await readFile(tmpReport, "utf8");
            } else {
                reportContent = [
                    `# Tender facts report: ${basename(tenderDocxAbs)}`,
                    "",
                    "- No report content produced by tender_facts_mvp.py.",
                    "",
                ].join("\n");
            }
            reportContent += `\n\n## Artifacts\n\n- facts.json: \`${facts.inboxPath}\`\n`;

            const report = await writeSessionReport({
                workspace,
                sessionId,
                moduleId: "facts",
                content: reportContent,
            });

            await rm(tmpReport, { force: true }).catch(() => undefined);

            return jsonResponse({ ok: true, report, facts, stdout, stderr });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/bid\/qc$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const body = (await ctx.request.json().catch(() => null)) as any;
            const requestedMode =
                (typeof ctx.url.searchParams.get("mode") === "string" ? (ctx.url.searchParams.get("mode") ?? "") : "").trim() ||
                (typeof body?.mode === "string" ? body.mode.trim() : "");
            const mode = requestedMode === "submit" ? "submit" : "draft";

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");
            const targetExt = extname(targetAbs).toLowerCase();
            if (targetExt !== ".docx") {
                throw new ApiError(400, "unsupported_target", "bid/qc currently supports .docx targets only.");
            }

            const scriptPath = resolveBidQcScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "qc_bid_mvp.py is missing in this workspace");
            }

            const factsAbs = join(docsDir, ".bid", "facts.json");
            const args = [scriptPath, "--docx", targetAbs];
            args.push("--mode", mode);
            const hasFacts = await exists(factsAbs);
            if (hasFacts) {
                args.push("--facts", factsAbs);
            }

            const result = spawnSync("python3", args, { encoding: "utf8", cwd: workspace.path });
            const stdout = String(result.stdout || "").trim();
            const stderr = String(result.stderr || "").trim();
            const passed = result.status === 0;

            const reportText = [
                `# QC report: ${basename(targetAbs)}`,
                "",
                `- session: \`${sessionId}\``,
                `- target: \`${targetDoc}\``,
                `- mode: \`${mode}\``,
                `- facts: \`${hasFacts ? ".bid/facts.json" : "—"}\``,
                `- result: **${passed ? "PASS" : "FAIL"}**`,
                "",
                "## Output",
                "",
                stdout || "(no stdout)",
                stderr ? `\n\n[stderr]\n${stderr}` : "",
                "",
            ].join("\n");

            const report = await writeSessionReport({
                workspace,
                sessionId,
                moduleId: "qc",
                content: reportText,
            });

            return jsonResponse({ ok: true, passed, mode, report, stdout, stderr });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/bid\/dedupe$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");
            const targetExt = extname(targetAbs).toLowerCase();
            if (targetExt !== ".docx") {
                throw new ApiError(400, "unsupported_target", "bid/dedupe currently supports .docx targets only.");
            }

            const scriptPath = resolveBidDedupeScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "compare_bids.py is missing in this workspace");
            }

            const body = (await ctx.request.json().catch(() => null)) as any;
            if (!body || typeof body !== "object") {
                throw new ApiError(400, "invalid_payload", "Expected JSON body");
            }

            const docPaths: string[] = Array.isArray(body.docPaths)
                ? body.docPaths
                    .map((v: unknown) => (typeof v === "string" ? v.trim().replace(/^\/+/, "") : ""))
                    .filter(Boolean)
                : [];

            const inboxIds: string[] = Array.isArray(body.inboxIds)
                ? body.inboxIds
                    .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
                    .filter(Boolean)
                : [];

            const excludeTables = Boolean(body.excludeTables);
            const exportMedia = Boolean(body.exportMedia);

            const simThresholdRaw = typeof body.simThreshold === "number" ? body.simThreshold : Number(body.simThreshold);
            const simThreshold = Number.isFinite(simThresholdRaw) ? simThresholdRaw : undefined;
            if (simThreshold !== undefined && (simThreshold < 0 || simThreshold > 1)) {
                throw new ApiError(400, "invalid_request", "simThreshold must be between 0 and 1");
            }

            const normalizePositiveInt = (value: unknown): number | undefined => {
                const parsed = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(parsed)) return undefined;
                const intValue = Math.trunc(parsed);
                return intValue > 0 ? intValue : undefined;
            };

            const normalizeNonNegativeInt = (value: unknown): number | undefined => {
                const parsed = typeof value === "number" ? value : Number(value);
                if (!Number.isFinite(parsed)) return undefined;
                const intValue = Math.trunc(parsed);
                return intValue >= 0 ? intValue : undefined;
            };

            const exactMinChars = normalizePositiveInt(body.exactMinChars);
            const minChars = normalizePositiveInt(body.minChars);
            const simhashMaxDist = normalizeNonNegativeInt(body.simhashMaxDist);

            const includeTitleRegex: string[] = Array.isArray(body.includeTitleRegex)
                ? body.includeTitleRegex
                    .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
                    .filter(Boolean)
                : [];
            const excludeTitleRegex: string[] = Array.isArray(body.excludeTitleRegex)
                ? body.excludeTitleRegex
                    .map((v: unknown) => (typeof v === "string" ? v.trim() : ""))
                    .filter(Boolean)
                : [];

            const compareAbs: string[] = [targetAbs];

            for (const relPath of docPaths) {
                if (!relPath || relPath === targetDoc) continue;
                const abs = resolveDocumentPathSafe(docsDir, relPath);
                if (!(await exists(abs))) continue;
                compareAbs.push(await ensureDocxZipPath(workspace.path, abs));
            }

            for (const inboxId of inboxIds) {
                const { absPath } = await resolveSessionInboxFilePath({
                    workspace,
                    sessionId,
                    inboxId,
                });
                compareAbs.push(await ensureDocxZipPath(workspace.path, absPath));
            }

            const uniq: string[] = [];
            const seen = new Set<string>();
            for (const abs of compareAbs) {
                const key = abs.trim();
                if (!key) continue;
                if (seen.has(key)) continue;
                seen.add(key);
                uniq.push(key);
            }

            if (uniq.length < 2) {
                throw new ApiError(400, "invalid_request", "Select at least 2 DOCX documents to compare (target + 1 or more sources).");
            }

            const tmpDir = join(docsDir, ".tmp");
            await ensureDir(tmpDir);

            const tmpReport = join(tmpDir, `dedupe-${shortId()}.md`);
            const tmpMediaDir = exportMedia ? join(tmpDir, `dedupe-media-${shortId()}`) : null;
            const tmpMediaZip = exportMedia ? join(tmpDir, `dedupe-media-${shortId()}.zip`) : null;

            if (tmpMediaDir) await ensureDir(tmpMediaDir);

            const args: string[] = [scriptPath, ...uniq, "--out", tmpReport];
            if (excludeTables) args.push("--exclude-tables");
            if (simThreshold !== undefined) args.push("--sim-threshold", String(simThreshold));
            if (exactMinChars !== undefined) args.push("--exact-min-chars", String(exactMinChars));
            if (minChars !== undefined) args.push("--min-chars", String(minChars));
            if (simhashMaxDist !== undefined) args.push("--simhash-max-dist", String(simhashMaxDist));
            for (const value of includeTitleRegex) args.push("--include-title-regex", value);
            for (const value of excludeTitleRegex) args.push("--exclude-title-regex", value);
            if (tmpMediaDir) args.push("--media-dir", tmpMediaDir);

            const result = spawnSync("python3", args, { encoding: "utf8", cwd: workspace.path });
            const stdout = String(result.stdout || "").trim();
            const stderr = String(result.stderr || "").trim();

            let mediaZip: { inboxId: string; inboxPath: string } | null = null;
            let mediaDoc: { docPath: string } | null = null;
            if (tmpMediaDir && tmpMediaZip) {
                const zipResult = spawnSync("zip", ["-r", tmpMediaZip, "."], {
                    cwd: tmpMediaDir,
                    encoding: "utf8",
                });
                if (zipResult.status === 0 && (await exists(tmpMediaZip))) {
                    mediaZip = await writeSessionArtifactFromFile({
                        workspace,
                        sessionId,
                        moduleId: "dedupe",
                        filename: "media.zip",
                        absSourcePath: tmpMediaZip,
                    });
                    mediaDoc = await writeSessionVisibleArtifactFromFile({
                        workspace,
                        sessionId,
                        moduleId: "dedupe",
                        filename: "media.zip",
                        absSourcePath: tmpMediaZip,
                    });
                }
            }

            let reportContent = "";
            if (await exists(tmpReport)) {
                reportContent = await readFile(tmpReport, "utf8");
            } else {
                reportContent = [
                    "# Bid dedupe report",
                    "",
                    "Report generation failed; no markdown report was produced by compare_bids.py.",
                    "",
                ].join("\n");
            }

            if (mediaZip) {
                reportContent = reportContent.replace(
                    /- Contact sheet \(HTML\): `[^`]+`/g,
                    `- Media contact sheet (download zip): \`${mediaZip.inboxPath}\``,
                );
                if (!/Media contact sheet/.test(reportContent)) {
                    reportContent += `\n\n## Media exports\n\n- Media contact sheet (download zip): \`${mediaZip.inboxPath}\`\n`;
                }
            }

            const report = await writeSessionReport({
                workspace,
                sessionId,
                moduleId: "dedupe",
                content: reportContent,
            });

            await rm(tmpReport, { force: true }).catch(() => undefined);
            if (tmpMediaZip) await rm(tmpMediaZip, { force: true }).catch(() => undefined);
            if (tmpMediaDir) await rm(tmpMediaDir, { recursive: true, force: true }).catch(() => undefined);

            if (result.status !== 0) {
                throw new ApiError(400, "dedupe_failed", stderr || stdout || "Failed to dedupe documents", {
                    report,
                    stdout,
                    stderr,
                });
            }

            return jsonResponse({ ok: true, report, mediaZip, mediaDoc, stdout, stderr });
        },
    });

    routes.push({
        method: "POST",
        regex: /^\/w\/([^/]+)\/bid\/preview-pdf$/,
        keys: ["id"],
        auth: "client",
        handler: async (ctx: RequestContext) => {
            const workspaceId = ctx.params.id;
            const sessionId = parseDocumentSessionId(ctx.url.searchParams.get("session"));
            if (!sessionId) throw new ApiError(400, "invalid_request", "session is required");

            const targetDoc = (ctx.url.searchParams.get("doc") ?? "").trim();
            if (!targetDoc) throw new ApiError(400, "invalid_request", "doc is required");

            const workspace = ctx.config.workspaces.find((w: WorkspaceInfo) => w.id === workspaceId);
            if (!workspace) throw new ApiError(404, "not_found", "Workspace not found");

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            const targetAbs = resolveDocumentPathSafe(docsDir, targetDoc);
            if (!(await exists(targetAbs))) throw new ApiError(404, "not_found", "Target document not found");

            const targetExt = extname(targetAbs).toLowerCase();
            if (targetExt !== ".docx") {
                throw new ApiError(400, "unsupported_target", "bid/preview-pdf currently supports .docx targets only.");
            }

            const tmpDir = join(docsDir, ".tmp");
            await ensureDir(tmpDir);
            const outputDir = join(tmpDir, `preview-${shortId()}`);
            await ensureDir(outputDir);

            try {
                const result = spawnSync(
                    "soffice",
                    [
                        "--headless",
                        "--nologo",
                        "--nofirststartwizard",
                        "--convert-to",
                        "pdf",
                        "--outdir",
                        outputDir,
                        targetAbs,
                    ],
                    { encoding: "utf8" },
                );

                if (result.error) {
                    const message = result.error instanceof Error ? result.error.message : String(result.error);
                    throw new ApiError(400, "preview_failed", `LibreOffice (soffice) failed: ${message}`);
                }

                const stdout = String(result.stdout || "").trim();
                const stderr = String(result.stderr || "").trim();
                if (result.status !== 0) {
                    throw new ApiError(400, "preview_failed", stderr || stdout || "Failed to export PDF preview (LibreOffice).");
                }

                const expected = join(outputDir, `${basename(targetAbs, targetExt)}.pdf`);
                let pdfAbs = expected;
                if (!(await exists(pdfAbs))) {
                    const entries = await readdir(outputDir, { withFileTypes: true });
                    const found = entries.find((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".pdf"));
                    if (!found) {
                        throw new ApiError(400, "preview_failed", "LibreOffice did not produce a PDF output.");
                    }
                    pdfAbs = join(outputDir, found.name);
                }

                const pdf = await writeSessionArtifactFromFile({
                    workspace,
                    sessionId,
                    moduleId: "preview",
                    filename: `${basename(targetAbs, targetExt)}.pdf`,
                    absSourcePath: pdfAbs,
                });
                const pdfDoc = await writeSessionVisibleArtifactFromFile({
                    workspace,
                    sessionId,
                    moduleId: "preview",
                    filename: `${basename(targetAbs, targetExt)}.pdf`,
                    absSourcePath: pdfAbs,
                });

                const reportText = [
                    `# PDF preview: ${basename(targetAbs)}`,
                    "",
                    `- session: \`${sessionId}\``,
                    `- target: \`${targetDoc}\``,
                    `- pdf: \`${pdfDoc.docPath}\``,
                    "",
                    "## Notes",
                    "",
                    "- This preview is exported with LibreOffice (headless). Final submission should still be spot-checked in Microsoft Word.",
                    "",
                ].join("\n");

                const report = await writeSessionReport({
                    workspace,
                    sessionId,
                    moduleId: "preview",
                    content: reportText,
                });

                return jsonResponse({ ok: true, pdf, pdfDoc, report });
            } finally {
                await rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
            }
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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
                    url: getDownloadUrl(ctx.config.host, ctx.config.port, workspaceId, docName, sessionId),
                    permissions: {
                        download: true,
                        edit: canEdit,
                        print: true,
                        review: canEdit,
                    },
                },
                documentType: getDocumentType(docName),
                editorConfig: {
                    callbackUrl: getCallbackUrl(ctx.config.host, ctx.config.port, workspaceId, docName, sessionId),
                    user: {
                        id: ctx.actor?.clientId || "anonymous",
                        name: "AI User", // TODO: Get actual user name
                    },
                    mode: canEdit ? "edit" : "view",
                    lang: resolveOnlyOfficeLang(ctx.request),
                    customization: {
                        autosave: canEdit,
                        forcesave: canEdit,
                    },
                },
            };

            const jwtSecret = getOnlyOfficeJwtSecret();
            if (jwtSecret) {
                const token = jwt.sign(config, jwtSecret, { expiresIn: "5m" });
                config.token = token;
            }

            return jsonResponse({ documentServerUrl: getOnlyOfficeUrl(ctx.request), config });
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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
                console.log("你要保存啦！！！！！Callback received for document:", docName, "Status:", body.status);
                if (body.url) {
                    const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
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

            const docsDir = resolveDocumentsDir(workspace.path, sessionId);
            await ensureDir(docsDir);

            const name = basename(file.name);
            const requestedPath = typeof formData.get("path") === "string" ? String(formData.get("path")) : "";
            let destRel = normalizeDocumentPath(requestedPath);
            if (!destRel) {
                destRel = name;
            } else {
                const tail = destRel.split("/").pop() ?? "";
                if (!tail || !extname(tail)) {
                    destRel = `${destRel}/${name}`;
                }
            }
            validateDocumentMutationPath(destRel, { allowHiddenLeafFile: true });

            const filePath = resolveDocumentPathSafe(docsDir, destRel);
            await ensureDir(dirname(filePath));
            await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

            return jsonResponse({ ok: true, name: destRel });
        },
    });
}
