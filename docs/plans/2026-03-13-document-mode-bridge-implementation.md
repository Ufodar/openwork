# Document Mode Bridge Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimal document-mode plugin and deploy the same logic to the pod runtime.

**Architecture:** Keep the logic as a standalone OpenCode plugin that uses only Node built-ins. The repository stores the canonical source, while the pod receives a deployed global plugin copy so every document workspace can benefit.

**Tech Stack:** OpenCode plugins, JavaScript, Node built-ins, pod global OpenCode config.

---

### Task 1: Add the repository plugin

**Files:**
- Create: `.opencode/plugins/document-mode-bridge.js`

**Steps:**
1. Add a conservative workspace classifier for document-heavy workspaces.
2. Implement `experimental.chat.system.transform` to inject document-mode orchestration guidance.
3. Implement `experimental.session.compacting` to preserve document continuation state.

### Task 2: Document the design

**Files:**
- Create: `docs/plans/2026-03-13-document-mode-bridge-design.md`
- Create: `docs/plans/2026-03-13-document-mode-bridge-implementation.md`

**Steps:**
1. Record why the bridge exists.
2. Record why third-party packages are not being forked yet.
3. Record the boundary between routing, planning, and memory.

### Task 3: Deploy runtime config on the pod

**Files:**
- Modify remotely: `~/.config/opencode/opencode.json`
- Create remotely: `~/.config/opencode/plugins/document-mode-bridge.js`
- Create remotely: `~/.config/opencode/opencode-mem.jsonc`

**Steps:**
1. Deny `bid-*` skills through `permission.skill`.
2. Install the document-mode bridge as a global local-file plugin.
3. Add `opencode-mem` as an npm plugin and write the minimal config required for the current provider.

### Task 4: Restart and verify

**Steps:**
1. Restart the pod runtime.
2. Verify the bridge plugin file exists in the global plugin directory.
3. Verify `opencode-mem` configuration exists.
4. Verify the memory web UI port is listening if the plugin starts successfully.
