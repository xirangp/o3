/**
 * OneDrive OAuth2 中转回调（部署在 n.xirang.dpdns.org）
 *
 * 只做一件事：把 code 和 state 转发回用户自己的应用。
 * 不做 token 交换，由用户应用端完成（支持 PKCE）。
 *
 * GET /api/oauth/onedrive/callback?code=xxx&state=xxx
 */
export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

  // 微软返回了错误，直接显示
  if (error) {
    return new Response(getHtml("授权失败", `${error}: ${errorDesc || "未知错误"}`), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!code || !state) {
    return new Response(getHtml("参数缺失", "未收到 code 或 state"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // 从 state 中解析 cb（用户自己的应用回调地址）
  let cb: string;
  try {
    const stateData = JSON.parse(atob(state));
    cb = stateData.cb;
  } catch {
    return new Response(getHtml("state 无效", "无法解析 state 参数"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!cb) {
    return new Response(getHtml("state 缺少 cb", "state 中没有 cb（应用回调地址）"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // 跳转回用户的应用，带上 code 和原始 state
  const redirectUrl = new URL(cb);
  redirectUrl.searchParams.set("code", code);
  redirectUrl.searchParams.set("state", state);

  // 302 跳转
  return new Response(null, {
    status: 302,
    headers: { Location: redirectUrl.toString() },
  });
}

function getHtml(title: string, message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}
.box{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h2{color:#e74c3c;margin-top:0;}</style></head>
<body><div class="box"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}
