# 文档 Agent 测试档案

时间：2026-03-25  
仓库：`/Users/storm/Documents/code/studyProject/opencode-docx/openwork`  
基线提交：`41014ee6`

## 目的

把多轮文档 Agent 测试过程中的计划、发现、决策、当前状态拆开记录，避免“测到哪算哪”，并给后续继续测试的账号或会话提供稳定入口。

## 这套文档的定位

- 这就是当前官方 handoff 包。
- 仓库内没有额外独立的 `handoff.md` 历史文件可复用，因此后续跨账号接力统一以本目录为准。
- 后续任何一次有效测试、修复、策略调整，都必须至少更新：
  - `run-ledger.md`
  - `status.md`
  - 以及 `findings.md` / `resolutions.md` / `decisions.md` 中至少一个

## 文档分工

- `test-plan.md`
  - 记录测试目标、测试对象、统一样例、评价维度、通过标准。
- `run-ledger.md`
  - 记录每一轮测试的编号、输入、模型、关键 session、产物、发现、后续动作。
- `findings.md`
  - 记录已经确认的问题、复现证据、影响范围、当前状态。
- `resolutions.md`
  - 记录已经解决的问题、解决方式、为什么这么解决、验证证据。
- `decisions.md`
  - 记录已经拍板的策略，不让后续测试反复摇摆。
- `status.md`
  - 记录当前最新进度、关键会话、关键产物、下一步。
- `handoff.md`
  - 给新账号/新会话的最短接力入口，只保留恢复工作所需的最关键信息。

## 当前统一约束

- 真实样例之一使用 `/Users/storm/Pictures/秦老师` 下的两份文档。
- 该样例只是压力测试，不允许把系统收窄成只会处理这一类文档。
- 联网补充只允许使用 `bocha-search`。
- 不允许为了“保证能用”引入隐性搜索 fallback 来掩盖系统工具故障。
- 目标是提升面对真实 user prompt 时的最终产物质量，而不是只追求流程跑完。
- hosted 运行态结论只有在“本地仓库、pod 部署仓库、目标用户 workspace 的对应 `.opencode` 资产都已核对”后才算有效证据。

## 入口顺序

1. 先读 `handoff.md`
2. 再读 `decisions.md`
3. 再读 `test-plan.md`
4. 再看 `run-ledger.md`
5. 再看 `findings.md`
6. 再看 `resolutions.md`
7. 最后看 `status.md`

## 最低维护纪律

- 任何一次测试都要有唯一编号，例如 `RL-004`。
- 每次测试至少要落地：
  - 测试对象
  - 输入文档
  - 使用模型
  - 关键 session / workspace
  - 结果
  - 新发现或无发现
  - 下一步
- 如果本轮改了代码，还要补：
  - 修改文件
  - 为什么改
  - 如何验证
- 如果本轮依赖 hosted 运行态，还要补：
  - pod 部署仓库路径
  - 目标用户 workspace 路径
  - 哪些 prompt / script 资产已核对或已同步
