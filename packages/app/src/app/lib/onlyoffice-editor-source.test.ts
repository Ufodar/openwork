import { describe, expect, test } from "bun:test";

import { equalOnlyOfficeEditorSource } from "./onlyoffice-editor-source";

describe("equalOnlyOfficeEditorSource", () => {
  test("treats the same doc/session/config tuple as stable", () => {
    expect(
      equalOnlyOfficeEditorSource(
        {
          baseUrl: "http://192.168.5.10:32765",
          token: "same-token",
          workspaceId: "user-a",
          sessionId: "ses_123",
          doc: "第三章_总体架构_优化版.docx",
          seq: 2,
          readonly: false,
        },
        {
          baseUrl: "http://192.168.5.10:32765",
          token: "same-token",
          workspaceId: "user-a",
          sessionId: "ses_123",
          doc: "第三章_总体架构_优化版.docx",
          seq: 2,
          readonly: false,
        },
      ),
    ).toBe(true);
  });

  test("invalidates the source when the active doc changes", () => {
    expect(
      equalOnlyOfficeEditorSource(
        {
          baseUrl: "http://192.168.5.10:32765",
          token: "same-token",
          workspaceId: "user-a",
          sessionId: "ses_123",
          doc: "第三章_总体架构_优化版.docx",
          seq: 2,
          readonly: false,
        },
        {
          baseUrl: "http://192.168.5.10:32765",
          token: "same-token",
          workspaceId: "user-a",
          sessionId: "ses_123",
          doc: "第四章_实施方案.docx",
          seq: 2,
          readonly: false,
        },
      ),
    ).toBe(false);
  });

  test("invalidates the source when readonly mode flips", () => {
    expect(
      equalOnlyOfficeEditorSource(
        {
          baseUrl: "http://192.168.5.10:32765",
          token: "same-token",
          workspaceId: "user-a",
          sessionId: "ses_123",
          doc: "第三章_总体架构_优化版.docx",
          seq: 2,
          readonly: false,
        },
        {
          baseUrl: "http://192.168.5.10:32765",
          token: "same-token",
          workspaceId: "user-a",
          sessionId: "ses_123",
          doc: "第三章_总体架构_优化版.docx",
          seq: 2,
          readonly: true,
        },
      ),
    ).toBe(false);
  });
});
