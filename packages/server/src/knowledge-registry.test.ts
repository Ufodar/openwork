import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type KnowledgeRegistryRecordInput,
  KnowledgeRegistryService,
} from "./knowledge-registry.js";

const BASE_RECORD: KnowledgeRegistryRecordInput = {
  knowledgeId: "kb_1",
  ragflowDatasetId: "ds_1",
  ownerUserId: "user_1",
  ownerDisplayName: "alice",
  title: "招标知识库",
  description: "项目知识沉淀",
  source: "openwork",
  visibility: "visible_to_all_users",
  ingestionPreset: "general_document",
  chunkMethod: "naive",
  parserConfig: { chunk_token_num: 512 },
  embeddingModel: "bge-m3",
  status: "ready",
  documentCount: 1,
  chunkCount: 10,
};

describe("KnowledgeRegistryService", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "openwork-knowledge-registry-"));
    process.env.OPENWORK_DATA_DIR = root;
  });

  test("stores knowledge bases with owner metadata and stable ids", async () => {
    const registry = new KnowledgeRegistryService();

    const created = await registry.upsert(BASE_RECORD);

    expect(created.knowledgeId).toBe("kb_1");
    expect(created.ownerUserId).toBe("user_1");
    expect(created.ownerDisplayName).toBe("alice");

    const mine = await registry.listMine("user_1");
    expect(mine).toHaveLength(1);
    expect(mine[0]?.knowledgeId).toBe("kb_1");
  });

  test("separates mine and others across all registered users", async () => {
    const registry = new KnowledgeRegistryService();

    await registry.upsert(BASE_RECORD);
    await registry.upsert({
      ...BASE_RECORD,
      knowledgeId: "kb_2",
      ragflowDatasetId: "ds_2",
      ownerUserId: "user_2",
      ownerDisplayName: "bob",
      title: "法务知识库",
    });

    const mine = await registry.listMine("user_1");
    const others = await registry.listOthers("user_1");

    expect(mine.map((item) => item.knowledgeId)).toEqual(["kb_1"]);
    expect(others.map((item) => item.knowledgeId)).toEqual(["kb_2"]);
    expect(others[0]?.ownerDisplayName).toBe("bob");
  });

  test("persists records across service instances", async () => {
    const first = new KnowledgeRegistryService();
    await first.upsert(BASE_RECORD);

    const second = new KnowledgeRegistryService();
    const loaded = await second.get("kb_1");

    expect(loaded?.ragflowDatasetId).toBe("ds_1");
    expect(loaded?.title).toBe("招标知识库");
  });

  test("marks later writes as newer than earlier writes", async () => {
    const registry = new KnowledgeRegistryService();
    await registry.upsert(BASE_RECORD);
    await registry.upsert({
      ...BASE_RECORD,
      knowledgeId: "kb_2",
      ragflowDatasetId: "ds_2",
      title: "更新更晚的知识库",
    });

    const mine = await registry.listMine("user_1");

    expect(mine[0]?.knowledgeId).toBe("kb_2");
    expect(mine[1]?.knowledgeId).toBe("kb_1");
  });
});
