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

export function resolveOnlyOfficeEditorKey(payload: OnlyOfficePayloadLike): string {
  if (!payload) return "";

  const key = payload.config?.document?.key?.trim() ?? "";
  const url = payload.config?.document?.url?.trim() ?? "";
  const title = payload.config?.document?.title?.trim() ?? "";
  const mode = payload.config?.editorConfig?.mode?.trim() ?? "";
  const documentServerUrl = payload.documentServerUrl?.trim().replace(/\/+$/, "") ?? "";

  return [documentServerUrl, key, url, title, mode].filter(Boolean).join("|");
}
