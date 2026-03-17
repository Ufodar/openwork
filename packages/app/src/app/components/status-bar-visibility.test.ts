import { describe, expect, test } from "bun:test";

import {
  filterStatusBarTipIds,
  shouldShowStatusBarSettings,
} from "./status-bar-visibility";

describe("status bar visibility", () => {
  test("hides the Notion tip for non-admin users", () => {
    expect(filterStatusBarTipIds(["slack", "notion", "providers"], false)).toEqual([
      "slack",
      "providers",
    ]);
  });

  test("keeps the Notion tip for admin users", () => {
    expect(filterStatusBarTipIds(["slack", "notion", "providers"], true)).toEqual([
      "slack",
      "notion",
      "providers",
    ]);
  });

  test("only shows the settings button for admin users", () => {
    expect(shouldShowStatusBarSettings(false)).toBe(false);
    expect(shouldShowStatusBarSettings(true)).toBe(true);
  });
});
