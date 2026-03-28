export const DEFAULT_FORMAL_DOCUMENT_BENCHMARK_SOURCE_ROOT =
  process.env.OPENWORK_FORMAL_BENCHMARK_SOURCE_ROOT ??
  "/Users/storm/Pictures/开发参考文件/标书agent开发相关文件";

export function buildFormalDocumentBenchmarks(
  sourceRoot = DEFAULT_FORMAL_DOCUMENT_BENCHMARK_SOURCE_ROOT,
) {
  return [
    {
      id: "formal-single-long-tech-rewrite",
      category: "single-long-rewrite",
      title: "天河产业园技术部分重构",
      expectedOutput: "outputs/formal-single-long-tech-rewrite.md",
      docs: [
        `${sourceRoot}/备-天河产业园一期融合算力系统建设项目CPU、GPU节点及云计算服务器采购投标文件电子版-技术部分-烽火.docx`,
      ],
      prompts: [
        "基于当前 workspace 已上传的正式技术文档，先完成长文档重构准备：梳理现有结构、关键事实、明显重复、营销化表述、需要补强的技术论证点，并把可恢复的中间状态写回 workspace。暂时不要写最终稿，只回复你已经形成了哪些关键 state，以及下一步如何重构全文。",
        "继续推进，把一份重构后的中文 Markdown 稿件写到 outputs/formal-single-long-tech-rewrite.md。正文至少必须包含以下四个 Markdown 标题：项目理解、结构重组方案、关键技术与实现路径、风险与待确认事项。写完后自检，确保这些标题原样存在，并补齐 coverage/verify 所需状态。",
      ],
      scoreAxes: [
        "tool-path-stability",
        "error-free-routing",
        "state-first-execution",
        "deliverable-quality",
      ],
    },
    {
      id: "formal-wjw-multi-doc",
      category: "multi-doc-synthesis",
      title: "卫健委多文档综合方案",
      expectedOutput: "outputs/formal-wjw-synthesis.md",
      docs: [
        `${sourceRoot}/智能员工资料/wjw项目伙伴/招标文件-天津市滨海新区卫生健康委员会天津市滨海新区卫生健康信息化平台项目.docx`,
        `${sourceRoot}/智能员工资料/wjw项目伙伴/产品信息/海滨医院点对点应答.docx`,
        `${sourceRoot}/智能员工资料/wjw项目伙伴/产品信息/智慧网络医疗服务项目设备参数9.29(1).docx`,
      ],
      prompts: [
        "基于当前 workspace 已上传的三份正式材料，先做多文档综合准备：梳理需求拆解、逐条可支撑证据、明显冲突、缺口和待确认事项，并把可恢复的 state 写入 workspace。暂时不要写最终稿，只回复关键中间结果和下一步计划。",
        "继续推进，把完整的中文 Markdown 方案写到 outputs/formal-wjw-synthesis.md。正文至少必须包含以下四个 Markdown 标题：需求拆解、综合解决路径、证据与约束、待确认事项。写完后自检，确保这些标题原样存在，并完成 verifier 前置状态刷新。",
      ],
      scoreAxes: [
        "tool-path-stability",
        "error-free-routing",
        "state-first-execution",
        "deliverable-quality",
      ],
    },
    {
      id: "formal-ly-plan-first",
      category: "plan-first-redraft",
      title: "临沂规划后写作",
      expectedOutput: "outputs/formal-ly-plan-first.md",
      docs: [
        `${sourceRoot}/备-环投数科临沂项目第一包v20250507v1.0(1)(1).docx`,
        `${sourceRoot}/智能员工资料/ly项目伙伴/临沂招标文件正文.pdf`,
        `${sourceRoot}/智能员工资料/ly项目伙伴/伙伴资料文档/环投数科临沂项目第一包v20250508终版文件.docx`,
      ],
      prompts: [
        "基于当前 workspace 已上传的三份正式材料，先完成规划阶段：建立 intake、facts/conflicts、solution plan 和 coverage，明确项目理解、解决路径、证据边界与风险项。暂时不要写最终稿，只回复你已经形成了哪些关键 state，以及下一步会如何落稿。",
        "继续推进，把完整的中文 Markdown 方案写到 outputs/formal-ly-plan-first.md。正文至少必须包含以下四个 Markdown 标题：项目理解、点对点解决路径、证据来源与假设、风险与待确认事项。写完后调用 verifier，并刷新 coverage/verify 状态。",
        "用户追加要求：在现有 outputs/formal-ly-plan-first.md 中补一个“实施里程碑与协作分工”章节。优先基于已有 state 修订，不要重新通读全部原文。完成后再次更新 coverage 与 verify 结果。",
      ],
      scoreAxes: [
        "tool-path-stability",
        "error-free-routing",
        "state-first-execution",
        "deliverable-quality",
      ],
    },
  ];
}

export const FORMAL_DOCUMENT_BENCHMARKS = buildFormalDocumentBenchmarks();

export const FORMAL_DOCUMENT_BENCHMARKS_BY_ID = Object.fromEntries(
  FORMAL_DOCUMENT_BENCHMARKS.map((benchmark) => [benchmark.id, benchmark]),
);
