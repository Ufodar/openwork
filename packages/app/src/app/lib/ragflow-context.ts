import type { OpenworkKnowledgeSearchItem, OpenworkRagflowChunk } from "./openwork-server";

export type RagflowContextSelection = {
  datasetIds: string[];
  datasetNames?: string[];
};

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const clampText = (value: string, maxChars: number) => {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
};

export const buildRagflowContextText = (input: {
  selection: RagflowContextSelection;
  chunks: OpenworkRagflowChunk[];
  question: string;
  maxChunks?: number;
  maxCharsPerChunk?: number;
}): string | null => {
  const datasetLabels = (input.selection.datasetNames ?? [])
    .map((value) => normalizeWhitespace(value))
    .filter(Boolean);
  const chunkLimit = Math.max(1, Math.min(12, input.maxChunks ?? 6));
  const chunkChars = Math.max(200, Math.min(3000, input.maxCharsPerChunk ?? 1200));
  const chunks = input.chunks
    .map((chunk) => ({
      ...chunk,
      content: clampText(normalizeWhitespace(chunk.content), chunkChars),
      datasetName: chunk.datasetName ? normalizeWhitespace(chunk.datasetName) : null,
      documentName: chunk.documentName ? normalizeWhitespace(chunk.documentName) : null,
    }))
    .filter((chunk) => chunk.content)
    .slice(0, chunkLimit);

  if (!chunks.length && !datasetLabels.length) return null;

  const header = [
    "Knowledge base context (RAGFlow, auto-attached for this session).",
    "Treat these passages as the primary grounded source when they are relevant.",
    "If the context is insufficient or irrelevant, say so explicitly instead of inventing facts.",
  ];

  if (datasetLabels.length) {
    header.push(`Selected datasets: ${datasetLabels.join(", ")}`);
  }
  if (input.question.trim()) {
    header.push(`Search query: ${normalizeWhitespace(input.question)}`);
  }

  if (!chunks.length) {
    header.push("No matching passages were retrieved from the selected datasets for this query.");
    return header.join("\n");
  }

  const body = chunks.map((chunk, index) => {
    const labels = [
      chunk.datasetName ? `dataset=${chunk.datasetName}` : null,
      chunk.documentName ? `document=${chunk.documentName}` : null,
      typeof chunk.similarity === "number" ? `score=${chunk.similarity.toFixed(2)}` : null,
    ].filter(Boolean);
    return `[${index + 1}] ${labels.join(" | ")}\n${chunk.content}`.trim();
  });

  return [...header, "", ...body].join("\n");
};

export const buildKnowledgeSearchContextText = (input: {
  knowledgeIds: string[];
  knowledgeTitles?: string[];
  items: OpenworkKnowledgeSearchItem[];
  question: string;
}): string | null =>
  buildRagflowContextText({
    selection: {
      datasetIds: input.knowledgeIds,
      datasetNames: input.knowledgeTitles,
    },
    question: input.question,
    chunks: input.items.map((item) => ({
      id: item.id,
      content: item.content,
      datasetId: item.datasetId,
      datasetName: item.knowledgeTitle,
      documentId: item.documentId,
      documentName: item.documentName,
      similarity: item.similarity,
      vectorSimilarity: item.vectorSimilarity,
      termSimilarity: item.termSimilarity,
      positions:
        Array.isArray(item.positions) && item.positions.every((value) => typeof value === "number")
          ? item.positions
          : null,
      imageId: item.imageId,
    })),
  });
