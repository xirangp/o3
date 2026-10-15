export function encodeUploadState(state: Record<string, unknown>): string {
  const json = JSON.stringify(state);
  const base64 = btoa(json);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeUploadState(token: string): Record<string, any> {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const padLength = padded.length % 4 === 0 ? 0 : 4 - (padded.length % 4);
  const base64 = padded + "=".repeat(padLength);
  const json = atob(base64);
  return JSON.parse(json) as Record<string, any>;
}

export function normalizeRootPath(rootPath: string): string {
  if (!rootPath) {
    return "/";
  }
  let normalized = rootPath.trim();
  if (!normalized.startsWith("/")) {
    normalized = "/" + normalized;
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}

export function joinRootPath(rootPath: string, path: string): string {
  const root = normalizeRootPath(rootPath);
  const cleanPath = path ? (path.startsWith("/") ? path : "/" + path) : "";
  if (!path || cleanPath === "/") {
    return root;
  }
  if (root === "/") {
    return cleanPath;
  }
  return `${root}${cleanPath}`;
}

export function stripTrailingSlash(path: string): string {
  if (path.length <= 1) {
    return path;
  }
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

export function stripLeadingSlash(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}
