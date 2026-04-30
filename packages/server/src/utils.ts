import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function readJsonFile<T>(path: string): Promise<T | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function shortId(): string {
  return randomUUID();
}

const ASCENDING_ID_LENGTH = 26;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
let lastAscendingTimestamp = 0;
let ascendingCounter = 0;

function randomBase62(length: number): string {
  let result = "";
  const bytes = randomBytes(length);
  for (let index = 0; index < length; index += 1) {
    result += BASE62[bytes[index] % BASE62.length];
  }
  return result;
}

export function createAscendingPrefixedId(prefix: string, timestamp = Date.now()): string {
  if (timestamp !== lastAscendingTimestamp) {
    lastAscendingTimestamp = timestamp;
    ascendingCounter = 0;
  }
  ascendingCounter += 1;

  const encoded = BigInt(timestamp) * 0x1000n + BigInt(ascendingCounter);
  const timeBytes = Buffer.alloc(6);
  for (let index = 0; index < 6; index += 1) {
    timeBytes[index] = Number((encoded >> BigInt(40 - 8 * index)) & 0xffn);
  }

  return `${prefix}_${timeBytes.toString("hex")}${randomBase62(ASCENDING_ID_LENGTH - 12)}`;
}

export function parseList(input: string | undefined): string[] {
  if (!input) return [];
  const trimmed = input.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item)).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return trimmed
    .split(/[,;]/)
    .map((value) => value.trim())
    .filter(Boolean);
}
