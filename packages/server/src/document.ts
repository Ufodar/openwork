import { copyFile, readFile, writeFile, readdir, stat, rm, rename } from "node:fs/promises";
import { dirname, join, resolve, relative, basename, extname, isAbsolute } from "node:path";
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

const ALLOWED_EXTENSIONS = new Set([...WORD_EXTENSIONS, ...CELL_EXTENSIONS, ...SLIDE_EXTENSIONS]);
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

function resolveBidQcScriptPath(workspacePath: string): string {
    return join(workspacePath, ".opencode", "skills", "bid-drafting", "scripts", "qc_bid_mvp.py");
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

function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

function getOnlyOfficeUrl(): string {
    return process.env.ONLYOFFICE_URL || "http://localhost:8080";
}

function getOnlyOfficeJwtSecret(): string {
    return (process.env.ONLYOFFICE_JWT_SECRET ?? "").trim();
}

function resolveOnlyOfficePublicBaseUrl(host: string, port: number): string {
    const override = (process.env.ONLYOFFICE_CALLBACK_URL || "").trim();
    if (override) return override.replace(/\/+$/, "");

    const normalizedHost = host.trim();
    if (!normalizedHost || normalizedHost === "0.0.0.0" || normalizedHost === "::") {
        // Common local-dev case: OpenWork binds to 0.0.0.0 but OnlyOffice runs in Docker.
        // `host.docker.internal` works on macOS/Windows Docker Desktop; Linux users can override via ONLYOFFICE_CALLBACK_URL.
        return `http://host.docker.internal:${port}`;
    }
    return `http://${normalizedHost}:${port}`;
}

function buildDocumentQuery(docId: string, sessionId?: string | null): string {
    const query = new URLSearchParams();
    query.set("docId", docId);
    if (sessionId) query.set("session", sessionId);
    return query.toString();
}

function getCallbackUrl(host: string, port: number, workspaceId: string, docId: string, sessionId?: string | null): string {
    const baseUrl = resolveOnlyOfficePublicBaseUrl(host, port);
    return `${baseUrl}/w/${workspaceId}/document/callback?${buildDocumentQuery(docId, sessionId)}`;
}

function getDownloadUrl(host: string, port: number, workspaceId: string, docId: string, sessionId?: string | null): string {
    const baseUrl = resolveOnlyOfficePublicBaseUrl(host, port);
    return `${baseUrl}/w/${workspaceId}/document/file?${buildDocumentQuery(docId, sessionId)}`;
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

            const walk = async (dir: string) => {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.name.startsWith(".")) continue;
                    const fullPath = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                        continue;
                    }
                    if (!entry.isFile()) continue;
                    const ext = extname(entry.name).toLowerCase();
                    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

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
            return jsonResponse({ items: docs });
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
                    if (entry.name.startsWith(".")) continue; // hide dot dirs/files
                    const fullPath = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        await walk(fullPath);
                        continue;
                    }
                    if (!entry.isFile()) continue;
                    const ext = extname(entry.name).toLowerCase();
                    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

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
            const ext = extname(initialDestRel).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) {
                throw new ApiError(400, "invalid_request", "Unsupported document type");
            }

            let destRel = initialDestRel;
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
                    const dirRel = dirname(destRel).replace(/\\/g, "/");
                    const base = basename(destRel, ext);
                    const unique = `${base}-${shortId()}${ext}`;
                    destRel = dirRel && dirRel !== "." ? `${dirRel}/${unique}` : unique;
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

            const findBestMatchIndex = (items: DocHeading[], needle: string) => {
                const matches = items
                    .map((item, idx) => ({ item, idx }))
                    .filter(({ item }) => {
                        const text = item.text ?? "";
                        if (matchMode === "exact") return text === needle;
                        if (matchMode === "contains") return text.includes(needle);
                        return text.startsWith(needle);
                    });
                if (!matches.length) return null;
                if (matches.length === 1) return 1;

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
                return occurrence > 0 ? occurrence : 1;
            };

            const targetHeadings = listHeadings(targetAbs);
            const partnerHeadings = listHeadings(partnerAbs);

            const alreadyInTarget = (needle: string) => {
                return targetHeadings.some((h) => {
                    const text = (h.text ?? "").trim();
                    if (!text) return false;
                    if (matchMode === "exact") return text === needle;
                    if (matchMode === "contains") return text.includes(needle);
                    return text.startsWith(needle);
                });
            };

            const tmpDir = join(docsDir, ".tmp");
            await ensureDir(tmpDir);
            const workAbs = join(tmpDir, `assemble-${shortId()}.docx`);
            await copyFile(targetAbs, workAbs);

            type StepResult = { heading: string; skipped?: boolean; stats?: { paragraphs: number; tables: number; images: number; styles: number } | null; warnings: string[]; };
            const steps: StepResult[] = [];

            try {
                for (const heading of DEFAULT_BID_FORMS_HEADINGS) {
                    if (!force && alreadyInTarget(heading)) {
                        steps.push({ heading, skipped: true, warnings: [] });
                        continue;
                    }

                    const sourceIdx = findBestMatchIndex(partnerHeadings, heading);
                    if (!sourceIdx) {
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
                        String(sourceIdx),
                    ];
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
        regex: /^\/w\/([^/]+)\/bid\/qc$/,
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
                throw new ApiError(400, "unsupported_target", "bid/qc currently supports .docx targets only.");
            }

            const scriptPath = resolveBidQcScriptPath(workspace.path);
            if (!(await exists(scriptPath))) {
                throw new ApiError(500, "missing_dependency", "qc_bid_mvp.py is missing in this workspace");
            }

            const result = spawnSync("python3", [scriptPath, "--docx", targetAbs], { encoding: "utf8", cwd: workspace.path });
            const stdout = String(result.stdout || "").trim();
            const stderr = String(result.stderr || "").trim();
            const passed = result.status === 0;

            const reportText = [
                `# QC report: ${basename(targetAbs)}`,
                "",
                `- session: \`${sessionId}\``,
                `- target: \`${targetDoc}\``,
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

            return jsonResponse({ ok: true, passed, report, stdout, stderr });
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
                    lang: "en",
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

            return jsonResponse({ documentServerUrl: getOnlyOfficeUrl(), config });
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
                    try {
                        const resp = await fetch(body.url);
                        if (!resp.ok) throw new Error("Failed to download");

                        const buffer = await resp.arrayBuffer();
                        const docsDir = resolveDocumentsDir(workspace.path, sessionId);
                        await ensureDir(docsDir);
                        const filePath = resolveDocumentPathSafe(docsDir, docName);

                        await writeFile(filePath, Buffer.from(buffer));
                    } catch (error) {
                        console.error("Failed to save document:", error);
                        return jsonResponse({ error: 1 });
                    }
                }
            }

            return jsonResponse({ error: 0 });
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
            const ext = extname(name).toLowerCase();
            if (!ALLOWED_EXTENSIONS.has(ext)) {
                throw new ApiError(400, "invalid_request", `Unsupported file type: ${ext || "unknown"}`);
            }

            const filePath = resolveDocumentPathSafe(docsDir, name);
            await writeFile(filePath, Buffer.from(await file.arrayBuffer()));

            return jsonResponse({ ok: true, name });
        },
    });
}
