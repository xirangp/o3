import type { Route } from "./+types/api.users";
import { requireAuth } from "~/lib/auth";
import { getRequestMeta, logAudit } from "~/lib/audit";
import { checkCsrf, checkRateLimit } from "~/lib/security";
import {
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserById,
  validateUserInput,
} from "~/lib/users";

// 用户管理接口：仅管理员可用
// 创建的用户角色固定为 "user"，权限 = 下载公开存储的文件

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const { isAdmin } = await requireAuth(request, db, "admin");
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }
  const users = await listUsers(db);
  return Response.json({ users });
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  const meta = getRequestMeta(request);
  const ip = meta.ip || "unknown";

  // CSRF 检查
  if (!checkCsrf(request)) {
    return Response.json({ error: "CSRF 验证失败" }, { status: 403 });
  }

  // 仅管理员
  const { isAdmin } = await requireAuth(request, db, "admin");
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 403 });
  }

  const method = request.method;

  // 创建用户
  if (method === "POST") {
    if (!checkRateLimit(`user-create:${ip}`, 10, 60000)) {
      return Response.json({ error: "请求过于频繁，请稍后再试" }, { status: 429 });
    }
    const body = (await request.json()) as {
      action?: string;
      id?: number;
      username?: string;
      password?: string;
    };

    // 重置密码 / 更新用户
    if (body.action === "update" && body.id) {
      const inputError = validateUserInput(body.username || "", body.password || "", {
        isUpdate: true,
      });
      if (body.username && inputError) {
        return Response.json({ error: inputError }, { status: 400 });
      }
      if (!body.username && !body.password) {
        return Response.json({ error: "没有需要更新的内容" }, { status: 400 });
      }
      const existing = await getUserById(db, body.id);
      if (!existing) {
        return Response.json({ error: "用户不存在" }, { status: 404 });
      }
      const updated = await updateUser(db, body.id, {
        username: body.username,
        password: body.password,
      });
      await logAudit(db, {
        action: "user.update",
        userType: "admin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { id: body.id, username: updated?.username, resetPassword: !!body.password },
      });
      return Response.json({ success: true, user: updated });
    }

    // 默认：创建用户
    const username = (body.username || "").trim();
    const password = body.password || "";
    const inputError = validateUserInput(username, password);
    if (inputError) {
      return Response.json({ error: inputError }, { status: 400 });
    }

    try {
      const user = await createUser(db, { username, password, role: "user" });
      await logAudit(db, {
        action: "user.create",
        userType: "admin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        detail: { id: user.id, username: user.username },
      });
      return Response.json({ success: true, user });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "创建失败";
      if (/UNIQUE/i.test(msg)) {
        return Response.json({ error: "用户名已存在" }, { status: 409 });
      }
      return Response.json({ error: msg }, { status: 400 });
    }
  }

  // 删除用户 ?id=
  if (method === "DELETE") {
    const url = new URL(request.url);
    const id = parseInt(url.searchParams.get("id") || "0", 10);
    if (!id) {
      return Response.json({ error: "缺少用户 ID" }, { status: 400 });
    }
    const ok = await deleteUser(db, id);
    if (!ok) {
      return Response.json({ error: "用户不存在" }, { status: 404 });
    }
    await logAudit(db, {
      action: "user.delete",
      userType: "admin",
      ip: meta.ip,
      userAgent: meta.userAgent,
      detail: { id },
    });
    return Response.json({ success: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
