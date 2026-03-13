# Pod Script Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the pod lifecycle workflow down to two main commands and fix the missing `file` dependency on fresh pod bootstraps.

**Architecture:** Keep `start-pod.sh` for initial bootstrap, keep `restart-pod.sh` for daily operations, and move pull logic into `restart-pod.sh` so the old `pod-pull-restart.sh` path can be retired. Mirror all touched lifecycle scripts into `packaging/docker/workspace/scripts`.

**Tech Stack:** Bash shell scripts, Markdown docs, git diff verification

---

### Task 1: Document the approved cleanup

**Files:**
- Create: `docs/plans/2026-03-13-pod-script-cleanup-design.md`
- Create: `docs/plans/2026-03-13-pod-script-cleanup-implementation.md`

**Step 1: Record the lifecycle split**

Document:

- why `start-pod.sh` remains
- why `restart-pod.sh` absorbs pull behavior
- why `pod-pull-restart.sh` can be removed from the primary workflow

**Step 2: Record the runtime dependency fix**

Document that fresh pod bootstrap must install `file`.

### Task 2: Add missing runtime tools to bootstrap

**Files:**
- Modify: `scripts/start-pod.sh`
- Modify: `packaging/docker/workspace/scripts/start-pod.sh`

**Step 1: Update apt package detection**

Ensure the bootstrap path installs:

- `file`
- `lsof`

**Step 2: Preserve the rest of the current bootstrap contract**

Do not expand scope beyond small runtime/tooling fixes.

### Task 3: Merge pull behavior into `restart-pod.sh`

**Files:**
- Modify: `scripts/restart-pod.sh`
- Modify: `packaging/docker/workspace/scripts/restart-pod.sh`

**Step 1: Add argument parsing**

Support:

- default restart
- `--pull`
- `--help`

**Step 2: Inline the pull logic**

Move the current pull behavior from `pod-pull-restart.sh` into `restart-pod.sh`.

**Step 3: Keep env-driven auto-pull**

Preserve `OPENWORK_PULL_BEFORE_RESTART=1` behavior.

### Task 4: Remove `pod-pull-restart.sh` from the key path

**Files:**
- Delete: `scripts/pod-pull-restart.sh`
- Delete: `packaging/docker/workspace/scripts/pod-pull-restart.sh`

**Step 1: Remove user-facing references**

Delete the old wrapper and remove any remaining user-facing references to it.

### Task 5: Update docs and examples

**Files:**
- Modify: `README.md`
- Modify: `scripts/secrets.env.example`
- Modify: `packaging/docker/workspace/scripts/secrets.env.example`

**Step 1: Rewrite pod workflow docs**

State clearly:

- one-time commands
- daily command
- optional helper commands

**Step 2: Update secret comments**

Replace references to `pod-pull-restart.sh` as a supported command.

### Task 6: Verify the result

**Files:**
- Test: `scripts/start-pod.sh`
- Test: `scripts/restart-pod.sh`
- Test: `packaging/docker/workspace/scripts/start-pod.sh`
- Test: `packaging/docker/workspace/scripts/restart-pod.sh`

**Step 1: Shell syntax validation**

Run:

```bash
bash -n scripts/start-pod.sh scripts/restart-pod.sh
bash -n packaging/docker/workspace/scripts/start-pod.sh packaging/docker/workspace/scripts/restart-pod.sh
```

Expected: no output, exit 0.

**Step 2: Targeted regression checks**

Run:

```bash
rg -n "pkgs\\+=\\(file|pkgs\\+=\\(lsof|command -v file|command -v lsof" scripts/start-pod.sh packaging/docker/workspace/scripts/start-pod.sh
rg -n -- "--pull|pull_requested|git_pull_ff_only|auto_restore_common_pod_local_changes" scripts/restart-pod.sh packaging/docker/workspace/scripts/restart-pod.sh
```

Expected: the new bootstrap and pull logic are present.

**Step 3: Review the diff**

Run:

```bash
git diff -- README.md scripts scripts/secrets.env.example packaging/docker/workspace/scripts
```

Expected: only the planned lifecycle/script-cleanup changes appear.
