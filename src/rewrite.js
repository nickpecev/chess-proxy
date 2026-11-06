import { isAllowedHost, isDefaultHost } from "./allowlist.js";

const HOST_SOURCE =
  "(?:[a-z0-9-]+\\.)*(?:chess\\.com|chesscomfiles\\.com)|challenges\\.cloudflare\\.com";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function publicContext(origin) {
  const url = new URL(origin);
  const secure = url.protocol === "https:";
  return {
    origin: url.origin,
    host: url.host,
    protocol: url.protocol,
    wsProtocol: secure ? "wss:" : "ws:",
    secure,
  };
}

function mappedOrigin(protocol, hostname, ctx) {
  const host = hostname.toLowerCase();
  const prefix = isDefaultHost(host) ? "" : `/_c/${host}`;
  const proto = protocol === "ws:" || protocol === "wss:" ? ctx.wsProtocol : ctx.protocol;
  return `${proto}//${ctx.host}${prefix}`;
}

export function rewriteText(text, ctx) {
  if (!text || !ctx) return text;
  const hostGroup = `(${HOST_SOURCE})(?![a-z0-9.-])`;
  let out = text.replace(
    new RegExp(`(https?:|wss?:)\\/\\/${hostGroup}`, "gi"),
    (full, protocol, hostname) => {
      if (!isAllowedHost(hostname)) return full;
      return mappedOrigin(protocol.toLowerCase(), hostname, ctx);
    },
  );
  out = out.replace(
    new RegExp(`(https?:|wss?:)\\\\/\\\\/${hostGroup}`, "gi"),
    (full, protocol, hostname) => {
      if (!isAllowedHost(hostname)) return full;
      return mappedOrigin(protocol.toLowerCase(), hostname, ctx).replaceAll("/", "\\/");
    },
  );
  out = out.replace(
    new RegExp(`(https?)\\\\u003[aA]\\\\/\\\\/${hostGroup}`, "gi"),
    (full, protocol, hostname) => {
      if (!isAllowedHost(hostname)) return full;
      const mapped = mappedOrigin(`${protocol.toLowerCase()}:`, hostname, ctx);
      const match = mapped.match(/^(https?):\/\/(.*)$/i);
      if (!match) return full;
      return `${match[1]}\\u003A\\/\\/${match[2].replaceAll("/", "\\/")}`;
    },
  );
  out = out.replace(
    new RegExp(`(^|[^\\w:])\\/\\/${hostGroup}`, "gi"),
    (full, prefix, hostname) => {
      if (!isAllowedHost(hostname)) return full;
      const host = hostname.toLowerCase();
      const path = isDefaultHost(host) ? "" : `/_c/${host}`;
      return `${prefix}//${ctx.host}${path}`;
    },
  );
  out = out.replace(
    new RegExp(`https?%3A%2F%2F(${HOST_SOURCE})(?![a-z0-9.-])`, "gi"),
    (full, hostname) => {
      if (!isAllowedHost(hostname)) return full;
      return encodeURIComponent(mappedOrigin("https:", hostname, ctx));
    },
  );
  return out;
}

function upstreamScheme(proxyOrigin) {
  return proxyOrigin.startsWith("ws") ? "wss://" : "https://";
}

function replaceOneOrigin(text, proxyOrigin, ctx, encoded) {
  const slash = encoded ? "%2F" : "/";
  const marker = `${proxyOrigin}${slash}_c${slash}`;
  const withHost = new RegExp(`${escapeRegExp(marker)}([a-z0-9.-]+)`, "gi");
  let out = text.replace(withHost, (full, hostname) => {
    if (!isAllowedHost(hostname)) return full;
    const absolute = `${upstreamScheme(proxyOrigin)}${hostname.toLowerCase()}`;
    return encoded ? encodeURIComponent(absolute) : absolute;
  });
  const bare = new RegExp(`${escapeRegExp(proxyOrigin)}(?![\\w.-])`, "gi");
  out = out.replace(bare, () => {
    const absolute = `${upstreamScheme(proxyOrigin)}www.chess.com`;
    return encoded ? encodeURIComponent(absolute) : absolute;
  });
  return out;
}

export function restoreText(text, ctx) {
  if (!text) return text;
  const encodedHost = encodeURIComponent(ctx.host);
  if (!text.includes(ctx.host) && !text.includes(encodedHost)) return text;
  const origins = [
    `https://${ctx.host}`,
    `http://${ctx.host}`,
    `wss://${ctx.host}`,
    `ws://${ctx.host}`,
    `//${ctx.host}`,
  ];
  let out = text;
  for (const origin of origins) {
    out = replaceOneOrigin(out, origin, ctx, false);
    out = replaceOneOrigin(out, encodeURIComponent(origin), ctx, true);
  }
  return out;
}

export function resolveUpstream(pathname, search = "") {
  let path = pathname || "/";
  if (path.includes("\\") || path.includes("\0")) return { error: 400 };
  if (path === "/_proxy/health") return { internal: "health" };
  if (path === "/_proxy/unlock") return { internal: "unlock" };
  if (
    path === "/_proxy/puzzles" ||
    path === "/_proxy/puzzles/next" ||
    path === "/_proxy/puzzles/app.js" ||
    path === "/_proxy/puzzles/chess.js"
  ) {
    return { internal: "puzzles" };
  }
  if (path.startsWith("/_proxy/") || path === "/_proxy") return { error: 404 };

  if (path.startsWith("/_c/")) {
    const rest = path.slice(4);
    if (!rest) return { error: 403 };
    const slash = rest.indexOf("/");
    const rawHost = slash === -1 ? rest : rest.slice(0, slash);
    const upstreamPath = slash === -1 ? "/" : rest.slice(slash);
    let host;
    try {
      host = decodeURIComponent(rawHost).toLowerCase();
    } catch {
      return { error: 400 };
    }
    if (!isAllowedHost(host)) return { error: 403 };
    if (!upstreamPath.startsWith("/")) return { error: 400 };
    return { hostname: host, pathname: upstreamPath, search };
  }

  return { hostname: "www.chess.com", pathname: path, search };
}

export function parseRequestTarget(reqUrl) {
  const url = new URL(reqUrl, "http://placeholder.local");
  const resolved = resolveUpstream(url.pathname, url.search);
  if (resolved.pathname) resolved.pathname = encodeURI(resolved.pathname);
  return resolved;
}

export function upstreamUrl(target, ctx) {
  const search = restoreText(target.search || "", ctx);
  const url = new URL(`https://${target.hostname}${target.pathname}${search}`);
  if (url.protocol !== "https:" || url.hostname !== target.hostname || url.port) {
    throw new Error("refusing upstream url");
  }
  if (!isAllowedHost(url.hostname)) throw new Error("refusing upstream host");
  return url;
}

export function rewriteSetCookie(raw, secure) {
  if (typeof raw !== "string" || raw.length === 0 || /[\r\n]/.test(raw)) return null;
  const parts = raw.split(";").map((part) => part.trim()).filter(Boolean);
  const nameValue = parts.shift();
  if (!nameValue || !nameValue.includes("=")) return null;
  const name = nameValue.slice(0, nameValue.indexOf("=")).trim();
  if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name)) return null;
  const kept = [];
  for (const attr of parts) {
    const key = attr.split("=")[0].trim().toLowerCase();
    if (key === "domain" || key === "samesite" || key === "secure" || key === "partitioned") {
      continue;
    }
    if (/[\r\n]/.test(attr)) return null;
    kept.push(attr);
  }
  kept.push("SameSite=Lax");
  if (secure) kept.push("Secure");
  return [nameValue, ...kept].join("; ");
}

const REWRITE_TYPES = [
  "text/html",
  "text/css",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/json",
  "text/plain",
  "application/xml",
  "text/xml",
  "application/xhtml+xml",
];

export function shouldRewrite(contentType) {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  if (REWRITE_TYPES.some((item) => type.includes(item))) return true;
  return type.includes("+json") || type.includes("+xml");
}

export function isTextRequest(contentType) {
  if (!contentType) return false;
  const type = contentType.toLowerCase();
  return (
    type.includes("application/json") ||
    type.includes("application/x-www-form-urlencoded") ||
    type.includes("text/plain") ||
    type.includes("+json") ||
    type.includes("application/javascript")
  );
}

export function injectBoot(html, boot) {
  const tag = `<script>${boot}</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (match) => `${match}${tag}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (match) => `${match}${tag}`);
  }
  return tag + html;
}

export function stripIntegrity(html) {
  return html
    .replace(/\s+integrity\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+integrity\s*=\s*'[^']*'/gi, "");
}
