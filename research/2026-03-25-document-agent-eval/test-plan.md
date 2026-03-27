# 测试计划

时间：2026-03-25

## 1. 测试目标

- 对比本机原始 OpenCode、OpenWork `common-work`、OpenWork `document-writer` 三条路径在长程文档任务上的表现。
- 验证新主 agent + 子 agent 架构是否真的提升了长任务稳定性、可恢复性、产物质量和工具调用质量。
- 找出导致 OpenWork 表现不如原始 OpenCode 的基础配置、prompt、工具接入或验证链问题。
- 只接受跨样例成立的改进，不做针对单个样例的硬编码优化。

## 2. 统一测试对象

### 核心对比对象

- 当前 baseline 阶段：
  - A：本机原始 OpenCode
  - B：pod OpenWork `common-work`
- 辅助诊断 lane：
  - 本机 local OpenWork `common-work`
- baseline 成立后再进入：
  - `document-writer`

### 当前重点样例

真实用户场景：

- 源文档 1：`/Users/storm/Pictures/秦老师/天河监控运维一体化平台软件介绍v0.3.docx`
- 源文档 2：`/Users/storm/Pictures/秦老师/融合算力云平台白皮书.docx`

用户问题：

- 围绕三个系统产出项目申报技术材料
- 每个系统至少覆盖：
  - 技术架构
  - 技术路线
  - 互联互通机制
  - 标识系统构建
  - 面向应用层的 API 调用示例
- 目标交付物：`.docx`

## 3. 固定约束

- 当前阶段公平比较基线模型：`my-company/MiniMax-2.5`
- 长期首选模型：`my-company/Qwen3.5-397B-A17B`
- 禁用：`Kimi-K2.5`
- 对比前必须记录：
  - OpenCode 版本
  - 全局 permission 姿态
  - `bocha-search` / memory 等关键 MCP 启用状态
- 若恢复使用 Qwen 做 raw vs OpenWork 公平对比，必须先单独确认本机 raw OpenCode 路径上的 `system message must be at the beginning` 兼容问题已消失
- 联网补充只允许 `bocha-search`
- `bocha-search` 失败要暴露为 blocker，不允许使用隐性 fallback 掩盖问题
- 必须结合 OpenCode 源码判断，不允许纯凭体感下结论

## 4. 评价维度

### 任务完成度

- 是否产出真实 `.docx`
- 是否覆盖用户要求的三个系统与各必需子章节
- 是否真的给出 API 示例，而不是只写接口名字

### 内容质量

- 是否把产品介绍重写成项目申报口径，而不是营销文案
- 是否给出实现方式、控制流/数据流、接口边界、实施约束
- 是否避免空泛堆词和 brochure 风格内容

### 证据质量

- 是否清楚区分源文档事实与联网补充
- 联网补充是否以权威来源为主
- 工具失败时是否诚实暴露缺口，而不是编来源

### 运行质量

- 工具调用是否符合设计初衷
- 是否正确使用子 agent，而不是退化为单 agent 硬撑
- 是否留下可恢复的状态文件与验证产物

### 验证质量

- verifier 是否能正确识别真实章节
- verifier 是否能识别低权威来源、弱支撑术语、格式伪装
- verifier 是否减少假阳性和假阴性

## 5. 当前通过标准

- 能稳定产出真实 `.docx`
- verifier 对章节覆盖不再出现明显假阴性
- `bocha-search` 失败时会显式报 blocker，不会产生伪造来源
- 联网补充报告中的来源以权威站点为主，低权威来源会被识别并要求整改
- 同一轮测试的产物和验证报告可被下一轮直接复用，而不需要重新从零理解上下文

## 6. 当前执行顺序

1. 先做主 baseline：
   - 本机 raw OpenCode
   - pod OpenWork `common-work`
2. `local OpenWork common-work` 只在需要定位 host-mode / wrapper 差异时补跑：
   - 不再作为每一轮 Qin baseline 的必跑项
3. baseline 开跑前先做短探针，确认：
   - global skills / overlays 是否可见
   - 没有主动调 `skill` 时，到底是没加载还是被 prompt 路由压住
4. 基线对齐项固定为：
   - `MiniMax-2.5`
   - 统一 permission posture
   - 统一关键 MCP 与全局 overlays 记录
5. 若 `common-work < raw OpenCode`，先修基线问题，再继续更复杂的 `document-writer` 比较
6. 在 `common-work >= raw OpenCode` 基本成立后，再回到 `document-writer` / `doc-*` 子 agent 路线评估

## 7. 每轮测试必须记录的字段

- 轮次编号
- 测试日期
- 测试模式：
  - raw OpenCode
  - OpenWork `common-work`
  - OpenWork `document-writer`
- 使用模型
- 输入文件路径
- 用户原始 prompt
- 工作区路径
- 主 session 和关键子 session
- 关键产物路径
- 结果：
  - 成功
  - 部分成功
  - 阻塞
- 新发现 / 无新增发现
- 对应问题编号、决策编号、解决编号
- 下一步动作

## 8. 每轮测试后的落盘要求

1. 先更新 `run-ledger.md`
2. 若发现新问题，更新 `findings.md`
3. 若解决了旧问题，更新 `resolutions.md`
4. 若策略发生改变，更新 `decisions.md`
5. 最后更新 `status.md`

## 9. 特别注意

- 测试台账的目标不是写周报，而是让下一次继续测试的人不用重新猜方向。
- 如果一轮测试被环境问题打断，也要记录：
  - 被什么打断
  - 它掩盖了什么判断
  - 下一轮应该如何绕开或先修它
