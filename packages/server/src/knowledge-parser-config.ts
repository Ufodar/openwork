function objectValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function buildDefaultKnowledgeParserConfig(): Record<string, unknown> {
  return {
    chunk_token_num: 2000,
    delimiter: "\n",
    layout_recognize: "DeepDOC",
    html4excel: false,
    raptor: { use_raptor: false },
  };
}

export function normalizeKnowledgeLayoutRecognize(value: unknown): string | undefined {
  if (typeof value === "boolean") {
    return value ? "DeepDOC" : "Plain Text";
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.toLowerCase();
  if (["true", "1", "yes", "on", "deepdoc"].includes(normalized)) {
    return "DeepDOC";
  }
  if (["false", "0", "no", "off", "plaintext", "plain text"].includes(normalized)) {
    return "Plain Text";
  }
  return trimmed;
}

export function sanitizeKnowledgeParserConfig(value: unknown): Record<string, unknown> {
  const object = objectValue(value);
  if (!object) return {};
  const parserConfig = { ...object };
  const normalizedLayoutRecognize = normalizeKnowledgeLayoutRecognize(parserConfig.layout_recognize);
  if (normalizedLayoutRecognize) {
    parserConfig.layout_recognize = normalizedLayoutRecognize;
  }
  return parserConfig;
}
