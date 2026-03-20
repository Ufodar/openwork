import { describe, expect, test } from "bun:test";

import { reconcileOpenworkServerProbe, type OpenworkServerProbeState } from "./openwork-server-status";

const connectedState = (): OpenworkServerProbeState => ({
  status: "connected",
  capabilities: {
    skills: { read: true, write: true, source: "openwork" },
    plugins: { read: true, write: true },
    mcp: { read: true, write: true },
    commands: { read: true, write: true },
    config: { read: true, write: true },
  },
  disconnectStreak: 0,
});

describe("reconcileOpenworkServerProbe", () => {
  test("keeps the previous connected state across one transient failure", () => {
    const next = reconcileOpenworkServerProbe(connectedState(), {
      status: "disconnected",
      capabilities: null,
    });

    expect(next.status).toBe("connected");
    expect(next.capabilities).not.toBeNull();
    expect(next.disconnectStreak).toBe(1);
  });

  test("marks the server disconnected after consecutive failures", () => {
    const first = reconcileOpenworkServerProbe(connectedState(), {
      status: "disconnected",
      capabilities: null,
    });
    const second = reconcileOpenworkServerProbe(first, {
      status: "disconnected",
      capabilities: null,
    });

    expect(second.status).toBe("disconnected");
    expect(second.capabilities).toBeNull();
    expect(second.disconnectStreak).toBe(2);
  });

  test("resets the disconnect streak after a healthy response", () => {
    const recovered = reconcileOpenworkServerProbe(
      {
        ...connectedState(),
        disconnectStreak: 1,
      },
      {
        status: "connected",
        capabilities: {
          skills: { read: true, write: false, source: "opencode" },
          plugins: { read: true, write: false },
          mcp: { read: true, write: false },
          commands: { read: true, write: false },
          config: { read: true, write: false },
        },
      },
    );

    expect(recovered.status).toBe("connected");
    expect(recovered.disconnectStreak).toBe(0);
    expect(recovered.capabilities?.skills.source).toBe("opencode");
  });
});
