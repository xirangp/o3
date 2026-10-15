import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: {
      env: Env;
      ctx: ExecutionContext;
    };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE
);

// ===== Simple IP Rate Limiter =====
// Uses a sliding window counter per IP address.
// State is in-memory per isolate (best-effort, resets on cold start).
// For stronger protection, combine with Cloudflare dashboard WAF rules.

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60 seconds to prevent memory leaks
let lastCleanup = Date.now();
function cleanupRateLimit() {
  const now = Date.now();
  if (now - lastCleanup < 60_000) return;
  lastCleanup = now;
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
  // Safety cap: if map grows too large, clear oldest entries
  if (rateLimitMap.size > 10_000) {
    const entries = [...rateLimitMap.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < 5_000; i++) rateLimitMap.delete(entries[i][0]);
  }
}

function checkRateLimit(ip: string, limit: number, windowMs: number): { allowed: boolean; remaining: number; resetAt: number } {
  cleanupRateLimit();
  const now = Date.now();
  const key = `rl:${ip}`;
  let entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    entry = { count: 1, resetAt: now + windowMs };
    rateLimitMap.set(key, entry);
    return { allowed: true, remaining: limit - 1, resetAt: entry.resetAt };
  }

  entry.count++;
  if (entry.count > limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt };
}

function getClientIP(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ip = getClientIP(request);

    // ===== Rate Limiting =====
    // API endpoints: stricter limit (120 requests/minute)
    // Static/page loads: more generous (300 requests/minute)
    const isApi = url.pathname.startsWith("/api/");
    const isStatic = url.pathname.startsWith("/assets/") || url.pathname.startsWith("/favicon");

    if (!isStatic) {
      const limit = isApi ? 120 : 300;
      const windowMs = 60_000; // 1 minute window
      const result = checkRateLimit(ip, limit, windowMs);

      if (!result.allowed) {
        return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
          status: 429,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Retry-After": Math.ceil((result.resetAt - Date.now()) / 1000).toString(),
            "X-RateLimit-Limit": limit.toString(),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": Math.ceil(result.resetAt / 1000).toString(),
          },
        });
      }

      // Pass through to app with rate limit headers
      const response = await requestHandler(request, {
        cloudflare: { env, ctx },
      });

      // Add rate limit info headers to successful responses
      const newResponse = new Response(response.body, response);
      newResponse.headers.set("X-RateLimit-Limit", limit.toString());
      newResponse.headers.set("X-RateLimit-Remaining", result.remaining.toString());
      newResponse.headers.set("X-RateLimit-Reset", Math.ceil(result.resetAt / 1000).toString());
      return newResponse;
    }

    // Static assets: no rate limit
    return requestHandler(request, {
      cloudflare: { env, ctx },
    });
  },
} satisfies ExportedHandler<Env>;
