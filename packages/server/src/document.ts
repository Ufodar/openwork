import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, resolve, relative, basename, extname, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import type { ServerConfig, WorkspaceInfo, Actor } from "./types.js";
import { ApiError } from "./errors.js";
import { ensureDir, exists, shortId } from "./utils.js";

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
