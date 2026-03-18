import type { OpenworkServerSettings } from "./openwork-server";
import { SESSION_MODEL_PREF_KEY } from "../constants";

export const OPENWORK_WEB_AUTH_USER_KEY = "openwork.web.auth.user";
export const SESSION_BY_WORKSPACE_KEY = "openwork.workspace-last-session.v1";
export const OPENWORK_SESSION_PREFS_LOCAL_STORAGE_KEY = "openwork.sessionPrefs.v1";

type RemovableStorage = Pick<Storage, "removeItem"> &
  Partial<Pick<Storage, "length" | "key">>;

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

export function clearWebLogoutStorage(storage?: RemovableStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(OPENWORK_WEB_AUTH_USER_KEY);
    storage.removeItem(SESSION_BY_WORKSPACE_KEY);
    storage.removeItem(OPENWORK_SESSION_PREFS_LOCAL_STORAGE_KEY);

    const length = typeof storage.length === "number" ? storage.length : 0;
    const keys: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const key = storage.key?.(index);
      if (key) keys.push(key);
    }

    for (const key of keys) {
      if (key.startsWith(`${SESSION_MODEL_PREF_KEY}.`)) {
        storage.removeItem(key);
      }
    }
  } catch {
    // ignore
  }
}
