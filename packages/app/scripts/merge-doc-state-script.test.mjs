import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "./.opencode/runtime-support/document-state/merge_doc_state.py";

test("merge_doc_state.py drops payment and UML noise for explicit multi-system solution goals", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-merge-multi-system-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "index.json"),
      JSON.stringify({
        summary: "请基于两篇资料撰写多系统建设方案。",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "请基于当前资料形成建设方案，围绕统一资源接入系统、智能调度协同系统、运行监测与审计系统展开，并给出 API 调用示例。",
        target_doc: "outputs/多系统建设方案.docx",
        sources: [
          { docId: "src-001", title: "融合算力云平台白皮书", role: "产品白皮书", relativePath: "融合算力云平台白皮书.docx" },
          { docId: "src-002", title: "天河监控运维一体化平台软件介绍v0.3", role: "产品介绍", relativePath: "天河监控运维一体化平台软件介绍v0.3.docx" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "src-001.json"),
      JSON.stringify({
        docId: "src-001",
        title: "融合算力云平台白皮书",
        role: "产品白皮书",
        relativePath: "融合算力云平台白皮书.docx",
        summary: "白皮书介绍融合算力云平台的资源纳管、统一接口和调度能力。",
        section_briefs: [
          {
            title: "平台物理架构",
            locator: "paragraph:10",
            summary: "平台采用控制中心与算力中心协同架构，支持跨中心资源统一纳管。",
            key_points: [
              {
                statement: "控制中心负责统一门户、认证与资源总览，算力中心负责纳管超算、智算和裸金属资源。",
                locator: "paragraph:12",
              },
            ],
          },
          {
            title: "资源付费机制",
            locator: "paragraph:80",
            summary: "介绍预付费、后付费和充值券规则。",
            key_points: [
              {
                statement: "平台支持充值券与扫码支付抵扣。",
                locator: "paragraph:88",
              },
            ],
          },
        ],
        facts: [
          {
            statement: "平台支持 K8S、虚拟机、裸金属和 GPU 统一纳管，实现跨中心异构资源池化。",
            locator: "paragraph:12",
            evidence: "平台支持 K8S、虚拟机、裸金属和 GPU 统一纳管，实现跨中心异构资源池化。",
          },
          {
            statement: "例如，若某张充值券规定最低充值额为50元人民币，那么用户扫码支付后可抵扣20元。",
            locator: "paragraph:88",
            evidence: "例如，若某张充值券规定最低充值额为50元人民币，那么用户扫码支付后可抵扣20元。",
          },
          {
            statement: "@startuml actor 用户 participant \"融合算力云平台\" as 平台 用户 -> 平台: 打开充值页面 @enduml",
            locator: "paragraph:90",
            evidence: "@startuml actor 用户 participant \"融合算力云平台\" as 平台 用户 -> 平台: 打开充值页面 @enduml",
          },
        ],
        claims: [],
        gaps: [],
        open_questions: [],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "src-002.json"),
      JSON.stringify({
        docId: "src-002",
        title: "天河监控运维一体化平台软件介绍v0.3",
        role: "产品介绍",
        relativePath: "天河监控运维一体化平台软件介绍v0.3.docx",
        summary: "产品介绍文档覆盖监控、告警、认证与接口能力。",
        section_briefs: [
          {
            title: "技术架构",
            locator: "paragraph:31",
            summary: "技术架构采用展示层、业务层、中间层、通信层、目标层分层设计。",
            key_points: [
              {
                statement: "业务层采用 RESTful API 和 gRPC 对外提供能力，可通过多云网关和统一门户接入。",
                locator: "paragraph:31",
              },
            ],
          },
        ],
        facts: [
          {
            statement: "业务层采用 RESTful API 和 gRPC 对外提供能力，可通过多云网关和统一门户接入。",
            locator: "paragraph:31",
            evidence: "业务层采用 RESTful API 和 gRPC 对外提供能力，可通过多云网关和统一门户接入。",
          },
          {
            statement: "平台提供统一认证、RBAC、审计日志、异常任务识别和资源滥用告警能力，满足等保三级要求。",
            locator: "paragraph:52",
            evidence: "平台提供统一认证、RBAC、审计日志、异常任务识别和资源滥用告警能力，满足等保三级要求。",
          },
        ],
        claims: [],
        gaps: [],
        open_questions: ["最新政策条文需要联网核对。"],
      }, null, 2),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal",
      "请基于当前资料形成建设方案，围绕统一资源接入系统、智能调度协同系统、运行监测与审计系统展开，并给出 API 调用示例。",
      "--target-doc", "outputs/多系统建设方案.docx",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const facts = JSON.parse(await readFile(join(workspace, ".worktree", "facts.json"), "utf8"));
    const evidenceStatements = facts.evidence_index.map((item) => item.statement);
    const canonicalStatements = facts.canonical_facts.map((item) => item.statement);
    const sourceBrief = facts.source_briefs.find((item) => item.docId === "src-001");

    expect(canonicalStatements).toContain("平台支持 K8S、虚拟机、裸金属和 GPU 统一纳管，实现跨中心异构资源池化。");
    expect(canonicalStatements).toContain("业务层采用 RESTful API 和 gRPC 对外提供能力，可通过多云网关和统一门户接入。");
    expect(canonicalStatements).not.toContain("例如，若某张充值券规定最低充值额为50元人民币，那么用户扫码支付后可抵扣20元。");
    expect(canonicalStatements.some((item) => item.includes("@startuml"))).toBe(false);
    expect(evidenceStatements).not.toContain("例如，若某张充值券规定最低充值额为50元人民币，那么用户扫码支付后可抵扣20元。");
    expect(sourceBrief?.sections.map((item) => item.title)).toContain("平台物理架构");
    expect(sourceBrief?.sections.map((item) => item.title)).not.toContain("资源付费机制");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("merge_doc_state.py uses generic topic labels for specialized technical facts instead of sample-specific names", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-merge-generic-topics-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "index.json"),
      JSON.stringify({
        summary: "请基于资料撰写一份通用技术方案。",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "请基于当前资料形成一份通用技术方案，重点说明兼容性约束、算力能力与部署条件。",
        target_doc: "outputs/generic-technical-plan.docx",
        sources: [
          { docId: "src-001", title: "技术规格说明", role: "规格说明", relativePath: "技术规格说明.docx" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "src-001.json"),
      JSON.stringify({
        docId: "src-001",
        title: "技术规格说明",
        role: "规格说明",
        relativePath: "技术规格说明.docx",
        summary: "规格说明覆盖兼容性、计算能力和机房部署约束。",
        section_briefs: [
          {
            title: "兼容性要求",
            locator: "paragraph:10",
            summary: "方案需兼容信创环境并适配国产化基础软件。",
            key_points: [
              {
                statement: "方案需兼容信创环境部署并适配国产化基础软件。",
                locator: "paragraph:10",
              },
            ],
          },
          {
            title: "计算能力",
            locator: "paragraph:20",
            summary: "平台需支持 FP64 科学计算与 FP16 混合精度能力。",
            key_points: [
              {
                statement: "平台需支持 FP64 科学计算与 FP16 混合精度能力。",
                locator: "paragraph:20",
              },
            ],
          },
          {
            title: "机房条件",
            locator: "paragraph:30",
            summary: "机房采用液冷机柜设计，单柜功率可达40kW。",
            key_points: [
              {
                statement: "机房采用液冷机柜设计，单柜功率可达40kW。",
                locator: "paragraph:30",
              },
            ],
          },
        ],
        facts: [
          {
            statement: "方案需兼容信创环境部署并适配国产化基础软件。",
            locator: "paragraph:10",
            evidence: "方案需兼容信创环境部署并适配国产化基础软件。",
          },
          {
            statement: "平台需支持 FP64 科学计算与 FP16 混合精度能力。",
            locator: "paragraph:20",
            evidence: "平台需支持 FP64 科学计算与 FP16 混合精度能力。",
          },
          {
            statement: "机房采用液冷机柜设计，单柜功率可达40kW。",
            locator: "paragraph:30",
            evidence: "机房采用液冷机柜设计，单柜功率可达40kW。",
          },
        ],
        claims: [],
        gaps: [],
        open_questions: [],
      }, null, 2),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal",
      "请基于当前资料形成一份通用技术方案，重点说明兼容性约束、算力能力与部署条件。",
      "--target-doc", "outputs/generic-technical-plan.docx",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const facts = JSON.parse(await readFile(join(workspace, ".worktree", "facts.json"), "utf8"));
    const topics = facts.canonical_facts.map((item) => item.topic);

    expect(topics).toContain("compatibility-requirements");
    expect(topics).toContain("compute-capability");
    expect(topics).toContain("facility-design");
    expect(topics).not.toContain("fp64-capability");
    expect(topics).not.toContain("fp16-capability");
    expect(topics).not.toContain("xinchuang-cloud");
    expect(topics).not.toContain("hpc");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
