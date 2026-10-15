/**
 * OneDrive OAuth 中转回调服务
 *
 * 原理：
 * 1. 所有用户的 Azure AD 都注册本服务的地址作为重定向 URI
 * 2. 用户发起 OAuth 时，把 callback 参数（client_id, client_secret, 自己的域名等）编码到 state 里
 * 3. 微软回调到本服务，本服务解析 state，拿到用户的回调地址
 * 4. 本服务把 code 转发回用户的应用（redirect_uri 用本服务的地址参与 token 交换）
 *
 * 部署：单独部署在固定域名，如 https://n.xirang.dpdns.org
 */

interface StateData {
  // 用户自己的应用回调地址（不含 query 参数）
  cb: string;
  // 其他自定义数据，原样传回
  [key: string]: any;
}

const HTML_TEMPLATES = {
  success: (redirectUrl: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>授权成功</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#333;}
  .card{background:#fff;padding:2.5rem;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);text-align:center;max-width:460px;width:90%;}
  .icon{font-size:3rem;margin-bottom:1rem;}
  h2{margin:0 0 0.5rem;color:#1a1a2e;}
  p{color:#666;margin:0 0 1.5rem;line-height:1.6;}
  .url{word-break:break-all;background:#f0f4ff;padding:0.75rem;border-radius:8px;font-size:12px;color:#4a6fa5;margin-bottom:1.5rem;max-height:80px;overflow:auto;text-align:left;}
  .btn{display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;padding:0.7rem 2rem;border-radius:10px;cursor:pointer;font-size:15px;text-decoration:none;transition:transform 0.2s;}
  .btn:hover{transform:scale(1.03);}
  .auto{font-size:12px;color:#999;margin-top:1rem;}
</style></head>
<body>
<div class="card">
  <div class="icon">✅</div>
  <h2>OneDrive 授权成功</h2>
  <p>正在将授权码返回给你的应用…</p>
  <div class="url">${redirectUrl}</div>
  <a class="btn" href="${redirectUrl}">点击跳转（如未自动跳转）</a>
  <div class="auto">页面将在 3 秒后自动跳转</div>
</div>
<script>setTimeout(()=>{window.location.href="${redirectUrl}"},3000)</script>
</body></html>`,

  error: (title: string, message: string) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:linear-gradient(135deg,#f093fb 0%,#f5576c 100%);color:#333;}
  .card{background:#fff;padding:2.5rem;border-radius:16px;box-shadow:0 10px 40px rgba(0,0,0,0.2);text-align:center;max-width:460px;width:90%;}
  .icon{font-size:3rem;margin-bottom:1rem;}
  h2{margin:0 0 0.5rem;color:#e74c3c;}
  p{color:#666;line-height:1.6;}
</style></head>
<body>
<div class="card">
  <div class="icon">❌</div>
  <h2>${title}</h2>
  <p>${message}</p>
</div>
</body></html>`,
};

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // 健康检查
    if (path === "/" || path === "/health") {
      return new Response(JSON.stringify({ status: "ok", service: "onedrive-oauth-relay" }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // 只处理回调路径
    // 支持多个路径：/onedrive/callback, /tool/onedrive/callback 等
    if (!path.endsWith("/onedrive/callback") && !path.endsWith("/onedrive/callback/")) {
      return new Response(HTML_TEMPLATES.error("404", "无效的路径"), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // 处理微软返回的错误
    if (error) {
      return new Response(HTML_TEMPLATES.error(
        "授权失败",
        `微软返回错误：${errorDescription || error}`
      ), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!code) {
      return new Response(HTML_TEMPLATES.error("参数缺失", "未收到授权码（code）"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!state) {
      return new Response(HTML_TEMPLATES.error("参数缺失", "未收到 state 参数"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 解析 state
    let stateData: StateData;
    try {
      stateData = JSON.parse(atob(state));
    } catch {
      return new Response(HTML_TEMPLATES.error("state 无效", "无法解析 state 参数，请重新授权"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (!stateData.cb) {
      return new Response(HTML_TEMPLATES.error("state 无效", "state 中缺少回调地址（cb）"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // 构造回调 URL，把 code 和原始 state 传回用户的应用
    const callbackUrl = new URL(stateData.cb);
    callbackUrl.searchParams.set("code", code);
    callbackUrl.searchParams.set("state", state);
    // 也传递原始的 error 参数（如果有）
    const errorParam = url.searchParams.get("error");
    if (errorParam) {
      callbackUrl.searchParams.set("error", errorParam);
    }
    const errorDesc = url.searchParams.get("error_description");
    if (errorDesc) {
      callbackUrl.searchParams.set("error_description", errorDesc);
    }

    return new Response(HTML_TEMPLATES.success(callbackUrl.toString()), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
