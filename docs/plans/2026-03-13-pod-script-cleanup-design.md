# Pod Script Cleanup Design

## Goal

Reduce the number of pod lifecycle commands the operator needs to remember, while fixing the missing `file` dependency in fresh pod setups.

## Current Problems

- The remote pod currently misses `file`, even after the documented pod bootstrap path.
- Daily restart behavior is split between `restart-pod.sh` and `pod-pull-restart.sh`.
- README and secrets comments still point users at the older split, making the pod workflow harder to remember.
- The repository also contains mirrored script copies under `packaging/docker/workspace/scripts`, so drift is a maintenance risk.

## Chosen Design

### 1. Keep two public lifecycle entrypoints

Retain:

- `scripts/start-pod.sh` for first boot on a fresh pod
- `scripts/restart-pod.sh` for day-to-day restarts

This keeps lifecycle boundaries clear:

- fresh pod = install runtimes and document toolchain once
- existing pod = restart the stack quickly

### 2. Reduce day-to-day cognitive load to one restart command

`restart-pod.sh` will absorb the pull-and-restart logic and support:

- plain `bash scripts/restart-pod.sh`
- `bash scripts/restart-pod.sh --pull`
- automatic pull via `OPENWORK_PULL_BEFORE_RESTART=1`

`pod-pull-restart.sh` is removed from the primary workflow entirely.

### 3. Fix the missing runtime toolchain

`start-pod.sh` should install the tools that document workflows and pod helper scripts actually depend on. At minimum this includes:

- `file` because the current pod is missing it
- `lsof` because restart logic depends on it

`rsync` remains optional because the sync helper already has a tar-over-ssh fallback.

### 4. Clarify the real script surface

The user-facing pod workflow should be:

- one-time: `pod-init-secrets.sh`, then `start-pod.sh`
- daily: `restart-pod.sh`
- optional local helpers: `openwork-pod-tunnel.sh`, `sync-skills-to-pod.sh`

### 5. Keep mirrored packaging scripts aligned

Any lifecycle-script changes in `scripts/` must be mirrored into `packaging/docker/workspace/scripts/` to avoid drift between the repo and packaged workspace template.

## Success Criteria

- A fresh pod bootstrap installs `file`.
- `restart-pod.sh` can handle pull + restart directly.
- `pod-pull-restart.sh` is no longer part of the user-facing workflow.
- README and secret comments reflect the simplified workflow.
- Root and packaging script copies stay aligned for touched files.
