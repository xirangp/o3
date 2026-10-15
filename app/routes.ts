import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("api/storages", "routes/api.storages.ts"),
  route("api/users", "routes/api.users.ts"),
  route("api/files/:storageId/*", "routes/api.files.$storageId.$.ts"),
  route("api/storage-stats/:storageId", "routes/api.storage-stats.$storageId.ts"),
  route("api/changelog", "routes/api.changelog.ts"),
  route("api/audit", "routes/api.audit.ts"),
  route("api/shares", "routes/api.shares.ts"),
  route("api/folder-passwords", "routes/api.folder-passwords.ts"),
  route("api/site-meta", "routes/api.site-meta.ts"),
  route("api/path-meta", "routes/api.path-meta.ts"),
  route("api/oauth/onedrive/callback", "routes/api.oauth.onedrive.callback.ts"),
  route("api/oauth/gdrive/callback", "routes/api.oauth.gdrive.callback.ts"),
  route("share", "routes/share.tsx"),
  route("dav/:storageId/*", "routes/dav.$storageId.$.ts"),
] satisfies RouteConfig;
