import type { Route } from "./+types/api.folder-passwords";
import { initDatabase } from "~/lib/storage";
import { requireAuth } from "~/lib/auth";
import { getRequestMeta, logAudit } from "~/lib/audit";
import {
  getAllPasswordPaths,
  setFolderPassword,
  removeFolderPassword,
  verifyFolderPassword,
  checkPathAccess,
  getPasswordForPath,
} from "~/lib/folder-passwords";

// GET: 检查路径是否有密码保护 / 管理员获取所有密码路径
export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  await initDatabase(db);
  const meta = getRequestMeta(request);

  const url = new URL(request.url);
  const storageId = parseInt(url.searchParams.get("storageId") || "0", 10);
  const folderPath = url.searchParams.get("path") || "";
  const checkOnly = url.searchParams.get("check") === "1";

  if (!storageId) {
    return Response.json({ error: "storageId required" }, { status: 400 });
  }

  const { isAdmin } = await requireAuth(request, db);

  // check=1: 检查指定路径是否需要密码
  if (checkOnly) {
    const access = await checkPathAccess(
      db, storageId, folderPath, isAdmin,
      request.headers.get("Cookie")
    );
    return Response.json({
      protected: !!access.passwordInfo,
      allowed: access.allowed,
      hint: access.passwordInfo?.hint || "",
    });
  }

  // 管理员: 获取所有密码路径
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const passwords = await getAllPasswordPaths(db, storageId);
  return Response.json({
    passwords: passwords.map(p => ({
      id: p.id,
      folderPath: p.folderPath,
      hint: p.hint,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
}

// POST: 验证密码 / 设置密码(管理员)
export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  await initDatabase(db);
  const meta = getRequestMeta(request);

  const method = request.method;

  if (method === "POST") {
    const body = await request.json() as {
      action?: string;
      storageId?: number;
      folderPath?: string;
      password?: string;
      hint?: string;
    };

    // 验证密码 (游客)
    if (body.action === "verify") {
      if (!body.storageId || body.folderPath === undefined || !body.password) {
        return Response.json({ error: "storageId, folderPath, password required" }, { status: 400 });
      }

      const result = await verifyFolderPassword(db, body.storageId, body.folderPath, body.password);
      if (result.valid) {
        const headers: Record<string, string> = {};
        if (result.cookie) {
          headers["Set-Cookie"] = result.cookie;
        }
        await logAudit(db, {
          action: "folder_password.verify_success",
          userType: "guest",
          ip: meta.ip,
          userAgent: meta.userAgent,
          storageId: body.storageId,
          path: body.folderPath,
        });
        return Response.json({ success: true }, { headers });
      } else {
        await logAudit(db, {
          action: "folder_password.verify_failed",
          userType: "guest",
          ip: meta.ip,
          userAgent: meta.userAgent,
          storageId: body.storageId,
          path: body.folderPath,
        });
        return Response.json({ success: false, error: "密码错误" }, { status: 401 });
      }
    }

    // 设置密码 (管理员)
    const { isAdmin } = await requireAuth(request, db, "admin");
    if (!isAdmin) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (!body.storageId || body.folderPath === undefined || !body.password) {
      return Response.json({ error: "storageId, folderPath, password required" }, { status: 400 });
    }

    try {
      const result = await setFolderPassword(
        db, body.storageId, body.folderPath, body.password, body.hint || ""
      );
      await logAudit(db, {
        action: "folder_password.set",
        userType: "admin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        storageId: body.storageId,
        path: body.folderPath,
        detail: { hint: body.hint },
      });
      return Response.json({ success: true, password: {
        id: result.id,
        folderPath: result.folderPath,
        hint: result.hint,
      }});
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Failed to set password" },
        { status: 500 }
      );
    }
  }

  if (method === "DELETE") {
    const { isAdmin } = await requireAuth(request, db, "admin");
    if (!isAdmin) {
      return Response.json({ error: "Unauthorized" }, { status: 403 });
    }

    const url = new URL(request.url);
    const storageId = parseInt(url.searchParams.get("storageId") || "0", 10);
    const folderPath = url.searchParams.get("path") || "";

    if (!storageId) {
      return Response.json({ error: "storageId required" }, { status: 400 });
    }

    const deleted = await removeFolderPassword(db, storageId, folderPath);
    if (deleted) {
      await logAudit(db, {
        action: "folder_password.remove",
        userType: "admin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        storageId,
        path: folderPath,
      });
    }
    return Response.json({ success: deleted });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
