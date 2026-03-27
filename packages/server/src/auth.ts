import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";
import { readFile, rename, writeFile } from "node:fs/promises";

import type { ServerConfig } from "./types.js";
import { ensureDir, exists, hashToken, shortId } from "./utils.js";
import type { TokenService } from "./tokens.js";
import { provisionUserWorkspace } from "./user-workspaces.js";
import { workspaceTemplateHasOpencodeDir, workspaceTemplateLooksUsable } from "./workspace-template.js";

type AuthUserRecord = {
  id: string;
  username: string;
  passwordSalt: string;
  passwordHash: string;
  token: string;
  workspaceId?: string;
  workspacePath?: string;
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
};

type AuthUserStore = {
  schemaVersion: 1;
  updatedAt: number;
  users: AuthUserRecord[];
};

export type AuthIdentity = {
  id: string;
  username: string;
  createdAt: number;
  lastLoginAt: number | null;
  isAdmin: boolean;
  ownerKey: string;
  workspace?: {
    id: string;
    name: string;
    path: string;
  };
};

const ADMIN_USER_ID = "admin";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "admin123";
const ADMIN_USERNAME_KEY = ADMIN_USERNAME.toLowerCase();
const ADMIN_CREATED_AT = Date.UTC(2026, 0, 1, 0, 0, 0, 0);

function resolveAuthStorePath(config: ServerConfig): string {
  const override = (process.env.OPENWORK_AUTH_STORE ?? "").trim();
  if (override) return resolve(override);

  const configPath = config.configPath?.trim();
  const configDir = configPath ? dirname(configPath) : join(homedir(), ".config", "openwork");
  return join(configDir, "users.json");
}

function normalizeUsername(value: string): string {
  return value.trim();
}

function usernameKey(value: string): string {
  return normalizeUsername(value).toLowerCase();
}

function validateUsername(value: string): string {
  const username = normalizeUsername(value);
  if (!username) {
    throw new Error("用户名不能为空。");
  }
  if (username.length > 64) {
    throw new Error("用户名长度不能超过 64 个字符。");
  }
  return username;
}

function validatePassword(value: string): string {
  const password = String(value ?? "");
  if (password.length < 1 || password.length > 20) {
    throw new Error("密码长度必须在 1 到 20 个字符之间。");
  }
  return password;
}

async function resolveUserWorkspaceTemplateDir(config: ServerConfig): Promise<string> {
  const override = process.env.OPENWORK_USER_WORKSPACE_TEMPLATE_DIR?.trim();
  if (override) return resolve(override);
  const firstWorkspace = config.workspaces[0]?.path?.trim();
  const cwd = process.cwd();
  // Prefer the current repo/process cwd over persisted workspace catalog entries.
  // In hosted mode the first configured workspace can itself be a stale user workspace,
  // which would otherwise cause newly provisioned user workspaces to keep cloning old assets.
  const candidates = [cwd, firstWorkspace]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => resolve(value));

  for (const candidate of candidates) {
    if (await workspaceTemplateHasOpencodeDir(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (await workspaceTemplateLooksUsable(candidate)) {
      return candidate;
    }
  }

  if (firstWorkspace) return resolve(firstWorkspace);
  return cwd;
}

function hashPassword(password: string, saltHex: string): string {
  return createHash("sha256").update(`${saltHex}:${password}`).digest("hex");
}

async function readStore(path: string): Promise<AuthUserStore> {
  if (!(await exists(path))) {
    return { schemaVersion: 1, updatedAt: Date.now(), users: [] };
  }
  try {
    const raw = await readFile(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<AuthUserStore>;
    const users = Array.isArray(parsed.users)
      ? parsed.users
        .map((item) => {
          const user = item as Partial<AuthUserRecord>;
          const id = typeof user.id === "string" ? user.id.trim() : "";
          const username = typeof user.username === "string" ? normalizeUsername(user.username) : "";
          const passwordSalt = typeof user.passwordSalt === "string" ? user.passwordSalt.trim() : "";
          const passwordHash = typeof user.passwordHash === "string" ? user.passwordHash.trim() : "";
          const token = typeof user.token === "string" ? user.token.trim() : "";
          const workspaceId = typeof user.workspaceId === "string" ? user.workspaceId.trim() : "";
          const workspacePath = typeof user.workspacePath === "string" ? user.workspacePath.trim() : "";
          const createdAt = typeof user.createdAt === "number" ? user.createdAt : Date.now();
          const updatedAt = typeof user.updatedAt === "number" ? user.updatedAt : createdAt;
          const lastLoginAt = typeof user.lastLoginAt === "number" ? user.lastLoginAt : undefined;
          if (!id || !username || !passwordSalt || !passwordHash || !token) return null;
          if (usernameKey(username) === ADMIN_USERNAME_KEY) return null;
          return {
            id,
            username,
            passwordSalt,
            passwordHash,
            token,
            ...(workspaceId && workspacePath ? { workspaceId, workspacePath } : {}),
            createdAt,
            updatedAt,
            ...(lastLoginAt ? { lastLoginAt } : {}),
          } satisfies AuthUserRecord;
        })
        .filter((item): item is AuthUserRecord => Boolean(item))
      : [];
    return { schemaVersion: 1, updatedAt: Date.now(), users };
  } catch {
    return { schemaVersion: 1, updatedAt: Date.now(), users: [] };
  }
}

async function writeStore(path: string, users: AuthUserRecord[]): Promise<void> {
  await ensureDir(dirname(path));
  const payload: AuthUserStore = {
    schemaVersion: 1,
    updatedAt: Date.now(),
    users,
  };
  const tmp = `${path}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf8");
  await rename(tmp, path);
}

function secureEquals(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export class AuthService {
  private config: ServerConfig;
  private path: string;
  private users: AuthUserRecord[] = [];
  private loaded = false;
  private tokens: TokenService;
  private adminOwnerKey: string;
  private adminLastLoginAt: number | null = null;

  constructor(config: ServerConfig, tokens: TokenService) {
    this.config = config;
    this.path = resolveAuthStorePath(config);
    this.tokens = tokens;
    this.adminOwnerKey = hashToken(config.hostToken);
  }

  private isAdminUsername(value: string): boolean {
    return usernameKey(value) === ADMIN_USERNAME_KEY;
  }

  private buildAdminIdentity(lastLoginAt: number | null = null): AuthIdentity {
    return {
      id: ADMIN_USER_ID,
      username: ADMIN_USERNAME,
      createdAt: ADMIN_CREATED_AT,
      lastLoginAt,
      isAdmin: true,
      ownerKey: this.adminOwnerKey,
    };
  }

  private toAuthIdentity(user: AuthUserRecord): AuthIdentity {
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
      isAdmin: false,
      ownerKey: hashToken(user.token),
      workspace: user.workspaceId && user.workspacePath
        ? {
          id: user.workspaceId,
          name: user.username,
          path: user.workspacePath,
        }
        : undefined,
    };
  }

  private async toAuthIdentityEnsuringWorkspace(user: AuthUserRecord): Promise<AuthIdentity> {
    const workspace = await this.ensureUserWorkspace(user);
    return {
      id: user.id,
      username: user.username,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt ?? null,
      isAdmin: false,
      ownerKey: hashToken(user.token),
      workspace,
    };
  }
  private async ensureUserWorkspace(user: AuthUserRecord) {
    const templateDir = await resolveUserWorkspaceTemplateDir(this.config);
    const provisioned = await provisionUserWorkspace({
      userId: user.id,
      templateDir,
    });

    if (
      user.workspaceId?.trim() !== provisioned.workspaceId ||
      user.workspacePath?.trim() !== provisioned.workspacePath
    ) {
      user.workspaceId = provisioned.workspaceId;
      user.workspacePath = provisioned.workspacePath;
      user.updatedAt = Date.now();
      await writeStore(this.path, this.users);
    }
    return {
      id: provisioned.workspaceId,
      name: user.username,
      path: provisioned.workspacePath,
    };
  }

  async listUsers(): Promise<AuthIdentity[]> {
    await this.ensureLoaded();
    return [
      this.buildAdminIdentity(this.adminLastLoginAt),
      ...this.users.map((user) => this.toAuthIdentity(user)),
    ];
  }

  async getUserById(id: string): Promise<AuthIdentity | null> {
    await this.ensureLoaded();
    const target = id.trim();
    if (!target) return null;
    if (target === ADMIN_USER_ID) {
      return this.buildAdminIdentity(this.adminLastLoginAt);
    }
    const user = this.users.find((item) => item.id === target);
    return user ? this.toAuthIdentityEnsuringWorkspace(user) : null;
  }

  async getUserByOwnerKey(ownerKey: string): Promise<AuthIdentity | null> {
    await this.ensureLoaded();
    const target = ownerKey.trim();
    if (!target) return null;
    if (target === this.adminOwnerKey) {
      return this.buildAdminIdentity(this.adminLastLoginAt);
    }
    const user = this.users.find((item) => hashToken(item.token) === target);
    return user ? this.toAuthIdentityEnsuringWorkspace(user) : null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const store = await readStore(this.path);
    this.users = store.users;
    this.loaded = true;
  }

  async register(input: { username: string; password: string }) {
    await this.ensureLoaded();
    const username = validateUsername(input.username);
    const password = validatePassword(input.password);
    if (this.isAdminUsername(username)) {
      throw new Error("用户名已存在。");
    }
    if (this.users.some((user) => usernameKey(user.username) === usernameKey(username))) {
      throw new Error("用户名已存在。");
    }

    const createdAt = Date.now();
    const salt = randomBytes(16).toString("hex");
    const passwordHash = hashPassword(password, salt);
    const token = `owu_${shortId().replace(/-/g, "")}`;
    await this.tokens.registerToken(token, "collaborator", { label: `user:${username}` });

    const userId = shortId();
    const provisionedWorkspace = await provisionUserWorkspace({
      userId,
      templateDir: await resolveUserWorkspaceTemplateDir(this.config),
    });

    const user: AuthUserRecord = {
      id: userId,
      username,
      passwordSalt: salt,
      passwordHash,
      token,
      workspaceId: provisionedWorkspace.workspaceId,
      workspacePath: provisionedWorkspace.workspacePath,
      createdAt,
      updatedAt: createdAt,
      lastLoginAt: createdAt,
    };
    this.users = [user, ...this.users];
    await writeStore(this.path, this.users);
    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt ?? null,
      },
      workspace: {
        id: provisionedWorkspace.workspaceId,
        name: user.username,
        path: provisionedWorkspace.workspacePath,
      },
    };
  }

  async login(input: { username: string; password: string }) {
    await this.ensureLoaded();
    const username = validateUsername(input.username);
    const password = validatePassword(input.password);
    if (this.isAdminUsername(username)) {
      if (password !== ADMIN_PASSWORD) {
        throw new Error("用户名或密码错误。");
      }
      this.adminLastLoginAt = Date.now();
      const admin = this.buildAdminIdentity(this.adminLastLoginAt);
      return {
        token: this.config.hostToken,
        user: {
          id: admin.id,
          username: admin.username,
          createdAt: admin.createdAt,
          lastLoginAt: admin.lastLoginAt,
        },
      };
    }
    const user = this.users.find((item) => usernameKey(item.username) === usernameKey(username));
    if (!user) {
      throw new Error("用户名或密码错误。");
    }

    const expected = hashPassword(password, user.passwordSalt);
    if (!secureEquals(expected, user.passwordHash)) {
      throw new Error("用户名或密码错误。");
    }

    // Ensure token is still present in the token store (for old/migrated data).
    await this.tokens.registerToken(user.token, "collaborator", { label: `user:${username}` });

    const now = Date.now();
    user.lastLoginAt = now;
    user.updatedAt = now;
    const workspace = await this.ensureUserWorkspace(user);
    await writeStore(this.path, this.users);

    return {
      token: user.token,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        lastLoginAt: user.lastLoginAt ?? null,
      },
      workspace,
    };
  }
}
