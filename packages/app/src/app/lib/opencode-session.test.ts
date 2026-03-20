import { describe, expect, test } from "bun:test";

import { listCommands } from "./opencode-session";

describe("listCommands", () => {
  test("merges workspace commands for session runtime directories", async () => {
    const calls: Array<string | undefined> = [];
    const client = {
      command: {
        list: async ({ directory }: { directory?: string }) => {
          calls.push(directory);
          if (directory === "/root/ai_staff/openwork/documents/sessions/runtime-1") {
            return {
              data: [
                { name: "compact", description: "compact session", source: "command" },
              ],
            };
          }
          if (directory === "/root/ai_staff/openwork") {
            return {
              data: [
                { name: "doc-normalize", description: "normalize docs", source: "command" },
              ],
            };
          }
          return { data: [] };
        },
      },
    } as any;

    const items = await listCommands(client, "/root/ai_staff/openwork/documents/sessions/runtime-1");

    expect(calls).toEqual([
      "/root/ai_staff/openwork/documents/sessions/runtime-1",
      "/root/ai_staff/openwork",
    ]);
    expect(items.map((item) => item.name)).toEqual(["compact", "doc-normalize"]);
  });

  test("keeps nearer command definitions when workspace and runtime share a name", async () => {
    const client = {
      command: {
        list: async ({ directory }: { directory?: string }) => {
          if (directory === "/root/ai_staff/openwork/documents/sessions/runtime-1") {
            return {
              data: [
                { name: "doc-normalize", description: "runtime", source: "command" },
              ],
            };
          }
          if (directory === "/root/ai_staff/openwork") {
            return {
              data: [
                { name: "doc-normalize", description: "workspace", source: "command" },
                { name: "document-normalize", description: "alias", source: "command" },
              ],
            };
          }
          return { data: [] };
        },
      },
    } as any;

    const items = await listCommands(client, "/root/ai_staff/openwork/documents/sessions/runtime-1");

    expect(items).toEqual([
      {
        id: "cmd:doc-normalize",
        name: "doc-normalize",
        description: "runtime",
        source: "command",
      },
      {
        id: "cmd:document-normalize",
        name: "document-normalize",
        description: "alias",
        source: "command",
      },
    ]);
  });
});
