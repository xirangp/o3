import type { Route } from "./+types/api.oauth.onedrive.callback";

/**
 * OneDrive OAuth2 回调
 * GET /api/oauth/onedrive/callback?code=xxx&state=xxx
 *
 * 接收中转服务转发回来的 code + state，
 * 从 state 中提取 code_verifier 完成 PKCE token 交换。
 */
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const errorDesc = url.searchParams.get("error_description");

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

  let stateData: {
    client_id: string;
    client_secret: string;
    redirect_uri: string;
    region: string;
    is_sharepoint: boolean;
    site_id: string;
    code_verifier?: string;
  };
  try {
    stateData = JSON.parse(atob(state));
  } catch {
    return new Response(getHtml("state 无效", "无法解析 state 参数"), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const tokenUrl = stateData.region === "cn"
    ? "https://login.partner.microsoftonline.cn/common/oauth2/v2.0/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

  const scope = stateData.is_sharepoint
    ? "https://graph.microsoft.com/.default offline_access"
    : "User.Read Files.ReadWrite offline_access";

  try {
    const params: Record<string, string> = {
      client_id: stateData.client_id,
      client_secret: stateData.client_secret,
      code,
      redirect_uri: stateData.redirect_uri,
      grant_type: "authorization_code",
      scope,
    };
    if (stateData.code_verifier) {
      params.code_verifier = stateData.code_verifier;
    }

    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(params),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      return new Response(getHtml("授权失败", `Token 请求失败: ${errText.slice(0, 300)}`), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const tokenData = (await tokenRes.json()) as {
      refresh_token: string;
      access_token: string;
      expires_in: number;
    };

    if (!tokenData.refresh_token) {
      return new Response(getHtml("错误", "未获取到 refresh_token"), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const dataToPass = {
      refresh_token: tokenData.refresh_token,
      region: stateData.region,
      is_sharepoint: stateData.is_sharepoint,
      site_id: stateData.site_id,
    };

    return new Response(getSuccessHtml(dataToPass), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return new Response(getHtml("错误", `请求异常: ${err}`), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

function getHtml(title: string, message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f5f5f5;}
.box{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:400px;}
h2{color:#e74c3c;margin-top:0;}</style></head>
<body><div class="box"><h2>${title}</h2><p>${message}</p></div></body></html>`;
}

function getSuccessHtml(data: {
  refresh_token: string;
  region: string;
  is_sharepoint: boolean;
  site_id: string;
}): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>授权成功</title>
<style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#f0fdf4;}
.box{background:white;padding:2rem;border-radius:12px;box-shadow:0 2px 10px rgba(0,0,0,0.1);text-align:center;max-width:500px;}
h2{color:#22c55e;margin-top:0;}
.token{word-break:break-all;background:#f1f5f9;padding:0.75rem;border-radius:8px;font-size:12px;text-align:left;max-height:120px;overflow:auto;margin:1rem 0;}
.btn{background:#3b82f6;color:white;border:none;padding:0.5rem 1.5rem;border-radius:8px;cursor:pointer;font-size:14px;}
.btn:hover{background:#2563eb;}
.info{font-size:12px;color:#64748b;margin-top:1rem;}</style></head>
<body><div class="box">
<h2>✅ OneDrive 授权成功</h2>
<p>请复制以下信息回到 CList 填写：</p>
<div class="token" id="token">${data.refresh_token}</div>
<button class="btn" onclick="copy()">📋 复制 Refresh Token</button>
<div class="info">区域: ${data.region} | 类型: ${data.is_sharepoint ? "SharePoint" : "OneDrive"}${data.site_id ? ` | 站点: ${data.site_id}` : ""}</div>
<script>
function copy(){navigator.clipboard.writeText('${data.refresh_token}').then(()=>alert('已复制')).catch(()=>{
  const t=document.createElement('textarea');t.value='${data.refresh_token}';document.body.appendChild(t);t.select();document.execCommand('copy');document.body.removeChild(t);alert('已复制');
})}
if(window.opener){try{window.opener.postMessage({type:'onedrive_oauth',data:${JSON.stringify(data)}},'*')}catch{}}
</script>
</body></html>`;
}
