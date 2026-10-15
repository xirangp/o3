# WebDAV Setup

## Enabling WebDAV

Set the following in Cloudflare Workers environment variables:

```json
{
  "vars": {
    "WEBDAV_ENABLED": "true",
    "WEBDAV_USERNAME": "your_webdav_username",
    "WEBDAV_PASSWORD": "your_webdav_password"
  }
}
```

> `WEBDAV_USERNAME` and `WEBDAV_PASSWORD` are optional. If not set, the admin credentials will be used.

## WebDAV Access URLs

Once enabled, access your storages via:

- All storages root: `https://your-domain/dav/0/`
- Specific storage: `https://your-domain/dav/{storage_id}/`

## Client Connection

### Windows

Map a network drive using the WebDAV URL.

### macOS

Finder → Go → Connect to Server, enter the WebDAV URL.

### Linux

Use `davfs2` or your file manager's built-in WebDAV support.

### Mobile

Use any WebDAV-compatible file manager app (e.g., Documents, FE File Explorer).
