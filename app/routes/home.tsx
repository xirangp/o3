import type { Route } from "./+types/home";
import { requireAuth, type UserRole } from "~/lib/auth";
import { getAllStorages, getPublicStorages, getStoragesForUser, initDatabase } from "~/lib/storage";
import { useState, useEffect, useCallback, useRef, type ChangeEvent } from "react";
import { FilePreview } from "~/components/FilePreview";
import { getFileType, isPreviewable } from "~/lib/file-utils";
import { marked } from "marked";
import { sanitizeHtml } from "~/lib/security";

// 启用 GFM（删除线、表格、任务列表等）
marked.setOptions({ gfm: true, breaks: true });

// 文件列表缓存 TTL：刷新时先用缓存兑底（SWR），避免远端网盘限流 429 导致刷新就报错
const LIST_CACHE_TTL_MS = 30_000;

export function meta({ data }: Route.MetaArgs) {
  const title = data?.siteMeta?.site_title || data?.siteTitle || "CList";
  const description = data?.siteMeta?.site_description || "S3 兼容存储聚合服务";
  const keywords = data?.siteMeta?.site_keywords || "";
  const result = [
    { title: `${title}` },
    { name: "description", content: description },
  ];
  if (keywords) result.push({ name: "keywords", content: keywords });
  return result;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const db = context.cloudflare.env.DB;
  const siteTitle = context.cloudflare.env.SITE_TITLE || "CList";
  const siteAnnouncement = context.cloudflare.env.SITE_ANNOUNCEMENT || "";
  const chunkSizeMB = parseInt(context.cloudflare.env.CHUNK_SIZE_MB || "50", 10);
  const webdavEnabled = (context.cloudflare.env.WEBDAV_ENABLED as string) === "true";

  // 读取站点 meta 配置
  let siteMeta: Record<string, string> = {};
  try {
    const metaRows = await db.prepare("SELECT key, value FROM site_meta").all();
    for (const row of (metaRows.results || []) as Array<{ key: string; value: string }>) {
      siteMeta[row.key] = row.value;
    }
  } catch {} // 表可能还没迁移

  // 用数据库值覆盖环境变量默认值
  const finalTitle = siteMeta.site_title || siteTitle;
  const finalAnnouncement = siteMeta.announcement || siteAnnouncement;

  if (!db) {
    console.error("D1 Database not bound");
    return { isAdmin: false, storages: [], siteTitle, siteAnnouncement, chunkSizeMB, webdavEnabled: false };
  }

  await initDatabase(db);

  const { isAdmin, isUser, role } = await requireAuth(request, db);

  const storages = isAdmin
    ? await getAllStorages(db)
    : isUser
      ? await getStoragesForUser(db)
      : await getPublicStorages(db);

  return {
    isAdmin,
    isUser,
    role,
    siteTitle: finalTitle,
    siteAnnouncement: finalAnnouncement,
    siteMeta,
    chunkSizeMB,
    webdavEnabled,
    storages: storages.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      endpoint: s.endpoint,
      region: s.region,
      accessKeyId: s.accessKeyId,
      bucket: s.bucket,
      basePath: s.basePath,
      config: isAdmin ? s.config : { orderBy: s.config?.orderBy, orderDirection: s.config?.orderDirection, folderOrder: s.config?.folderOrder },
      isPublic: s.isPublic,
      guestList: s.guestList,
      guestDownload: s.guestDownload,
      guestUpload: s.guestUpload,
    })),
    onedriveClientId: context.cloudflare.env.ONEDRIVE_CLIENT_ID || "",
    onedriveClientSecret: context.cloudflare.env.ONEDRIVE_CLIENT_SECRET || "",
  };
}

interface S3Object {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

interface StorageInfo {
  id: number;
  name: string;
  type?: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  bucket?: string;
  basePath?: string;
  config?: Record<string, any>;
  isPublic: boolean;
  guestList: boolean;
  guestDownload: boolean;
  guestUpload: boolean;
}

type ConfigField = {
  key: string;
  label: string;
  type: "text" | "password" | "textarea" | "select" | "boolean";
  required?: boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: string | number | boolean;
  show?: (values: Record<string, any>) => boolean;
  help?: string;
};

const driveConfigMap: Record<string, { name: string; supportsMultipart: boolean; fields: ConfigField[] }> = {
  onedrive: {
    name: "OneDrive",
    supportsMultipart: true,
    fields: [
      { key: "region", label: "区域", type: "select", required: true, options: [{ value: "global", label: "全球版" }, { value: "cn", label: "中国版（世纪互联）" }, { value: "us", label: "美国政府版" }, { value: "de", label: "德国版" }], defaultValue: "global" },
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true, placeholder: "Microsoft OAuth 刷新令牌" },
      { key: "use_online_api", label: "使用在线API", type: "boolean", defaultValue: false },
      { key: "api_address", label: "在线API地址", type: "text", placeholder: "自建刷新接口地址", show: (v) => v.use_online_api === true },
      { key: "client_id", label: "客户端ID", type: "text", placeholder: "本地客户端ID", show: (v) => v.use_online_api !== true },
      { key: "client_secret", label: "客户端密钥", type: "password", placeholder: "本地客户端密钥", show: (v) => v.use_online_api !== true },
      { key: "redirect_uri", label: "重定向URI", type: "text", placeholder: "留空则自动使用当前域名", defaultValue: "", show: (v) => v.use_online_api !== true },
      { key: "is_sharepoint", label: "SharePoint 模式", type: "boolean", defaultValue: false },
      { key: "site_id", label: "SharePoint 站点ID", type: "text", placeholder: "SharePoint 站点ID", show: (v) => v.is_sharepoint === true },
      { key: "root_folder_path", label: "根文件夹路径", type: "text", defaultValue: "/" },
      { key: "chunk_size", label: "分块大小 (MB)", type: "text", defaultValue: "5" },
      { key: "custom_host", label: "自定义下载主机", type: "text", placeholder: "可选：自定义下载域名" },
    ],
  },
  gdrive: {
    name: "Google Drive",
    supportsMultipart: true,
    fields: [
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true, placeholder: "Google OAuth 刷新令牌" },
      { key: "client_id", label: "客户端ID", type: "text", required: true },
      { key: "client_secret", label: "客户端密钥", type: "password", required: true },
      { key: "root_folder_id", label: "根目录ID", type: "text", defaultValue: "root", placeholder: "默认 root" },
    ],
  },
  alicloud: {
    name: "阿里云盘",
    supportsMultipart: true,
    fields: [
      { key: "drive_type", label: "驱动类型", type: "select", required: true, options: [{ value: "resource", label: "资源库" }, { value: "backup", label: "备份盘" }, { value: "default", label: "默认" }], defaultValue: "resource" },
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true },
      { key: "root_folder_id", label: "根目录ID", type: "text", defaultValue: "root" },
      { key: "order_by", label: "排序方式", type: "select", options: [{ value: "name", label: "文件名" }, { value: "size", label: "文件大小" }, { value: "updated_at", label: "修改时间" }, { value: "created_at", label: "创建时间" }], defaultValue: "name" },
      { key: "order_direction", label: "排序方向", type: "select", options: [{ value: "ASC", label: "升序" }, { value: "DESC", label: "降序" }], defaultValue: "ASC" },
      { key: "use_online_api", label: "使用在线API", type: "boolean", defaultValue: false },
      { key: "api_address", label: "在线API地址", type: "text", placeholder: "自建刷新接口地址", show: (v) => v.use_online_api === true },
      { key: "client_id", label: "客户端ID", type: "text", placeholder: "本地客户端ID", show: (v) => v.use_online_api !== true },
      { key: "client_secret", label: "客户端密钥", type: "password", placeholder: "本地客户端密钥", show: (v) => v.use_online_api !== true },
      { key: "remove_way", label: "删除方式", type: "select", options: [{ value: "trash", label: "移到回收站" }, { value: "delete", label: "直接删除" }], defaultValue: "trash" },
      { key: "rapid_upload", label: "秒传", type: "boolean", defaultValue: false },
      { key: "internal_upload", label: "内网上传", type: "boolean", defaultValue: false },
      { key: "livp_download_format", label: "LIVP 下载格式", type: "select", options: [{ value: "jpeg", label: "JPEG" }, { value: "mov", label: "MOV" }], defaultValue: "jpeg" },
      { key: "alipan_type", label: "云盘类型", type: "select", options: [{ value: "default", label: "默认" }, { value: "alipanTV", label: "阿里云盘TV" }], defaultValue: "default" },
    ],
  },
  baiduyun: {
    name: "百度网盘",
    supportsMultipart: false,
    fields: [
      { key: "refresh_token", label: "刷新令牌", type: "textarea", required: true },
      { key: "root_path", label: "根目录路径", type: "text", defaultValue: "/" },
      { key: "order_by", label: "排序方式", type: "select", options: [{ value: "name", label: "文件名" }, { value: "time", label: "修改时间" }, { value: "size", label: "文件大小" }], defaultValue: "name" },
      { key: "order_direction", label: "排序方向", type: "select", options: [{ value: "asc", label: "升序" }, { value: "desc", label: "降序" }], defaultValue: "asc" },
      { key: "use_online_api", label: "使用在线API", type: "boolean", defaultValue: false },
      { key: "api_address", label: "在线API地址", type: "text", placeholder: "自建刷新接口地址", show: (v) => v.use_online_api === true },
      { key: "client_id", label: "客户端ID", type: "text", placeholder: "本地客户端ID", show: (v) => v.use_online_api !== true },
      { key: "client_secret", label: "客户端密钥", type: "password", placeholder: "本地客户端密钥", show: (v) => v.use_online_api !== true },
    ],
  },
};

function supportsMultipart(type?: string): boolean {
  if (!type) return true;
  if (type === "webdev") return false;
  if (type === "s3") return true;
  const config = driveConfigMap[type];
  if (config) return config.supportsMultipart;
  return false;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return "0 B/s";
  const k = 1024;
  const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
  const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
  return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN");
}

// ===== Login Modal (AList style, centered bottom) =====
function LoginModal({ onLogin, onClose }: { onLogin: (role: UserRole) => void; onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/storages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username, password }),
      });
      const data = (await res.json()) as { error?: string; role?: "admin" | "user" };
      if (res.ok) {
        onLogin(data.role === "admin" ? "admin" : "user");
      } else {
        setError(data.error || "登录失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-end justify-center z-50 pb-[15vh]" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-zinc-100 dark:border-zinc-800 text-center">
          <span className="text-zinc-800 dark:text-zinc-100 font-semibold text-base">登录</span>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none rounded-lg"
              placeholder="用户名"
              required
            />
          </div>
          <div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-4 py-2.5 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none rounded-lg"
              placeholder="密码"
              required
            />
          </div>
          {error && <div className="text-red-500 text-xs">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 rounded-lg transition"
          >
            {loading ? "登录中..." : "登 录"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ===== User Manage Modal (admin): 添加/管理用户 =====
// 创建的用户角色为 "user"，权限 = 下载公开存储（is_public）的文件
interface ManagedUser {
  id: number;
  username: string;
  role: string;
  createdAt: string;
}

function UserManageModal({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/users");
      if (res.ok) {
        const data = (await res.json()) as { users: ManagedUser[] };
        setUsers(data.users || []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPwd) {
      setError("两次输入的密码不一致");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        setUsername("");
        setPassword("");
        setConfirmPwd("");
        loadUsers();
      } else {
        setError(data.error || "创建失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: ManagedUser) => {
    if (!confirm(`确定删除用户 "${u.username}"？`)) return;
    try {
      const res = await fetch(`/api/users?id=${u.id}`, { method: "DELETE" });
      if (res.ok) loadUsers();
      else {
        const data = (await res.json()) as { error?: string };
        alert(data.error || "删除失败");
      }
    } catch {
      alert("网络错误");
    }
  };

  const handleReset = async () => {
    if (!resetTarget || !resetPassword) return;
    try {
      const res = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update", id: resetTarget.id, password: resetPassword }),
      });
      const data = (await res.json()) as { error?: string };
      if (res.ok) {
        setResetTarget(null);
        setResetPassword("");
      } else {
        alert(data.error || "重置失败");
      }
    } catch {
      alert("网络错误");
    }
  };

  const inputCls = "w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg focus:border-blue-500 focus:outline-none text-zinc-900 dark:text-zinc-100";

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-lg rounded-xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between">
          <span className="text-zinc-800 dark:text-zinc-100 font-semibold text-sm">👥 用户管理</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-xl leading-none">×</button>
        </div>

        {/* 添加用户 */}
        <form onSubmit={handleCreate} className="px-5 py-4 border-b border-zinc-100 dark:border-zinc-800 space-y-3">
          <div className="text-xs text-zinc-500">添加用户（权限：可下载公开存储的文件）</div>
          <div className="grid grid-cols-1 gap-2">
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className={inputCls} placeholder="用户名" required />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} placeholder="密码（至少 6 位）" required />
            <input type="password" value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} className={inputCls} placeholder="确认密码" required />
          </div>
          {error && <div className="text-red-500 text-xs">{error}</div>}
          <button type="submit" disabled={saving} className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium disabled:opacity-50 rounded-lg transition">
            {saving ? "创建中..." : "+ 添加用户"}
          </button>
        </form>

        {/* 用户列表 */}
        <div className="max-h-64 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-zinc-400 text-xs">加载中...</div>
          ) : users.length === 0 ? (
            <div className="p-4 text-center text-zinc-400 text-xs">暂无用户</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-zinc-400 border-b border-zinc-100 dark:border-zinc-800">
                <tr>
                  <th className="text-left py-2 px-5 font-medium">用户名</th>
                  <th className="text-left py-2 px-2 font-medium">权限</th>
                  <th className="text-right py-2 px-5 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-zinc-50 dark:border-zinc-800/50">
                    <td className="py-2 px-5 text-zinc-800 dark:text-zinc-100 truncate max-w-[10rem]">{u.username}</td>
                    <td className="py-2 px-2 text-xs text-blue-500">下载公开文件</td>
                    <td className="py-2 px-5 text-right whitespace-nowrap">
                      <button onClick={() => { setResetTarget(u); setResetPassword(""); }} className="text-xs text-zinc-400 hover:text-blue-500 px-2">重置密码</button>
                      <button onClick={() => handleDelete(u)} className="text-xs text-zinc-400 hover:text-red-500 px-2">删除</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 重置密码 */}
        {resetTarget && (
          <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center gap-2">
            <span className="text-xs text-zinc-500 shrink-0">重置 "{resetTarget.username}" 的密码：</span>
            <input type="password" value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} className={inputCls} placeholder="新密码（至少 6 位）" autoFocus />
            <button onClick={handleReset} disabled={!resetPassword} className="shrink-0 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs disabled:opacity-50 rounded-lg">确定</button>
            <button onClick={() => setResetTarget(null)} className="shrink-0 px-3 py-2 text-xs text-zinc-500 border border-zinc-200 dark:border-zinc-700 rounded-lg">取消</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== Storage Modal =====
function StorageModal({ storage, onSave, onCancel, onedriveClientId, onedriveClientSecret }: { storage?: StorageInfo; onSave: () => void; onCancel: () => void; onedriveClientId?: string; onedriveClientSecret?: string }) {
  const initConfig = (type: string, existing?: Record<string, any>) => {
    const fields = driveConfigMap[type]?.fields || [];
    const base = { ...(existing || {}) };
    // OneDrive 环境变量默认值
    if (type === "onedrive") {
      if (!base.client_id && onedriveClientId) base.client_id = onedriveClientId;
      if (!base.client_secret && onedriveClientSecret) base.client_secret = onedriveClientSecret;
    }
    for (const field of fields) {
      if (base[field.key] === undefined && field.defaultValue !== undefined) {
        base[field.key] = field.defaultValue;
      }
    }
    return base;
  };

  const [formData, setFormData] = useState({
    name: storage?.name || "",
    type: storage?.type || "s3",
    endpoint: storage?.endpoint || "",
    region: storage?.region || "auto",
    accessKeyId: storage?.accessKeyId || "",
    secretAccessKey: "",
    bucket: storage?.bucket || "",
    basePath: storage?.basePath || "",
    config: initConfig(storage?.type || "s3", storage?.config),
    isPublic: storage?.isPublic ?? false,
    guestList: storage?.guestList ?? false,
    guestDownload: storage?.guestDownload ?? false,
    guestUpload: storage?.guestUpload ?? false,
    orderBy: storage?.config?.orderBy || "name",
    orderDirection: storage?.config?.orderDirection || "asc",
    folderOrder: storage?.config?.folderOrder || "top",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const driveConfig = driveConfigMap[formData.type || ""];
  const isS3 = formData.type === "s3";
  const isWebdav = formData.type === "webdev";

  const handleTypeChange = (nextType: string) => {
    setFormData({
      ...formData,
      type: nextType,
      endpoint: nextType === "s3" || nextType === "webdev" ? formData.endpoint : "",
      region: nextType === "s3" ? formData.region : "auto",
      accessKeyId: nextType === "s3" || nextType === "webdev" ? formData.accessKeyId : "",
      secretAccessKey: "",
      bucket: nextType === "s3" ? formData.bucket : "",
      basePath: nextType === "s3" || nextType === "webdev" ? formData.basePath : "",
      config: initConfig(nextType, {}),
    });
  };

  const updateConfigValue = (key: string, value: string | number | boolean) => {
    setFormData({ ...formData, config: { ...(formData.config || {}), [key]: value } });
  };

  const renderConfigField = (field: ConfigField) => {
    const values = formData.config || {};
    if (field.show && !field.show(values)) return null;
    const cls = "w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg";
    const value = values[field.key] ?? "";

    if (field.type === "boolean") {
      return (
        <label key={field.key} className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => updateConfigValue(field.key, e.target.checked)} className="w-4 h-4 rounded" />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">{field.label}</span>
        </label>
      );
    }
    if (field.type === "select") {
      return (
        <div key={field.key}>
          <label className="block text-xs text-zinc-500 mb-1">{field.label}{field.required ? " *" : ""}</label>
          <select value={String(value)} onChange={(e) => updateConfigValue(field.key, e.target.value)} className={cls} required={field.required}>
            {(field.options || []).map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      );
    }
    if (field.type === "textarea") {
      return (
        <div key={field.key}>
          <label className="block text-xs text-zinc-500 mb-1">{field.label}{field.required ? " *" : ""}</label>
          <textarea value={String(value)} onChange={(e) => updateConfigValue(field.key, e.target.value)} className={`${cls} h-20`} placeholder={field.placeholder} required={field.required} />
        </div>
      );
    }
    return (
      <div key={field.key}>
        <label className="block text-xs text-zinc-500 mb-1">{field.label}{field.required ? " *" : ""}</label>
        <input type={field.type} value={String(value)} onChange={(e) => updateConfigValue(field.key, e.target.value)} className={cls} placeholder={field.placeholder} required={field.required} />
      </div>
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const method = storage ? "PUT" : "POST";
      const configToSend = { ...(formData.config || {}) };
      if (driveConfig) {
        for (const field of driveConfig.fields) {
          if (field.type === "password" && !configToSend[field.key]) delete configToSend[field.key];
        }
      }
      configToSend.orderBy = formData.orderBy;
      configToSend.orderDirection = formData.orderDirection;
      configToSend.folderOrder = formData.folderOrder;
      const body: any = storage ? { id: storage.id, ...formData, config: configToSend } : { ...formData, config: configToSend };
      if (storage && !formData.secretAccessKey && (isS3 || isWebdav)) delete body.secretAccessKey;

      const res = await fetch("/api/storages", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) onSave();
      else { const d = await res.json(); setError(d.error || "保存失败"); }
    } catch { setError("网络错误"); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onCancel}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between sticky top-0 bg-white dark:bg-zinc-900 rounded-t-xl">
          <span className="text-zinc-800 dark:text-zinc-100 font-semibold text-sm">{storage ? "编辑存储" : "添加存储"}</span>
          <button onClick={onCancel} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-xs text-zinc-500 mb-1">名称 *</label>
              <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" placeholder="My Storage" required />
            </div>
            <div className="col-span-2">
              <label className="block text-xs text-zinc-500 mb-1">存储类型 *</label>
              <select value={formData.type} onChange={(e) => handleTypeChange(e.target.value)} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" required>
                <option value="s3">S3 兼容服务</option>
                <option value="webdev">WebDAV</option>
                <option value="onedrive">OneDrive</option>
                <option value="gdrive">Google Drive</option>
                <option value="alicloud">阿里云盘</option>
                <option value="baiduyun">百度网盘</option>
              </select>
            </div>
            {(isS3 || isWebdav) && (
              <div className="col-span-2">
                <label className="block text-xs text-zinc-500 mb-1">{isWebdav ? "WebDAV 服务器地址" : "Endpoint"} *</label>
                <input type="url" value={formData.endpoint} onChange={(e) => setFormData({ ...formData, endpoint: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" placeholder={isWebdav ? "https://example.com/webdav" : "https://s3.us-east-1.amazonaws.com"} required />
              </div>
            )}
            {isS3 && <>
              <div><label className="block text-xs text-zinc-500 mb-1">Region</label><input type="text" value={formData.region} onChange={(e) => setFormData({ ...formData, region: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" /></div>
              <div><label className="block text-xs text-zinc-500 mb-1">Bucket *</label><input type="text" value={formData.bucket} onChange={(e) => setFormData({ ...formData, bucket: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" required /></div>
            </>}
            {(isS3 || isWebdav) && <>
              <div><label className="block text-xs text-zinc-500 mb-1">{isWebdav ? "用户名" : "Access Key"} *</label><input type="text" value={formData.accessKeyId} onChange={(e) => setFormData({ ...formData, accessKeyId: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" required={!storage} /></div>
              <div><label className="block text-xs text-zinc-500 mb-1">{isWebdav ? "密码" : "Secret Key"} {storage && "(留空保持)"}</label><input type="password" value={formData.secretAccessKey} onChange={(e) => setFormData({ ...formData, secretAccessKey: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" required={!storage} /></div>
              <div className="col-span-2"><label className="block text-xs text-zinc-500 mb-1">根路径</label><input type="text" value={formData.basePath} onChange={(e) => setFormData({ ...formData, basePath: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg" placeholder="/path/to/folder" /></div>
            </>}
            {driveConfig && (
              <div className="col-span-2 border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">
                <div className="text-xs text-zinc-500 mb-2">驱动配置 - {driveConfig.name}</div>
                <div className="space-y-3">{driveConfig.fields.map(renderConfigField)}</div>
                {/* OneDrive 一键授权按钮 */}
                {formData.type === "onedrive" && !(formData.config?.use_online_api) && (
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                    <div className="text-xs text-blue-600 dark:text-blue-400 mb-2 font-medium">💡 快速授权</div>
                    <div className="text-[11px] text-zinc-500 mb-2">填写上方 Client ID 和 Client Secret 后，点击下方按钮完成 OneDrive 授权，无需手动获取令牌。</div>
                    <button
                      type="button"
                      onClick={async () => {
                        const cfg = formData.config || {};
                        if (!cfg.client_id || !cfg.client_secret) { alert("请先填写 Client ID 和 Client Secret"); return; }
                        const region = cfg.region || "global";
                        const isSp = cfg.is_sharepoint === true;
                        const siteId = cfg.site_id || "";
                        const localCb = window.location.origin + "/api/oauth/onedrive/callback";
                        const redirectUri = cfg.redirect_uri || localCb;
                        // PKCE: 生成 code_verifier 和 code_challenge
                        const toBase64Url = (buf: ArrayBuffer | Uint8Array) => {
                          const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
                          let s = '';
                          for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
                          return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                        };
                        const array = new Uint8Array(32);
                        crypto.getRandomValues(array);
                        const codeVerifier = toBase64Url(array);
                        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
                        const codeChallenge = toBase64Url(new Uint8Array(digest));
                        // state 包含所有需要的参数
                        const state = btoa(JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: redirectUri, cb: localCb, region, is_sharepoint: isSp, site_id: siteId, code_verifier: codeVerifier }));
                        const loginBase = region === "cn"
                          ? "https://login.partner.microsoftonline.cn/common/oauth2/v2.0/authorize"
                          : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
                        const scope = isSp ? "https://graph.microsoft.com/.default offline_access" : "User.Read Files.ReadWrite offline_access";
                        const oauthUrl = `${loginBase}?client_id=${encodeURIComponent(cfg.client_id)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${encodeURIComponent(state)}&response_mode=query&code_challenge=${codeChallenge}&code_challenge_method=S256`;
                        const popup = window.open(oauthUrl, "onedrive_oauth", "width=600,height=700,left=200,top=100");
                        const handler = (e: MessageEvent) => {
                          if (e.data?.type === "onedrive_oauth" && e.data?.data?.refresh_token) {
                            setFormData(prev => ({
                              ...prev,
                              config: { ...prev.config, refresh_token: e.data.data.refresh_token, region: e.data.data.region || prev.config?.region }
                            }));
                            window.removeEventListener("message", handler);
                            try { popup?.close(); } catch {}
                          }
                        };
                        window.addEventListener("message", handler);
                      }}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition"
                    >
                      🔐 一键获取 OneDrive 授权
                    </button>
                  </div>
                )}
                {/* Google Drive 一键授权按钮 */}
                {formData.type === "gdrive" && (
                  <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                    <div className="text-xs text-green-600 dark:text-green-400 mb-2 font-medium">💡 快速授权</div>
                    <div className="text-[11px] text-zinc-500 mb-2">填写上方 Client ID 和 Client Secret 后，点击下方按钮完成 Google Drive 授权。</div>
                    <button
                      type="button"
                      onClick={() => {
                        const cfg = formData.config || {};
                        if (!cfg.client_id || !cfg.client_secret) { alert("请先填写 Client ID 和 Client Secret"); return; }
                        const redirectUri = window.location.origin + "/api/oauth/gdrive/callback";
                        const state = btoa(JSON.stringify({ client_id: cfg.client_id, client_secret: cfg.client_secret, redirect_uri: redirectUri }));
                        const oauthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(cfg.client_id)}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent("https://www.googleapis.com/auth/drive offline_access")}&state=${encodeURIComponent(state)}&access_type=offline&prompt=consent`;
                        window.open(oauthUrl, "gdrive_oauth", "width=600,height=700,left=200,top=100");
                        const handler = (e: MessageEvent) => {
                          if (e.data?.type === "gdrive_oauth" && e.data?.data?.refresh_token) {
                            setFormData(prev => ({
                              ...prev,
                              config: { ...prev.config, refresh_token: e.data.data.refresh_token }
                            }));
                            window.removeEventListener("message", handler);
                          }
                        };
                        window.addEventListener("message", handler);
                      }}
                      className="w-full py-2 bg-green-600 hover:bg-green-500 text-white text-xs font-medium rounded-lg transition"
                    >
                      🔐 一键获取 Google Drive 授权
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="col-span-2 border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">
              <div className="text-xs text-zinc-500 mb-2">排列设置</div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">排列依据</label>
                  <select value={formData.orderBy} onChange={(e) => setFormData({ ...formData, orderBy: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg">
                    <option value="name">名称</option>
                    <option value="size">大小</option>
                    <option value="modified">修改时间</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">排序方式</label>
                  <select value={formData.orderDirection} onChange={(e) => setFormData({ ...formData, orderDirection: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg">
                    <option value="asc">升序</option>
                    <option value="desc">降序</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">文件夹顺序</label>
                  <select value={formData.folderOrder} onChange={(e) => setFormData({ ...formData, folderOrder: e.target.value })} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-zinc-900 dark:text-zinc-100 text-sm focus:border-blue-500 focus:outline-none rounded-lg">
                    <option value="top">文件夹置顶</option>
                    <option value="bottom">文件夹置底</option>
                    <option value="mixed">不区分</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={formData.isPublic} onChange={(e) => { const c = e.target.checked; setFormData({ ...formData, isPublic: c, guestList: c, guestDownload: c }); }} className="w-4 h-4 rounded" />
                <span className="text-sm text-zinc-700 dark:text-zinc-300">公开访问</span>
              </label>
            </div>
            <div className="col-span-2 border-t border-zinc-200 dark:border-zinc-700 pt-3 mt-1">
              <div className="text-xs text-zinc-500 mb-2">游客权限</div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.guestList} onChange={(e) => setFormData({ ...formData, guestList: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-zinc-700 dark:text-zinc-300">允许浏览</span></label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.guestDownload} onChange={(e) => setFormData({ ...formData, guestDownload: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-zinc-700 dark:text-zinc-300">允许下载</span></label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={formData.guestUpload} onChange={(e) => setFormData({ ...formData, guestUpload: e.target.checked })} className="w-4 h-4 rounded" /><span className="text-sm text-zinc-700 dark:text-zinc-300">允许上传</span></label>
              </div>
            </div>
          </div>
          {error && <div className="text-red-500 text-xs">{error}</div>}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onCancel} className="flex-1 py-2 px-4 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-sm rounded-lg transition">取消</button>
            <button type="submit" disabled={loading} className="flex-1 py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50 rounded-lg transition">{loading ? "保存中..." : "保存"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ===== Path Meta Settings Modal =====
function PathMetaModal({ storageId, currentPath, onClose }: { storageId: number; currentPath: string; onClose: () => void }) {
  const [items, setItems] = useState<Array<{ id: number; path: string; password: string; p_sub: number; write_access: number; w_sub: number; hide: string; h_sub: number; readme: string; r_sub: number; header: string; header_sub: number; footer: string; footer_sub: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editItem, setEditItem] = useState<{
    id?: number; path: string;
    password: string; p_sub: boolean;
    write_access: boolean; w_sub: boolean;
    hide: string; h_sub: boolean;
    readme: string; r_sub: boolean;
    header: string; header_sub: boolean;
    footer: string; footer_sub: boolean;
  } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/path-meta?storageId=${storageId}&_all=1`);
      if (res.ok) { const data = await res.json() as { items: typeof items }; setItems(data.items || []); }
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [storageId]);

  const handleSave = async () => {
    if (!editItem) return; setSaving(true); setError("");
    try {
      const res = await fetch("/api/path-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...editItem, storageId }),
      });
      if (res.ok) { setEditItem(null); load(); } else { const d = await res.json(); setError(d.error || "保存失败"); }
    } catch { setError("网络错误"); } finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("确定删除此路径配置？")) return;
    try {
      const res = await fetch("/api/path-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, storageId, _delete: true }),
      });
      if (res.ok) load();
    } catch {}
  };

  const inputCls = "w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none rounded-lg";
  const labelCls = "block text-xs text-zinc-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <span className="text-zinc-800 dark:text-zinc-100 font-semibold text-sm">路径元信息管理</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">&times;</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? <div className="text-center text-zinc-400 py-8">加载中...</div> : (<>
            <div className="mb-4">
              <button
                onClick={() => setEditItem({ path: currentPath, password: "", p_sub: true, write_access: true, w_sub: true, hide: "", h_sub: true, readme: "", r_sub: true, header: "", header_sub: true, footer: "", footer_sub: true })}
                className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1.5 rounded-lg"
              >
                + 添加路径配置
              </button>
              <span className="ml-2 text-xs text-zinc-400">当前路径: /{currentPath || "(根目录)"}</span>
            </div>

            {items.length === 0 && !editItem ? (
              <div className="text-center text-zinc-300 dark:text-zinc-600 py-8 text-sm">暂无路径配置</div>
            ) : (
              <div className="space-y-2">
                {items.map(item => (
                  <div key={item.id} className="flex items-center gap-3 p-3 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200">/{item.path || "(根目录)"}</div>
                      <div className="text-xs text-zinc-400 truncate flex flex-wrap gap-x-2">
                        {item.password && <span>🔒{item.p_sub ? "↓" : ""}</span>}
                        {!item.write_access && <span>🚫写{item.w_sub ? "↓" : ""}</span>}
                        {item.hide && <span>👁隐藏{item.h_sub ? "↓" : ""}</span>}
                        {item.readme && <span>📖{item.r_sub ? "↓" : ""}</span>}
                        {item.header && <span>📋头{item.header_sub ? "↓" : ""}</span>}
                        {item.footer && <span>📋尾{item.footer_sub ? "↓" : ""}</span>}
                      </div>
                    </div>
                    <button onClick={() => setEditItem({
                      id: item.id, path: item.path,
                      password: item.password, p_sub: !!item.p_sub,
                      write_access: !!item.write_access, w_sub: !!item.w_sub,
                      hide: item.hide, h_sub: !!item.h_sub,
                      readme: item.readme, r_sub: !!item.r_sub,
                      header: item.header, header_sub: !!item.header_sub,
                      footer: item.footer, footer_sub: !!item.footer_sub,
                    })} className="text-xs text-blue-500 hover:text-blue-400 px-2">编辑</button>
                    <button onClick={() => handleDelete(item.id)} className="text-xs text-red-500 hover:text-red-400 px-2">删除</button>
                  </div>
                ))}
              </div>
            )}

            {editItem && (
              <div className="mt-4 p-4 border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/20 rounded-lg space-y-3">
                <div className="text-xs font-medium text-blue-600 dark:text-blue-400">{editItem.id ? "编辑" : "新增"}路径配置</div>
                <div>
                  <label className={labelCls}>路径</label>
                  <input type="text" value={editItem.path} onChange={e => setEditItem({ ...editItem, path: e.target.value })} className={inputCls} placeholder="留空表示根目录" />
                </div>

                {/* 密码 */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={labelCls}>访问密码</label>
                    <input type="password" value={editItem.password} onChange={e => setEditItem({ ...editItem, password: e.target.value })} className={inputCls} placeholder="留空不设密码" />
                  </div>
                  <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer">
                    <input type="checkbox" checked={editItem.p_sub} onChange={e => setEditItem({ ...editItem, p_sub: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                    <span className="text-[11px] text-zinc-500">应用到子目录</span>
                  </label>
                </div>

                {/* 写权限 */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={labelCls}>允许上传</label>
                    <label className="flex items-center gap-2 cursor-pointer mt-1">
                      <input type="checkbox" checked={editItem.write_access} onChange={e => setEditItem({ ...editItem, write_access: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">允许在此路径上传文件</span>
                    </label>
                  </div>
                  <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer">
                    <input type="checkbox" checked={editItem.w_sub} onChange={e => setEditItem({ ...editItem, w_sub: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                    <span className="text-[11px] text-zinc-500">应用到子目录</span>
                  </label>
                </div>

                {/* 隐藏规则 */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={labelCls}>隐藏文件规则</label>
                    <textarea value={editItem.hide} onChange={e => setEditItem({ ...editItem, hide: e.target.value })} className={`${inputCls} h-16 font-mono text-xs`} placeholder={`每行一个正则，如:\n^\.\\.*
secret.*`} />
                    <div className="text-[10px] text-zinc-400 mt-1">每行一个正则表达式，匹配的文件名将被隐藏</div>
                  </div>
                  <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer shrink-0">
                    <input type="checkbox" checked={editItem.h_sub} onChange={e => setEditItem({ ...editItem, h_sub: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                    <span className="text-[11px] text-zinc-500">应用到子目录</span>
                  </label>
                </div>

                {/* README */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={labelCls}>README</label>
                    <textarea value={editItem.readme} onChange={e => setEditItem({ ...editItem, readme: e.target.value })} className={`${inputCls} h-24 font-mono text-xs`} placeholder="Markdown 格式，显示在文件列表下方" />
                  </div>
                  <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer shrink-0">
                    <input type="checkbox" checked={editItem.r_sub} onChange={e => setEditItem({ ...editItem, r_sub: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                    <span className="text-[11px] text-zinc-500">应用到子目录</span>
                  </label>
                </div>

                {/* Header */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={labelCls}>头部内容</label>
                    <textarea value={editItem.header} onChange={e => setEditItem({ ...editItem, header: e.target.value })} className={`${inputCls} h-16 font-mono text-xs`} placeholder="HTML，显示在文件列表上方" />
                  </div>
                  <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer shrink-0">
                    <input type="checkbox" checked={editItem.header_sub} onChange={e => setEditItem({ ...editItem, header_sub: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                    <span className="text-[11px] text-zinc-500">应用到子目录</span>
                  </label>
                </div>

                {/* Footer */}
                <div className="flex items-end gap-3">
                  <div className="flex-1">
                    <label className={labelCls}>底部内容</label>
                    <textarea value={editItem.footer} onChange={e => setEditItem({ ...editItem, footer: e.target.value })} className={`${inputCls} h-16 font-mono text-xs`} placeholder="HTML，显示在文件列表下方" />
                  </div>
                  <label className="flex items-center gap-1.5 pb-2.5 cursor-pointer shrink-0">
                    <input type="checkbox" checked={editItem.footer_sub} onChange={e => setEditItem({ ...editItem, footer_sub: e.target.checked })} className="w-3.5 h-3.5 rounded" />
                    <span className="text-[11px] text-zinc-500">应用到子目录</span>
                  </label>
                </div>

                {error && <div className="text-red-500 text-xs">{error}</div>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setEditItem(null)} className="flex-1 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-800">取消</button>
                  <button onClick={handleSave} disabled={saving} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50 rounded-lg">{saving ? "保存中..." : "保存"}</button>
                </div>
              </div>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}

// ===== File Browser =====
function FileBrowser({ storage, role, onInteraction, chunkSizeMB, searchQuery: globalSearch }: { storage: StorageInfo; role: UserRole; onInteraction: () => void; chunkSizeMB: number; searchQuery?: string }) {
  const isAdmin = role === "admin";
  const isUser = role === "user";
  // 用户（user）仅可下载公开存储（is_public = 1）的文件，不可上传/管理
  const canList = isAdmin || (isUser ? storage.isPublic : storage.guestList);
  const canDownload = isAdmin || (isUser ? storage.isPublic : storage.guestDownload);
  const canUpload = isAdmin || (!isUser && storage.guestUpload);

  const [path, setPath] = useState("");
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<{ name: string; progress: number; currentPart?: number; totalParts?: number; speed?: number; loaded?: number; total?: number } | null>(null);
  const [previewFile, setPreviewFile] = useState<S3Object | null>(null);
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [showOfflineDownload, setShowOfflineDownload] = useState(false);
  const [offlineUrl, setOfflineUrl] = useState("");
  const [offlineFilename, setOfflineFilename] = useState("");
  const [offlineDownloading, setOfflineDownloading] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<S3Object | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [moveTarget, setMoveTarget] = useState<S3Object | null>(null);
  const [moveDestPath, setMoveDestPath] = useState("");
  const [moving, setMoving] = useState(false);
  const [allFolders, setAllFolders] = useState<string[]>([]);
  const [shareTarget, setShareTarget] = useState<S3Object | null>(null);
  const [shareToken, setShareToken] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [shareExpireHours, setShareExpireHours] = useState(0);
  const [creatingShare, setCreatingShare] = useState(false);
  const [passwordRequired, setPasswordRequired] = useState<{ hint: string; folderPath: string } | null>(null);
  const [passwordInput, setPasswordInput] = useState("");
  const [verifyingPassword, setVerifyingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showSetPassword, setShowSetPassword] = useState(false);
  const [showPathMeta, setShowPathMeta] = useState(false);
  const [pathMeta, setPathMeta] = useState<{ write_access: boolean; hide: string; readme: string; header: string; footer: string }>({ write_access: true, hide: "", readme: "", header: "", footer: "" });

  const [setPasswordPath, setSetPasswordPath] = useState("");
  const [setPasswordValue, setSetPasswordValue] = useState("");
  const [setPasswordHint, setSetPasswordHint] = useState("");
  const [settingPassword, setSettingPassword] = useState(false);
  const [protectedPaths, setProtectedPaths] = useState<Set<string>>(new Set());

  // Sorting config from storage config
  const [sortBy, setSortBy] = useState<string>(storage.config?.orderBy || "name");
  const [sortDir, setSortDir] = useState<string>(storage.config?.orderDirection || "asc");
  const [folderPos, setFolderPos] = useState<string>(storage.config?.folderOrder || "top");

  // Sync sort config when storage changes
  useEffect(() => {
    setSortBy(storage.config?.orderBy || "name");
    setSortDir(storage.config?.orderDirection || "asc");
    setFolderPos(storage.config?.folderOrder || "top");
  }, [storage.id, storage.config?.orderBy, storage.config?.orderDirection, storage.config?.folderOrder]);

  // Sort objects based on config
  const sortObjects = useCallback((items: S3Object[]) => {
    const sorted = [...items];
    sorted.sort((a, b) => {
      // Folder ordering
      if (folderPos !== "mixed") {
        if (a.isDirectory !== b.isDirectory) {
          return folderPos === "top" ? (a.isDirectory ? -1 : 1) : (a.isDirectory ? 1 : -1);
        }
      }

      let cmp = 0;
      switch (sortBy) {
        case "size":
          cmp = a.size - b.size;
          break;
        case "modified":
          cmp = new Date(a.lastModified || 0).getTime() - new Date(b.lastModified || 0).getTime();
          break;
        case "name":
        default:
          cmp = a.name.localeCompare(b.name, "zh-CN");
          break;
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return sorted;
  }, [sortBy, sortDir, folderPos]);

  // Toggle time sort direction
  const toggleTimeSort = useCallback(() => {
    if (sortBy === "modified") {
      const newDir = sortDir === "asc" ? "desc" : "asc";
      setSortDir(newDir);
      // Persist to storage config
      fetch("/api/storages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: storage.id, config: { orderBy: "modified", orderDirection: newDir, folderOrder: folderPos } }),
      });
    } else {
      setSortBy("modified");
      setSortDir("desc");
      fetch("/api/storages", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: storage.id, config: { orderBy: "modified", orderDirection: "desc", folderOrder: folderPos } }),
      });
    }
  }, [sortBy, sortDir, folderPos, storage.id]);

  // Notify parent on any interaction
  const notify = useCallback(() => { onInteraction(); }, [onInteraction]);

  useEffect(() => { setPath(""); }, [storage.id]);
  useEffect(() => { loadFiles(); setSelectedKeys(new Set()); loadPathMeta(); }, [storage.id, path]);

  const loadPathMeta = async () => {
    try {
      const res = await fetch(`/api/path-meta?storageId=${storage.id}&path=${encodeURIComponent(path)}`);
      if (res.ok) { const data = await res.json() as { meta?: typeof pathMeta }; if (data.meta) setPathMeta(data.meta as typeof pathMeta); }
    } catch {}
  };

  const loadFiles = async (force = false) => {
    setError(""); setPasswordRequired(null);
    const cacheKey = `clist:list:${storage.id}:${path}`;
    if (force) { try { sessionStorage.removeItem(cacheKey); } catch {} }
    let cachedObjs: S3Object[] | null = null;
    try {
      const raw = sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { ts?: number; objects?: S3Object[] };
        if (parsed.objects && (!parsed.ts || Date.now() - parsed.ts < LIST_CACHE_TTL_MS)) cachedObjs = parsed.objects;
      }
    } catch {}

    // 有新鲜缓存 → 立即展示，避免刷新白屏/报错（后台再验证）
    const hasCache = !!cachedObjs;
    if (hasCache) { setObjects(cachedObjs!); setLoading(false); }
    else setLoading(true);

    try {
      const res = await fetch(`/api/files/${storage.id}/${path}?action=list`);
      if (res.ok) {
        const data = await res.json() as { objects?: S3Object[] };
        const objs = data.objects || [];
        setObjects(objs);
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), objects: objs })); } catch {}
      } else {
        const data = await res.json() as { error?: string; hint?: string; folderPath?: string };
        if (data.error === "password_required") { setPasswordRequired({ hint: data.hint || "", folderPath: data.folderPath || path }); setObjects([]); }
        else if (!hasCache) setError(data.error || "加载失败");
        // hasCache 时：远端限流等错误静默保留缓存，刷新不报错
      }
    } catch { if (!hasCache) setError("网络错误"); }
    finally { setLoading(false); }
  };

  const loadProtectedPaths = async () => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`/api/folder-passwords?storageId=${storage.id}`);
      if (res.ok) { const data = await res.json() as { passwords?: Array<{ folderPath: string }> }; setProtectedPaths(new Set((data.passwords || []).map(p => p.folderPath))); }
    } catch {}
  };
  useEffect(() => { loadProtectedPaths(); }, [storage.id, isAdmin]);

  const navigateTo = (newPath: string) => { setPath(newPath.replace(/^\//, "").replace(/\/$/, "")); notify(); };
  const goUp = () => { const parts = path.split("/").filter(Boolean); parts.pop(); setPath(parts.join("/")); notify(); };
  const downloadFile = (key: string) => { window.open(`/api/files/${storage.id}/${key}?action=download`, "_blank"); notify(); };

  const deleteFile = async (key: string) => {
    if (!confirm(`确定删除 ${key}?`)) return;
    try { const res = await fetch(`/api/files/${storage.id}/${key}`, { method: "DELETE" }); if (res.ok) loadFiles(true); else { const d = await res.json(); alert(d.error || "删除失败"); } }
    catch { alert("网络错误"); }
  };
  const deleteFolder = async (key: string, name: string) => {
    if (!confirm(`确定删除文件夹 "${name}" 及其所有内容?`)) return;
    try { const res = await fetch(`/api/files/${storage.id}/${key}?action=rmdir`, { method: "DELETE" }); if (res.ok) loadFiles(true); else { const d = await res.json(); alert(d.error || "删除失败"); } }
    catch { alert("网络错误"); }
  };

  const startRename = (obj: S3Object) => { setRenameTarget(obj); setRenameValue(obj.name); notify(); };
  const handleRename = async () => {
    if (!renameTarget || !renameValue.trim()) return;
    if (renameValue.includes("/")) { alert("名称不能包含 /"); return; }
    if (renameValue === renameTarget.name) { setRenameTarget(null); return; }
    setRenaming(true);
    try {
      const res = await fetch(`/api/files/${storage.id}/${renameTarget.key}?action=rename`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ newName: renameValue.trim() }) });
      if (res.ok) { setRenameTarget(null); loadFiles(true); } else { const d = await res.json(); alert(d.error || "重命名失败"); }
    } catch { alert("网络错误"); } finally { setRenaming(false); }
  };

  const loadAllFolders = async () => {
    const folders: string[] = [""];
    const listRecursive = async (prefix: string) => {
      try { const res = await fetch(`/api/files/${storage.id}/${prefix}?action=list`); if (res.ok) { const data = await res.json() as { objects?: S3Object[] }; for (const obj of data.objects || []) { if (obj.isDirectory) { folders.push(obj.key); await listRecursive(obj.key); } } } } catch {}
    };
    await listRecursive("");
    setAllFolders(folders);
  };

  const startMove = async (obj: S3Object) => { setMoveTarget(obj); setMoveDestPath(""); await loadAllFolders(); notify(); };
  const handleMove = async () => {
    if (!moveTarget) return; setMoving(true);
    try {
      const res = await fetch(`/api/files/${storage.id}/${moveTarget.key}?action=move`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ destPath: moveDestPath }) });
      if (res.ok) { setMoveTarget(null); loadFiles(true); } else { const d = await res.json(); alert(d.error || "移动失败"); }
    } catch { alert("网络错误"); } finally { setMoving(false); }
  };

  const startShare = (obj: S3Object) => { setShareTarget(obj); setShareToken(""); setShareUrl(""); setShareExpireHours(0); notify(); };
  const handleCreateShare = async () => {
    if (!shareTarget) return; setCreatingShare(true);
    try {
      let expiresAt: string | undefined;
      if (shareExpireHours > 0) { const d = new Date(); d.setHours(d.getHours() + shareExpireHours); expiresAt = d.toISOString(); }
      const res = await fetch("/api/shares", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storageId: storage.id, filePath: shareTarget.key, isDirectory: shareTarget.isDirectory, expiresAt }) });
      if (res.ok) { const data = await res.json() as { share: { shareToken: string }; shareUrl: string }; setShareToken(data.share.shareToken); setShareUrl(data.shareUrl); }
      else { const d = await res.json(); alert(d.error || "创建分享链接失败"); }
    } catch { alert("网络错误"); } finally { setCreatingShare(false); }
  };

  const copyToClipboard = (text: string) => { navigator.clipboard.writeText(text).then(() => alert("已复制")).catch(() => alert("复制失败")); };
  const toggleSelect = (key: string) => { setSelectedKeys(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; }); };
  const toggleSelectAll = () => { setSelectedKeys(prev => { const n = new Set(prev); allVisibleSelected ? visibleObjects.forEach(o => n.delete(o.key)) : visibleObjects.forEach(o => n.add(o.key)); return n; }); };

  const handleBatchDelete = async () => {
    if (selectedKeys.size === 0) return;
    const folders = objects.filter(o => o.isDirectory && selectedKeys.has(o.key));
    const files = objects.filter(o => !o.isDirectory && selectedKeys.has(o.key));
    if (!confirm(folders.length > 0 ? `确定删除 ${files.length} 个文件和 ${folders.length} 个文件夹?` : `确定删除 ${files.length} 个文件?`)) return;
    setDeleting(true);
    try {
      for (const f of folders) { await fetch(`/api/files/${storage.id}/${f.key}?action=rmdir`, { method: "DELETE" }); }
      for (const f of files) { await fetch(`/api/files/${storage.id}/${f.key}`, { method: "DELETE" }); }
      setSelectedKeys(new Set()); loadFiles(true);
    } finally { setDeleting(false); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files; if (!files || files.length === 0) return;
    const CHUNK_SIZE = chunkSizeMB * 1024 * 1024;
    for (const file of Array.from(files)) {
      try {
        const uploadPath = path ? `${path}/${file.name}` : file.name;
        const canMultipart = supportsMultipart(storage.type);
        if (file.size >= CHUNK_SIZE && canMultipart) await uploadMultipart(file, uploadPath, CHUNK_SIZE);
        else await uploadSingle(file, uploadPath);
      } catch (err) { alert(`上传 ${file.name} 失败: ${err instanceof Error ? err.message : "未知错误"}`); }
    }
    setUploadProgress(null); loadFiles(true); e.target.value = "";
  };

  const uploadSingle = async (file: File, uploadPath: string) => {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) setUploadProgress({ name: file.name, progress: Math.round((event.loaded / event.total) * 100) }); };
      xhr.onload = () => { xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("上传失败")); };
      xhr.onerror = () => reject(new Error("网络错误"));
      xhr.open("PUT", `/api/files/${storage.id}/${uploadPath}`);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.send(file);
    });
  };

  const uploadMultipart = async (file: File, uploadPath: string, chunkSize: number) => {
    const totalParts = Math.ceil(file.size / chunkSize);
    const contentType = file.type || "application/octet-stream";
    const storageKey = `multipart_${storage.id}_${uploadPath}_${file.size}`;
    const savedState = localStorage.getItem(storageKey);
    let uploadId: string;
    let completedParts: { partNumber: number; etag: string }[] = [];
    let startPart = 0;
    let useDirectUpload = true;

    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        if (parsed.uploadId && parsed.parts && parsed.fileName === file.name) {
          if (confirm(`检测到未完成的上传 "${file.name}"，是否继续？\n已完成 ${parsed.parts.length}/${totalParts} 分片`)) {
            uploadId = parsed.uploadId; completedParts = parsed.parts; startPart = completedParts.length; useDirectUpload = parsed.useDirectUpload ?? true;
          } else {
            try { await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-abort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId: parsed.uploadId }) }); } catch {}
            localStorage.removeItem(storageKey);
          }
        }
      } catch {}
    }

    if (!uploadId!) {
      setUploadProgress({ name: file.name, progress: 0, currentPart: 0, totalParts, speed: 0, loaded: 0, total: file.size });
      const initRes = await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-init`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contentType, size: file.size, chunkSize }) });
      if (!initRes.ok) { const d = await initRes.json(); throw new Error(d.error || "初始化分片上传失败"); }
      const initData = await initRes.json() as { uploadId: string };
      uploadId = initData.uploadId;
      localStorage.setItem(storageKey, JSON.stringify({ uploadId, fileName: file.name, parts: [], useDirectUpload: true }));
    }

    let totalBytesUploaded = startPart * chunkSize;
    const startTime = Date.now();
    const partProgress: Record<number, number> = {};
    const updateProgress = () => {
      const currentBytes = totalBytesUploaded + Object.values(partProgress).reduce((a, b) => a + b, 0);
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? currentBytes / elapsed : 0;
      setUploadProgress({ name: file.name, progress: Math.min(Math.round((currentBytes / file.size) * 100), 100), currentPart: completedParts.length, totalParts, speed, loaded: currentBytes, total: file.size });
    };
    updateProgress();

    try {
      const remainingParts = Array.from({ length: totalParts - startPart }, (_, i) => startPart + i + 1);
      let signedUrls: Record<number, string> = {};
      if (useDirectUpload) {
        try { const urlsRes = await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-urls`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, partNumbers: remainingParts }) }); if (urlsRes.ok) { const d = await urlsRes.json() as { urls: Record<number, string> }; signedUrls = d.urls; } } catch {}
      }

      const uploadQueue = remainingParts.map(pn => ({ partNumber: pn, start: (pn - 1) * chunkSize, end: Math.min(pn * chunkSize, file.size) }));
      const uploadPartDirect = (chunk: Blob, url: string, partNumber: number): Promise<{ partNumber: number; etag: string }> => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) { partProgress[partNumber] = event.loaded; updateProgress(); } };
        xhr.onload = () => { delete partProgress[partNumber]; xhr.status >= 200 && xhr.status < 300 ? resolve({ partNumber, etag: xhr.getResponseHeader("ETag")?.replace(/"/g, "") || "" }) : reject(new Error(`Direct upload failed: ${xhr.status}`)); };
        xhr.onerror = () => { delete partProgress[partNumber]; reject(new Error("Direct upload network error")); };
        xhr.open("PUT", url); xhr.send(chunk);
      });
      const uploadPartProxy = (chunk: Blob, p: string, upId: string, partNumber: number): Promise<{ partNumber: number; etag: string }> => new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = (event) => { if (event.lengthComputable) { partProgress[partNumber] = event.loaded; updateProgress(); } };
        xhr.onload = () => { delete partProgress[partNumber]; if (xhr.status >= 200 && xhr.status < 300) { try { const d = JSON.parse(xhr.responseText); totalBytesUploaded += chunk.size; resolve({ partNumber, etag: d.etag }); } catch { reject(new Error(`解析失败: 分片 ${partNumber}`)); } } else { try { const d = JSON.parse(xhr.responseText); reject(new Error(d.error || `分片 ${partNumber} 失败`)); } catch { reject(new Error(`分片 ${partNumber} 失败: ${xhr.status}`)); } } };
        xhr.onerror = () => { delete partProgress[partNumber]; reject(new Error(`网络错误: 分片 ${partNumber}`)); };
        xhr.open("PUT", `/api/files/${storage.id}/${p}?action=multipart-upload&uploadId=${encodeURIComponent(upId)}&partNumber=${partNumber}`); xhr.send(chunk);
      });

      let index = 0;
      const runNext = async () => { while (index < uploadQueue.length) { const ci = index++; const item = uploadQueue[ci]; let result; if (useDirectUpload && signedUrls[item.partNumber]) { try { result = await uploadPartDirect(file.slice(item.start, item.end), signedUrls[item.partNumber], item.partNumber); } catch { useDirectUpload = false; localStorage.setItem(storageKey, JSON.stringify({ uploadId, fileName: file.name, parts: completedParts, useDirectUpload: false })); result = await uploadPartProxy(file.slice(item.start, item.end), uploadPath, uploadId, item.partNumber); } } else { result = await uploadPartProxy(file.slice(item.start, item.end), uploadPath, uploadId, item.partNumber); } completedParts.push(result); localStorage.setItem(storageKey, JSON.stringify({ uploadId, fileName: file.name, parts: completedParts, useDirectUpload })); updateProgress(); } };
      await Promise.all(Array(Math.min(useDirectUpload ? 5 : 3, uploadQueue.length)).fill(null).map(() => runNext()));

      const completeRes = await fetch(`/api/files/${storage.id}/${uploadPath}?action=multipart-complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId, parts: completedParts }) });
      if (!completeRes.ok) { const d = await completeRes.json(); throw new Error(d.error || "完成分片上传失败"); }
      localStorage.removeItem(storageKey);
    } catch (err) { throw err; }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return; setCreatingFolder(true); notify();
    try {
      const folderPath = path ? `${path}/${newFolderName.trim()}` : newFolderName.trim();
      const res = await fetch(`/api/files/${storage.id}/${folderPath}?action=mkdir`, { method: "POST" });
      if (res.ok) { setNewFolderName(""); setShowNewFolderInput(false); loadFiles(true); }
      else { const d = await res.json(); alert(d.error || "创建文件夹失败"); }
    } catch { alert("网络错误"); } finally { setCreatingFolder(false); }
  };

  const handleOfflineDownload = async () => {
    if (!offlineUrl.trim()) return; setOfflineDownloading(true); notify();
    try {
      const res = await fetch(`/api/files/${storage.id}/${path}?action=fetch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: offlineUrl.trim(), filename: offlineFilename.trim() || undefined }) });
      const data = await res.json() as { success?: boolean; filename?: string; size?: number; error?: string };
      if (res.ok && data.success) { alert(`下载成功: ${data.filename}${data.size ? ` (${formatBytes(data.size)})` : ""}`); setOfflineUrl(""); setOfflineFilename(""); setShowOfflineDownload(false); loadFiles(true); }
      else alert(data.error || "下载失败");
    } catch { alert("网络错误"); } finally { setOfflineDownloading(false); }
  };

  const handleVerifyPassword = async () => {
    if (!passwordRequired || !passwordInput.trim()) return; setVerifyingPassword(true); setPasswordError("");
    try {
      const res = await fetch("/api/folder-passwords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "verify", storageId: storage.id, folderPath: passwordRequired.folderPath, password: passwordInput }) });
      if (res.ok) { setPasswordRequired(null); setPasswordInput(""); loadFiles(true); }
      else { const d = await res.json(); setPasswordError(d.error || "密码错误"); }
    } catch { setPasswordError("网络错误"); } finally { setVerifyingPassword(false); }
  };

  const handleSetPassword = async () => {
    if (!setPasswordValue.trim()) return; setSettingPassword(true);
    try {
      const res = await fetch("/api/folder-passwords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storageId: storage.id, folderPath: setPasswordPath, password: setPasswordValue, hint: setPasswordHint }) });
      if (res.ok) { setShowSetPassword(false); setSetPasswordValue(""); setSetPasswordHint(""); loadProtectedPaths(); alert("密码设置成功"); }
      else { const d = await res.json(); alert(d.error || "设置失败"); }
    } catch { alert("网络错误"); } finally { setSettingPassword(false); }
  };

  const handleRemovePassword = async (folderPath: string) => {
    if (!confirm(`确定移除文件夹 "${folderPath || "/"}" 的密码保护？`)) return;
    try { const res = await fetch(`/api/folder-passwords?storageId=${storage.id}&path=${encodeURIComponent(folderPath)}`, { method: "DELETE" }); if (res.ok) loadProtectedPaths(); } catch {}
  };

  const openSetPassword = () => { setSetPasswordPath(path); setSetPasswordValue(""); setSetPasswordHint(""); setShowSetPassword(true); notify(); };

  const breadcrumbs = path ? path.split("/").filter(Boolean) : [];
  const normalizedQuery = (globalSearch || "").trim().toLowerCase();
  let filteredObjects = normalizedQuery ? objects.filter(o => o.name.toLowerCase().includes(normalizedQuery)) : objects;
  // 应用路径元信息的隐藏规则（支持多行正则，对齐 AList）
  if (pathMeta.hide) {
    try {
      const patterns = pathMeta.hide.split("\n").filter(Boolean);
      for (const pattern of patterns) {
        const hideRegex = new RegExp(pattern);
        filteredObjects = filteredObjects.filter(o => !hideRegex.test(o.name));
      }
    } catch {}
  }
  const visibleObjects = sortObjects(filteredObjects);
  const allVisibleSelected = visibleObjects.length > 0 && visibleObjects.every(o => selectedKeys.has(o.key));

  const previewableFiles = visibleObjects.filter(o => !o.isDirectory && isPreviewable(o.name));
  const currentPreviewIndex = previewFile ? previewableFiles.findIndex(f => f.key === previewFile.key) : -1;
  const handlePreview = (obj: S3Object) => { if (isPreviewable(obj.name)) setPreviewFile(obj); notify(); };

  const getFileIcon = (fileName: string) => {
    const type = getFileType(fileName);
    switch (type) { case 'video': return '🎬'; case 'audio': return '🎵'; case 'image': return '🖼️'; case 'pdf': return '📕'; case 'code': return '📝'; case 'markdown': return '📑'; case 'text': return '📄'; default: return '📄'; }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between py-2 px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white/50 dark:bg-zinc-900/50">
        <div className="flex items-center gap-1 text-sm overflow-x-auto min-w-0">
          <button onClick={() => { setPath(""); notify(); }} className="text-blue-600 dark:text-blue-400 hover:text-blue-500 shrink-0 font-medium">{storage.name}</button>
          {breadcrumbs.map((part, i) => (
            <span key={i} className="flex items-center shrink-0">
              <span className="text-zinc-300 dark:text-zinc-600 mx-1">/</span>
              <button onClick={() => navigateTo(breadcrumbs.slice(0, i + 1).join("/"))} className="text-blue-600 dark:text-blue-400 hover:text-blue-500">{part}</button>
            </span>
          ))}
          {selectedKeys.size > 0 && <span className="ml-2 text-xs text-zinc-400">(已选 {selectedKeys.size} 项)</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && selectedKeys.size > 0 && (
            <button onClick={handleBatchDelete} disabled={deleting} className="text-xs bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white px-3 py-1 rounded-md">
              {deleting ? "删除中..." : `删除 (${selectedKeys.size})`}
            </button>
          )}
          {path && <button onClick={goUp} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-2 py-1">← 上级</button>}
          {isAdmin && <>
            <button onClick={() => { setShowNewFolderInput(true); notify(); }} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-2 py-1">+ 文件夹</button>
            <button onClick={() => { setShowOfflineDownload(true); notify(); }} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-2 py-1">离线下载</button>
            <button onClick={() => setShowPathMeta(true)} className="text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 px-2 py-1" title="路径元信息">📋 路径配置</button>
            <button onClick={openSetPassword} className={`text-xs px-2 py-1 ${protectedPaths.has(path) ? 'text-yellow-500' : 'text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300'}`}>
              {protectedPaths.has(path) ? '🔒 已加密' : '🔐 加密'}
            </button>
          </>}
          {(canUpload && pathMeta.write_access) && (
            <label className={`text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 cursor-pointer rounded-md ${uploadProgress ? 'opacity-50 pointer-events-none' : ''}`}>
              {uploadProgress ? '上传中...' : '上传'}
              <input type="file" multiple onChange={handleUpload} className="hidden" disabled={!!uploadProgress} />
            </label>
          )}
        </div>
      </div>

      {/* New Folder / Offline Download bars - same as original, shortened */}
      {showNewFolderInput && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">新建文件夹:</span>
            <input type="text" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setShowNewFolderInput(false); setNewFolderName(""); } }} placeholder="文件夹名称" className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm rounded-md focus:border-blue-500 focus:outline-none" autoFocus disabled={creatingFolder} />
            <button onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()} className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded-md">{creatingFolder ? "创建中..." : "创建"}</button>
            <button onClick={() => { setShowNewFolderInput(false); setNewFolderName(""); }} className="text-xs text-zinc-500 px-2 py-1">取消</button>
          </div>
        </div>
      )}
      {showOfflineDownload && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500 shrink-0">链接:</span>
              <input type="url" value={offlineUrl} onChange={(e) => setOfflineUrl(e.target.value)} placeholder="https://example.com/file.zip" className="flex-1 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm rounded-md focus:border-blue-500 focus:outline-none" autoFocus disabled={offlineDownloading} />
              <input type="text" value={offlineFilename} onChange={(e) => setOfflineFilename(e.target.value)} placeholder="文件名（可选）" className="w-40 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-sm rounded-md" disabled={offlineDownloading} onKeyDown={(e) => { if (e.key === "Enter") handleOfflineDownload(); }} />
              <button onClick={handleOfflineDownload} disabled={offlineDownloading || !offlineUrl.trim()} className="text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white px-3 py-1 rounded-md">{offlineDownloading ? "下载中..." : "开始下载"}</button>
              <button onClick={() => { setShowOfflineDownload(false); setOfflineUrl(""); setOfflineFilename(""); }} disabled={offlineDownloading} className="text-xs text-zinc-500 px-2 py-1">取消</button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Progress */}
      {uploadProgress && (
        <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50">
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-600 dark:text-zinc-400 truncate flex-1">上传: {uploadProgress.name} {uploadProgress.totalParts && <span className="text-zinc-400">({uploadProgress.currentPart}/{uploadProgress.totalParts} 分片)</span>}</span>
            {uploadProgress.speed && uploadProgress.speed > 0 && <span className="text-xs text-blue-500 shrink-0">{formatSpeed(uploadProgress.speed)}</span>}
            <span className="text-xs text-zinc-500 w-12 text-right">{uploadProgress.progress}%</span>
          </div>
          <div className="mt-1 h-1 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden"><div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${uploadProgress.progress}%` }} /></div>
        </div>
      )}

      {/* Content - 所有内容在同一滚动区域 */}
      <div className="flex-1 overflow-auto">
        {/* 路径 Header */}
        {pathMeta.header && (
          <div className="px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-600 dark:text-zinc-400" dangerouslySetInnerHTML={{ __html: sanitizeHtml(pathMeta.header) }} />
        )}

        {loading ? <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">加载中...</div>
        : error ? <div className="flex items-center justify-center h-32 text-red-500 text-sm">{error}</div>
        : objects.length === 0 ? <div className="flex items-center justify-center h-32 text-zinc-300 dark:text-zinc-600 text-sm">空目录</div>
        : (
          <>
          <table className="w-full text-sm">
            <thead className="text-xs text-zinc-400 border-b border-zinc-100 dark:border-zinc-800 sticky top-0 bg-zinc-50 dark:bg-zinc-900">
              <tr>
                {isAdmin && <th className="py-2 px-2 w-8"><input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll} className="w-4 h-4 rounded" /></th>}
                <th className="text-left py-2 px-4">名称</th>
                <th className="text-right py-2 px-4 w-24">大小</th>
                <th className="text-right py-2 px-4 w-44 cursor-pointer select-none hover:text-zinc-600 dark:hover:text-zinc-300 transition" onClick={toggleTimeSort} title="点击切换排序">
                  修改时间 {sortBy === "modified" ? (sortDir === "asc" ? "↑" : "↓") : ""}
                </th>
                <th className="text-right py-2 px-4 w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleObjects.length === 0 ? <tr><td colSpan={isAdmin ? 5 : 4} className="py-6 text-center text-zinc-400">没有匹配的文件</td></tr>
              : visibleObjects.map((obj) => (
                <tr key={obj.key} className={`border-b border-zinc-50 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 ${selectedKeys.has(obj.key) ? "bg-blue-50/50 dark:bg-blue-900/20" : ""}`}>
                  {isAdmin && <td className="py-2 px-2"><input type="checkbox" checked={selectedKeys.has(obj.key)} onChange={() => toggleSelect(obj.key)} className="w-4 h-4 rounded" /></td>}
                  <td className="py-2 px-4">
                    {obj.isDirectory ? (
                      <button onClick={() => navigateTo(obj.key)} className="flex items-center gap-2 text-blue-600 dark:text-blue-400 hover:text-blue-500">
                        <span>📁</span>{obj.name}
                        {protectedPaths.has(obj.key.replace(/\/$/, "")) && <span className="text-xs" title="已加密">🔒</span>}
                      </button>
                    ) : isPreviewable(obj.name) ? (
                      <button onClick={() => handlePreview(obj)} className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300 hover:text-blue-500">
                        <span>{getFileIcon(obj.name)}</span>{obj.name}
                      </button>
                    ) : <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300"><span className="text-zinc-400">{getFileIcon(obj.name)}</span>{obj.name}</span>}
                  </td>
                  <td className="py-2 px-4 text-right text-zinc-400">{obj.isDirectory ? "-" : formatBytes(obj.size)}</td>
                  <td className="py-2 px-4 text-right text-zinc-400">{formatDate(obj.lastModified)}</td>
                  <td className="py-2 px-4 text-right">
                    {obj.isDirectory ? isAdmin && (
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => startShare(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="分享">🡭</button>
                        <button onClick={() => startRename(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="重命名">✎</button>
                        <button onClick={() => startMove(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="移动">⤷</button>
                        <button onClick={() => deleteFolder(obj.key, obj.name)} className="text-zinc-300 dark:text-zinc-600 hover:text-red-500" title="删除">×</button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        {canDownload && isPreviewable(obj.name) && <button onClick={() => handlePreview(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="预览">▶</button>}
                        {canDownload && <button onClick={() => downloadFile(obj.key)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="下载">↓</button>}
                        {isAdmin && <>
                          <button onClick={() => startShare(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="分享">🡭</button>
                          <button onClick={() => startRename(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="重命名">✎</button>
                          <button onClick={() => startMove(obj)} className="text-zinc-300 dark:text-zinc-600 hover:text-blue-500" title="移动">⤷</button>
                          <button onClick={() => deleteFile(obj.key)} className="text-zinc-300 dark:text-zinc-600 hover:text-red-500" title="删除">×</button>
                        </>}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 路径 README (Markdown) - 紧跟文件列表 */}
          {pathMeta.readme && (
            <div
              className="px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900"
              onClick={(e) => { const a = (e.target as HTMLElement).closest("a"); if (a) a.classList.add("visited"); }}
            >
              <div className="prose prose-sm dark:prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(marked.parse(pathMeta.readme) as string) }} />
            </div>
          )}
          {/* 路径 Footer - 紧跟 README */}
          {pathMeta.footer && (
            <div className="px-4 py-2 border-t border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/50 text-xs text-zinc-600 dark:text-zinc-400" dangerouslySetInnerHTML={{ __html: sanitizeHtml(pathMeta.footer) }} />
          )}
          </>
        )}
      </div>

      {/* Modals: Preview, Rename, Share, Move, Password - kept identical logic */}
      {previewFile && <FilePreview storageId={storage.id} fileKey={previewFile.key} fileName={previewFile.name} onClose={() => setPreviewFile(null)} onPrev={() => currentPreviewIndex > 0 && setPreviewFile(previewableFiles[currentPreviewIndex - 1])} onNext={() => currentPreviewIndex < previewableFiles.length - 1 && setPreviewFile(previewableFiles[currentPreviewIndex + 1])} hasPrev={currentPreviewIndex > 0} hasNext={currentPreviewIndex < previewableFiles.length - 1} />}

      {renameTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setRenameTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between"><span className="text-sm font-semibold">重命名</span><button onClick={() => setRenameTarget(null)} className="text-zinc-400 hover:text-zinc-600">&times;</button></div>
            <div className="p-5 space-y-4">
              <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleRename()} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg focus:border-blue-500 focus:outline-none" autoFocus />
              <div className="flex gap-2">
                <button onClick={() => setRenameTarget(null)} className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg">取消</button>
                <button onClick={handleRename} disabled={renaming || !renameValue.trim()} className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm hover:bg-blue-600 disabled:opacity-50 rounded-lg">{renaming ? "处理中..." : "确定"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {shareTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setShareTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between"><span className="text-sm font-semibold">生成分享链接</span><button onClick={() => setShareTarget(null)} className="text-zinc-400 hover:text-zinc-600">&times;</button></div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-zinc-500">分享: {shareTarget.name}</div>
              {!shareUrl ? (<>
                <div><label className="block text-xs text-zinc-500 mb-1">过期时间</label>
                  <select value={shareExpireHours} onChange={(e) => setShareExpireHours(parseInt(e.target.value))} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg">
                    <option value={0}>永不过期</option><option value={1}>1 小时</option><option value={24}>1 天</option><option value={168}>1 周</option><option value={720}>1 月</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShareTarget(null)} className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm rounded-lg">取消</button>
                  <button onClick={handleCreateShare} disabled={creatingShare} className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm disabled:opacity-50 rounded-lg">{creatingShare ? "生成中..." : "生成链接"}</button>
                </div>
              </>) : (<>
                <div><label className="block text-xs text-zinc-500 mb-1">分享链接</label>
                  <div className="flex gap-2"><input type="text" value={shareUrl} readOnly className="flex-1 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-xs rounded-lg" /><button onClick={() => copyToClipboard(shareUrl)} className="px-3 py-2 bg-zinc-200 dark:bg-zinc-700 hover:bg-zinc-300 dark:hover:bg-zinc-600 text-sm rounded-lg">复制</button></div>
                </div>
                <button onClick={() => setShareTarget(null)} className="w-full px-3 py-2 bg-blue-500 text-white text-sm rounded-lg">完成</button>
              </>)}
            </div>
          </div>
        </div>
      )}

      {moveTarget && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setMoveTarget(null)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between"><span className="text-sm font-semibold">移动到</span><button onClick={() => setMoveTarget(null)} className="text-zinc-400 hover:text-zinc-600">&times;</button></div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-zinc-500">移动: {moveTarget.name}</div>
              <div><label className="block text-xs text-zinc-500 mb-1">目标文件夹</label>
                <select value={moveDestPath} onChange={(e) => setMoveDestPath(e.target.value)} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg">
                  {allFolders.map(f => <option key={f} value={f}>{f === "" ? "/ (根目录)" : "/" + f}</option>)}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setMoveTarget(null)} className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm rounded-lg">取消</button>
                <button onClick={handleMove} disabled={moving} className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm disabled:opacity-50 rounded-lg">{moving ? "处理中..." : "确定"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {passwordRequired && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={() => { setPasswordRequired(null); setPasswordInput(""); setPasswordError(""); }}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800"><span className="text-sm font-semibold">🔒 文件夹已加密</span></div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-zinc-500">访问路径: /{passwordRequired.folderPath}</div>
              {passwordRequired.hint && <div className="text-xs text-blue-500 bg-blue-50 dark:bg-blue-900/20 p-2 rounded-lg">💡 提示: {passwordRequired.hint}</div>}
              <input type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleVerifyPassword()} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg focus:border-blue-500 focus:outline-none" placeholder="输入密码" autoFocus />
              {passwordError && <div className="text-xs text-red-500">{passwordError}</div>}
              <div className="flex gap-2">
                <button onClick={() => { setPasswordRequired(null); setPasswordInput(""); }} className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm rounded-lg">取消</button>
                <button onClick={handleVerifyPassword} disabled={verifyingPassword || !passwordInput.trim()} className="flex-1 px-3 py-2 bg-blue-500 text-white text-sm disabled:opacity-50 rounded-lg">{verifyingPassword ? "验证中..." : "确认"}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSetPassword && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4" onClick={() => setShowSetPassword(false)}>
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-sm rounded-xl shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800"><span className="text-sm font-semibold">🔐 {protectedPaths.has(setPasswordPath) ? "修改密码" : "设置密码保护"}</span></div>
            <div className="p-5 space-y-4">
              <div className="text-xs text-zinc-500">文件夹: /{setPasswordPath || "(根目录)"}</div>
              <input type="text" value={setPasswordValue} onChange={(e) => setSetPasswordValue(e.target.value)} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg" placeholder="密码" autoFocus />
              <input type="text" value={setPasswordHint} onChange={(e) => setSetPasswordHint(e.target.value)} className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm rounded-lg" placeholder="密码提示（可选）" />
              {protectedPaths.has(setPasswordPath) && <button onClick={() => { handleRemovePassword(setPasswordPath); setShowSetPassword(false); }} className="w-full px-3 py-2 text-xs text-red-500 border border-red-200 dark:border-red-800 rounded-lg">🗑 移除密码保护</button>}
              <div className="flex gap-2">
                <button onClick={() => setShowSetPassword(false)} className="flex-1 px-3 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm rounded-lg">取消</button>
                <button onClick={handleSetPassword} disabled={settingPassword || !setPasswordValue.trim()} className="flex-1 px-3 py-2 bg-yellow-500 text-black text-sm disabled:opacity-50 rounded-lg font-medium">{settingPassword ? "设置中..." : "🔒 确认加密"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showPathMeta && <PathMetaModal storageId={storage.id} currentPath={path} onClose={() => setShowPathMeta(false)} />}
    </div>
  );
}

// ===== Site Meta Settings Modal (AList style) =====
function SiteMetaSettings({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [meta, setMeta] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("basic");

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch("/api/site-meta");
        if (res.ok) {
          const data = await res.json() as { meta: Record<string, string> };
          setMeta(data.meta || {});
        }
      } catch {} finally { setLoading(false); }
    };
    load();
  }, []);

  const update = (key: string, value: string) => setMeta(prev => ({ ...prev, [key]: value }));

  const handleSave = async () => {
    setSaving(true); setError("");
    try {
      const res = await fetch("/api/site-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta }),
      });
      if (res.ok) { onSaved(); onClose(); }
      else { const d = await res.json(); setError(d.error || "保存失败"); }
    } catch { setError("网络错误"); } finally { setSaving(false); }
  };

  const tabs = [
    { key: "basic", label: "基本信息", icon: "📝" },
    { key: "appearance", label: "外观", icon: "🎨" },
    { key: "advanced", label: "高级", icon: "⚙️" },
  ];

  const inputCls = "w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:border-blue-500 focus:outline-none rounded-lg";
  const labelCls = "block text-xs text-zinc-500 mb-1";

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 w-full max-w-2xl max-h-[85vh] overflow-hidden rounded-xl shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-3 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
          <span className="text-zinc-800 dark:text-zinc-100 font-semibold text-sm">站点设置</span>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-lg leading-none">&times;</button>
        </div>
        {/* Tabs */}
        <div className="flex border-b border-zinc-100 dark:border-zinc-800 px-5 shrink-0">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-xs font-medium border-b-2 transition ${
                activeTab === tab.key
                  ? "border-blue-500 text-blue-600 dark:text-blue-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-zinc-400 text-sm">加载中...</div>
          ) : (<>
            {activeTab === "basic" && (<>
              <div>
                <label className={labelCls}>站点标题</label>
                <input type="text" value={meta.site_title || ""} onChange={e => update("site_title", e.target.value)} className={inputCls} placeholder="CList" />
              </div>
              <div>
                <label className={labelCls}>站点描述</label>
                <textarea value={meta.site_description || ""} onChange={e => update("site_description", e.target.value)} className={`${inputCls} h-20`} placeholder="S3 兼容存储聚合服务" />
              </div>
              <div>
                <label className={labelCls}>关键词（SEO）</label>
                <input type="text" value={meta.site_keywords || ""} onChange={e => update("site_keywords", e.target.value)} className={inputCls} placeholder="cloud storage,s3,file manager" />
              </div>
              <div>
                <label className={labelCls}>站点公告</label>\                <textarea value={meta.announcement || ""} onChange={e => update("announcement", e.target.value)} className={`${inputCls} h-20`} placeholder="支持 Markdown 格式" />
              </div>
              <div>
                <label className={labelCls}>页脚文本</label>
                <input type="text" value={meta.footer_text || ""} onChange={e => update("footer_text", e.target.value)} className={inputCls} placeholder="© 2025 CList" />
              </div>
            </>)}

            {activeTab === "appearance" && (<>
              <div>
                <label className={labelCls}>Logo URL</label>
                <input type="text" value={meta.site_logo || ""} onChange={e => update("site_logo", e.target.value)} className={inputCls} placeholder="https://example.com/logo.png" />
                {meta.site_logo && <div className="mt-2"><img src={meta.site_logo} alt="logo" className="h-8 object-contain" /></div>}
              </div>
              <div>
                <label className={labelCls}>Favicon URL</label>
                <input type="text" value={meta.site_favicon || ""} onChange={e => update("site_favicon", e.target.value)} className={inputCls} placeholder="https://example.com/favicon.ico" />
              </div>
              <div>
                <label className={labelCls}>自定义 CSS</label>
                <textarea
                  value={meta.custom_css || ""}
                  onChange={e => update("custom_css", e.target.value)}
                  className={`${inputCls} h-40 font-mono text-xs`}
                  placeholder={`/* 自定义样式 */\nbody { background: #f5f5f5; }`}
                />
              </div>
            </>)}

            {activeTab === "advanced" && (<>
              <div>
                <label className={labelCls}>自定义 Head JS</label>
                <div className="text-[10px] text-zinc-400 mb-1">在 &lt;head&gt; 中注入，适合放统计代码</div>
                <textarea
                  value={meta.custom_head_js || ""}
                  onChange={e => update("custom_head_js", e.target.value)}
                  className={`${inputCls} h-32 font-mono text-xs`}
                  placeholder={`<script>console.log('head')</script>`}
                />
              </div>
              <div>
                <label className={labelCls}>自定义 Body JS</label>
                <div className="text-[10px] text-zinc-400 mb-1">在 &lt;/body&gt; 前注入</div>
                <textarea
                  value={meta.custom_body_js || ""}
                  onChange={e => update("custom_body_js", e.target.value)}
                  className={`${inputCls} h-32 font-mono text-xs`}
                  placeholder={`<script>console.log('body')</script>`}
                />
              </div>
            </>)}
          </>)}
          {error && <div className="text-red-500 text-xs">{error}</div>}
        </div>
        {/* Footer */}
        <div className="px-5 py-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-lg transition">取消</button>
          <button onClick={handleSave} disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm disabled:opacity-50 rounded-lg transition">{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

// ===== Main Home Component (AList Style) =====
export default function Home({ loaderData }: Route.ComponentProps) {
  const [role, setRole] = useState<UserRole>(
    (loaderData.role as UserRole) || (loaderData.isAdmin ? "admin" : "guest")
  );
  const isAdmin = role === "admin";
  const isUser = role === "user";
  const [storages, setStorages] = useState<StorageInfo[]>(loaderData.storages);
  const [selectedStorage, setSelectedStorage] = useState<StorageInfo | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [showUserManage, setShowUserManage] = useState(false);
  const [showStorageForm, setShowStorageForm] = useState(false);
  const [editingStorage, setEditingStorage] = useState<StorageInfo | null>(null);
  // 1. Default light theme
  const [isDark, setIsDark] = useState(false);
  // 6. Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 5. Refresh loading state
  const [refreshing, setRefreshing] = useState(false);
  // 3. Global search
  const [searchQuery, setSearchQuery] = useState("");

  // 7. Site meta settings
  const [showSiteSettings, setShowSiteSettings] = useState(false);

  const siteTitle = loaderData.siteTitle || "CList";
  const siteMeta = loaderData.siteMeta || {};
  const chunkSizeMB = loaderData.chunkSizeMB || 50;

  // 1. Default light theme - do NOT add dark class
  useEffect(() => {
    const saved = localStorage.getItem("theme");
    if (saved === "dark") {
      setIsDark(true);
      document.documentElement.classList.add("dark");
    } else {
      setIsDark(false);
      document.documentElement.classList.remove("dark");
    }
  }, []);

  // 2. Auto-select first storage
  useEffect(() => {
    if (storages.length > 0 && !selectedStorage) {
      setSelectedStorage(storages[0]);
    }
  }, [storages]);

  // 6. When operating right panel, auto-collapse sidebar
  const handleRightPanelInteraction = useCallback(() => {
    if (window.innerWidth < 768) {
      setSidebarCollapsed(true);
    }
  }, []);

  const toggleTheme = useCallback(() => {
    const newIsDark = !isDark;
    setIsDark(newIsDark);
    if (newIsDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  }, [isDark]);

  const refreshStorages = async () => {
    try {
      const res = await fetch("/api/storages");
      if (res.ok) {
        const data = await res.json() as { storages: StorageInfo[]; isAdmin: boolean; isUser: boolean; role: UserRole };
        setStorages(data.storages);
        setRole(data.role || (data.isAdmin ? "admin" : data.isUser ? "user" : "guest"));
      }
    } catch {}
  };

  // 5. Refresh with loading animation
  const handleRefresh = async () => {
    setRefreshing(true);
    await refreshStorages();
    setTimeout(() => setRefreshing(false), 500);
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/storages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) });
      setRole("guest"); setSelectedStorage(null); refreshStorages();
    } catch {}
  };

  const handleDeleteStorage = async (s: StorageInfo) => {
    if (!confirm(`删除存储 "${s.name}"?`)) return;
    try { const res = await fetch(`/api/storages?id=${s.id}`, { method: "DELETE" }); if (res.ok) { if (selectedStorage?.id === s.id) setSelectedStorage(null); refreshStorages(); } } catch {}
  };

  return (
    <div className="h-screen overflow-hidden bg-white dark:bg-zinc-950 text-zinc-800 dark:text-zinc-100 flex flex-col">
      {/* Header (AList style) */}
      <header className="border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shrink-0">
        <div className="px-4 h-12 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {siteMeta.site_logo ? (
              <img src={siteMeta.site_logo} alt="logo" className="h-6 object-contain" />
            ) : null}
            <span className="text-lg font-bold tracking-tight">{siteTitle}</span>
          </div>
          {/* 3. Search in top-right */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索..."
                className="w-48 lg:w-64 bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 pl-8 pr-3 py-1.5 text-xs rounded-lg focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
            </div>
            <button onClick={toggleTheme} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition" title="切换主题">
              {isDark ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
              )}
            </button>
            {isAdmin && (
              <button onClick={() => setShowUserManage(true)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition" title="添加用户">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              </button>
            )}
            {isAdmin && (
              <button onClick={() => setShowSiteSettings(true)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition" title="站点设置">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              </button>
            )}
            {isUser && (
              <span className="text-xs text-zinc-400 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800">用户</span>
            )}
            {(isAdmin || isUser) && (
              <button onClick={handleLogout} className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 px-2 py-1 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition">
                退出
              </button>
            )}
          </div>
        </div>
      </header>

      {/* 公告栏 */}
      {(siteMeta.announcement || loaderData.siteAnnouncement) && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-100 dark:border-blue-800/30 px-4 py-2 text-xs text-blue-700 dark:text-blue-300 text-center shrink-0">
          {siteMeta.announcement || loaderData.siteAnnouncement}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden relative">
        {/* Sidebar - AList style */}
        <aside
          className={`border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 flex flex-col transition-all duration-300 overflow-hidden shrink-0 ${sidebarCollapsed ? 'w-0' : 'w-44'}`}
        >
          {/* Sidebar header */}
          <div className="px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 flex items-center justify-between shrink-0">
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">存储</span>
            <div className="flex items-center gap-1">
              {isAdmin && (
                <button onClick={() => { setEditingStorage(null); setShowStorageForm(true); }} className="text-blue-500 hover:text-blue-400 text-lg leading-none" title="添加存储">+</button>
              )}
              <button onClick={() => setSidebarCollapsed(true)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-0.5" title="收起">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
            </div>
          </div>
          {/* Storage list */}
          <div className="overflow-y-auto flex-1 py-1">
            {storages.length === 0 ? (
              <div className="p-4 text-center text-zinc-400 text-xs">暂无存储</div>
            ) : (
              storages.map((s) => (
                <div
                  key={s.id}
                  className={`group flex items-center justify-between px-3 py-2 cursor-pointer transition-colors ${
                    selectedStorage?.id === s.id
                      ? "border-blue-500 bg-blue-50 dark:bg-zinc-800/50"
                      : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/30"
                  }`}
                  onClick={() => setSelectedStorage(s)}
                  onTouchStart={() => setSelectedStorage(s)}
                >
                  <div className="min-w-0 flex items-center gap-2">
                    <svg className={`w-4 h-4 shrink-0 ${selectedStorage?.id === s.id ? 'text-blue-500' : 'text-zinc-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className={`text-sm truncate ${selectedStorage?.id === s.id ? 'font-medium' : ''}`}>{s.name}</span>
                  </div>
                  {isAdmin && (
                    <div 
                        className={`${
                          true ? "flex" : "hidden"
                        } items-center gap-1`}
                        onClick={(e) => e.stopPropagation()}
                     >
                      <button
                        onClick={() => { setEditingStorage(s); setShowStorageForm(true); }}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-zinc-700 dark:hover:text-zinc-300 text-xs px-1"
                        title="编辑"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDeleteStorage(s)}
                        className="text-zinc-400 dark:text-zinc-600 hover:text-red-500 dark:hover:text-red-400 text-xs px-1"
                        title="删除"
                      >
                        ×
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          {/* Login button - sidebar center bottom */}
          {!isAdmin && (
            <div className="p-3 border-t border-zinc-100 dark:border-zinc-800 shrink-0">
              <button
                onClick={() => setShowLogin(true)}
                className="w-full px-4 py-2 bg-white/20 dark:bg-zinc-800/30 backdrop-blur-md border border-white/30 dark:border-zinc-600/30 text-zinc-700 dark:text-zinc-200 text-sm rounded-lg shadow-sm hover:shadow-md hover:bg-white/30 dark:hover:bg-zinc-700/40 transition-all"
              >
                登录
              </button>
            </div>
          )}
        </aside>

        {/* 6. Sidebar expand button - always visible when collapsed, clickable area = right panel edge */}
        {sidebarCollapsed && (
          <button
            onClick={() => setSidebarCollapsed(false)}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-5 h-10 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 dark:text-zinc-500 rounded-r-lg shadow-sm transition"
            title="展开侧边栏"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        )}

        {/* Main content area */}
        <main className="flex-1 min-w-0 overflow-hidden bg-zinc-50 dark:bg-zinc-900">
          {selectedStorage ? (
            <FileBrowser storage={selectedStorage} role={role} onInteraction={handleRightPanelInteraction} chunkSizeMB={chunkSizeMB} searchQuery={searchQuery} />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-300 dark:text-zinc-600">
              <svg className="w-16 h-16 mb-4 text-zinc-200 dark:text-zinc-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              <p className="text-sm">选择左侧存储以浏览文件</p>
            </div>
          )}
        </main>
      </div>

      {/* 5. Floating refresh button - bottom right, AList style */}
      <button
        onClick={handleRefresh}
        className={`fixed bottom-6 right-6 z-40 w-10 h-10 bg-blue-600 hover:bg-blue-500 text-white rounded-full shadow-lg flex items-center justify-center transition-all hover:shadow-xl ${refreshing ? 'animate-spin' : ''}`}
        title="刷新"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>



      {/* 页脚 */}
      {siteMeta.footer_text && (
        <div className="border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 px-4 py-2 text-center text-xs text-zinc-400 shrink-0">
          {siteMeta.footer_text}
        </div>
      )}

      {/* Modals */}
      {showSiteSettings && <SiteMetaSettings onClose={() => setShowSiteSettings(false)} onSaved={() => { /* 重新加载 meta 信息 */ window.location.reload(); }} />}
      {showUserManage && <UserManageModal onClose={() => setShowUserManage(false)} />}
      {showLogin && <LoginModal onLogin={(r) => { setShowLogin(false); setRole(r); refreshStorages(); }} onClose={() => setShowLogin(false)} />}
      {showStorageForm && <StorageModal storage={editingStorage || undefined} onSave={() => { setShowStorageForm(false); setEditingStorage(null); refreshStorages(); }} onCancel={() => { setShowStorageForm(false); setEditingStorage(null); }} onedriveClientId={loaderData.onedriveClientId} onedriveClientSecret={loaderData.onedriveClientSecret} />}
    </div>
  );
}
