import type { Route } from "./+types/api.path-meta";
import { requireAuth } from "~/lib/auth";
import { initDatabase } from "~/lib/storage";

interface PathMetaRow {
  id: number; storage_id: number; path: string;
  password: string; p_sub: number; write_access: number; w_sub: number;
  hide: string; h_sub: number; readme: string; r_sub: number;
  header: string; header_sub: number; footer: string; footer_sub: number;
}

/**
 * AList 风格：向上查找最近的父级 meta
 * GetNearestMeta: walk up path until a meta is found
 */
async function getNearestMeta(db: D1Database, storageId: number, currentPath: string): Promise<PathMetaRow | null> {
  // 先查当前路径
  let row = await db.prepare("SELECT * FROM path_meta WHERE storage_id = ? AND path = ?")
    .bind(storageId, currentPath).first() as PathMetaRow | null;
  if (row) return row;

  // 向上逐级查找
  let path = currentPath;
  while (path) {
    const parent = path.lastIndexOf("/");
    path = parent > 0 ? path.substring(0, parent) : "";
    row = await db.prepare("SELECT * FROM path_meta WHERE storage_id = ? AND path = ?")
      .bind(storageId, path).first() as PathMetaRow | null;
    if (row) return row;
  }

  // 查根目录
  row = await db.prepare("SELECT * FROM path_meta WHERE storage_id = ? AND path = ''")
    .bind(storageId).first() as PathMetaRow | null;
  return row || null;
}

/**
 * AList 风格：根据 *Sub 标志合并 meta 到当前路径
 * 如果当前路径有自己的 meta，用它；否则从最近的父级继承（仅 *Sub=true 的字段）
 */
async function resolveMeta(db: D1Database, storageId: number, currentPath: string): Promise<{
  password: string; write_access: boolean; hide: string; readme: string; header: string; footer: string;
}> {
  // 查当前路径自身的 meta
  const self = await db.prepare("SELECT * FROM path_meta WHERE storage_id = ? AND path = ?")
    .bind(storageId, currentPath).first() as PathMetaRow | null;

  if (self) {
    // 当前路径有自己的 meta，直接用，忽略 *Sub
    return {
      password: self.password || "",
      write_access: self.write_access !== 0,
      hide: self.hide || "",
      readme: self.readme || "",
      header: self.header || "",
      footer: self.footer || "",
    };
  }

  // 没有自己的 meta，向上查找最近的父级
  const nearest = await getNearestMeta(db, storageId, currentPath);
  if (!nearest) {
    return { password: "", write_access: true, hide: "", readme: "", header: "", footer: "" };
  }

  // 只继承 *Sub=true 的字段
  return {
    password: nearest.p_sub ? (nearest.password || "") : "",
    write_access: nearest.w_sub ? (nearest.write_access !== 0) : true,
    hide: nearest.h_sub ? (nearest.hide || "") : "",
    readme: nearest.r_sub ? (nearest.readme || "") : "",
    header: nearest.header_sub ? (nearest.header || "") : "",
    footer: nearest.footer_sub ? (nearest.footer || "") : "",
  };
}

// 查询路径元信息
export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  if (!db) return Response.json({ error: "数据库未绑定" }, { status: 500 });

  await initDatabase(db);
  const { isAdmin } = await requireAuth(request, db);

  const url = new URL(request.url);
  const storageId = url.searchParams.get("storageId");
  const path = url.searchParams.get("path") || "";
  const listAll = url.searchParams.has("_all");

  if (!storageId) return Response.json({ error: "缺少 storageId" }, { status: 400 });

  if (listAll) {
    // 返回该存储的所有路径元信息（仅管理员）
    if (!isAdmin) return Response.json({ error: "需要管理员权限" }, { status: 403 });
    const rows = await db.prepare("SELECT * FROM path_meta WHERE storage_id = ? ORDER BY path").bind(storageId).all();
    return Response.json({ items: rows.results || [] });
  }

  // 解析当前路径的最终 meta
  const resolved = await resolveMeta(db, parseInt(storageId), path);

  if (!isAdmin) {
    // 游客不返回密码明文
    return Response.json({
      meta: {
        write_access: resolved.write_access,
        hide: resolved.hide,
        readme: resolved.readme,
        header: resolved.header,
        footer: resolved.footer,
      },
      hasPassword: !!resolved.password,
    });
  }

  return Response.json({ meta: resolved, isAdmin: true });
}

// 创建/更新/删除路径元信息（仅管理员）
export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  if (!db) return Response.json({ error: "数据库未绑定" }, { status: 500 });

  await initDatabase(db);
  const { isAdmin } = await requireAuth(request, db);
  if (!isAdmin) return Response.json({ error: "需要管理员权限" }, { status: 403 });

  const body = (await request.json()) as {
    id?: number; storageId: number; path: string;
    password?: string; p_sub?: boolean; write_access?: boolean; w_sub?: boolean;
    hide?: string; h_sub?: boolean; readme?: string; r_sub?: boolean;
    header?: string; header_sub?: boolean; footer?: string; footer_sub?: boolean;
    _delete?: boolean;
  };

  if (!body.storageId) return Response.json({ error: "缺少 storageId" }, { status: 400 });

  // 删除
  if (body._delete && body.id) {
    await db.prepare("DELETE FROM path_meta WHERE id = ?").bind(body.id).run();
    return Response.json({ success: true });
  }

  const path = (body.path || "").replace(/^\/+/, "").replace(/\/+$/, "");

  await db.prepare(`
    INSERT INTO path_meta (storage_id, path, password, p_sub, write_access, w_sub, hide, h_sub, readme, r_sub, header, header_sub, footer, footer_sub, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(storage_id, path) DO UPDATE SET
      password = excluded.password, p_sub = excluded.p_sub,
      write_access = excluded.write_access, w_sub = excluded.w_sub,
      hide = excluded.hide, h_sub = excluded.h_sub,
      readme = excluded.readme, r_sub = excluded.r_sub,
      header = excluded.header, header_sub = excluded.header_sub,
      footer = excluded.footer, footer_sub = excluded.footer_sub,
      updated_at = excluded.updated_at
  `).bind(
    body.storageId, path,
    body.password || "", body.p_sub ? 1 : 0,
    body.write_access !== false ? 1 : 0, body.w_sub ? 1 : 0,
    body.hide || "", body.h_sub ? 1 : 0,
    body.readme || "", body.r_sub ? 1 : 0,
    body.header || "", body.header_sub ? 1 : 0,
    body.footer || "", body.footer_sub ? 1 : 0,
  ).run();

  return Response.json({ success: true });
}
