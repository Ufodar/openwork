# Safe Restart And Hosted OpenCode Design

## Goal

Make hosted pod restarts safe by default, support an explicit force path, and stop routing hosted production traffic through a mutable global `opencode` binary.

## Root Cause

- Hosted document sessions can be interrupted mid-tool-call when `restart-pod.sh` kills the orchestrator/OpenCode stack in place.
- The current restart path has no drain state, so new work can still start while an operator is preparing to restart.
- Hosted pods currently force `--opencode-source external`, so runtime behavior depends on `/root/.local/bin/opencode` plus legacy env pins instead of a managed, versioned OpenCode binary.

## Design

### 1. Server-owned restart state

The OpenWork server owns a small runtime-maintenance state machine:

- `idle`
- `draining`
- `restarting`

This is host-only control state. It exists so `restart-pod.sh` can negotiate with the running server instead of killing processes blindly.

### 2. Live active-session tracking

The server maintains a best-effort active-session index per workspace by combining:

- explicit `prompt_async` / prompt starts
- upstream OpenCode SSE events (`session.status`, `session.idle`)
- session deletion cleanup

This gives the restart path an authoritative answer to:

- how many runs are still active
- which sessions need an `abort` before a forced restart

### 3. Drain semantics

Once the server enters `draining`:

- allow in-flight runs to finish
- reject new session creation
- reject new prompts on existing sessions
- continue serving read APIs, deletions, and status checks

The key product rule is: no new work starts after drain begins.

### 4. Safe restart flow

`restart-pod.sh` becomes safe-by-default:

1. Ask the running server to enter `draining`
2. Poll runtime status until active sessions reach `0`
3. Kill old processes
4. Start the new stack

If the running server does not support the drain API yet, the script logs that this is a legacy rollout restart and falls back to the current disruptive behavior once.

### 5. Forced restart flow

`restart-pod.sh --force`:

1. Tells the server to enter `restarting`
2. Enumerates active sessions
3. Sends `POST /session/{id}/abort` to each active session as a best-effort stop
4. Waits a short grace period
5. Proceeds with process shutdown even if some sessions remain

This keeps the force path explicit while still trying to leave OpenCode session state consistent.

### 6. Hosted OpenCode binary governance

Hosted pods should stop defaulting to the global external OpenCode binary.

The target behavior is:

- keep `~/.config/opencode/opencode.json` as the shared provider/model config
- keep global `opencode` installed only as a fallback/debug tool
- run hosted traffic with a managed OpenCode binary source
- default hosted `opencode` source to `downloaded`
- ignore legacy `OPENWORK_OPENCODE_SOURCE=external` pins unless an operator explicitly opts back in

`openwork-server` and `opencode-router` can continue to use the freshly built local binaries passed by `restart-pod.sh`; the problem is specifically the hosted `opencode` runtime default.

## Rollout Notes

- The first deployment of this feature may still require one disruptive restart, because the old server binary has no drain API to talk to.
- After that rollout, subsequent restarts can use the safe path.
- Existing `~/.config/opencode/opencode.json` must be preserved through the migration.

## Success Criteria

- `restart-pod.sh` waits for active sessions to finish by default.
- `restart-pod.sh --force` exists and first attempts `session.abort`.
- Draining blocks new prompts and new sessions at the server boundary.
- Hosted restarts no longer default to `--opencode-source external`.
- Legacy env pins cannot silently pull hosted production traffic back onto `/root/.local/bin/opencode`.
