import { marked } from "marked";

export const MARKDOWN_PREVIEW_CLASS = `
  markdown-content max-w-none text-dls-text
  [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-4
  [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-3
  [&_h3]:text-lg [&_h3]:font-bold [&_h3]:my-2
  [&_p]:my-3 [&_p]:leading-relaxed
  [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:my-3
  [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:my-3
  [&_li]:my-1
  [&_blockquote]:border-l-4 [&_blockquote]:border-dls-border [&_blockquote]:pl-4 [&_blockquote]:my-4 [&_blockquote]:italic
  [&_table]:w-full [&_table]:border-collapse [&_table]:my-4
  [&_th]:border [&_th]:border-dls-border [&_th]:p-2 [&_th]:bg-dls-hover
  [&_td]:border [&_td]:border-dls-border [&_td]:p-2
  [&_code]:font-mono [&_code]:text-[0.95em]
  [&_pre]:overflow-auto [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-dls-border [&_pre]:bg-dls-sidebar [&_pre]:p-3
`.trim();

export function renderMarkdownPreview(source: string): string | null {
  const text = String(source ?? "");
  if (!text.trim()) return "";

  try {
    const result = marked.parse(text, {
      breaks: true,
      gfm: true,
      async: false,
    });
    return typeof result === "string" ? result : "";
  } catch {
    return null;
  }
}
