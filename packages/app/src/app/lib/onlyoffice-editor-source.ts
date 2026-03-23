export type OnlyOfficeEditorSourceLike = {
  baseUrl?: string | null;
  token?: string | null;
  workspaceId?: string | null;
  sessionId?: string | null;
  doc?: string | null;
  seq?: number | null;
  readonly?: boolean | null;
} | null | undefined;

export function equalOnlyOfficeEditorSource(
  previous: OnlyOfficeEditorSourceLike,
  next: OnlyOfficeEditorSourceLike,
) {
  if (previous === next) return true;
  if (!previous || !next) return previous === next;

  return (
    (previous.baseUrl ?? "").trim() === (next.baseUrl ?? "").trim() &&
    (previous.token ?? "").trim() === (next.token ?? "").trim() &&
    (previous.workspaceId ?? "").trim() === (next.workspaceId ?? "").trim() &&
    (previous.sessionId ?? "").trim() === (next.sessionId ?? "").trim() &&
    (previous.doc ?? "").trim() === (next.doc ?? "").trim() &&
    (previous.seq ?? 0) === (next.seq ?? 0) &&
    Boolean(previous.readonly) === Boolean(next.readonly)
  );
}
