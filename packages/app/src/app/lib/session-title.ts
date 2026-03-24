export type SessionTitleLabels = {
  generated: string;
  untitled: string;
};

const GENERATED_SESSION_TITLE = /^New session(?:\s*-\s*\d{4}-\d{2}-\d{2}T.+)?$/i;
const UNTITLED_SESSION_TITLE = /^Untitled session$/i;

export function isGeneratedSessionTitle(title: string | null | undefined): boolean {
  const value = title?.trim() ?? "";
  if (!value) return false;
  return GENERATED_SESSION_TITLE.test(value);
}

export function formatSessionDisplayTitle(
  title: string | null | undefined,
  labels: SessionTitleLabels,
): string {
  const value = title?.trim() ?? "";
  if (!value) return labels.untitled;
  if (UNTITLED_SESSION_TITLE.test(value)) return labels.untitled;
  if (GENERATED_SESSION_TITLE.test(value)) return labels.generated;
  return value;
}
