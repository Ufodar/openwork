import { describe, expect, test } from "bun:test";

import { renderMarkdownPreview } from "./markdown-preview";

describe("renderMarkdownPreview", () => {
  test("renders headings and lists into html", () => {
    const html = renderMarkdownPreview("# Title\n\n- one\n- two");

    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<li>two</li>");
  });
});
