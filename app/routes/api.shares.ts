import type { Route } from "./+types/api.shares";
import { initDatabase, getStorageById } from "~/lib/storage";
import { requireAuth } from "~/lib/auth";
import {
  createShare,
  getShareByToken,
  getShareById,
  getAllShares,
  deleteShare,
  cleanExpiredShares,
} from "~/lib/shares";
import { getRequestMeta, logAudit } from "~/lib/audit";

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  await initDatabase(db);
  const meta = getRequestMeta(request);

  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const shareId = url.searchParams.get("id");

  // Get share by token (public access)
  if (token) {
    try {
      const share = await getShareByToken(db, token);
      if (!share) {
        return Response.json({ error: "分享链接不存在或已过期" }, { status: 404 });
      }

      const storage = await getStorageById(db, share.storageId);
      if (!storage) {
        return Response.json({ error: "存储不存在" }, { status: 404 });
      }

      await logAudit(db, {
        action: "share.view",
        userType: "share",
        ip: meta.ip,
        userAgent: meta.userAgent,
        storageId: share.storageId,
        path: share.filePath,
      });

      return Response.json({
        share,
        storage: {
          id: storage.id,
          name: storage.name,
        },
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "获取分享信息失败" },
        { status: 500 }
      );
    }
  }

  // Get all shares (admin only)
  const { isAdmin } = await requireAuth(request, db);
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await cleanExpiredShares(db);
    const shares = await getAllShares(db);
    return Response.json({ shares });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "获取分享列表失败" },
      { status: 500 }
    );
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  const db = context.cloudflare.env.DB;
  await initDatabase(db);
  const meta = getRequestMeta(request);

  const { isAdmin } = await requireAuth(request, db);
  if (!isAdmin) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const method = request.method;

  if (method === "POST") {
    try {
      const body = (await request.json()) as {
        storageId: number;
        filePath: string;
        isDirectory: boolean;
        expiresAt?: string;
      };

      const { storageId, filePath, isDirectory, expiresAt } = body;

      if (!storageId || !filePath || isDirectory === undefined) {
        return Response.json(
          { error: "storageId、filePath 和 isDirectory 为必填项" },
          { status: 400 }
        );
      }

      const storage = await getStorageById(db, storageId);
      if (!storage) {
        return Response.json({ error: "存储不存在" }, { status: 404 });
      }

      const share = await createShare(db, storageId, filePath, isDirectory, expiresAt);

      // Generate share URL
      const baseUrl = new URL(request.url).origin;
      const shareUrl = `${baseUrl}/share?token=${share.shareToken}`;

      await logAudit(db, {
        action: "share.create",
        userType: "admin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        storageId,
        path: filePath,
        detail: { isDirectory, expiresAt: expiresAt || null },
      });

      return Response.json({
        success: true,
        share,
        shareUrl,
      });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "创建分享链接失败" },
        { status: 500 }
      );
    }
  }

  if (method === "DELETE") {
    try {
      const url = new URL(request.url);
      const shareId = url.searchParams.get("id");

      if (!shareId) {
        return Response.json({ error: "id 为必填项" }, { status: 400 });
      }

      const share = await getShareById(db, shareId);
      if (!share) {
        return Response.json({ error: "分享链接不存在" }, { status: 404 });
      }

      await deleteShare(db, shareId);

      await logAudit(db, {
        action: "share.delete",
        userType: "admin",
        ip: meta.ip,
        userAgent: meta.userAgent,
        storageId: share.storageId,
        path: share.filePath,
      });

      return Response.json({ success: true });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "删除分享链接失败" },
        { status: 500 }
      );
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
