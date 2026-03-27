# session list / runtime maintenance 误启动 isolated runtime 修复（2026-03-27）

## 背景

- pod 在已经有真实用户使用的情况下再次出现“看起来没完全挂，但 `8789`/`/openwork/health` 超时”的现象。
- 现场特征不是主进程消失，而是：
  - 根页面还能返回 `200`
  - `127.0.0.1:8789/health` 与 `127.0.0.1:32765/openwork/health` 超时
  - 进程表里出现大量：
    - `opencode serve --hostname 127.0.0.1 --port ...`

## 根因

- 问题不在“每个活跃 session 一个独立 OpenCode 进程”这个方向本身。
- 真正的问题是两条不该启动 isolated runtime 的路径，也调用了会启动 runtime 的 `resolveSessionWorkspace()`：
  - `listWorkspaceSessions()`
  - `ensureRuntimeActivitySubscriptions()`
- 结果是：
  - 用户一打开会话列表/工作区视图
  - 或维护状态轮询运行
  - server 就可能把大量历史 session 的 isolated runtime 一起拉起来
- 在 pod 上，这会把 `openwork-server` 拖到近似不可用，随后又触发：
  - `GET /w/.../opencode/session 500`
  - `GET /opencode-router/health 503`
  - sidecar 退出
  - orchestrator 关停

## 修复思路

- 保留“活跃 session 独立 runtime”。
- 但收紧为：
  - 列表页只允许读取：
    - 已经运行中的 runtime
    - 或 `openwork.json` / runtime 目录里的历史恢复元数据
  - 维护轮询只允许订阅：
    - 已经运行中的 runtime
  - 不再因为只读状态查询去启动新的 isolated runtime

## 代码修改

- `packages/server/src/session-opencode-runtime.ts`
  - 新增 `peekSessionWorkspace(...)`
  - 只查看某个 isolated runtime 是否已经在跑，不负责启动
- `packages/server/src/server.ts`
  - `listWorkspaceSessions()`：
    - 对 isolated session，不再直接 `resolveSessionWorkspace()`
    - 优先读取 `peekSessionWorkspace()`
    - 若未运行，则使用恢复元数据或最小占位记录返回
  - `ensureRuntimeActivitySubscriptions()`：
    - 只对已运行 runtime 调 `ensureSessionRuntime()`
    - 不再通过 `resolveSessionWorkspace()` 启动新的 child runtime

## 测试

- 新增/更新：
  - `packages/server/src/session-opencode-runtime.test.ts`
  - `packages/server/src/server.proxy-session-list.test.ts`
  - `packages/server/src/server.runtime-maintenance.test.ts`
- 本地验证：
  - `bun test packages/server/src/session-opencode-runtime.test.ts packages/server/src/server.proxy-session-list.test.ts packages/server/src/server.runtime-maintenance.test.ts`
  - 结果：`8 pass / 0 fail`

## pod 落地

- 已把以下源码同步到 pod：
  - `packages/server/src/server.ts`
  - `packages/server/src/session-opencode-runtime.ts`
- 然后在 pod 上直接重编：
  - `packages/server/dist/bin/openwork-server`
- 重编后，先清掉失控的 stack，再用手工脚本重新拉起：
  - 两条 `serve-web-prod.mjs`
  - 一条 `openwork serve ... --opencode-source downloaded ...`

## live 结果

- 恢复脚本输出：
  - `WEB1=1641249`
  - `WEB2=1641250`
  - `ORCH=1641251`
  - `8789=up`
  - `32765=up`
  - `CHILD_COUNT=0`
- 延迟复检：
  - `8789=up`
  - `32765=up`
  - `CHILD_COUNT=2`
- 当前解释：
  - child runtime 不再一上来暴涨到几十个
  - 只剩少量真实活跃 session 对应的 child runtime
  - 这符合“per-session runtime 只服务活跃 session”的目标

## 当前判断

- 用户的担心是对的：
  - “如果 session 一多，每个 session 一个 opencode 进程，会不会变成性能问题？”
- 回答是：
  - 如果给所有历史 session 都启动进程，会出问题
  - 如果只给活跃 session 启动，并做空闲回收，这个模型是成立的
- 这轮修复做的就是把系统从前者拉回后者。
