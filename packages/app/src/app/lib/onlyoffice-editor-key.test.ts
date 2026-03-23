import { describe, expect, test } from "bun:test";

import {
  resolveCurrentOnlyOfficePayload,
  resolveOnlyOfficeContainerId,
  resolveOnlyOfficeEditorKey,
} from "./onlyoffice-editor-key";

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

  test("builds a safe container id from an unsafe editor key", () => {
    const containerId = resolveOnlyOfficeContainerId(
      "document-agent",
      "ses_2f6026fd7ffe1yFv62BcL9G2aJ",
      "http://192.168.5.10:32764|key-1|http://192.168.5.10:32765/openwork/w/user/doc?x=1&y=2|第三章_总体架构_优化版.docx|edit",
    );

    expect(containerId).toStartWith("document-agent-ses_2f6026fd7ffe1yFv62BcL9G2aJ-");
    expect(containerId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(containerId).not.toContain("http://");
    expect(containerId).not.toContain("第三章");
  });

  test("returns null while a stale payload still points at the previous doc", () => {
    const payload = resolveCurrentOnlyOfficePayload(
      {
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
      },
      { doc: "b.docx", readonly: false },
    );

    expect(payload).toBeNull();
  });

  test("accepts the payload once the doc and mode match the current source", () => {
    const payload = resolveCurrentOnlyOfficePayload(
      {
        documentServerUrl: "http://docs.example.com/",
        config: {
          document: {
            key: "doc-b",
            url: "http://app.example.com/file?b",
            title: "b.docx",
          },
          editorConfig: {
            mode: "view",
          },
        },
      },
      { doc: "b.docx", readonly: true },
    );

    expect(payload?.config?.document?.title).toBe("b.docx");
  });
});
