/**
 * 注册用户管理
 * - 用户（role = "user"）仅拥有"下载公开存储文件"的权限
 * - 与管理员（env 配置）分离，存于 users 表，密码使用 PBKDF2 哈希
 */
import { hashPassword, verifyPassword } from "./security";

export type AppUserRole = "user";

export interface AppUser {
  id: number;
  username: string;
  role: AppUserRole;
  createdAt: string;
  updatedAt: string;
}

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

function rowToUser(row: UserRow): AppUser {
  return {
    id: row.id,
    username: row.username,
    role: (row.role as AppUserRole) || "user",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface UserInput {
  username: string;
  password: string;
  role?: AppUserRole;
}

/** 校验用户名/密码是否合法，返回错误信息或 null（合法） */
export function validateUserInput(
  username: string,
  password: string,
  opts: { isUpdate?: boolean } = {}
): string | null {
  const u = (username || "").trim();
  if (u.length < 2) return "用户名至少 2 个字符";
  if (u.length > 64) return "用户名最长 64 个字符";
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) return "用户名只能包含字母、数字、下划线、点或短横线";
  // 更新时允许不改密码
  if (!opts.isUpdate || password) {
    if (password.length < 6) return "密码至少 6 个字符";
    if (password.length > 128) return "密码最长 128 个字符";
  }
  return null;
}

export async function getUserById(db: D1Database, id: number): Promise<AppUser | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function getUserByUsername(
  db: D1Database,
  username: string
): Promise<(AppUser & { passwordHash: string }) | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE username = ?")
    .bind(username.trim())
    .first<UserRow>();
  if (!row) return null;
  return { ...rowToUser(row), passwordHash: row.password_hash };
}

export async function listUsers(db: D1Database): Promise<AppUser[]> {
  const result = await db
    .prepare("SELECT * FROM users ORDER BY created_at DESC")
    .all<UserRow>();
  return (result.results ?? []).map(rowToUser);
}

export async function createUser(
  db: D1Database,
  input: UserInput
): Promise<AppUser> {
  const username = input.username.trim();
  const passwordHash = await hashPassword(input.password);
  const role = input.role || "user";

  const row = await db
    .prepare(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?) RETURNING *"
    )
    .bind(username, passwordHash, role)
    .first<UserRow>();

  if (!row) throw new Error("Failed to create user");
  return rowToUser(row);
}

export async function updateUser(
  db: D1Database,
  id: number,
  input: Partial<UserInput>
): Promise<AppUser | null> {
  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (input.username !== undefined) {
    updates.push("username = ?");
    values.push(input.username.trim());
  }
  if (input.password) {
    updates.push("password_hash = ?");
    values.push(await hashPassword(input.password));
  }
  if (input.role !== undefined) {
    updates.push("role = ?");
    values.push(input.role);
  }
  if (updates.length === 0) return getUserById(db, id);

  updates.push("updated_at = datetime('now')");
  values.push(id);

  const row = await db
    .prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ? RETURNING *`)
    .bind(...values)
    .first<UserRow>();
  return row ? rowToUser(row) : null;
}

export async function deleteUser(db: D1Database, id: number): Promise<boolean> {
  const result = await db.prepare("DELETE FROM users WHERE id = ?").bind(id).run();
  return (result.meta?.changes ?? 0) > 0;
}

/** 校验用户名密码，成功返回用户，失败返回 null */
export async function validateUserCredentials(
  db: D1Database,
  username: string,
  password: string
): Promise<AppUser | null> {
  const user = await getUserByUsername(db, username);
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  return ok ? user : null;
}
