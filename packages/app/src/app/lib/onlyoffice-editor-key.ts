type OnlyOfficePayloadLike = {
  documentServerUrl?: string | null;
  config?: {
    document?: {
      key?: string | null;
      url?: string | null;
      title?: string | null;
    } | null;
    editorConfig?: {
      mode?: string | null;
    } | null;
  } | null;
} | null | undefined;

type OnlyOfficeSourceLike = {
  doc?: string | null;
  readonly?: boolean | null;
} | null | undefined;

export function resolveOnlyOfficeEditorKey(payload: OnlyOfficePayloadLike): string {
  if (!payload) return "";

  const key = payload.config?.document?.key?.trim() ?? "";
  const url = payload.config?.document?.url?.trim() ?? "";
  const title = payload.config?.document?.title?.trim() ?? "";
  const mode = payload.config?.editorConfig?.mode?.trim() ?? "";
  const documentServerUrl = payload.documentServerUrl?.trim().replace(/\/+$/, "") ?? "";

  return [documentServerUrl, key, url, title, mode].filter(Boolean).join("|");
}

function hashEditorKey(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function resolveOnlyOfficeContainerId(
  prefix: string,
  sessionId: string,
  editorKey: string | null | undefined,
): string {
  const safePrefix = prefix.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "onlyoffice";
  const safeSessionId =
    sessionId.trim().replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "session";
  const digest = hashEditorKey(editorKey?.trim() || "empty");
  return `${safePrefix}-${safeSessionId}-${digest}`;
}

export function resolveCurrentOnlyOfficePayload(
  payload: OnlyOfficePayloadLike,
  source: OnlyOfficeSourceLike,
): OnlyOfficePayloadLike {
  if (!payload || !source) return null;

  const expectedDoc = source.doc?.trim() ?? "";
  const payloadDoc = payload.config?.document?.title?.trim() ?? "";
  if (!expectedDoc || payloadDoc !== expectedDoc) return null;

  const expectedMode = source.readonly ? "view" : "edit";
  const payloadMode = payload.config?.editorConfig?.mode?.trim() ?? "";
  if (payloadMode && payloadMode !== expectedMode) return null;

  return payload;
}
