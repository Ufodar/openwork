import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "./.opencode/runtime-support/document-state/plan_doc_state.py";

test("plan_doc_state.py generates system-material sections and filters noisy evidence for proposal-style goals", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-qin-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });

    await writeFile(
      join(workspace, ".worktree", "index.json"),
      JSON.stringify({
        summary: "Uploaded source documents. Bootstrap state is ready.",
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "Compile uploaded source documents into structured state",
        target_doc: null,
        sources: [
          { title: "融合算力云平台白皮书" },
          { title: "天河监控运维一体化平台软件介绍v0.3" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        source_briefs: [
          {
            docId: "src-001",
            title: "融合算力云平台白皮书",
            relativePath: "融合算力云平台白皮书.docx",
            sections: [
              {
                title: "平台物理架构",
                topic: "resource-aggregation",
                summary: "控制中心和算力中心协同纳管超算、智算和裸金属资源。",
              },
              {
                title: "平台技术架构",
                topic: "api-interoperability",
                summary: "服务层提供标准化接口，支持 API 与网关接入。",
              },
            ],
          },
          {
            docId: "src-002",
            title: "天河监控运维一体化平台软件介绍v0.3",
            relativePath: "天河监控运维一体化平台软件介绍v0.3.docx",
            sections: [
              {
                title: "技术架构",
                topic: "security-monitoring",
                summary: "展示层、业务层、中间层、通信层、目标层协同实现监控与告警。",
              },
            ],
          },
        ],
        goal: "Compile uploaded source documents into structured state",
        canonical_facts: [
          {
            topic: "resource-aggregation",
            statement: "平台支持 K8S、虚拟机、裸金属和 GPU 统一纳管，实现跨中心异构资源池化。",
            sources: [{ title: "融合算力云平台白皮书" }],
          },
          {
            topic: "scheduling",
            statement: "系统融合实时网络时延、带宽和丢包率，结合 TPM/RPM 指标实现任务-资源-路径联合调度。",
            sources: [{ title: "融合算力云平台白皮书" }],
          },
          {
            topic: "security-monitoring",
            statement: "平台提供统一认证、RBAC、审计日志、异常任务识别和资源滥用告警能力，满足等保三级要求。",
            sources: [{ title: "天河监控运维一体化平台软件介绍v0.3" }],
          },
          {
            topic: "api-interoperability",
            statement: "业务层采用 RESTful API 和 gRPC 对外提供能力，可通过多云网关和统一门户接入。",
            sources: [{ title: "天河监控运维一体化平台软件介绍v0.3" }],
          },
          {
            topic: "general",
            statement: "@startuml actor 用户 participant \"平台网关\" as 网关 用户 -> 网关: 打开页面 @enduml",
            sources: [{ title: "融合算力云平台白皮书" }],
          },
          {
            topic: "general",
            statement: "例如，若某张充值券规定最低充值额为50元人民币，那么用户扫码支付后可抵扣20元。",
            sources: [{ title: "融合算力云平台白皮书" }],
          },
        ],
        gaps: [],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "merge", "conflicts.json"),
      JSON.stringify({
        conflicts: [],
        open_questions: ["最新政策条文需要联网核对。"],
      }, null, 2),
      "utf8",
    );

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal",
      "请你结合参考两篇文档以及查找网络中的一些资料，帮我写一份项目申报所需要的技术材料，围绕算力资源汇聚系统、算力选择与调度系统、算力运行安全监测系统三部分展开，并给出 API 调用示例。",
      "--target-doc", "outputs/qin-technical-material.md",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const plan = JSON.parse(await readFile(join(workspace, ".worktree", "plan", "solution-plan.json"), "utf8"));
    const coverage = JSON.parse(await readFile(join(workspace, ".worktree", "coverage.json"), "utf8"));

    expect(plan.goal).toContain("技术材料");
    expect(plan.target_doc).toBe("outputs/qin-technical-material.md");
    expect(plan.sections.map((item) => item.title)).toEqual([
      "算力资源汇聚系统",
      "算力选择与调度系统",
      "算力运行安全监测系统",
      "参考与依据",
    ]);
    expect(coverage.targets.map((item) => item.title)).toEqual([
      "算力资源汇聚系统",
      "算力选择与调度系统",
      "算力运行安全监测系统",
      "参考与依据",
    ]);
    expect(coverage.targets[0].required_subsections).toEqual([
      "功能定位",
      "技术架构",
      "技术路线",
      "互联互通机制",
      "标识系统构建",
      "API调用示例",
    ]);
    expect(plan.sections[0].required_evidence.map((item) => item.statement)).toContain(
      "平台支持 K8S、虚拟机、裸金属和 GPU 统一纳管，实现跨中心异构资源池化。",
    );
    expect(plan.sections[1].required_evidence.map((item) => item.statement)).toContain(
      "系统融合实时网络时延、带宽和丢包率，结合 TPM/RPM 指标实现任务-资源-路径联合调度。",
    );
    expect(plan.sections[2].required_evidence.map((item) => item.statement)).toContain(
      "平台提供统一认证、RBAC、审计日志、异常任务识别和资源滥用告警能力，满足等保三级要求。",
    );
    expect(plan.sections[0].source_context_refs[0].section_titles).toContain("平台物理架构");
    expect(plan.writer_instructions).toContain(
      "Use section-level required_evidence and source_context_refs before reopening the global facts store.",
    );
    expect(plan.writer_instructions).toContain(
      "If the backing facts store is needed for a missing claim, extract only the relevant records for the current section instead of reading the entire file into context.",
    );

    const evidenceStatements = plan.required_evidence.map((item) => item.statement);
    expect(evidenceStatements).toContain("平台支持 K8S、虚拟机、裸金属和 GPU 统一纳管，实现跨中心异构资源池化。");
    expect(evidenceStatements).toContain("系统融合实时网络时延、带宽和丢包率，结合 TPM/RPM 指标实现任务-资源-路径联合调度。");
    expect(evidenceStatements).not.toContain("例如，若某张充值券规定最低充值额为50元人民币，那么用户扫码支付后可抵扣20元。");
    expect(evidenceStatements.some((item) => item.includes("@startuml"))).toBe(false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("plan_doc_state.py preserves generic fallback sections for generic goals", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-generic-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });

    await writeFile(join(workspace, ".worktree", "index.json"), JSON.stringify({ summary: "simple summary" }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "Compile uploaded source documents into structured state",
        sources: [
          { title: "融合算力云平台白皮书" },
          { title: "天河监控运维一体化平台软件介绍v0.3" },
        ],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          { topic: "resource-aggregation", statement: "平台支持算力资源统一纳管。", sources: [{ title: "融合算力云平台白皮书" }] },
          { topic: "security-monitoring", statement: "平台支持统一监控与告警。", sources: [{ title: "天河监控运维一体化平台软件介绍v0.3" }] },
        ],
        gaps: [],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal", "请基于当前材料整理一份通用说明。",
    ], {
      cwd: "/Users/storm/Documents/code/studyProject/opencode-docx/openwork",
      stdout: "pipe",
      stderr: "pipe",
    });

    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(0);
    expect(stderr.trim()).toBe("");

    const plan = JSON.parse(await readFile(join(workspace, ".worktree", "plan", "solution-plan.json"), "utf8"));
    expect(plan.sections.map((item) => item.title)).toEqual([
      "执行摘要",
      "主体内容",
      "待确认事项",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
