import { describe, expect, test } from "bun:test";

import {
  filterStatusBarTipIds,
  shouldShowStatusBarLogout,
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

  test("shows the logout button only for authenticated web users", () => {
    expect(shouldShowStatusBarLogout({ requiresWebServerAuth: false, hasWebAuthSession: true })).toBe(false);
    expect(shouldShowStatusBarLogout({ requiresWebServerAuth: true, hasWebAuthSession: false })).toBe(false);
    expect(shouldShowStatusBarLogout({ requiresWebServerAuth: true, hasWebAuthSession: true })).toBe(true);
  });
});
