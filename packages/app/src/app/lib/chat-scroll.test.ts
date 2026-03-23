import { describe, expect, test } from "bun:test";

import { preserveScrollPositionOnToggle } from "./chat-scroll";

describe("preserveScrollPositionOnToggle", () => {
  test("restores the previous scrollTop when the user is away from the bottom", () => {
    const container = {
      scrollTop: 240,
      scrollHeight: 1000,
      clientHeight: 400,
    };
    const scheduled: Array<() => void> = [];

    preserveScrollPositionOnToggle(
      container,
      () => {
        container.scrollTop = 610;
        container.scrollHeight = 1360;
      },
      {
        threshold: 96,
        schedule: (cb) => {
          scheduled.push(cb);
        },
      },
    );

    expect(scheduled).toHaveLength(1);

    scheduled[0]!();

    expect(container.scrollTop).toBe(240);
  });

  test("does not restore when the user is already near the bottom", () => {
    const container = {
      scrollTop: 560,
      scrollHeight: 1000,
      clientHeight: 400,
    };
    const scheduled: Array<() => void> = [];

    preserveScrollPositionOnToggle(
      container,
      () => {
        container.scrollTop = 620;
        container.scrollHeight = 1120;
      },
      {
        threshold: 96,
        schedule: (cb) => {
          scheduled.push(cb);
        },
      },
    );

    expect(scheduled).toHaveLength(0);
    expect(container.scrollTop).toBe(620);
  });

  test("still runs the update when no scroll container is available", () => {
    let invoked = false;

    preserveScrollPositionOnToggle(undefined, () => {
      invoked = true;
    });

    expect(invoked).toBe(true);
  });
});
