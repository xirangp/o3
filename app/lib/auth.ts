export type UserRole = "guest" | "user" | "admin";

import { verifyPassword, isHashed } from "./security";

export interface Session {
  id: string;
  userType: UserRole;
  expiresAt: Date;
}

export function generateSessionId(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSession(
  db: D1Database,
  userType: UserRole,
  expiresInHours: number = 24
): Promise<string> {
  const sessionId = generateSessionId();
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

  await db
    .prepare(
      "INSERT INTO sessions (id, user_type, expires_at) VALUES (?, ?, ?)"
    )
    .bind(sessionId, userType, expiresAt.toISOString())
    .run();

  return sessionId;
}

export async function getSession(
  db: D1Database,
  sessionId: string
): Promise<Session | null> {
  const result = await db
    .prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')")
    .bind(sessionId)
    .first<{ id: string; user_type: string; expires_at: string }>();

  if (!result) {
    return null;
  }

  return {
    id: result.id,
    userType: result.user_type as UserRole,
    expiresAt: new Date(result.expires_at),
  };
}

export async function deleteSession(
  db: D1Database,
  sessionId: string
): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function cleanExpiredSessions(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

export function getSessionIdFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(";").map((c) => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split("=");
    if (name === "session") {
      return value;
    }
  }
  return null;
}

export function createSessionCookie(sessionId: string, maxAge: number = 86400): string {
  return `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function deleteSessionCookie(): string {
  return "session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
}

export async function validateAdmin(
  username: string,
  password: string,
  env: { ADMIN_USERNAME: string; ADMIN_PASSWORD: string }
): Promise<boolean> {
  if (username !== env.ADMIN_USERNAME) return false;
  // 兼容明文和哈希格式
  const stored = env.ADMIN_PASSWORD;
  if (isHashed(stored)) {
    return await verifyPassword(password, stored);
  }
  // 明文比较（向后兼容）
  return password === stored;
}

export async function requireAuth(
  request: Request,
  db: D1Database,
  requiredRole: UserRole = "guest"
): Promise<{ session: Session | null; isAdmin: boolean; isUser: boolean; role: UserRole }> {
  const cookieHeader = request.headers.get("Cookie");
  const sessionId = getSessionIdFromCookie(cookieHeader);

  if (!sessionId) {
    return { session: null, isAdmin: false, isUser: false, role: "guest" };
  }

  const session = await getSession(db, sessionId);
  if (!session) {
    return { session: null, isAdmin: false, isUser: false, role: "guest" };
  }

  const isAdmin = session.userType === "admin";
  const isUser = session.userType === "user";
  const role: UserRole = isAdmin ? "admin" : isUser ? "user" : "guest";

  if (requiredRole === "admin" && !isAdmin) {
    return { session, isAdmin: false, isUser, role };
  }
  if (requiredRole === "user" && role === "guest") {
    return { session, isAdmin: false, isUser: false, role };
  }

  return { session, isAdmin, isUser, role };
}
