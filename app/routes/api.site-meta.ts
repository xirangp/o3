import type { Route } from "./+types/api.site-meta";
import { requireAuth } from "~/lib/auth";
import { initDatabase } from "~/lib/storage";

// 内置预览配置（按扩展名分组，$e_url=encodeURIComponent(url), $url=原始url, $name=encodeURIComponent(filename)）
const BUILTIN_PREVIEW_EXTERNAL: Record<string, Record<string, string>> = {
  json: {
    "阅读": "legado://import/?src=$e_url",
    "源阅读": "yuedu://booksource/importonline?src=$e_url",
    "订阅源导入": "legado://import/auto?src=$e_url&embedded=true",
  },
};

// 合并内置配置与用户自定义配置（用户同名 key 覆盖内置）
function mergePreviewExternal(metaValue: string | undefined): string | undefined {
  let userConfig: Record<string, Record<string, string>> = {};
  if (metaValue) {
    try { userConfig = JSON.parse(metaValue); } catch {}
  }
  // 深度合并：每个扩展名下，用户配置覆盖内置
  const merged: Record<string, Record<string, string>> = {};
  const allExts = new Set([...Object.keys(BUILTIN_PREVIEW_EXTERNAL), ...Object.keys(userConfig)]);
  for (const ext of allExts) {
    merged[ext] = { ...(BUILTIN_PREVIEW_EXTERNAL[ext] || {}), ...(userConfig[ext] || {}) };
  }
  return JSON.stringify(merged);
}

// 获取所有 meta（管理员返回全部，游客返回公开字段）
export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  if (!db) return Response.json({ error: "数据库未绑定" }, { status: 500 });

  await initDatabase(db);
  const { isAdmin } = await requireAuth(request, db);

  const rows = await db.prepare("SELECT key, value FROM site_meta").all();
  const meta: Record<string, string> = {};
  for (const row of (rows.results || []) as Array<{ key: string; value: string }>) {
    meta[row.key] = row.value;
  }

  // 合并内置预览配置
  meta.preview_external = mergePreviewExternal(meta.preview_external);

  if (isAdmin) {
    return Response.json({ meta, isAdmin: true });
  }

  // 游客只返回公开字段
  const publicKeys = ["site_title", "site_description", "site_keywords", "site_logo", "site_favicon", "announcement", "footer_text", "custom_css", "custom_head_js", "custom_body_js", "preview_external", "preview_iframe", "preview_iframe_types"];
  const publicMeta: Record<string, string> = {};
  for (const key of publicKeys) {
    if (meta[key]) publicMeta[key] = meta[key];
  }
  return Response.json({ meta: publicMeta, isAdmin: false });
}

// 更新 meta（仅管理员）
export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  if (!db) return Response.json({ error: "数据库未绑定" }, { status: 500 });

  await initDatabase(db);
  const { isAdmin } = await requireAuth(request, db);
  if (!isAdmin) return Response.json({ error: "需要管理员权限" }, { status: 403 });

  const body = (await request.json()) as { meta?: Record<string, string> };
  if (!body.meta || typeof body.meta !== "object") {
    return Response.json({ error: "参数错误" }, { status: 400 });
  }

  const allowedKeys = [
    "site_title", "site_description", "site_keywords", "site_logo", "site_favicon",
    "announcement", "footer_text", "custom_css", "custom_head_js", "custom_body_js",
    "allow_register", "open_api",
    "preview_external", "preview_iframe", "preview_iframe_types",
  ];

  const stmt = db.prepare("INSERT INTO site_meta (key, value, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at");

  const batch: D1PreparedStatement[] = [];
  for (const [key, value] of Object.entries(body.meta)) {
    if (allowedKeys.includes(key)) {
      batch.push(stmt.bind(key, String(value)));
    }
  }

  if (batch.length === 0) {
    return Response.json({ error: "没有有效的配置项" }, { status: 400 });
  }

  await db.batch(batch);
  return Response.json({ success: true });
}
