import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = "./.opencode/runtime-support/document-state/plan_doc_state.py";

test("plan_doc_state.py preserves explicit multi-system section names for non-sample proposal goals", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-multi-system-"));

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
      "请基于当前资料起草一份建设方案，围绕统一资源接入系统、智能调度协同系统、运行监测与审计系统三部分展开，并给出 API 调用示例，同时补一节参考与依据。",
      "--target-doc", "outputs/multi-system-solution.md",
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

    expect(plan.goal).toContain("建设方案");
    expect(plan.target_doc).toBe("outputs/multi-system-solution.md");
    expect(plan.sections.map((item) => item.title)).toEqual([
      "统一资源接入系统",
      "智能调度协同系统",
      "运行监测与审计系统",
      "参考与依据",
    ]);
    expect(coverage.targets.map((item) => item.title)).toEqual([
      "统一资源接入系统",
      "智能调度协同系统",
      "运行监测与审计系统",
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

test("plan_doc_state.py preserves explicit heading contracts from formal benchmark prompts", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-explicit-headings-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });

    await writeFile(join(workspace, ".worktree", "index.json"), JSON.stringify({ summary: "formal rewrite" }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "Compile uploaded source documents into structured state",
        sources: [{ title: "正式技术文档" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          { topic: "general", statement: "原始文档结构存在重复章节和营销化表述。", sources: [{ title: "正式技术文档" }] },
          { topic: "api-interoperability", statement: "文档包含接口接入与数据交换相关内容。", sources: [{ title: "正式技术文档" }] },
          { topic: "security-monitoring", statement: "文档提到风险控制、审计与监测机制。", sources: [{ title: "正式技术文档" }] },
        ],
        gaps: ["部分技术论证仍需补强。"],
      }, null, 2),
      "utf8",
    );
    await writeFile(join(workspace, ".worktree", "merge", "conflicts.json"), JSON.stringify({ conflicts: [], open_questions: [] }, null, 2), "utf8");

    const proc = Bun.spawn([
      "python3",
      scriptPath,
      "--workspace", workspace,
      "--goal",
      "继续推进，把一份重构后的中文 Markdown 稿件写到 outputs/formal-single-long-rewrite.md。正文至少必须包含以下四个 Markdown 标题：项目理解、结构重组方案、关键技术与实现路径、风险与待确认事项。写完后自检，确保这些标题原样存在。",
      "--target-doc", "outputs/formal-single-long-rewrite.md",
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

    expect(plan.target_doc).toBe("outputs/formal-single-long-rewrite.md");
    expect(plan.sections.map((item) => item.title)).toEqual([
      "项目理解",
      "结构重组方案",
      "关键技术与实现路径",
      "风险与待确认事项",
    ]);
    expect(coverage.targets.map((item) => item.title)).toEqual([
      "项目理解",
      "结构重组方案",
      "关键技术与实现路径",
      "风险与待确认事项",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("plan_doc_state.py keeps generic solution routes domain-neutral instead of sample-specific", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "doc-plan-generic-solution-"));

  try {
    await mkdir(join(workspace, ".worktree", "sources"), { recursive: true });
    await mkdir(join(workspace, ".worktree", "merge"), { recursive: true });

    await writeFile(join(workspace, ".worktree", "index.json"), JSON.stringify({ summary: "solution draft" }, null, 2), "utf8");
    await writeFile(
      join(workspace, ".worktree", "sources", "manifest.json"),
      JSON.stringify({
        goal: "Compile uploaded source documents into structured state",
        sources: [{ title: "项目资料" }],
      }, null, 2),
      "utf8",
    );
    await writeFile(
      join(workspace, ".worktree", "facts.json"),
      JSON.stringify({
        canonical_facts: [
          { topic: "resource-aggregation", statement: "方案需要统一接入多类业务资源并形成标准化目录。", sources: [{ title: "项目资料" }] },
          { topic: "api-interoperability", statement: "平台需要通过标准接口与外部系统交换数据。", sources: [{ title: "项目资料" }] },
          { topic: "security-monitoring", statement: "方案要求保留审计、告警与权限控制机制。", sources: [{ title: "项目资料" }] },
          { topic: "timeline", statement: "交付节奏需要分阶段推进并保留联调窗口。", sources: [{ title: "项目资料" }] },
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
      "--goal", "请基于当前资料整理一份解决方案，先给出项目理解、需求拆解、解决路径、证据与约束、风险与待确认事项。",
      "--target-doc", "outputs/generic-solution.md",
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
      "项目理解",
      "需求拆解",
      "解决路径",
      "证据与约束",
      "风险与待确认事项",
    ]);

    const sectionEvidence = new Map(
      plan.sections.map((item) => [item.title, (item.required_evidence || []).map((evidence) => evidence.statement)]),
    );
    expect(sectionEvidence.get("需求拆解")).toContain("方案需要统一接入多类业务资源并形成标准化目录。");
    expect(sectionEvidence.get("解决路径")).toContain("平台需要通过标准接口与外部系统交换数据。");
    expect(sectionEvidence.get("风险与待确认事项")).toContain("交付节奏需要分阶段推进并保留联调窗口。");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
