import { describe, expect, test } from "bun:test";

import {
  buildSessionPreferenceHint,
  mergeOpenworkSessionPrefs,
  resolveSessionPreferences,
  resolveStoredRagflowSelection,
} from "./session-preferences";

describe("mergeOpenworkSessionPrefs", () => {
  test("preserves local-only session prefs when the remote config is missing them", () => {
    expect(
      mergeOpenworkSessionPrefs(
        {
          ses_local: {
            view: "document-agent",
            agent: "common-work",
            agentLock: "common-work",
          },
        },
        {},
      ),
    ).toEqual({
      ses_local: {
        view: "document-agent",
        agent: "common-work",
        agentLock: "common-work",
      },
    });
  });

  test("keeps remote entries authoritative when the same session exists on both sides", () => {
    expect(
      mergeOpenworkSessionPrefs(
        {
          ses_same: {
            view: "document-agent",
            agent: "common-work",
            agentLock: "common-work",
          },
        },
        {
          ses_same: {
            view: "document-writer",
            agent: "document-writer",
            agentLock: "document-writer",
          },
        },
      ),
    ).toEqual({
      ses_same: {
        view: "document-writer",
        agent: "document-writer",
        agentLock: "document-writer",
      },
    });
  });
});

describe("resolveSessionPreferences", () => {
  test("builds a session-list hint from hosted preferred view metadata", () => {
    expect(
      buildSessionPreferenceHint({
        openworkPreferredView: "document-agent",
        openworkPreferredAgent: "common-work",
        openworkPreferredAgentLock: "common-work",
      }),
    ).toEqual({
      view: "document-agent",
      agent: "common-work",
      agentLock: "common-work",
    });
  });

  test("returns null when a session list item has no preferred view metadata", () => {
    expect(
      buildSessionPreferenceHint({
        openworkPreferredView: null,
        openworkPreferredAgent: null,
        openworkPreferredAgentLock: null,
      }),
    ).toBeNull();
  });

  test("uses session-list hints when stored prefs are missing", () => {
    const resolved = resolveSessionPreferences({
      hint: {
        view: "document-agent",
        agent: "common-work",
        agentLock: "common-work",
      },
      title: "Generated title",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "stored" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "stored" });
  });

  test("keeps explicit stored prefs authoritative over session-list hints", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "document-writer",
        agent: "document-writer",
        agentLock: "document-writer",
      },
      hint: {
        view: "document-agent",
        agent: "common-work",
        agentLock: "common-work",
      },
      title: "Generated title",
    });

    expect(resolved.view).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agent).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "stored" });
  });

  test("lets a document-session hint override stale stored session view state", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "session",
      },
      hint: {
        view: "document-agent",
        agent: "common-work",
        agentLock: "common-work",
      },
      title: "历史会话 ses_2cf999cb",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "stored" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "stored" });
  });

  test("preserves a stored document-writer view instead of collapsing it to document-agent", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "document-writer",
        agent: "document-writer",
        agentLock: "document-writer",
      },
      title: "标书写作助手",
    });

    expect(resolved.view).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agent).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "stored" });
  });

  test("maps 标书写作助手 legacy titles to the document-writer view and lock", () => {
    const resolved = resolveSessionPreferences({
      title: "标书写作助手",
    });

    expect(resolved.view).toEqual({ value: "document-writer", source: "legacy" });
    expect(resolved.agent).toEqual({ value: "document-writer", source: "legacy" });
    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "legacy" });
  });

  test("keeps 文档智能体 mapped to document-agent and common-work", () => {
    const resolved = resolveSessionPreferences({
      title: "文档智能体",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "legacy" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "legacy" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "legacy" });
  });

  test("defaults stored document-agent sessions without explicit agent back to common-work", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "document-agent",
      },
      title: "New session - 2026-03-18T00:00:00.000Z",
    });

    expect(resolved.view).toEqual({ value: "document-agent", source: "stored" });
    expect(resolved.agent).toEqual({ value: "common-work", source: "default" });
    expect(resolved.agentLock).toEqual({ value: "common-work", source: "default" });
  });

  test("defaults stored document-writer sessions without explicit agent to document-writer", () => {
    const resolved = resolveSessionPreferences({
      stored: {
        view: "document-writer",
      },
      title: "New session - 2026-03-18T00:00:00.000Z",
    });

    expect(resolved.view).toEqual({ value: "document-writer", source: "stored" });
    expect(resolved.agent).toEqual({ value: "document-writer", source: "default" });
    expect(resolved.agentLock).toEqual({ value: "document-writer", source: "default" });
  });

  test("normalizes stored ragflow dataset selection", () => {
    expect(
      resolveStoredRagflowSelection({
        ragflowDatasetIds: [" ds_1 ", "ds_2", "ds_1", ""],
        ragflowDatasetNames: [" Product Docs ", "", "Policies"],
        ragflowTopK: 8,
      }),
    ).toEqual({
      datasetIds: ["ds_1", "ds_2"],
      datasetNames: ["Product Docs", "Policies"],
      topK: 8,
    });
  });

  test("drops ragflow selection when no dataset ids remain", () => {
    expect(
      resolveStoredRagflowSelection({
        ragflowDatasetIds: ["", "   "],
        ragflowDatasetNames: ["Anything"],
      }),
    ).toBeNull();
  });
});
