import type { Route } from "./+types/share";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (!token) {
    return { token: null };
  }

  return { token };
}

import { useState, useEffect } from "react";

interface S3Object {
  key: string;
  name: string;
  size: number;
  lastModified: string;
  isDirectory: boolean;
}

interface Share {
  id: string;
  storageId: number;
  filePath: string;
  isDirectory: boolean;
  shareToken: string;
  expiresAt: string | null;
  createdAt: string;
}

interface StorageInfo {
  id: number;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "-";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  return date.toLocaleString("zh-CN");
}

function getFileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    pdf: "📄",
    doc: "📝",
    docx: "📝",
    xls: "📊",
    xlsx: "📊",
    ppt: "🎬",
    pptx: "🎬",
    zip: "📦",
    rar: "📦",
    "7z": "📦",
    jpg: "🖼",
    jpeg: "🖼",
    png: "🖼",
    gif: "🖼",
    mp4: "🎥",
    avi: "🎥",
    mkv: "🎥",
    mp3: "🎵",
    flac: "🎵",
    wav: "🎵",
    txt: "📃",
    json: "⚙️",
    xml: "⚙️",
    yaml: "⚙️",
    yml: "⚙️",
  };
  return iconMap[ext] || "📄";
}

export default function Share({ loaderData }: Route.ComponentProps) {
  const { token } = loaderData as { token: string | null };
  const [share, setShare] = useState<Share | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [path, setPath] = useState("");
  const [objects, setObjects] = useState<S3Object[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) {
      setError("分享令牌缺失");
      setLoading(false);
      return;
    }

    const fetchShareInfo = async () => {
      try {
        const res = await fetch(`/api/shares?token=${token}`);
        if (res.ok) {
          const data = (await res.json()) as { share: Share; storage: StorageInfo };
          setShare(data.share);
          setStorage(data.storage);
        } else {
          const data = (await res.json()) as { error?: string };
          setError(data.error || "分享链接不存在或已过期");
        }
      } catch {
        setError("网络错误");
      } finally {
        setLoading(false);
      }
    };

    fetchShareInfo();
  }, [token]);

  useEffect(() => {
    if (share && storage) {
      loadFiles();
    }
  }, [share, storage, path]);

  const loadFiles = async () => {
    if (!share || !storage || !token) return;

    setLoading(true);

    try {
      // If sharing a single file and at root level, show the file itself
      if (!share.isDirectory && !path) {
        // Create a single object representing the shared file
        const fileName = share.filePath.split("/").pop() || share.filePath;
        const fileObj: S3Object = {
          key: share.filePath,
          name: fileName,
          size: 0, // We don't have size info, will show as "-"
          lastModified: share.createdAt,
          isDirectory: false,
        };
        setObjects([fileObj]);
        setLoading(false);
        return;
      }

      const basePath = share.filePath;
      const fullPath = path ? `${basePath}/${path}` : basePath;

      const res = await fetch(
        `/api/files/${storage.id}/${fullPath}?action=list&token=${token}`
      );

      if (res.ok) {
        const data = (await res.json()) as { objects?: S3Object[] };
        setObjects(data.objects || []);
      } else {
        const data = (await res.json()) as { error?: string };
        setError(data.error || "加载失败");
      }
    } catch {
      setError("网络错误");
    } finally {
      setLoading(false);
    }
  };

  const navigateTo = (newPath: string) => {
    // If sharing a single file, don't allow navigation
    if (!share?.isDirectory) return;
    setPath(newPath.replace(/^\//, "").replace(/\/$/, ""));
  };

  const downloadFile = (key: string) => {
    window.open(
      `/api/files/${storage!.id}/${key}?action=download&token=${token}`,
      "_blank"
    );
  };

  if (error && !share) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-zinc-950">
        <div className="text-center p-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="text-red-500 dark:text-red-400 font-mono text-lg">
            ❌ {error}
          </div>
        </div>
      </div>
    );
  }

  if (!share || !storage) {
    return (
      <div className="flex items-center justify-center h-screen bg-white dark:bg-zinc-950">
        <div className="text-center p-8">
          <div className="text-zinc-500 dark:text-zinc-400 font-mono">
            加载中...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-lg font-mono font-bold">🔗 分享内容</div>
            <div className="text-xs text-zinc-500 font-mono mt-1">
              存储: {storage.name} | 项目: {share.filePath}
            </div>
            {share.expiresAt && (
              <div className="text-xs text-yellow-600 dark:text-yellow-400 font-mono mt-1">
                ⏰ 过期时间: {formatDate(share.expiresAt)}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Breadcrumb */}
      <div className="px-6 py-3 border-b border-zinc-200 dark:border-zinc-800 shrink-0 flex items-center gap-2 text-sm font-mono">
        <button
          onClick={() => setPath("")}
          className="text-blue-500 hover:text-blue-400"
        >
          📁 根目录
        </button>
        {path
          .split("/")
          .filter(Boolean)
          .map((part, index, arr) => {
            const fullPath = arr.slice(0, index + 1).join("/");
            return (
              <div key={fullPath} className="flex items-center gap-2">
                <span className="text-zinc-400 dark:text-zinc-600">/</span>
                <button
                  onClick={() => navigateTo(fullPath)}
                  className="text-blue-500 hover:text-blue-400"
                >
                  {part}
                </button>
              </div>
            );
          })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 font-mono text-sm">
            加载中...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-500 dark:text-red-400 font-mono text-sm">
            {error}
          </div>
        ) : objects.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-400 dark:text-zinc-600 font-mono text-sm">
            空目录
          </div>
        ) : (
          <table className="w-full text-sm font-mono">
            <thead className="text-xs text-zinc-500 border-b border-zinc-200 dark:border-zinc-800 sticky top-0 bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <th className="text-left py-2 px-4 font-normal">名称</th>
                <th className="text-right py-2 px-4 font-normal w-24">大小</th>
                <th className="text-right py-2 px-4 font-normal w-44">修改时间</th>
                <th className="text-right py-2 px-4 font-normal w-16">操作</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((obj) => (
                <tr
                  key={obj.key}
                  className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/30"
                >
                  <td className="py-2 px-4">
                    {obj.isDirectory ? (
                      <button
                        onClick={() => navigateTo(obj.key)}
                        className="flex items-center gap-2 text-blue-500 hover:text-blue-400"
                      >
                        <span className="text-yellow-500">📁</span>
                        {obj.name}
                      </button>
                    ) : (
                      <span className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                        <span>{getFileIcon(obj.name)}</span>
                        {obj.name}
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-4 text-right text-zinc-500">
                    {obj.isDirectory ? "-" : formatBytes(obj.size)}
                  </td>
                  <td className="py-2 px-4 text-right text-zinc-500">
                    {formatDate(obj.lastModified)}
                  </td>
                  <td className="py-2 px-4 text-right">
                    {!obj.isDirectory && (
                      <button
                        onClick={() => downloadFile(obj.key)}
                        className="text-zinc-400 dark:text-zinc-500 hover:text-blue-500"
                        title="下载"
                      >
                        ↓
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 shrink-0 text-xs text-zinc-500 font-mono">
        <div>CList 分享内容</div>
      </div>
    </div>
  );
}
