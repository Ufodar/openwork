# 发现清单

时间：2026-03-26

## 已确认问题

### F-001 `bocha-search` 本机链路失败

- 现象：
  - `doc-writer` 在 Qin 样例运行中多次得到 `MCP error 13: 搜索请求失败: fetch failed`
  - 本机直接请求 Bocha API 也得到 `Connection reset by peer`
- 影响：
  - 联网补充链路失效
  - 如果 prompt/agent 不够严格，模型会用低质量或伪造来源补位
- 当前状态：
  - 已确认为真实系统问题，不再用 fallback 掩盖

### F-002 verifier 对双前缀标题存在假阴性

- 现象：
  - 文档里真实存在 `1.2 第一章 算力资源汇聚系统`
  - verifier 仍把 `算力资源汇聚系统` 判为缺失
- 根因：
  - `normalize_heading()` 只剥了一层前缀，不能正确处理“数字前缀 + 章节前缀”叠加
- 当前状态：
  - 已修复并有测试覆盖

### F-003 verifier 对复合英文技术词支撑判断过死

- 现象：
  - `NVIDIA MIG` 已在 `docs.nvidia.com` 官方文档中出现对应支撑
  - verifier 仍报 `weakly-supported-concrete-term`
- 根因：
  - 原逻辑只做整串包含，不接受“同一支持文本中分离出现 vendor + capability token”
- 当前状态：
  - 已修复并有测试覆盖

### F-004 低权威来源识别不完整

- 现象：
  - `baike.baidu.com`、`blog.csdn.net`、`juejin.cn`、`developer.baidu.com/article/*` 没有被完整标记
- 影响：
  - verifier 低估外部补充中的来源污染程度
- 当前状态：
  - 已扩展规则并有测试覆盖

### F-005 `doc-writer` 虽然进入子 agent 链，但外部补充行为仍不够硬

- 现象：
  - fresh Qin run 已经过 `doc-intake -> doc-reader -> doc-merger -> doc-planner -> doc-writer -> doc-verifier`
  - 说明子 agent 架构已真实跑起来
  - 但 `doc-writer` 在 `bocha-search` 失败后仍写出低质量来源列表
- 影响：
  - 产物质量退化
  - 容易掩盖系统工具故障
- 当前状态：
  - 已把 prompt 改为 bocha-only，失败显式 blocker
  - 需要再重跑验证真实行为

### F-006 prompt 中的 `fallback` 一词存在语义混淆风险

- 现象：
  - 后续测试者容易把 `document-writer` / `doc-orchestrator` 里的 `fallback:` 理解成“搜索兜底”
- 实际代码含义：
  - `.opencode/agent/document-writer.md` 与 `.opencode/prompts/doc-orchestrator.md` 里的 `State surfaces -> fallback:` 指状态工件读取面
  - `generic fallback sections` 指规划阶段退化成泛化章节名，不是联网兜底
- 影响：
  - 容易误判系统仍在偷偷走搜索 fallback
  - 也容易让排查方向继续跑偏
- 当前状态：
  - 已在决策与台账中明确拆分语义
  - 若后续仍持续引发误判，再考虑把 prompt 内用词改掉

### F-007 `common-work` 会在搜索失败时伪造“联网补充已完成”的样子

- 现象：
  - Qin 当前重跑中，`common-work` 会在 `bash` 里写出“模拟搜索结果（因为 bocha 搜索需要特定环境）”
  - 同一轮还出现了用脚本硬编码行业实践、厂商清单、缺口列表的行为
- 影响：
  - 产物表面上更完整，但证据链实际上已经断掉
  - 这类“看起来很专业”的补写最容易让用户误以为系统有深度，实际却没有可追溯依据
- 当前状态：
  - 已定位为高优先级通用问题
  - 正在把 `common-work` prompt 收紧为：搜索失败只能显式 blocker，不能模拟或硬编码检索结果

### F-008 `document-writer` 已经能完整跑通，不能再把上传竞态当既定事实

- 现象：
  - `packages/app/scripts/run-qin-doc-writer.mjs` 的 isolated fresh run 已成功完成上传、子链执行、最终稿生成与 verifier 回环
  - 关键 session：`ses_2dd781aabffe3O5FoYaVUU1JWd`
- 影响：
  - 说明此前“`doc_state` session 在上传阶段必挂”并不成立
  - 任何围绕这个假设的产品修复都需要重新审视
- 当前状态：
  - 已确认为反证
  - 后续不能再把“upload race”当成已确认根因

### F-009 compare harness 的错误信息不足以支撑产品级归因

- 现象：
  - `doc-agent-live-compare.mjs qin` 当前只留下 `TypeError: fetch failed`
  - 没有标出失败发生在哪个请求或阶段
- 影响：
  - 不能可靠地区分是：
    - compare harness 自身问题
    - 某一类网络瞬态
    - 运行态真实缺陷
  - 如果在这种证据粒度下直接改产品代码，很容易修错对象
- 当前状态：
  - 已定位为测试诊断能力不足的问题
  - 下一步应优先补 step-level 诊断，而不是继续猜测产品根因

### F-010 当前最新 compare 失败点在 `common-work` 首轮 `promptAndSettle`，不是 `document-writer` 上传

- 现象：
  - 给 `doc-agent-live-compare.mjs` 增加步骤标签后，Qin 重跑当前报错为：
    - `[cmp-common-work] failed at promptAndSettle`
    - session: `ses_2daa60a38ffeFrOE46X4mjI1yT`
    - cause: `fetch failed`
- 影响：
  - 可以排除“这一轮是 `document-writer` 上传挂了”的错误归因
  - 当前对比链甚至还没进入 `document-writer` 阶段
- 当前状态：
  - 已确认 compare harness 的首个失败点发生在 `common-work` 第一轮 prompt 提交/等待阶段
  - 仍需继续拆分 `promptAndSettle` 内部边界，确认是 `event.subscribe`、`promptAsync` 还是 `session.messages` polling 出错

### F-011 compare harness 仍有更底层的未标注 fetch 调用

- 现象：
  - 在继续细化后再次重跑 Qin，对比脚本这轮直接报：
    - `TypeError: fetch failed`
    - `cause: SocketError: other side closed`
  - 并且 `partialResult = null`
- 影响：
  - 说明当前还有发生在已标注业务步骤之前的底层 fetch 调用没有带上上下文
  - 这类错误最容易让排查再次退回“猜网络”而不是定位到具体 API
- 当前状态：
  - 已定位为 compare harness / 基础请求层仍需补诊断
  - 下一步要把 `requestJson`、`login` 和直接 `fetch` 入口一并标注

### F-012 最近这轮 OpenWork 外部入口异常的直接原因是 pod 里没有服务进程

- 现象：
  - 外部 `healthz`、`openwork/health`、`auth/login` 同时返回 `Empty reply from server`
  - SSH 进入 pod 后，`ps` 中没有任何 `openwork` / `orchestrator` / `node` / `bun` 相关进程
- 影响：
  - compare harness 的 `fetch failed` 在这段时间内不能再被当成 agent 行为问题
  - 这属于基础设施可用性故障
- 当前状态：
  - 已通过 `scripts/restart-pod.sh` 恢复
  - 恢复后外部 health/login 已重新返回 `200`

### F-013 pod 中 OpenCode 版本落后于 orchestrator 期望版本

- 现象：
  - `restart-pod` 日志显示：
    - `expected 1.3.2, got 1.2.6`
  - 本机 raw `opencode --version` 当前是 `1.3.0`
- 影响：
  - raw OpenCode、本机 OpenWork、pod OpenWork 三者当前不在同一 OpenCode 版本基线上
  - 这会直接污染工具调用差异和行为差异的解释
- 当前状态：
  - 已定位为高优先级环境问题
  - 还没有修复，后续比较必须显式带着版本信息

### F-014 当前用户侧最稳定暴露的故障是公共 Web 入口上传代理 `socket hang up`

- 现象：
  - 在 pod 恢复后，Qin live compare 重新跑时：
    - `login`、`createSession` 已通过
    - 第一个 14MB 级 docx 上传就失败
    - 错误为：`Proxy error: socket hang up`
- 影响：
  - 这直接命中真实用户上传文档场景
  - 即使 agent prompt 再好，只要上传入口不稳，后续 B/C 对比和真实使用都站不住
- 当前状态：
  - 已确认这是服务恢复后的首个稳定失败点
  - 下一步要查 public web proxy 与后端上传接口之间的连接处理

### F-015 慢上传时长本身不是充分条件

- 现象：
  - 在 pod 内对同一个 public web 入口做 `5MB @ 30kB/s` 的慢上传，对应总时长约 `170.7s`
  - 结果仍然是 `200`
- 影响：
  - 这说明“超过 170s 就会挂”不是当前问题的正确抽象
  - 真正的问题更可能依赖于外部客户端到 pod 的网络链路特征，而不是纯粹的服务端固定超时
- 当前状态：
  - 已确认慢上传时长不是唯一触发因素
  - 下一步要从本机到 pod 的真实网络路径继续复现

### F-016 pod 全局 OpenCode 基线与本机不一致，而且携带无效本机路径

- 现象：
  - 本机 `/Users/storm/.config/opencode/opencode.json` 当前是：
    - `permission = allow`
    - `model = Qwen3.5-397B-A17B`
    - `bocha-search = enabled`
  - pod `/root/.config/opencode/opencode.json` 当前是：
    - OpenCode `1.2.6`
    - `model = my-company/Qwen3.5-397B-A17B`
    - `small_model = my-company/Qwen3.5-397B-A17B`
    - `bocha-search = enabled`
    - `memory = false`
    - `permission` 不是本机这套全局 `allow`
    - `mcp.filesystem.command` 仍指向 `/Users/storm/Documents/code`
- 影响：
  - raw、本机 OpenWork、pod OpenWork 现在并不在同一“权限 + MCP + 路径”基线下
  - pod 全局 config 中残留的本机路径说明同步后的配置并不完全适配 pod 运行态
- 当前状态：
  - 已确认这是跨模式对比前必须显式带上的基线差异
  - 暂未把它直接归因为某一条 prompt 或 agent 逻辑缺陷

### F-017 `sync-global-opencode-config.py` 裸跑会污染 pod 全局配置

- 现象：
  - 在 pod 中直接运行 `python3 scripts/sync-global-opencode-config.py` 时，日志显示：
    - `api_key=empty`
  - 说明脚本本身依赖 runtime env；如果不先加载 env，它会把全局 `opencode.json` 改写成不完整配置
- 影响：
  - 排查过程中很容易一边取证一边把运行态基线改坏
  - 这类误操作会直接污染后续的 raw/OpenWork 对比
- 当前状态：
  - 已定位为运维/调试纪律问题
  - 后续必须先加载 `~/.config/openwork/*.env` 再运行该脚本

### F-018 早期导出快照会误导 `document-writer` 完成态判断

- 现象：
  - Qin 本地 MiniMax 轮次中，早期导出的 root 快照一度显示最后一个 `task` 仍处于 `status=running`
  - 但复核 `root.export.latest.json` 与最终产物后，root 会话已经继续完成 `doc-verifier` 收尾并输出最终总结文本
- 影响：
  - 如果只看旧快照，会把“观测时点过早”误判成“主链路卡死”
  - 这会把排查注意力从真实的内容质量问题拉偏到并不存在的完成态故障
- 当前状态：
  - 已确认为观测口径问题，而不是这轮 `document-writer` 主会话真的卡死
  - 后续判断完成态时，必须优先看最新 export、最终 assistant 收尾文本和产物目录，不能拿旧快照直接下结论

### F-019 本地 `document-writer` 已生成 `.docx`，但格式与证据质量仍不足以判为高质量交付

- 现象：
  - 本地 MiniMax 轮次成功生成了真实 Office 文档包
  - 但文档标题出现双层编号叠加，例如：
    - `1.2 第一章 算力资源汇聚系统`
    - `1.2.1 1.1 技术架构`
  - `reports/doc-writer/external-supplements.md` 仍包含：
    - `CSDN`
    - `网易`
    - `搜狐`
    - `X技术网`
- 影响：
  - 当前问题已经从“能不能生成”转向“生成的是否专业、可追溯、适合申报材料”
  - 即使子链完整跑通，若 heading 语义和外部证据质量不硬，最终交付价值仍然不够
- 当前状态：
  - 已确认为当前最关键的内容质量问题之一
  - 后续优化应优先压：
    - heading/编号生成纪律
    - 外部来源筛选规则
    - verifier 对“看起来完整但证据质量不足”的识别

### F-020 `bocha-search` 的本机失败与 pod 成功是环境分裂，不是同一类系统故障

- 现象：
  - 本机直接请求 `https://api.bochaai.com/v1/web-search`：
    - Python `urllib` -> `URLError: Connection reset by peer`
    - Node `fetch` -> `TypeError: fetch failed`
    - `openssl s_client` -> TLS 握手阶段被 reset，`no peer certificate available`
  - pod 直接请求同一 API：
    - TLS 握手成功
    - API 返回 `200`
- 影响：
  - “raw 本机 OpenCode 无法联网补充”不能直接归因为 prompt / agent / MCP 配置错误
  - 本机与 pod 的联网结论必须分开记录，否则会把环境网络故障误判成产品编排缺陷
- 当前状态：
  - 已确认为环境差异
  - 后续所有 Qin A/B/C 结论必须显式带上“本机 Bocha 不通、pod Bocha 可通”这一前提

### F-021 当前标题问题的真实层级是“Heading 文本里仍手写编号”，不是“根本没有 Heading 样式”

- 现象：
  - `tmp/qin-local-document-writer-minimax-r2/outputs/算力平台项目申报技术材料.docx` 中：
    - `算力平台项目申报技术材料` 使用 `Heading 1`
    - `一、算力资源汇聚系统` 使用 `Heading 2`
    - `1.1 功能定位` 使用 `Heading 3`
    - `1.3.1 异构资源接入` 使用 `Heading 4`
  - 说明文档并非“普通段落伪标题”
  - 但标题文本本身仍保留了 `一、`、`1.1`、`1.3.1` 这类手写编号
- 影响：
  - 仅仅确认“有没有真实 Heading 样式”是不够的
  - 即便 paragraph style 正确，只要 heading text 里还写着人工编号，最终目录语义和文稿观感仍然不符合当前文档链规则
- 当前状态：
  - 已定位为 writer + verifier 都需要共同约束的通用问题
  - 已开始把它从“格式待确认”提升为明确的 `manual-heading-numbering` 风险

### F-022 本地 `common-work` 首次 MiniMax 对比因 harness 工作目录错误而无效

- 现象：
  - 首次本地 `common-work` 对比 session `ses_2da59994affeeQsFaVVXU9fWm2` 实际运行在 repo 根目录
  - 它首先 glob 到的是仓库内 `research/*.md`、`AGENTS.md` 等文件，而不是秦老师两份 `.docx`
  - 后续它反问“参考两篇文档是什么”
- 影响：
  - 这轮不能作为 `common-work` 的有效产品表现
  - 如果不单独标记为 harness 错误，会把“测试命令起错目录”误算成 agent 能力缺陷
- 当前状态：
  - 已明确判定为无效轮次
  - 已按正确 `cwd` 重新发起有效重跑

### F-023 本地 `common-work` 有效重跑虽然生成了 `.docx`，但内容一致性和证据质量仍不足

- 现象：
  - 正确 `cwd` 下的有效重跑 session `ses_2da58ba04ffe0glGTCCvYOMQpQ` 已成功生成：
    - `tmp/qin-local-common-work-minimax/融合算力服务平台技术材料.docx`
  - 文档结构比 `document-writer` 更干净，没有双层标题编号，但仍存在明显内容问题：
    - `3.2 技术路线` 段首错误写成“算力选择与调度系统的技术路线分为三个阶段”
    - API 示例以长代码段直接堆入正文，申报材料口径不够克制
    - 最终文档仅 `84` 个非空段落、`0` 张表
  - 运行日志里仍可见混合来源与网络补充痕迹，说明证据纪律没有真正收紧到高权威补充
- 影响：
  - `common-work` 当前不是“不能完成”，而是“能完成但容易串章节、证据链偏软、正文更像泛化技术稿”
  - 这类错误会直接伤到申报材料的专业可信度
- 当前状态：
  - 已确认为本地 `common-work` 的有效质量基线
  - 后续优化要同时约束：
    - 系统章节一致性
    - 外部来源权威性
    - API 示例与正文体裁的匹配度

### F-024 `doc-writer` 的真实运行态配置与 prompt 契约存在漂移

- 现象：
  - Qin `document-writer` MiniMax-r8 中，`doc-writer` session `ses_2d9f41ea4ffe6hk9S2nVYv40jt` 对 `.worktree/facts.json` 的首次 `read` 直接被权限拒绝
  - SQLite 里记录的实际报错显示：运行态白名单只放行了 `index.json`、`manifest.json`、`conflicts.json`、`solution-plan.json`、`coverage.json`、`outputs/**` 和文档类扩展名，并没有放行 `.worktree/facts.json`
  - 同时，`opencode.json` / `opencode.jsonc` 的 `doc-writer.tools` 里仍暴露了 `brave-search*`
- 影响：
  - `doc-writer` 无法读取事实库时，更容易退化成“plan + 通用常识”式写作，最终文稿会出现弱支撑术语和泛化实现词
  - bocha-only 已经是当前决策，但运行态仍保留其他搜索工具，会让策略边界变得不可信
- 当前状态：
  - 已在 repo 配置中修复：
    - 为 hidden `doc-writer` 恢复 `.worktree/facts.json` 读权限
    - 移除 `brave-search*`
  - 对应配置测试已更新并通过
  - 仍需用 Qwen 基线重跑 Qin 样例，确认 live 行为真的收敛

### F-025 hosted verifier 曾因运行态资产陈旧而出现假绿

- 现象：
  - Qin hosted 旧 session `ses_2d9b9caa5ffeRWjlYmjmqH91Qt` 的最终稿仍包含人工编号标题和弱来源痕迹，但 hosted `reports/doc-verifier/summary.md` 却写成“剩余风险: 无”
  - 对同一份最终 markdown，本地用最新 `verify_doc_state.py` 单独重跑时，能稳定报出：
    - `manual-heading-numbering`
    - `low-authority-external-sources`
- 根因：
  - pod 部署仓库与目标 hosted 用户 workspace 里的 `doc-verifier.md` / `verify_doc_state.py` 仍是旧版本
  - 本地仓库已经修过 verifier，但 hosted 运行态实际没有加载到新资产
- 影响：
  - 会制造“本地看见问题、hosted 却假绿”的错觉
  - 如果不先核对资产新鲜度，很容易把 stale runtime 误判成 verifier 逻辑本身没问题
- 当前状态：
  - 已确认根因并完成同步
  - 后续 hosted 结论必须先核对 deployed repo 与 user workspace 资产

### F-026 最终交付曾经消费了外补，却没有把依据显式写回文稿

- 现象：
  - `reports/doc-writer/external-supplements.md` 已经有真实补充内容
  - 但较早的 Qin hosted 最终稿在 `参考与依据/联网补充依据` 里仍停留在“如需进一步补充，建议联网检索”这类占位表述
- 影响：
  - 用户读最终稿时会误以为系统根本没有完成外补
  - 外补报告和最终交付脱节，会削弱最终文档的专业可信度
- 当前状态：
  - 已在 writer/verifier/script 三层收紧
  - 最新 hosted rerun 已把已消费的外补依据显式写回最终稿

### F-027 参考来源需要区分“权威依据”和“背景参考”

- 现象：
  - Qin hosted 中后期 rerun 虽已开始把联网补充依据写回最终稿，但仍会出现：
    - 新浪财经
    - 上海证券报
    - IT 之家
    这类门户或新闻转载站点
  - 若不额外声明，它们会和第一方/标准组织来源看起来处于同一层级
- 影响：
  - 文稿会给人“来源很多”的感觉，但来源等级表达失真
  - 申报/技术材料场景中，这类层级混淆会直接拉低专业感
- 当前状态：
  - verifier 的低权威域名表已继续扩展
  - 最新 hosted 最终稿已开始把这类站点显式降级为“背景参考”

### F-028 单个 `技术架构` 小节内曾出现重复层级标签

- 现象：
  - 较早的 Qin hosted rerun 中，单个系统的 `技术架构` 小节会重复出现相同层级标签，例如同一小节内重复 `服务管理层`
- 影响：
  - 即使整篇文稿结构完整，这类重复层级也会暴露 writer 收口质量不稳
  - 会让最终架构描述看起来像模板拼接，而不是经过整理的正式技术材料
- 当前状态：
  - 已把“重复架构层标签”写成 writer/verifier/script 联动约束
  - 最新 hosted rerun 已不再复现

### F-029 `qin-one-shot-compare.mjs` 的 `no assistant progress` 现在会把部分已完成 session 误判成超时

- 现象：
  - 最新 hosted Qwen 对照里，`qin-one-shot-compare.mjs` 对 `common-work` lane 报：
    - `No assistant progress after 243775ms`
  - 但对应 session `ses_2d968fa0dffe2579AFVDOPasYx` 事后查询发现：
    - 最终已生成 `output/融合算力云平台项目申报技术材料.docx`
    - 服务端消息已完整收口
- 根因：
  - harness 当前把“`session.messages` 中是否已经出现带 parts 的 assistant payload”当成进度门槛
  - 诊断重跑表明，`session.messages` 开头可能先出现空 assistant，再在后续 poll 才补出 `step-start/reasoning/tool`
  - 因此一旦某轮 assistant payload 的可见性滞后，harness 就会把它放大成“无进度超时”，即使服务端后续最终完成
- 影响：
  - A/B/C 对比会出现假阴性，进而把 harness 误判当成产品卡死
  - 这会继续污染 raw / `common-work` / `document-writer` 的质量比较
- 当前状态：
  - 已通过原失败 session + 诊断重跑双重取证确认
  - 已把 compare/harness 侧的进度门槛从“assistant payload 可见”调整为“assistant message 可见”
  - 对应脚本已完成语法校验

### F-030 `common-work` 与 Superpowers 的差异当前更像路由策略差异，不是“skills 根本没加载”

- 现象：
  - 本机 direct raw OpenCode 的最小探针里，默认 lane 一度出现：
    - `toolCounts = { skill: 1, read: 5 }`
  - 同一工作区、同一模型下切到 `common-work` 时，对应探针一度变成：
    - `toolCounts = { glob: 1, read: 5 }`
  - 进一步用显式可见性探针复核：
    - raw lane 直接通过 `skill` 工具找到 `writing-plans` 与 `brainstorming`
    - `common-work` lane 虽未主动调用 `skill`，但仍能正确说出同样的 skills 存在
- 根因：
  - `.opencode/agent/common-work.md` 旧版路由把“泛化写作/头脑风暴类 skill 不作为默认路线”压得过死
  - 结果是 planner / brainstorming 类能力虽然可见，但更容易被 prompt 路由策略压住
- 影响：
  - 如果只看“有没有主动调 `skill` 工具”，很容易把 prompt 路由问题误判成全局配置 / runtime 加载问题
  - 这会把 baseline 修复带偏到错误方向
- 当前状态：
  - 已确认为“能力可见性”和“实际路由选择”需要分开判断
  - 已开始把 `common-work` 收紧为：
    - 真实文件优先
    - 但读到真实文件后，对长任务/系统调试/复杂统筹不再一刀切压制规划类 skill
  - 仍需继续在 local OpenWork 与 pod OpenWork 路径上做同一探针复核

### F-031 MiniMax 短探针已证明三条 baseline 都能看到 Superpowers，问题不在“skills 缺失”

- 现象：
  - 统一 MiniMax 短探针下：
    - raw lane 能列出 `brainstorming` 与 `writing-plans`
    - local OpenWork `common-work` 能列出同两项 skill
    - pod OpenWork `common-work` 也能列出同两项 skill
  - 即使某一轮没有主动调 `skill` 工具，assistant 仍可能直接从可用 skill 上下文中给出正确列表
- 影响：
  - 当前已经没有证据支持“OpenWork 把 Superpowers 吃掉了”
  - 真正需要继续比较的是：
    - 同一任务下是否主动走到规划类 skill
    - 以及这种差异来自 prompt 路由、上下文、还是运行态资产陈旧
- 当前状态：
  - 已通过 raw / local / pod 三条 lane 的显式探针确认
  - 后续 baseline 对比可以从“skills 是否存在”收窄到“何时会被主动调用”

### F-032 pod `common-work` 的首轮路由结论会被运行态资产陈旧直接污染

- 现象：
  - pod 首轮 `planning_route` 探针在同步前表现为：
    - `toolCounts = { glob: 2, read: 3, bash: 1, grep: 1 }`
    - 没有 `skill`
    - assistant 还引用了旧版 `common-work.md` 的旧行号/旧口径
  - SSH 核对发现：
    - `/root/ai_staff/openwork/.opencode/agent/common-work.md`
    - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/.opencode/agent/common-work.md`
    都不是本地仓库当前版本
  - 同步新版 `common-work.md` 后，pod 同一探针重跑变成：
    - `toolCounts = { glob: 1, read: 1, skill: 1 }`
- 影响：
  - 如果不先核对被测 agent 文件的新鲜度，tool-call 差异会被直接误判成产品能力差异
  - 这次已经再次证明：hosted/pod 的 prompt 资产陈旧足以颠覆 baseline 结论
- 当前状态：
  - 已通过同步前后两轮 pod session 直接取证确认
  - 后续任何 pod / hosted `common-work` 对比，必须先核对同名 agent 文件版本

### F-033 当前 OpenCode 官方 config schema 没有文档化的顶层 session env 注入位

- 现象：
  - 对 `https://opencode.ai/config.json` 的 schema 取证显示：
    - 顶层存在 `agent / command / instructions / mcp / permission` 等配置
    - 没有文档化的顶层 `environment / env / bash / shell` 字段
    - `environment` 只出现在 MCP 配置面
- 影响：
  - 现在不能把“用官方项目配置直接给 session shell 注入 `TMPDIR/TMP/TEMP`”当成已存在能力
  - hosted 文档 temp 隔离短期内仍要靠 runtime workspace、temp root 和外部 temp copy-back 规则
- 当前状态：
  - 已作为当前设计边界确认
  - 不是阻塞项，但会影响 temp 隔离方案的选型

### F-034 最新 raw vs pod 重跑里，`/tmp` 碰撞已消失，但 assistant 可见文本仍泄漏 `</think>`

- 现象：
  - 最新 Qin 主 baseline 重跑中：
    - raw：`ses_2d7763f7effevmomFnP77k20go`
    - pod：`ses_2d776285dffeR7NRJxx8WmaK6R`
  - pod lane 已成功生成：
    - `downloads/pod/融合算力云平台三大系统技术材料.docx`
  - `toolIssueCounts = {}`
  - 但 `assistantText` 仍出现：
    - `任务已完成。让我总结一下完成的工作。`
    - `</think>`
- 影响：
  - 说明 `/tmp` 边界碰撞和 reasoning tag 泄漏是两个独立问题
  - 即使工具链已经干净，用户可见摘要和测试报告仍会继续被污染
- 当前状态：
  - `/tmp` 读回失败在这一轮主 baseline 里已不再复现
  - `</think>` 泄漏已作为独立缺陷处理，并已进入显示/报告层修复与 live 重跑复核

### F-035 raw `opencode export` 在真实长文档样例里会产出坏 JSON

- 现象：
  - WJW raw lane 初次长跑 session `ses_2d74acea0ffezKzT9jqcBiRPKH` 成功完成并生成文档
  - 但 `raw-opencode-workspace/raw.export.json` 解析失败：
    - `JSONDecodeError / Unterminated string`
  - 复查文件内容发现，损坏点落在超长 `read` 输出内嵌的大表格文本区域
- 影响：
  - compare harness 会错误丢失 raw lane 的：
    - `toolCounts`
    - `toolIssueCounts`
    - `assistantText`
  - 如果不补救，就会把 raw 行为层证据误记成“无数据”
- 当前状态：
  - 已确认这不是 harness 截断，而是 `opencode export` 在该类样例上的格式完整性问题
  - 已在 compare harness 增加 `run.jsonl` 回退分析

### F-036 WJW 第二真实样例里，pod `common-work` 没明显弱于 raw，但交付形态仍有差异

- 现象：
  - 在统一 `my-company/MiniMax-2.5` 下：
    - raw：`ses_2d74acea0ffezKzT9jqcBiRPKH`
    - pod：`ses_2d74ac031ffea2GsQFgHpo1lEL`
  - 两条 lane 都成功完成
  - raw 产出：
    - `点对点解决方案.md`
    - `outputs/点对点解决方案.docx`
  - pod 产出：
    - `点对点解决方案.md`
  - 内容层面对读显示：
    - raw 更像“逐条摊平招标要求 + 偏离汇总”的投标底稿
    - pod 更像正式方案写法，章节展开更完整，尤其在操作系统/技术要求梳理部分更充分
  - 同时 pod 仍保留了：
    - `[供应商名称]` 占位
    - 仅落出 `.md`、未落出 `.docx`
- 影响：
  - 这轮不足以支持“pod `common-work` 比 raw 差”
  - 但也不能直接判定“pod 已全面优于 raw”，因为交付包装和模板收口仍弱于 raw
- 当前状态：
  - 已作为第二个真实样例基线成立
  - 当前更准确的判断是：
    - `pod common-work >= raw` 基线没有被第二样例推翻
    - 但差异已收敛到“最终交付形态与收口细节”，不是“能不能完成”或“会不会乱用工具”

### F-037 `common-work` 会把最终 `.docx` 留在 `.tmp`，导致 hosted 只暴露部分交付物

- 现象：
  - WJW pod 首轮 session `ses_2d74ac031ffea2GsQFgHpo1lEL` 的 assistant 总结里明确写出：
    - `.tmp/docx-output/点对点解决方案.docx`
  - 但 `finalDocuments` / 下载结果里只有：
    - `点对点解决方案.md`
  - 进一步取证该 session 的工具调用后确认：
    - `pandoc "点对点解决方案.md" -o ".tmp/docx-output/点对点解决方案.docx"`
    - 后续只 `ls` 验证 `.tmp/docx-output/`，没有再把 `.docx` 回写到 workspace 稳定路径
- 影响：
  - 用户看到的是“agent 说自己生成了 Word 文档”，但下载面没有对应文件
  - 这会把本来已经生成的最终交付物误降级成“只有 Markdown”
- 当前状态：
  - 已定位为 `common-work` 的通用收口问题，不是 WJW 样例特有逻辑
  - 已通过 prompt 收紧和 pod 重跑验证修复

## 已确认的正向信号

### G-001 新架构确实开始留下可恢复状态

- fresh Qin run 当前已稳定留下：
  - `.worktree/index.json`
  - `.worktree/facts.json`
  - `.worktree/plan/solution-plan.json`
  - `.worktree/coverage.json`
  - `.worktree/verify/coverage.json`
  - `reports/docx-draft/draft.md`
  - `reports/doc-verifier/summary.md`

### G-002 fresh Qin run 已生成完整章节结构

- verifier 虽然一度误判缺失，但检测到的标题已覆盖：
  - 三大系统
  - 各系统的功能定位、技术架构、技术路线、互联互通机制、标识系统构建、API 调用示例

### G-003 本地 `document-writer` 主会话已能完成闭环

- Qin 本地 MiniMax 轮次里，最新 root export 与最终 assistant 收尾文本都已表明主会话继续完成：
  - `doc-intake -> doc-reader -> doc-merger -> doc-planner -> doc-writer -> doc-verifier`
- 这说明当前更值得优化的是：
  - 最终稿质量
  - 外部来源纪律
  - heading 语义与 verifier 严格度
  - 而不是继续围绕这轮不存在的“主会话卡死”假设修产品逻辑

### G-004 最新 Qin `document-writer` rerun 已验证 canonical plan schema 恢复

- 现象：
  - 最新本地 rerun：
    - 工作区：`tmp/qin-local-document-writer-minimax-r5`
    - root session：`ses_2da1ce4d6ffedBFrpUN7JTEfEo`
  - `doc-planner` 产物重新回到 canonical schema：
    - `.worktree/plan/solution-plan.json`
    - 第一层 section key 为：
      - `id`
      - `title`
      - `required_subsections`
      - `source_context_refs`
  - 不再出现上一轮那种：
    - `system`
    - `modules`
    - `key_facts`
- 影响：
  - 说明最近对 planner/orchestrator/document-writer 的 schema 约束已经在真实运行态生效
  - 当前问题中心继续从“计划结构损坏”收敛到“正文质量、证据质量和 writer 收口”
- 当前状态：
  - 已作为真实 rerun 证据确认
  - 后续若再出现 plan drift，需要优先怀疑消费端或运行态版本差异，而不是继续重复修同一段 prompt

### G-005 最新 Qin `document-writer` rerun 已把本机 `bocha-search` 失败显式写成真实 blocker

- 现象：
  - `tmp/qin-local-document-writer-minimax-r5/reports/doc-writer/external-supplements.md` 当前内容显示：
    - 四类查询都真实尝试了 `bocha-search`
    - 每次都记录为 `fetch failed`
    - 未再混入 `CSDN`、`网易`、`搜狐`、`X技术网` 这类低权威补充来源
- 影响：
  - 说明这轮已经不再用“假联网补充”掩盖本机环境里的 Bocha 故障
  - 当前本机 lane 的问题可以更清晰地拆成：
    - 证据纪律：已明显变硬
    - 网络环境：Bocha 仍真实失败
- 当前状态：
  - 已作为最新本机 rerun 的正向信号确认
  - 后续需要继续观察最终 `.docx` 是否也维持同样的证据纪律

### G-006 hosted `document-writer` 在 verifier 资产同步后已出现真实纠偏回环

- 现象：
  - Qin hosted rerun `ses_2d9a510c2ffeBryhBzY3mIH5jm` 中，第二轮不再只是单次 `doc-writer -> doc-verifier`
  - 而是进入多轮 writer/verifier 自纠偏：
    - `doc-writer`
    - `doc-verifier`
    - `doc-writer`
    - `doc-verifier`
    - `doc-writer`
    - `doc-verifier`
    - `doc-writer`
    - `doc-verifier`
- 影响：
  - 说明 hosted 运行态在加载到新 verifier 资产后，确实会把 verifier 结论反馈回正文收口，而不是纸面上有 verifier、实际不生效
- 当前状态：
  - 已作为 hosted live 行为确认

### G-007 最新 Qin hosted 稳定基线已经显著优于早期空话稿

- 现象：
  - 最新 Qin hosted rerun `ses_2d97dad4dffeDbEf0Q05HVa3U3` 的最终稿已满足：
    - 无 `如需进一步补充` 这类占位话术
    - 无人工编号标题
    - 无重复架构层标签
    - `参考与依据/联网补充依据` 中已显式区分权威来源与背景参考
  - verifier 当前仅保留：
    - `open-question: 未明显识别到评分标准，需要后续核对`
- 影响：
  - 这说明当前 Qin hosted `document-writer` 的主要矛盾已经从“最终稿几乎没价值”明显收敛到“还有评分标准等外部招标上下文未补齐”
- 当前状态：
  - 已作为当前 hosted 最佳稳定基线确认

### G-008 仓库关键字审计未再发现 active 文档链搜索 fallback

- 现象：
  - 以 `fallback`、`模拟搜索结果`、`如需进一步补充`、`建议进行针对性联网检索`、`bocha` 为关键字在 `.opencode`、`packages/app/scripts`、`research/2026-03-25-document-agent-eval` 下复扫后
  - 剩余命中主要属于：
    - model resolution 的 `fallbackModel`
    - `plan_doc_state.py` 的 generic fallback sections
    - browser/setup 等非文档链 skill 的 fallback 描述
- 影响：
  - 当前“文档链偷偷走搜索 fallback”已经没有 repo 内直接证据
  - 后续再看到 `fallback` 一词，必须按具体运行路径判断，而不能按关键字直接定性
- 当前状态：
  - 已作为最新 repo 级审计结论确认
  - 与当前 bocha-only 决策一致

## 待继续确认

- `Qwen3.5-397B-A17B` 在当前本机 raw OpenCode 路径上的系统消息异常是否仍然存在
- raw OpenCode 与 OpenWork 在相同模型、相同权限、相同 skills 条件下，是否仍存在工具调用风格差异
- `common-work` 收紧后，是否还会通过 `bash` / `webfetch` 绕开搜索证据纪律
- `doc-agent-live-compare.mjs` 的 `fetch failed` 究竟发生在 compare harness 的哪个步骤
- `common-work` 首轮 `promptAndSettle` 内部究竟是哪一个 API 边界在失败
- `requestJson/login/upload/readback` 这类底层 fetch 里，究竟是哪一个在抛 `SocketError: other side closed`
- pod 里的 OpenCode 为什么停留在 `1.2.6`，以及是否需要升级到 orchestrator 期望的 `1.3.2`
- `serve-web-prod.mjs` 的上传代理为什么会在大文档上传时 `socket hang up`
- 为什么 pod 内慢上传成功，而本机到 pod 的真实上传会在相近时长附近断开

### G-009 工具状态 `completed` 不等于真实成功

- 现象：
  - 在 Qin MiniMax 长跑里：
    - raw `bocha-search_bocha_web_search` 三次状态都显示 `completed`
    - 但实际 `state.output` 全是：
      - `MCP error 13: 搜索请求失败: fetch failed`
  - pod `filesystem_read_text_file` 也出现：
    - 状态 `completed`
    - 但 `output` 实际是：
      - `Access denied - path outside allowed directories: /tmp/baipishu.md ...`
- 影响：
  - 如果只看工具计数或 `status=completed`，会把“逻辑失败”误算成“成功调用”
  - 这会直接污染：
    - 搜索成功率判断
    - 权限/路径问题判断
    - baseline 工具行为对比
- 当前状态：
  - 已由 `RL-028` 的 raw / pod 实际工具返回体确认

### G-010 pod `common-work` 仍会先写 `/tmp` 再撞 workspace 边界

- 现象：
  - `ses_2d834bab7ffem4OmET67lm60eD` 的 pod `common-work` 工具序列中：
    - 先执行：
      - `pandoc ... -o /tmp/baipishu.md`
    - 随后：
      - `read /tmp/baipishu.md` -> permission rule error
      - `filesystem_read_text_file /tmp/baipishu.md` -> `Access denied`
    - 之后才自我修正为：
      - `mkdir -p .tmp && pandoc ... -o .tmp/baipishu.md`
      - `filesystem_read_text_file .tmp/baipishu.md`
- 影响：
  - 这不是内容质量问题，而是可重复的运行路径浪费和权限边界碰撞
  - 它会平白增加：
    - 一次失败 `read`
    - 一次“completed 但实际 denied”的文件工具调用
    - 额外的模型回合与 bash 成本
- 当前状态：
  - `common-work.md` 里其实已经写了“中间产物必须在 workspace 内，不要写 `/tmp`”
  - 因此当前更像“prompt 已有规则，但实际执行仍会踩线”的运行态不服从问题，而不是规则缺失

### G-011 最新 pod 主 baseline 重跑已不再复现 `/tmp` 工具碰撞

- 现象：
  - 在最新 Qin 主 baseline 重跑中：
    - raw：`ses_2d7763f7effevmomFnP77k20go`
    - pod：`ses_2d776285dffeR7NRJxx8WmaK6R`
  - pod lane 的：
    - `toolIssueCounts = {}`
    - `toolIssues = []`
  - 没再出现上一轮那种：
    - `read /tmp/*.md`
    - `filesystem_read_text_file /tmp/*.md -> Access denied`
- 影响：
  - 说明“workspace-local temp + 外部 temp copy-back 约束”已经开始在真实 hosted Qin 路径里生效
  - `/tmp` 问题不再是当前 pod `common-work` 主 baseline 的首要阻塞
- 当前状态：
  - 已由最新 raw/pod 长跑结果确认
  - 下一步关注点已转移到用户可见文本污染和更细的工具路由质量

### G-012 assistant 可见摘要在最新 live 重跑里已不再泄漏 `</think>`

- 现象：
  - 在应用显示/报告层净化后重新跑 Qin 主 baseline：
    - raw：`ses_2d763a500ffeTLiSn1P81POga8`
    - pod：`ses_2d7638fc1ffegLzH3pmhEa9GWs`
  - pod lane 的 `assistantText` 已变成正常总结文本
  - 不再出现：
    - 孤立 `</think>`
    - 完整 `<think>...</think>` block
- 影响：
  - 用户可见摘要与 compare 报告已不再被 reasoning tag artifact 污染
  - 这让后续 raw vs pod 的内容质量对读更接近真实用户体验，而不是被显示层噪音带偏
- 当前状态：
  - 已由最新 live 重跑确认
  - 原始消息存储仍保持未改动，继续可用于底层运行态取证

### G-013 WJW 第二样例下 raw 与 pod 两条主基线都能稳定完成

- 现象：
  - WJW `raw vs pod` 长跑里：
    - raw：`ses_2d74acea0ffezKzT9jqcBiRPKH`
    - pod：`ses_2d74ac031ffea2GsQFgHpo1lEL`
  - 两条 lane 都成功完成最终交付
  - pod `toolIssueCounts = {}`
  - raw lane 在 `export` 坏 JSON 的情况下，经 `run.jsonl` 回退后仍可恢复工具统计
- 影响：
  - 说明当前主 baseline 已经不只在 Qin 单一样例上成立
  - 比较焦点可以进一步从“是否能跑完”转向“产物专业度和交付收口”
- 当前状态：
  - 已作为跨样例正向信号确认

### G-014 `common-work` 最终交付物回写约束生效后，WJW pod 已能稳定产出 `.md + .docx`

- 现象：
  - 在把 “`.tmp` 只允许中间产物，最终交付物必须回写到稳定路径” 写入 `common-work.md` 并同步到 pod 后
  - WJW pod 重跑 session：
    - `ses_2d728a4b1ffeLCwnCzI6dhVi4o`
  - 当前结果显示：
    - `generatedDocuments = [点对点解决方案.docx, 点对点解决方案.md]`
    - 下载目录已同时拿到：
      - `downloads/pod/点对点解决方案.docx`
      - `downloads/pod/点对点解决方案.md`
    - Markdown 中不再含 `[供应商名称]` 占位
- 影响：
  - 先前 WJW baseline 暴露出的“pod 只落 Markdown、交付收口不稳”已被这次修复显著收敛
  - 这进一步加强了当前判断：
    - `pod common-work >= raw` 这条主基线已经不只是“勉强站住”，而是在第二样例上继续增强
- 当前状态：
  - 已作为修复后的正向信号确认

### F-038 OpenCode 普通 `/session` 创建没有 per-session env 注入位，shell 临时目录硬约束应走 plugin hook

- 现象：
  - 对当前本机可读到的 OpenCode SDK 生成代码与类型再次核对后确认：
    - 普通 `/session create` 的 body 只包含：
      - `parentID`
      - `title`
      - `permission`
      - `workspaceID`
    - 没有 `env`
  - 同时，OpenCode plugin API 暴露了：
    - `shell.env`
  - 该 hook 可以在每次 shell 调用前改写 shell 进程环境变量
- 影响：
  - hosted session 的 `TMPDIR/TMP/TEMP` 不能继续假设可以通过：
    - `/session` payload
    - undocumented config hack
    稳定注入
  - 如果继续只靠 `common-work.md` 或 runtime instruction 约束 temp 路径，仍然是软约束
- 当前状态：
  - 已在仓库新增：
    - `.opencode/plugins/session-temp-root.js`
    - `.opencode/plugins/session-temp-root.test.mjs`
  - 当前策略改成：
    - 由 project plugin 在 `shell.env` 中把 `TMPDIR/TMP/TEMP` 强制指向 `<WORKSPACE>/.tmp/system`
  - 这条结论已落盘，后续 live hosted 探针已完成

### G-015 temp-root plugin 已在 pod `common-work` live probe 中被真实 shell 调用验证

- 现象：
  - 使用最小 probe 脚本直接对 pod OpenWork 发起：
    - 登录
    - 创建 session
    - 以 `common-work` 执行一次 `session.shell`
    - shell 命令仅为：`printf %s "$TMPDIR"`
  - live session：
    - `ses_2d7035ff3ffeSBIVd0HC9dsa4B`
  - 实际 `bash` 工具输出为：
    - `/root/.openwork/user-workspaces/c503a0f6-a558-41f4-8ba4-899eb1ed6923/documents/sessions/64412fea5d664b51bb81350afbf7e630/.tmp/system`
- 影响：
  - 这不是 prompt 推断，而是 pod 真实 shell 调用返回的环境值
  - 说明 session temp-root 已经从“文档约束”进一步变成了 hosted runtime 中真实生效的 shell 环境
- 当前状态：
  - 已完成 deployment repo + target user workspace 同步
  - 已完成 live probe 验证
  - 下一步可以回到 raw vs pod baseline，观察它是否进一步减少 temp 路径噪音

### F-039 temp-root 修正后的最新 WJW pod 长跑不再有 temp 噪音，但剩余 `.docx` 缺口来自 Markdown-only 收口

- 现象：
  - temp-root plugin live 生效后，重跑 WJW `raw vs pod`：
    - pod：`ses_2d6fee976ffe34mLovBhQv3TRM`
    - raw：`ses_2d6fef733ffemGaYnp4A3yAlUT`
  - pod 结果中：
    - `toolIssueCounts = {}`
    - 只交付了：
      - `点对点解决方案_滨海新区卫生健康信息化平台.md`
  - 进一步抓取 pod tool trace 后确认：
    - agent 明确把 todo 写成了 `输出最终Markdown文档`
    - 实际工具序列只有：
      - `glob`
      - `skill: docx`
      - `bash` 提取 docx -> markdown
      - `read`
      - `write` 最终 markdown
    - 没有任何一步执行 docx 回写或 markdown->docx 转换
- 影响：
  - 当前 pod lane 剩余的“只落 Markdown”问题已经不再属于 temp 边界或 shell env 问题
  - 真正剩下的是：
    - `common-work` 的收口策略
    - 或 prompt 对“Markdown / Word”二选一时的默认交付偏好
- 当前状态：
  - 这条差异已经被工具级证据确认
  - 下一步不该继续在 temp 隔离层打转，而要回到文档交付策略本身

### F-040 hosted per-session OpenCode runtime 若只隔离 data/state/cache 仍不彻底

- 现象：
  - 这轮把 hosted isolated runtime 再往前推进后，真实 persisted metadata 已新增：
    - `configHomeDir`
    - `tempDir`
  - spawn env 也已补齐：
    - `OPENCODE_CONFIG_DIR`
    - `XDG_CONFIG_HOME`
    - `TMPDIR`
    - `TMP`
    - `TEMP`
  - 关键 live session：
    - `ses_2d671b6dfffeJY9ZGO2L030ERe`
- 影响：
  - 说明“只把 cwd 和 data/state/cache 做 session 化”还不够
  - 若 config / temp 仍停留在共享面，OpenCode 运行态仍会留下跨 session 污染和共享工具输出的口子
- 当前状态：
  - 已作为 runtime 层已修正问题确认
  - Qin pod-only baseline 在这轮扩展后仍能成功完成，说明更彻底的 session 化没有把当前主链打坏

### F-041 hosted `docx` skill 当前存在独立于 Qin 样例的运行态故障

- 现象：
  - Qin pod-only baseline session `ses_2d670d6beffeoquayIArVR6qWs` 虽然最终成功生成了 `.docx`
  - 但工具追踪里同时出现：
    - `toolIssueCounts = { skill: 1 }`
    - 对应 `skill` 调用是 `docx`
    - 错误为：
      - `Error: Unable to connect. Is the computer able to access the url?`
  - 进一步做最小 hosted 复现：
    - prompt 只要求“立即调用 docx skill，然后只回复 ok”
    - session：`ses_2d667e286ffe16Asqj1brqinWc`
    - 结果是 `skill` 长时间停留在 `running`
- 影响：
  - 这说明当前 hosted `common-work` 下的 `docx` skill 问题不是 Qin 样例特有行为
  - 即使最终文档有时仍能生成，也不能把这条 `skill` 故障当成无关噪音忽略
  - 继续做文档基线对比时，必须把它视为真实系统问题，而不是 prompt 波动
- 当前状态：
  - 已确认为新的高优先级 hosted runtime / skill 执行问题
  - 当前还没有根因，下一步需要顺着 `skill(name=docx)` 的执行链继续定位

### F-042 `document-writer` 当前 Qin live 链路已跑通，旧的“卡在 `doc-reader` / `doc-merger` 后”结论失效

- 现象：
  - 最新 Qin `document-writer` live session：
    - `ses_2994aba77ffeyfqW7DDjmoxJ3l`
  - 已完整完成：
    - `doc-reader`
    - 补充研究
    - `doc-merger`
    - `doc-planner`
    - `doc-writer`
    - `doc-verifier`
  - 实际交付已落盘：
    - `outputs/qin-technical-material.md`
    - `reports/doc-writer/external-supplements.md`
    - `reports/doc-verifier/20260407-073000.md`
- 影响：
  - 旧理论“`document-writer` 会在 Qin 样例前半段 orchestration 卡死”已经被反证
  - 后续调优不应继续围绕这个已失效判断展开
- 当前状态：
  - 已确认为反证
  - 当前主问题已从“controller 前半段卡死”缩小到更局部的 harness 与收口问题

### F-043 `run-qin-doc-writer.mjs` 最近的失败已变成 harness 取件路径错误，而不是产品失败

- 现象：
  - 在 live session 两轮 prompt 均完成后，compare harness 最终报：
    - `{"code":"not_found","message":"File not found"}`
  - 直接原因是脚本硬编码读取：
    - `reports/doc-verifier/summary.md`
  - 实际 verifier 已输出时间戳报告：
    - `reports/doc-verifier/20260407-073000.md`
- 影响：
  - 这会把一次成功的产品 run 误记成失败
  - 不修正的话，会继续污染 `document-writer` 稳定性的结论
- 当前状态：
  - 已定位为 harness 缺陷
  - 本地脚本已改为从 `reports/doc-verifier/` 中选择最新 `.md` 报告

### F-044 `document-writer` 顶层仍有少量被拒绝的非阻塞探索动作

- 现象：
  - 在成功的 Qin live run 中，顶层 controller 仍会尝试：
    - `read .worktree/text/src-001.txt`
    - `read .worktree/text/src-002.txt`
    - `glob outputs/**/*.md`
    - `glob **/*.md`
  - 这些调用均被当前权限正确拒绝，但没有阻止最终交付完成
- 影响：
  - 说明 controller 仍残留少量“自己再确认一遍”的探索习惯
  - 它们不会阻塞结果，但会制造噪音，也会掩盖真正必要的工具面
- 当前状态：
  - 已定位为次要但真实的收口点
  - 暂未作为本轮主阻塞项处理
