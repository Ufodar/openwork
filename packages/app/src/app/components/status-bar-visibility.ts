const NON_ADMIN_HIDDEN_TIP_IDS = new Set(["notion"]);

export function filterStatusBarTipIds(tipIds: readonly string[], isAdminUser: boolean): string[] {
  if (isAdminUser) return [...tipIds];
  return tipIds.filter((tipId) => !NON_ADMIN_HIDDEN_TIP_IDS.has(tipId));
}

export function shouldShowStatusBarSettings(isAdminUser: boolean): boolean {
  return isAdminUser;
}
