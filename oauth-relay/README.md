# OneDrive OAuth 中转回调服务

## 这是什么？

一个独立的轻量服务，提供**公共的 OneDrive OAuth 重定向地址**。所有用户只需在 Azure AD 中注册这一个地址即可。

类似 alist 的 `https://alistgo.com/tool/onedrive/callback` 方案。

## 原理

```
用户浏览器 → 微软授权页面 → 中转服务(固定域名) → 用户自己的应用
```

1. 用户在 Azure AD 注册中转服务的地址作为重定向 URI
2. 发起 OAuth 时，把自己的应用地址编码到 `state.cb` 里
3. 微软回调到中转服务
4. 中转服务把 `code` 转发回用户的应用

## 部署

```bash
cd oauth-relay
npx wrangler deploy
```

部署后得到地址，如 `https://onedrive-oauth-relay.example.workers.dev`

可以绑定自定义域名，如 `https://n.xirang.dpdns.org`

## 支持的回调路径

- `https://your-domain/onedrive/callback`
- `https://your-domain/tool/onedrive/callback`
- `https://your-domain/any/prefix/onedrive/callback`

## Azure AD 配置

在 Azure Portal → 应用注册 → 身份验证中，添加重定向 URI：

```
https://your-relay-domain/onedrive/callback
```

## 在 olist 中使用

在 OneDrive 配置的「重定向URI」字段中填入中转服务的地址：

```
https://your-relay-domain/onedrive/callback
```
