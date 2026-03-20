import { describe, expect, test } from "bun:test";

import { resolveOnlyOfficeEditorKey } from "./onlyoffice-editor-key";

describe("resolveOnlyOfficeEditorKey", () => {
  test("changes when the active doc changes", () => {
    const a = resolveOnlyOfficeEditorKey({
      documentServerUrl: "http://docs.example.com/",
      config: {
        document: {
          key: "doc-a",
          url: "http://app.example.com/file?a",
          title: "a.docx",
        },
        editorConfig: {
          mode: "edit",
        },
      },
    });
    const b = resolveOnlyOfficeEditorKey({
      documentServerUrl: "http://docs.example.com/",
      config: {
        document: {
          key: "doc-b",
          url: "http://app.example.com/file?b",
          title: "b.docx",
        },
        editorConfig: {
          mode: "edit",
        },
      },
    });

    expect(a).not.toBe("");
    expect(b).not.toBe("");
    expect(a).not.toBe(b);
  });

  test("changes when mode flips between view and edit", () => {
    const view = resolveOnlyOfficeEditorKey({
      documentServerUrl: "http://docs.example.com/",
      config: {
        document: {
          key: "same-doc",
          url: "http://app.example.com/file",
          title: "same.docx",
        },
        editorConfig: {
          mode: "view",
        },
      },
    });
    const edit = resolveOnlyOfficeEditorKey({
      documentServerUrl: "http://docs.example.com/",
      config: {
        document: {
          key: "same-doc",
          url: "http://app.example.com/file",
          title: "same.docx",
        },
        editorConfig: {
          mode: "edit",
        },
      },
    });

    expect(view).not.toBe(edit);
  });
});
