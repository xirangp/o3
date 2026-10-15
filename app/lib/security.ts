/**
 * 安全工具模块
 * - 密码哈希（PBKDF2）
 * - 强随机数
 * - HTML 净化
 * - CSRF 检查
 * - 速率限制
 */

// ===== 密码哈希 (PBKDF2-SHA256) =====
export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashArray = new Uint8Array(bits);
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, expectedHash] = stored.split(":");
  if (!saltHex || !expectedHash) return false;
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, "0")).join("");
  return hashHex === expectedHash;
}

// 兼容：检查密码是否是旧的明文格式
export function isHashed(password: string): boolean {
  return /^[0-9a-f]{32}:[0-9a-f]{64}$/.test(password);
}

// ===== 强随机数 =====
export function secureRandomId(length: number = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, "0")).join("");
}

export function secureRandomToken(length: number = 24): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => chars[b % chars.length]).join("");
}

// ===== HTML 净化（防 XSS）=====
const HTML_ALLOWED_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "hr",
  "strong", "b", "em", "i", "u", "s", "del", "mark", "sub", "sup",
  "a", "img", "ul", "ol", "li", "blockquote", "pre", "code",
  "table", "thead", "tbody", "tr", "th", "td",
  "div", "span", "details", "summary",
]);
const HTML_ALLOWED_ATTRS: Record<string, Set<string>> = {
  "a": new Set(["href", "title", "target", "rel"]),
  "img": new Set(["src", "alt", "title", "width", "height"]),
  "blockquote": new Set(["cite"]),
  "*": new Set(["class", "id"]),
};

export function sanitizeHtml(html: string): string {
  // 简单但有效的净化：移除危险标签和属性
  let clean = html;
  // 移除 script/style/iframe/object/embed/form 等危险标签
  clean = clean.replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base)[^>]*>[\s\S]*?<\/\1>/gi, "");
  clean = clean.replace(/<(script|style|iframe|object|embed|form|input|button|textarea|select|link|meta|base)[^>]*\/?>/gi, "");
  // 移除 on* 事件属性
  clean = clean.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, "");
  clean = clean.replace(/\s+on\w+\s*=\s*[^\s>]*/gi, "");
  // 移除 javascript: 协议
  clean = clean.replace(/href\s*=\s*["']javascript:[^"']*["']/gi, 'href="#"');
  clean = clean.replace(/src\s*=\s*["']javascript:[^"']*["']/gi, 'src=""');
  // 移除 data:text/html 协议
  clean = clean.replace(/href\s*=\s*["']data:text\/html[^"']*["']/gi, 'href="#"');
  return clean;
}

// ===== CSRF 检查 =====
export function checkCsrf(request: Request): boolean {
  const method = request.method.toUpperCase();
  // GET/HEAD/OPTIONS 不需要检查
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const host = request.headers.get("Host");

  if (!origin && !referer) return false; // 无来源信息，拒绝

  // 检查 Origin
  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host === host) return true;
    } catch {}
  }

  // 检查 Referer
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      if (refererUrl.host === host) return true;
    } catch {}
  }

  return false;
}

// ===== 速率限制（内存版，Workers 重启后重置）=====
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
let lastCleanup = Date.now();

export function checkRateLimit(key: string, maxRequests: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now();

  // 每 5 分钟自动清理一次过期条目
  if (now - lastCleanup > 300000) {
    lastCleanup = now;
    for (const [k, entry] of rateLimitMap) {
      if (now > entry.resetAt) rateLimitMap.delete(k);
    }
  }

  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (entry.count >= maxRequests) return false;
  entry.count++;
  return true;
}