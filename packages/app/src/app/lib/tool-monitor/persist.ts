export type ToolMonitorPersistResult = {
  ok: boolean;
  path: string;
  error?: string;
};

const normalizeRelativePath = (value: string) => value.replace(/\\/g, "/").replace(/^\/+/, "").trim();

export function buildWorkspaceUrl(baseUrl: string, workspaceId: string, pathname: string, query?: URLSearchParams) {
  const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = `${basePath}/w/${encodeURIComponent(workspaceId)}${normalizedPath}`.replace(/\/{2,}/g, "/");
  parsed.search = query ? query.toString() : "";
  return parsed.toString();
}

const parseErrorMessage = async (response: Response) => {
  const fallback = `HTTP ${response.status}`;
  try {
    const text = await response.text();
    if (!text.trim()) return fallback;
    return text.length > 900 ? `${text.slice(0, 897)}...` : text;
  } catch {
    return fallback;
  }
};

export async function uploadSessionMarkdownReport(input: {
  baseUrl: string;
  token: string;
  workspaceId: string;
  sessionId: string;
  path: string;
  content: string;
  timeoutMs?: number;
}): Promise<ToolMonitorPersistResult> {
  const baseUrl = input.baseUrl.trim();
  const workspaceId = input.workspaceId.trim();
  const sessionId = input.sessionId.trim();
  const token = input.token.trim();
  const relPath = normalizeRelativePath(input.path);
  const content = input.content ?? "";

  if (!baseUrl || !workspaceId || !sessionId) {
    return { ok: false, path: relPath, error: "Missing baseUrl/workspaceId/sessionId." };
  }
  if (!relPath.toLowerCase().endsWith(".md")) {
    return { ok: false, path: relPath, error: "Tool monitor report must be a .md file." };
  }

  const query = new URLSearchParams();
  query.set("session", sessionId);
  const url = buildWorkspaceUrl(baseUrl, workspaceId, "/document/upload", query);

  const filename = relPath.split("/").pop() || "tool-monitor.md";
  const file = new File([content], filename, { type: "text/markdown" });
  const form = new FormData();
  form.append("file", file);
  form.append("path", relPath);

  const headers = new Headers();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutMs = Number.isFinite(input.timeoutMs) && (input.timeoutMs ?? 0) > 0 ? (input.timeoutMs as number) : 12_000;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, { method: "POST", headers, body: form, ...(controller ? { signal: controller.signal } : {}) });
    if (!response.ok) {
      return { ok: false, path: relPath, error: await parseErrorMessage(response) };
    }
    return { ok: true, path: relPath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed.";
    return { ok: false, path: relPath, error: message };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

