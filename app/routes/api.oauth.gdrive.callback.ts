import type { Route } from "./+types/api.oauth.gdrive.callback";

/**
 * Google Drive OAuth2 回调
 * GET /api/oauth/gdrive/callback?code=xxx&state=xxx
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code) {
    return new Response(getHtml("错误", "未收到授权码"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  let stateData: { client_id: string; client_secret: string; redirect_uri: string };
  try {
    stateData = JSON.parse(atob(state || ""));
  } catch {
    return new Response(getHtml("错误", "无效的 state 参数"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: stateData.client_id,
        client_secret: stateData.client_secret,
        code,
        redirect_uri: stateData.redirect_uri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(getHtml("授权失败", `Token 请求失败: ${errText.slice(0, 200)}`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    const tokenData = (await tokenRes.json()) as { refresh_token: string };

    if (!tokenData.refresh_token) {
      return new Response(getHtml("错误", "未获取到 refresh_token。请确保 access_type=offline 且 prompt=consent。"), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    return new Response(getSuccessHtml(tokenData.refresh_token), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (err) {
    return new Response(getHtml("错误", `请求异常: ${err}`), { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}

function getHtml(title: string, message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}
.box{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h2{color:#e74c3c;margin-top:0;}</style></head>
<body><div class="box"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

function getSuccessHtml(refreshToken: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>授权成功</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4;}
.box{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h2{color:#22c55e;margin-top:0;}</style></head>
<body><div class="box">
<h2>✅ Google Drive 授权成功</h2>
<p>授权已完成，请返回 CList 继续操作。</p>
<script>
if(window.opener){try{window.opener.postMessage({type:'gdrive_oauth',data:{refresh_token:'${refreshToken}'}},'*');}catch{}}
setTimeout(function(){try{window.close();}catch{}},2000);
</script>
</body></html>`;
}
