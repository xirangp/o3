import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";
import { useEffect } from "react";

import type { Route } from "./+types/root";
import "./app.css";

export const links: Route.LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        {/* 自定义 head JS 注入点 */}
        <meta name="cl-site-meta" content="injected" />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// 注入站点自定义 CSS/JS/favicon
function SiteMetaInjector() {
  useEffect(() => {
    // 避免重复注入
    if (document.querySelector('[data-cl-meta-injected]')) return;

    fetch("/api/site-meta")
      .then(res => res.json())
      .then((data: { meta?: Record<string, string> }) => {
        const meta = data.meta || {};
        const head = document.head;
        const body = document.body;

        // Favicon
        if (meta.site_favicon) {
          let link = head.querySelector<HTMLLinkElement>('link[rel="icon"]');
          if (!link) { link = document.createElement("link"); link.rel = "icon"; head.appendChild(link); }
          link.href = meta.site_favicon;
        }

        // 自定义 CSS
        if (meta.custom_css) {
          const style = document.createElement("style");
          style.textContent = meta.custom_css;
          style.setAttribute("data-cl-meta-injected", "css");
          head.appendChild(style);
        }

        // Head JS
        if (meta.custom_head_js) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = meta.custom_head_js;
          wrapper.setAttribute("data-cl-meta-injected", "head-js");
          head.appendChild(wrapper);
          // 执行 script 标签
          wrapper.querySelectorAll("script").forEach(oldScript => {
            const s = document.createElement("script");
            for (const attr of oldScript.attributes) s.setAttribute(attr.name, attr.value);
            s.textContent = oldScript.textContent;
            oldScript.replaceWith(s);
          });
        }

        // Body JS
        if (meta.custom_body_js) {
          const wrapper = document.createElement("div");
          wrapper.innerHTML = meta.custom_body_js;
          wrapper.setAttribute("data-cl-meta-injected", "body-js");
          wrapper.style.display = "none";
          body.appendChild(wrapper);
          wrapper.querySelectorAll("script").forEach(oldScript => {
            const s = document.createElement("script");
            for (const attr of oldScript.attributes) s.setAttribute(attr.name, attr.value);
            s.textContent = oldScript.textContent;
            oldScript.replaceWith(s);
          });
        }

        // 标记已注入
        const marker = document.createElement("meta");
        marker.name = "cl-meta-injected";
        marker.content = "true";
        head.appendChild(marker);
      })
      .catch(() => {});
  }, []);
  return null;
}

export default function App() {
  return <>
    <SiteMetaInjector />
    <Outlet />
  </>;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="pt-16 p-4 container mx-auto">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full p-4 overflow-x-auto">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
