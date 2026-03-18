import type { OpenworkServerSettings } from "./openwork-server";

export const OPENWORK_WEB_AUTH_USER_KEY = "openwork.web.auth.user";

export function readWebAuthUser(storage?: Pick<Storage, "getItem"> | null): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(OPENWORK_WEB_AUTH_USER_KEY);
    const value = raw?.trim() ?? "";
    return value || null;
  } catch {
    return null;
  }
}

export function writeWebAuthUser(
  username: string | null,
  storage?: Pick<Storage, "removeItem" | "setItem"> | null,
): void {
  if (!storage) return;
  try {
    const value = username?.trim() ?? "";
    if (value) {
      storage.setItem(OPENWORK_WEB_AUTH_USER_KEY, value);
    } else {
      storage.removeItem(OPENWORK_WEB_AUTH_USER_KEY);
    }
  } catch {
    // ignore
  }
}

export function clearOpenworkWebSession(current: OpenworkServerSettings): OpenworkServerSettings {
  const next: OpenworkServerSettings = { ...current };
  delete next.token;
  return next;
}
