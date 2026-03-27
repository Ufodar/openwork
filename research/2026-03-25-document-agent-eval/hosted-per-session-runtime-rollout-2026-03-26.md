# Hosted Per-Session Runtime Rollout

时间：2026-03-26

## 背景

- 之前的 hosted 隔离只完成了：
  - session workspace 独立
  - session temp root 下沉到 `<WORKSPACE>/.tmp/system`
- 但 OpenCode 自己的运行态全局状态仍然挂在共享进程级目录上，例如：
  - `XDG_DATA_HOME`
  - `XDG_STATE_HOME`
  - `XDG_CACHE_HOME`
  - `tool-output` 一类派生目录
- 这意味着：
  - session cwd 虽然隔离了
  - OpenCode 运行态却没有真正 session 化

## 这轮决策

- 不修改 OpenCode 源码。
- 不靠继续放开 `external_directory` 来掩盖隔离缺口。
- 改由 OpenWork server 在 hosted 模式下提供：
  - per-session OpenCode runtime directory
  - per-session `OPENCODE_CONFIG_DIR`
  - per-session `XDG_DATA_HOME`
  - per-session `XDG_STATE_HOME`
  - per-session `XDG_CACHE_HOME`
  - per-session `opencode serve` 进程

## 已完成实现

- 新增 `SessionOpencodeRuntimeService`
  - 文件：
    - `packages/server/src/session-opencode-runtime.ts`
    - `packages/server/src/session-opencode-runtime.test.ts`
- `SessionWorkspaceService` 现在会持久化 isolated runtime 元数据
  - 文件：
    - `packages/server/src/session-workspaces.ts`
    - `packages/server/src/session-workspaces.test.ts`
- `proxyOpencodeRequest` 已接入 per-session runtime：
  - 新建 session 时可先拉起 session-owned OpenCode runtime
  - session 路由会优先走该 session 自己的 `baseUrl`
  - 删除 session 时会一并 dispose 对应 runtime
- `SessionActivityService` 已从“workspace 级事件流”扩展为：
  - shared workspace stream
  - isolated session stream
  - isolated prompt run 会优先订阅 `workspaceId + sessionId` 对应的 session-owned `/event`
- runtime maintenance 相关路径也已接上：
  - 会补订阅 isolated session runtime
  - 强制 abort 时不会再默认把 isolated session 当成共享 workspace session 来打
- pod 启动脚本默认导出：
  - `OPENWORK_SESSION_RUNTIME_MODE=process`

## 为什么这样改

- 这条路径比继续加 prompt 纪律更根治。
- 这条路径不依赖 OpenCode 未文档化能力。
- 这条路径不会把多用户 hosted 的宿主机目录继续放开。
- 这条路径能同时减少：
  - `tool-output` 串 session
  - XDG 级缓存/状态污染
  - 共享运行态导致的行为漂移

## 已验证

- 通过的测试：
  - `packages/server/src/session-activity.test.ts`
  - `packages/server/src/server.proxy-session-activity.test.ts`
  - `packages/server/src/session-workspaces.test.ts`
  - `packages/server/src/session-opencode-runtime.test.ts`
  - `packages/server/src/server.proxy-session-create.test.ts`
  - `packages/server/src/server.proxy-session-list.test.ts`
  - `packages/server/src/server.proxy-runtime-control.test.ts`
  - `packages/server/src/server.knowledge-routes.test.ts`
  - `packages/server/src/server.admin-user-session-scan.test.ts`
  - `packages/server/src/server.admin-user-counts.test.ts`
- `git diff --check` 已通过这轮修改文件

## 仍未完成

- 还没有完成新的 hosted live baseline 重跑。
- `pnpm --filter openwork-server build:bin` 之后，需要把新 server 重新部署到 pod 再看真实 Qin/WJW 路径。
- `bunx tsc -p packages/server/tsconfig.json --noEmit` 仍被一批既有 server/test 类型错误拦住；当前没有发现这轮新增错误残留。

## 下一步

1. 重建 server 二进制。
2. 部署到 pod。
3. 重跑主 baseline：
   - raw OpenCode
   - pod OpenWork `common-work`
4. 重点观察：
   - tool 调用是否继续出现 shared-state 痕迹
   - active session / maintenance 视图是否与 session-owned runtime 一致
   - 最终产物质量是否在这个隔离底座上更稳定
