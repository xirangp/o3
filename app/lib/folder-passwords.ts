// 文件夹密码保护 — 数据层
// 参考 OneManager-php 的 passhidden/gethiddenpass/comppass 机制

export interface FolderPassword {
  id: number;
  storageId: number;
  folderPath: string;
  passwordHash: string; // MD5 of plaintext password
  hint: string;
  createdAt: string;
  updatedAt: string;
}

interface FolderPasswordRow {
  id: number;
  storage_id: number;
  folder_path: string;
  password_hash: string;
  hint: string;
  created_at: string;
  updated_at: string;
}

function rowToFolderPassword(row: FolderPasswordRow): FolderPassword {
  return {
    id: row.id,
    storageId: row.storage_id,
    folderPath: row.folder_path || "",
    passwordHash: row.password_hash,
    hint: row.hint || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 为路径计算 MD5（Web Crypto API，与前端一致） */
export async function md5Hash(input: string): Promise<string> {
  // 使用 SubtleCrypto 不直接支持 MD5，用简单实现
  return simpleMd5(input);
}

/** 纯 JS MD5 实现（用于前端/后端一致的哈希比对） */
function simpleMd5(str: string): string {
  // 基于 RFC 1321 的 MD5
  function add32(a: number, b: number): number {
    return (a + b) & 0xffffffff;
  }
  function rol(value: number, shift: number): number {
    return (value << shift) | (value >>> (32 - shift));
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number): number {
    return add32(rol(add32(add32(a, q), add32(x, t)), s), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number): number {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function toHex(num: number): string {
    let out = "";
    for (let i = 0; i < 4; i++) {
      const byte = (num >> (i * 8)) & 0xff;
      out += byte.toString(16).padStart(2, "0");
    }
    return out;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  }
  const bitLen = bytes.length * 8;
  words[bitLen >> 5] |= 0x80 << (bitLen % 32);
  words[(((bitLen + 64) >>> 9) << 4) + 14] = bitLen;

  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let i = 0; i < words.length; i += 16) {
    const aa = a, bb = b, cc = c, dd = d;
    a = ff(a, b, c, d, words[i + 0] || 0, 7, 0xd76aa478);
    d = ff(d, a, b, c, words[i + 1] || 0, 12, 0xe8c7b756);
    c = ff(c, d, a, b, words[i + 2] || 0, 17, 0x242070db);
    b = ff(b, c, d, a, words[i + 3] || 0, 22, 0xc1bdceee);
    a = ff(a, b, c, d, words[i + 4] || 0, 7, 0xf57c0faf);
    d = ff(d, a, b, c, words[i + 5] || 0, 12, 0x4787c62a);
    c = ff(c, d, a, b, words[i + 6] || 0, 17, 0xa8304613);
    b = ff(b, c, d, a, words[i + 7] || 0, 22, 0xfd469501);
    a = ff(a, b, c, d, words[i + 8] || 0, 7, 0x698098d8);
    d = ff(d, a, b, c, words[i + 9] || 0, 12, 0x8b44f7af);
    c = ff(c, d, a, b, words[i + 10] || 0, 17, 0xffff5bb1);
    b = ff(b, c, d, a, words[i + 11] || 0, 22, 0x895cd7be);
    a = ff(a, b, c, d, words[i + 12] || 0, 7, 0x6b901122);
    d = ff(d, a, b, c, words[i + 13] || 0, 12, 0xfd987193);
    c = ff(c, d, a, b, words[i + 14] || 0, 17, 0xa679438e);
    b = ff(b, c, d, a, words[i + 15] || 0, 22, 0x49b40821);
    a = gg(a, b, c, d, words[i + 1] || 0, 5, 0xf61e2562);
    d = gg(d, a, b, c, words[i + 6] || 0, 9, 0xc040b340);
    c = gg(c, d, a, b, words[i + 11] || 0, 14, 0x265e5a51);
    b = gg(b, c, d, a, words[i + 0] || 0, 20, 0xe9b6c7aa);
    a = gg(a, b, c, d, words[i + 5] || 0, 5, 0xd62f105d);
    d = gg(d, a, b, c, words[i + 10] || 0, 9, 0x02441453);
    c = gg(c, d, a, b, words[i + 15] || 0, 14, 0xd8a1e681);
    b = gg(b, c, d, a, words[i + 4] || 0, 20, 0xe7d3fbc8);
    a = gg(a, b, c, d, words[i + 9] || 0, 5, 0x21e1cde6);
    d = gg(d, a, b, c, words[i + 14] || 0, 9, 0xc33707d6);
    c = gg(c, d, a, b, words[i + 3] || 0, 14, 0xf4d50d87);
    b = gg(b, c, d, a, words[i + 8] || 0, 20, 0x455a14ed);
    a = gg(a, b, c, d, words[i + 13] || 0, 5, 0xa9e3e905);
    d = gg(d, a, b, c, words[i + 2] || 0, 9, 0xfcefa3f8);
    c = gg(c, d, a, b, words[i + 7] || 0, 14, 0x676f02d9);
    b = gg(b, c, d, a, words[i + 12] || 0, 20, 0x8d2a4c8a);
    a = hh(a, b, c, d, words[i + 5] || 0, 4, 0xfffa3942);
    d = hh(d, a, b, c, words[i + 8] || 0, 11, 0x8771f681);
    c = hh(c, d, a, b, words[i + 11] || 0, 16, 0x6d9d6122);
    b = hh(b, c, d, a, words[i + 14] || 0, 23, 0xfde5380c);
    a = hh(a, b, c, d, words[i + 1] || 0, 4, 0xa4beea44);
    d = hh(d, a, b, c, words[i + 4] || 0, 11, 0x4bdecfa9);
    c = hh(c, d, a, b, words[i + 7] || 0, 16, 0xf6bb4b60);
    b = hh(b, c, d, a, words[i + 10] || 0, 23, 0xbebfbc70);
    a = hh(a, b, c, d, words[i + 13] || 0, 4, 0x289b7ec6);
    d = hh(d, a, b, c, words[i + 0] || 0, 11, 0xeaa127fa);
    c = hh(c, d, a, b, words[i + 3] || 0, 16, 0xd4ef3085);
    b = hh(b, c, d, a, words[i + 6] || 0, 23, 0x04881d05);
    a = hh(a, b, c, d, words[i + 9] || 0, 4, 0xd9d4d039);
    d = hh(d, a, b, c, words[i + 12] || 0, 11, 0xe6db99e5);
    c = hh(c, d, a, b, words[i + 15] || 0, 16, 0x1fa27cf8);
    b = hh(b, c, d, a, words[i + 2] || 0, 23, 0xc4ac5665);
    a = ii(a, b, c, d, words[i + 0] || 0, 6, 0xf4292244);
    d = ii(d, a, b, c, words[i + 7] || 0, 10, 0x432aff97);
    c = ii(c, d, a, b, words[i + 14] || 0, 15, 0xab9423a7);
    b = ii(b, c, d, a, words[i + 5] || 0, 21, 0xfc93a039);
    a = ii(a, b, c, d, words[i + 12] || 0, 6, 0x655b59c3);
    d = ii(d, a, b, c, words[i + 3] || 0, 10, 0x8f0ccc92);
    c = ii(c, d, a, b, words[i + 10] || 0, 15, 0xffeff47d);
    b = ii(b, c, d, a, words[i + 1] || 0, 21, 0x85845dd1);
    a = ii(a, b, c, d, words[i + 8] || 0, 6, 0x6fa87e4f);
    d = ii(d, a, b, c, words[i + 15] || 0, 10, 0xfe2ce6e0);
    c = ii(c, d, a, b, words[i + 6] || 0, 15, 0xa3014314);
    b = ii(b, c, d, a, words[i + 13] || 0, 21, 0x4e0811a1);
    a = ii(a, b, c, d, words[i + 4] || 0, 6, 0xf7537e82);
    d = ii(d, a, b, c, words[i + 11] || 0, 10, 0xbd3af235);
    c = ii(c, d, a, b, words[i + 2] || 0, 15, 0x2ad7d2bb);
    b = ii(b, c, d, a, words[i + 9] || 0, 21, 0xeb86d391);
    a = add32(a, aa);
    b = add32(b, bb);
    c = add32(c, cc);
    d = add32(d, dd);
  }
  return `${toHex(a)}${toHex(b)}${toHex(c)}${toHex(d)}`;
}

/** 获取存储上某路径的密码保护状态 — 向上递归（OneManager 风格） */
export async function getPasswordForPath(
  db: D1Database,
  storageId: number,
  folderPath: string
): Promise<FolderPassword | null> {
  // 规范化路径
  const normalized = folderPath.replace(/^\/|\/$/g, "");

  // 先查精确匹配
  const exact = await db
    .prepare("SELECT * FROM folder_passwords WHERE storage_id = ? AND folder_path = ?")
    .bind(storageId, normalized)
    .first<FolderPasswordRow>();

  if (exact) return rowToFolderPassword(exact);

  // 向上递归查找父目录的密码
  if (!normalized) return null;

  const parts = normalized.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const parentPath = parts.slice(0, i).join("/");
    const found = await db
      .prepare("SELECT * FROM folder_passwords WHERE storage_id = ? AND folder_path = ?")
      .bind(storageId, parentPath)
      .first<FolderPasswordRow>();
    if (found) return rowToFolderPassword(found);
  }

  return null;
}

/** 获取存储上所有密码保护的文件夹路径 */
export async function getAllPasswordPaths(
  db: D1Database,
  storageId: number
): Promise<FolderPassword[]> {
  const result = await db
    .prepare("SELECT * FROM folder_passwords WHERE storage_id = ? ORDER BY folder_path")
    .bind(storageId)
    .all<FolderPasswordRow>();

  return (result.results ?? []).map(rowToFolderPassword);
}

/** 创建或更新文件夹密码 */
export async function setFolderPassword(
  db: D1Database,
  storageId: number,
  folderPath: string,
  passwordPlaintext: string,
  hint: string = ""
): Promise<FolderPassword> {
  const normalized = folderPath.replace(/^\/|\/$/g, "");
  const passwordHash = simpleMd5(passwordPlaintext);

  // UPSERT
  const result = await db
    .prepare(
      `INSERT INTO folder_passwords (storage_id, folder_path, password_hash, hint)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(storage_id, folder_path)
       DO UPDATE SET password_hash = excluded.password_hash, hint = excluded.hint, updated_at = datetime('now')
       RETURNING *`
    )
    .bind(storageId, normalized, passwordHash, hint)
    .first<FolderPasswordRow>();

  if (!result) throw new Error("Failed to set folder password");
  return rowToFolderPassword(result);
}

/** 删除文件夹密码 */
export async function removeFolderPassword(
  db: D1Database,
  storageId: number,
  folderPath: string
): Promise<boolean> {
  const normalized = folderPath.replace(/^\/|\/$/g, "");
  const result = await db
    .prepare("DELETE FROM folder_passwords WHERE storage_id = ? AND folder_path = ?")
    .bind(storageId, normalized)
    .run();

  return (result.meta?.changes ?? 0) > 0;
}

/** 从 Cookie 中解析已解锁的路径列表 */
export function getUnlockedPathsFromCookie(cookieHeader: string | null, storageId: number): Set<string> {
  if (!cookieHeader) return new Set();
  const prefix = `fp_${storageId}=`;
  const cookies = cookieHeader.split(";").map(c => c.trim());
  for (const cookie of cookies) {
    if (cookie.startsWith(prefix)) {
      try {
        const value = decodeURIComponent(cookie.slice(prefix.length));
        const paths: string[] = JSON.parse(value);
        return new Set(paths);
      } catch {
        return new Set();
      }
    }
  }
  return new Set();
}

/** 生成 Set-Cookie 头，将路径加入已解锁列表 */
export function buildUnlockedCookie(storageId: number, path: string, existing: Set<string>): string {
  const normalized = path.replace(/^\/|\/$/g, "");
  const merged = new Set(existing);
  merged.add(normalized);
  // 也添加所有父路径（用户解锁了 /a/b 就等于解锁了 /a）
  const parts = normalized.split("/");
  for (let i = 1; i < parts.length; i++) {
    merged.add(parts.slice(0, i).join("/"));
  }
  const value = encodeURIComponent(JSON.stringify([...merged]));
  return `fp_${storageId}=${value}; Path=/; SameSite=Lax; Max-Age=3600`;
}

/** 检查用户对指定路径是否有密码访问权限 */
export async function checkPathAccess(
  db: D1Database,
  storageId: number,
  folderPath: string,
  isAdmin: boolean,
  cookieHeader: string | null
): Promise<{ allowed: boolean; passwordInfo: FolderPassword | null; unlockedCookie?: string }> {
  // 管理员无需验证
  if (isAdmin) return { allowed: true, passwordInfo: null };

  // 查找该路径是否有密码保护（含向上递归）
  const passwordInfo = await getPasswordForPath(db, storageId, folderPath);
  if (!passwordInfo) return { allowed: true, passwordInfo: null };

  // 检查 cookie 中是否已解锁
  const unlockedPaths = getUnlockedPathsFromCookie(cookieHeader, storageId);
  const normalized = folderPath.replace(/^\/|\/$/g, "");

  // 检查精确匹配和所有父路径
  if (unlockedPaths.has(normalized)) {
    return { allowed: true, passwordInfo };
  }
  const parts = normalized.split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const parent = parts.slice(0, i).join("/");
    if (unlockedPaths.has(parent)) {
      return { allowed: true, passwordInfo };
    }
  }

  return { allowed: false, passwordInfo };
}

/** 验证密码是否正确 */
export async function verifyFolderPassword(
  db: D1Database,
  storageId: number,
  folderPath: string,
  inputPassword: string
): Promise<{ valid: boolean; cookie?: string }> {
  const passwordInfo = await getPasswordForPath(db, storageId, folderPath);
  if (!passwordInfo) return { valid: true };

  const inputHash = simpleMd5(inputPassword);
  if (inputHash === passwordInfo.passwordHash) {
    // 密码正确，生成解锁 cookie
    const cookieHeader = null; // 新解锁
    const cookie = buildUnlockedCookie(storageId, folderPath, new Set());
    return { valid: true, cookie };
  }

  return { valid: false };
}
