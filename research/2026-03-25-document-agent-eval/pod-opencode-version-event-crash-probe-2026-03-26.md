# Pod OpenCode 版本与 Event 崩溃探针

更新时间：2026-03-26

## 背景

这轮目标不是继续跑长文档质量对比，而是先把 hosted 主基线恢复到“可稳定复现”的状态。直接 blocker 是：

- 最小 hosted `common-work` probe 会把共享主 `opencode` 打挂
- `restart-pod.sh` 在 pod 上经常因为前端重建 `vite build` 被系统杀成 `137`

## 本轮新增改动

- `scripts/restart-pod.sh`
  - 新增 `--reuse-build`
  - 允许复用已有 `dist/` 和 `dist/bin/`，跳过重建
- `scripts/recover-pod-runtime.sh`
  - 统一走现有 `restart-pod.sh` 主链
  - 只是默认打开 `OPENWORK_REUSE_BUILD=1`
- `tmp/pod-hosted-skill-probe.mjs`
  - 增加 `raw/common-work` lane 切换
  - 输出 `requestedAgent / effectiveAgent / lane`
  - 增加前后健康检查字段，便于定位是 prompt 前、prompt 后还是 messages 阶段失效
- 新增验证：
  - `scripts/restart-pod-help.test.mjs`
  - `tmp/pod-hosted-skill-probe.test.mjs`

## 已验证

- 本地通过：
  - `bash -n scripts/restart-pod.sh`
  - `bash -n scripts/recover-pod-runtime.sh`
  - `node --check tmp/pod-hosted-skill-probe.mjs`
  - `node --test tmp/pod-hosted-skill-probe.test.mjs scripts/restart-pod-help.test.mjs`
- pod 同步后也通过同样的语法/单测检查
- `recover-pod-runtime.sh --force` 已实测能把 pod 拉起，并成功恢复：
  - `GET http://127.0.0.1:8789/health`

## 关键发现 1：共享 external OpenCode 1.2.6 组合仍然不稳定

使用 pod 现有 external `opencode` 时，恢复日志显示：

- orchestrator 明确警告：
  - `opencode version mismatch (expected 1.3.2, got 1.2.6)`
- 随后 server 侧出现两类 event 连接：
  - `/opencode/event`
  - `/w/<workspace>/opencode/event`
- 紧接着共享主进程退出：
  - `[opencode] ERROR Process exited`
  - `[openwork-orchestrator] Shutting down`

当前最稳妥的判断是：

- 这已经不像是 `common-work` prompt 自身的问题
- 更像是 hosted event 链与 external `opencode 1.2.6` 组合本身不受支持或不稳定

这里的“raw 也有问题”目前属于基于运行态证据的推断，不应表述成完全证明：

- 已经证明 `common-work` 最小 probe 会打挂共享主进程
- 也已经证明在 external `1.2.6` 下，shared event 链会在运行初期把共享主进程带崩
- 但这轮还没有拿到一个完整收尾的“正确 web 入口 + external 1.2.6 + raw lane”最终日志

## 关键发现 2：pod 内 probe 入口必须区分 web 代理和后端 API

这轮还抓到一个容易污染结论的小坑：

- `http://127.0.0.1:8789` 是 OpenWork server API 本体
- `http://127.0.0.1:5173/openwork` 才是 pod 内 web 代理入口

因此：

- `OPENWORK_BASE=http://127.0.0.1:8789/openwork`
  - 会把登录打到 `/openwork/auth/login`
  - 返回 `404 not_found`
- 这个结果不能误判成产品 bug，只是 probe base 选错了

## 关键发现 3：切到 orchestrator 受管 OpenCode 后，即死崩溃现象先消失了

我做了一个高价值实验：

- 不改 OpenCode 源码
- 不改产品逻辑
- 只在这次 pod 启动里设置：
  - `OPENWORK_POD_OPENCODE_SOURCE=downloaded`

结果分两段：

1. 第一阶段
   - pod 成功恢复
   - `GET /health` 恢复正常
   - 用正确入口 `http://127.0.0.1:5173/openwork` 跑 hosted `raw` probe 时，不再像 external `1.2.6` 那样很快即死
   - probe 一开始进入了长执行态
2. 第二阶段
   - 重新抓日志后确认这不是“稳定跑通”，而是“延后崩溃”
   - 最新 `raw` probe 结果已经拿到：
     - `sessionID = ses_2d5fb3c1bffeN72PSyeQV2Mglu`
     - `promptAsyncError = null`
     - `messagesError = "Proxy error: socket hang up"`
     - `postPromptHealth = 502`
   - 对应 pod 日志显示：
     - `POST /auth/login 200`
     - `Started isolated session opencode runtime`
     - `POST /.../session ... 200`
     - `POST /.../prompt_async ... 204`
     - `GET /.../message ... 200`
     - 随后 `[opencode] ERROR Process exited`
     - `openwork-orchestrator` 跟着退出

所以当前更准确的结论是：

- `downloaded` 受管 OpenCode 没有彻底修好 shared hosted 主链
- 它只是把症状从 external `1.2.6` 的“更早、更粗暴的崩溃”变成了“在 `prompt_async -> 首次 message 读取` 附近再崩”
- 这已经足以证明：
  - 问题不再能归因到 `common-work`
  - `raw` lane 也会复现

## 当前最合理的工作假设

优先工作假设：

- hosted 共享主链目前真正的问题，是在 external `opencode 1.2.6` 上继续运行了一个已经按 `1.3.2` 预期设计的 OpenWork 组合
- `common-work` 只是最早暴露这个问题的触发器，不是唯一根因

补充后的更强假设：

- external `1.2.6` 只是把问题放大了
- 但 current hosted 主链里还存在第二个更靠近 server/event-tracking 的问题
- 目前最可疑的是 `SessionActivityService` 的 shared workspace event 订阅
  - 因为日志里持续出现：
    - `/opencode/event`
    - `/w/<workspace>/opencode/event`
  - 而且最新崩溃正好发生在：
    - 已创建 isolated session runtime
    - `prompt_async` 成功
    - 首次 message 读取后
- 为了验证这点，仓库里已经新增一个**默认关闭**的诊断开关：
  - `OPENWORK_DISABLE_SHARED_WORKSPACE_EVENT_TRACKING=1`
- 它只用于验证 shared workspace event 订阅是否是触发器，不改变默认产品行为

## 关键发现 4：真正的硬 blocker 不是 event 本身，而是 pod 上 `openwork-server` 二进制不可执行

在把 probe 收紧到：

- `OPENWORK_POD_OPENCODE_SOURCE=downloaded`
- `OPENWORK_OPENCODE_ROUTER=0`
- `OPENWORK_DISABLE_SHARED_WORKSPACE_EVENT_TRACKING=1`
- `OPENWORK_LOG_FORMAT=json`

之后，恢复日志终于给出了明确错误：

- `Run failed`
- `error = ENOEXEC: unknown error, posix_spawn '/root/ai_staff/openwork/packages/server/dist/bin/openwork-server'`

这说明此前“OpenCode healthy 后 orchestrator 立刻退出”的直接原因不是 prompt，也不是 `common-work`，而是 pod 上 `openwork-server` 二进制本身无法在当前 Linux 环境执行。

更合理的判断是：

- 之前的某次非规范同步把本机产物带进了 pod
- 导致 `packages/server/dist/bin/openwork-server` 不再是可在 pod 本地执行的 Linux 二进制
- 所以 orchestrator 在 `opencode healthy` 之后，根本没有机会把 `openwork-server` 正常拉起

## 关键发现 5：在 pod 本地重建 `openwork-server` 后，hosted 最小链路恢复

修复动作：

- 在 pod 仓库 `/root/ai_staff/openwork` 内直接执行：
  - `corepack pnpm --filter openwork-server build:bin`

修复后重跑同一组条件：

- `OPENWORK_LOG_FORMAT=json`
- `OPENWORK_POD_OPENCODE_SOURCE=downloaded`
- `OPENWORK_OPENCODE_ROUTER=0`
- `OPENWORK_DISABLE_SHARED_WORKSPACE_EVENT_TRACKING=1`
- `bash scripts/recover-pod-runtime.sh --force`

结果：

- `GET http://192.168.5.10:32765/healthz` -> `200`
- `GET http://192.168.5.10:32765/openwork/health` -> `200`
- 日志确认：
  - `opencode` healthy
  - `openwork-server` 成功 spawn
  - `GET /health 200`
  - orchestrator `Ready`

进一步的 hosted 最小 probe 也恢复了：

- `raw create_only`：成功
- `raw prompt_only`：成功
- `raw full`：成功返回，且 `postPromptHealth = 200`
- `common-work full`：成功返回，且 `postPromptHealth = 200`

这说明：

- 这轮真正打通的是 hosted session-isolation 主链，而不是只把某个样例 prompt 调顺
- `downloaded + no-router + no-shared-event + 正确的 Linux openwork-server binary` 已经构成当前最可信的 pod 最小稳定基线

## 关键发现 6：isolated session runtime child 仍在走 PATH 里的旧版 `opencode 1.2.6`

在 `openwork-server` 二进制修好后，正式 Qin compare 仍然出现：

- `POST /w/.../opencode/session -> 500`
- `{"code":"internal_error","message":"Unexpected server error"}`

继续往 pod 内追后，真正的差异不是 shared 主 `opencode`，而是 session-owned child runtime：

- shared orchestrator / shared `opencode` 已切到 downloaded `1.3.2`
- 但 isolated session runtime child 仍通过 PATH 启动
- pod PATH 上解析到的是旧版 `opencode 1.2.6`

直接证据：

- 某次失败时的 child 进程 `cwd` 已经是正确的 session runtime workspace
- `XDG_DATA_HOME / XDG_STATE_HOME / XDG_CACHE_HOME / TMPDIR` 也都已经 session 化
- 但该 child 自己的 OpenCode 日志第一行仍写着：
  - `service=default version=1.2.6 args=["serve","--hostname","127.0.0.1","--port","37873"]`

这解释了为什么：

- “每个 session 一个独立 OpenCode 进程”的方向已经对了
- 但 `createSession` 仍会在 `10s` 健康等待内超时
- 真正没对齐的是“child runtime 用哪一个 opencode binary”

## 关键发现 7：把 resolved `opencode` binary 显式传进 `openwork-server` 后，session runtime finally 对齐到 `1.3.2`

修复动作不在 OpenCode 源码，而在 OpenWork orchestrator：

- 新增：
  - `packages/orchestrator/src/runtime-env.ts`
    - `buildOpenworkServerRuntimeEnv(...)`
- 修改：
  - `packages/orchestrator/src/cli.ts`
    - `startOpenworkServer(...)` 现在会把 resolved `opencodeBinary.bin` 透传为：
      - `OPENWORK_OPENCODE_BIN`

这样 `openwork-server` 在为 hosted session 拉起 isolated child runtime 时，不再掉回 PATH 里的旧版 `opencode 1.2.6`，而是和 shared orchestrator 对齐到同一份 downloaded `1.3.2`。

本地验证：

- `bun test packages/orchestrator/src/runtime-env.test.ts`
- `bun test packages/server/src/session-opencode-runtime.test.ts packages/orchestrator/src/runtime-env.test.ts`
- `corepack pnpm --filter openwork-orchestrator build:bin`

pod 验证：

- `cd /root/ai_staff/openwork && bun test packages/orchestrator/src/runtime-env.test.ts`
- `cd /root/ai_staff/openwork && corepack pnpm --filter openwork-orchestrator build:bin`

直接 product-level 证据：

1. 直接 API `createSession` 已恢复成功
   - session：
     - `ses_2d55a525dffe4CWDqrnWoC9JJj`
   - 返回：
     - `version = 1.3.2`
2. Qin pod-only compare 已重新跑通
   - session：
     - `ses_2d5584e13ffeZBG8C77mySVBrp`
   - 成功落出：
     - `融合算力调度平台技术方案.docx`

所以当前更准确的结论是：

- pod hosted 路径里，“每个 session 是独立 OpenCode 进程”这件事现在已经真正落地
- 前一阶段阻塞它的，不是 session workspace 设计本身，而是 isolated child runtime 仍在偷走旧 PATH binary
- 这条修复后，才能继续做有意义的 `raw` vs `pod common-work` 质量基线

## 当前外部可达性状态

在最新一轮之后，又补了一次“完全不依赖 SSH”的外部视角探针：

- 入口：
  - `http://192.168.5.10:32765/openwork`
- 模式：
  - `OPENWORK_PROBE_MODE=login_only`
- 结果：
  - `preAuthHealth = timeout`
  - `postPromptHealth = timeout`
  - `fatalError = "The operation was aborted due to timeout"`

这说明当前阻断已经不只是 SSH：

- 从本机到 pod 的 SSH 在 banner 阶段超时
- 从本机到 pod 的公共 Web 入口也已经在 `health/login` 前置阶段超时

该段结论现已过时：

- SSH 虽仍有间歇性抖动，但已足够支撑短命令与构建
- 公共 Web 入口在修复 `openwork-server` 二进制后已恢复到稳定 `200`

## 下一步

当前下一步已经更新为：

1. 在这个修复后的 pod 基线上继续跑正式 `raw vs pod common-work` 样例对比
2. 保留：
   - `downloaded`
   - `no-router`
   - `OPENWORK_DISABLE_SHARED_WORKSPACE_EVENT_TRACKING=1`
   作为当前诊断稳定基线
3. 用正式样例继续核对：
   - `common-work >= raw` 是否已经在修复后的 hosted 路径上站稳
   - 还剩下哪些是真正的内容质量问题，哪些只是配置/密钥问题
4. 在完成正式样例验证后，再决定是否需要把 shared workspace event tracking 逐步放回
5. 之后再把“不要长期绕过规范 push/pull 发布路径、不要把本机产物直接灌到 pod”写进仓库级开发约束
