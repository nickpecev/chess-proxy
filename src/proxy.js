import https from "node:https";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { isAllowedHost, isDefaultHost } from "./allowlist.js";
import {
  cookieName,
  createRateLimiter,
  issueSession,
  passwordsMatch,
  readCookie,
  readSession,
  sessionCookie,
  stripCookie,
} from "./auth.js";
import { clientBoot } from "./boot.js";
import { gateHtml } from "./gate.js";
import {
  injectBoot,
  isTextRequest,
  parseRequestTarget,
  publicContext,
  restoreText,
  rewriteSetCookie,
  rewriteText,
  shouldRewrite,
  stripIntegrity,
  upstreamUrl,
} from "./rewrite.js";

const BOOT = clientBoot();
if (BOOT.includes("</")) throw new Error("boot script contains a closing tag");

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

const DROP_REQUEST = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "content-length",
  "accept-encoding",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ray",
  "cf-ipcountry",
  "via",
  "proxy-authorization",
]);

const DROP_RESPONSE = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-security-policy",
  "content-security-policy-report-only",
  "report-to",
  "nel",
  "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
  "strict-transport-security",
  "alt-svc",
  "server",
  "cf-ray",
  "cf-cache-status",
]);

const REWRITE_RESPONSE = new Set(["location", "content-location", "refresh", "link"]);

function gzip(buffer) {
  return new Promise((resolve, reject) => {
    zlib.gzip(buffer, (error, result) => (error ? reject(error) : resolve(result)));
  });
}

function clientAddress(req, config) {
  if (config.trustProxy) {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded.slice(0, 80);
  }
  return req.socket?.remoteAddress || "unknown";
}

export function requestContext(req, config) {
  if (config.publicOrigin) return publicContext(config.publicOrigin);
  let proto = req.socket?.encrypted ? "https" : "http";
  let host = req.headers.host || `127.0.0.1:${config.port}`;
  if (config.trustProxy) {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const forwardedHost = String(req.headers["x-forwarded-host"] || "").split(",")[0].trim();
    if (forwardedProto === "http" || forwardedProto === "https") proto = forwardedProto;
    if (forwardedHost) host = forwardedHost;
  }
  let parsed;
  try {
    parsed = new URL(`${proto}://${host}`);
  } catch {
    const error = new Error("bad host");
    error.status = 400;
    throw error;
  }
  if (parsed.host !== host || isAllowedHost(parsed.hostname) || parsed.username || parsed.password) {
    const error = new Error("bad host");
    error.status = 400;
    throw error;
  }
  return publicContext(parsed.origin);
}

function secFetchSite(hostname) {
  if (isDefaultHost(hostname)) return "same-origin";
  if (hostname === "chess.com" || hostname.endsWith(".chess.com")) return "same-site";
  return "cross-site";
}

function upstreamHeaders(req, target, ctx) {
  const headers = new Headers();
  const listed = String(req.headers.connection || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const extraDrop = new Set(listed);
  for (const [name, raw] of Object.entries(req.headers)) {
    if (raw == null || Array.isArray(raw)) continue;
    const key = name.toLowerCase();
    if (DROP_REQUEST.has(key) || extraDrop.has(key)) continue;
    if (key === "cookie") {
      const cookie = stripCookie(raw);
      if (cookie) headers.set("cookie", cookie);
      continue;
    }
    if (key === "origin") {
      headers.set("origin", "https://www.chess.com");
      continue;
    }
    if (key === "referer") {
      headers.set("referer", restoreText(raw, ctx));
      continue;
    }
    if (key === "sec-fetch-site") {
      headers.set(key, raw === "none" ? raw : secFetchSite(target.hostname));
      continue;
    }
    headers.set(key, raw);
  }
  if (!headers.has("user-agent")) {
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );
  }
  return headers;
}

function responseHeaders(upstream, ctx) {
  const headers = {
    "x-robots-tag": "noindex, nofollow",
  };
  const cookies = [];
  for (const cookie of upstream.headers.getSetCookie()) {
    const rewritten = rewriteSetCookie(cookie, ctx.secure);
    if (rewritten) cookies.push(rewritten);
  }
  upstream.headers.forEach((value, key) => {
    if (key === "set-cookie" || DROP_RESPONSE.has(key)) return;
    if (/[\r\n]/.test(value)) return;
    headers[key] = REWRITE_RESPONSE.has(key) ? rewriteText(value, ctx).replace(/[\r\n]/g, "") : value;
  });
  if (cookies.length) headers["cache-control"] = "private, no-store";
  if (cookies.length) headers["set-cookie"] = cookies;
  return headers;
}

async function readBody(req, limit) {
  if (req.method === "GET" || req.method === "HEAD") return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function plain(res, status, message) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(message);
}

function authorized(req, config) {
  if (!config.accessKey) return true;
  return Boolean(readSession(readCookie(req.headers.cookie || "", cookieName()), config.sessionSecret));
}

function wantsDocument(req) {
  const dest = req.headers["sec-fetch-dest"];
  if (dest === "document" || dest === "iframe") return true;
  return String(req.headers.accept || "").includes("text/html");
}

export function createApp(config, deps = {}) {
  const fetchImpl = deps.fetchImpl || globalThis.fetch;
  const unlockLimiter = createRateLimiter({ limit: 8, windowMs: 15 * 60 * 1000 });

  async function handleUnlock(req, res, ctx) {
    if (!config.accessKey) {
      res.writeHead(302, { location: "/", "cache-control": "no-store" });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://placeholder.local");
    if (req.method === "GET" || req.method === "HEAD") {
      const code = url.searchParams.get("e");
      const error = code === "1" ? "mismatch" : code === "2" ? "limited" : "";
      const html = gateHtml(error);
      res.writeHead(req.method === "HEAD" ? 200 : 200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow",
      });
      res.end(req.method === "HEAD" ? undefined : html);
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405, { allow: "GET, POST", "cache-control": "no-store" });
      res.end();
      return;
    }
    if (req.headers.origin && req.headers.origin !== ctx.origin) {
      plain(res, 403, "The unlock form was submitted from the wrong address.");
      return;
    }
    const referer = req.headers.referer || "";
    if (!req.headers.origin && referer && !referer.startsWith(`${ctx.origin}/`)) {
      plain(res, 403, "The unlock form was submitted from the wrong address.");
      return;
    }
    const ip = clientAddress(req, config);
    if (unlockLimiter.blocked(ip)) {
      res.writeHead(303, { location: "/_proxy/unlock?e=2", "cache-control": "no-store" });
      res.end();
      return;
    }
    const raw = await readBody(req, 16 * 1024);
    const password = new URLSearchParams(raw.toString("utf8")).get("password") || "";
    if (!passwordsMatch(password, config.accessKey)) {
      unlockLimiter.fail(ip);
      await new Promise((resolve) => setTimeout(resolve, 200));
      res.writeHead(303, { location: "/_proxy/unlock?e=1", "cache-control": "no-store" });
      res.end();
      return;
    }
    unlockLimiter.clear(ip);
    res.writeHead(303, {
      location: "/",
      "cache-control": "no-store",
      "set-cookie": sessionCookie(issueSession(config.sessionSecret), ctx.secure),
    });
    res.end();
  }

  async function handle(req, res) {
    const ctx = requestContext(req, config);
    const target = parseRequestTarget(req.url || "/");
    if (target.internal === "health") {
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end('{"ok":true}');
      return;
    }
    if (target.internal === "unlock") {
      await handleUnlock(req, res, ctx);
      return;
    }
    if (target.error) {
      const messages = {
        400: "That address could not be read.",
        403: "That address is outside this proxy.",
        404: "Nothing is published at that address.",
      };
      plain(res, target.error, messages[target.error] || "Request refused.");
      return;
    }
    if (!METHODS.has(req.method || "GET")) {
      plain(res, 405, "That method is not supported.");
      return;
    }
    if (!authorized(req, config)) {
      if (wantsDocument(req)) {
        res.writeHead(302, { location: "/_proxy/unlock", "cache-control": "no-store" });
        res.end();
        return;
      }
      plain(res, 401, "Unlock required.");
      return;
    }

    const destination = upstreamUrl(target, ctx);
    const headers = upstreamHeaders(req, target, ctx);
    const hasBody = req.method !== "GET" && req.method !== "HEAD";
    let body;
    if (hasBody) {
      const raw = await readBody(req, config.maxBodyBytes);
      const type = String(req.headers["content-type"] || "");
      body = raw.length && isTextRequest(type) ? restoreText(raw.toString("utf8"), ctx) : raw;
    }

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const started = Date.now();
    const upstream = await fetchImpl(destination, {
      method: req.method,
      headers,
      body: hasBody ? body : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.any([AbortSignal.timeout(config.upstreamTimeoutMs), controller.signal]),
    });

    const outHeaders = responseHeaders(upstream, ctx);
    const status = upstream.status;
    console.log(
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        host: destination.hostname,
        path: destination.pathname,
        status,
        ms: Date.now() - started,
      }),
    );

    if (req.method === "HEAD" || status === 204 || status === 304 || !upstream.body) {
      res.writeHead(status, outHeaders);
      res.end();
      return;
    }

    const type = upstream.headers.get("content-type") || "";
    if (!shouldRewrite(type)) {
      res.writeHead(status, outHeaders);
      await pipeline(Readable.fromWeb(upstream.body), res);
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > config.maxRewriteBytes) {
      res.writeHead(status, outHeaders);
      res.end(buffer);
      return;
    }
    let text = rewriteText(buffer.toString("utf8"), ctx);
    if (type.toLowerCase().includes("text/html")) {
      text = injectBoot(stripIntegrity(text), BOOT);
    }
    let payload = Buffer.from(text);
    const accept = String(req.headers["accept-encoding"] || "");
    if (payload.length > 1024 && /\bgzip\b/.test(accept)) {
      payload = await gzip(payload);
      outHeaders["content-encoding"] = "gzip";
      outHeaders.vary = "Accept-Encoding";
    }
    res.writeHead(status, outHeaders);
    res.end(payload);
  }

  function upgrade(req, socket, head) {
    let ctx;
    try {
      ctx = requestContext(req, config);
    } catch {
      socket.destroy();
      return;
    }
    const fail = (status, reason) => {
      if (socket.destroyed) return;
      socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!authorized(req, config)) {
      fail(401, "Unauthorized");
      return;
    }
    const target = parseRequestTarget(req.url || "/");
    if (target.error || target.internal || !isAllowedHost(target.hostname)) {
      fail(403, "Forbidden");
      return;
    }
    let destination;
    try {
      destination = upstreamUrl(target, ctx);
    } catch {
      fail(403, "Forbidden");
      return;
    }
    const headers = {
      host: destination.hostname,
      connection: "Upgrade",
      upgrade: "websocket",
      origin: "https://www.chess.com",
    };
    for (const name of [
      "sec-websocket-key",
      "sec-websocket-version",
      "sec-websocket-protocol",
      "sec-websocket-extensions",
      "user-agent",
      "accept-language",
    ]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    const cookie = stripCookie(req.headers.cookie || "");
    if (cookie) headers.cookie = cookie;

    const upstream = https.request({
      hostname: destination.hostname,
      port: 443,
      servername: destination.hostname,
      method: "GET",
      path: `${destination.pathname}${destination.search}`,
      headers,
      timeout: 20_000,
    });
    const closeBoth = (left, right) => {
      left.on("error", () => right.destroy());
      right.on("error", () => left.destroy());
      left.on("close", () => right.destroy());
      right.on("close", () => left.destroy());
    };
    upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
      const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage || ""}`.trimEnd()];
      for (let i = 0; i < response.rawHeaders.length; i += 2) {
        const key = response.rawHeaders[i];
        const value = response.rawHeaders[i + 1];
        if (/^(transfer-encoding|content-length)$/i.test(key)) continue;
        if (/^set-cookie$/i.test(key)) {
          const rewritten = rewriteSetCookie(value, ctx.secure);
          if (rewritten) lines.push(`Set-Cookie: ${rewritten}`);
          continue;
        }
        if (/[\r\n]/.test(value)) continue;
        lines.push(`${key}: ${value}`);
      }
      socket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (upstreamHead?.length) socket.write(upstreamHead);
      if (head?.length) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
      closeBoth(socket, upstreamSocket);
    });
    upstream.on("response", (response) => {
      response.resume();
      fail(response.statusCode || 502, response.statusMessage || "Bad Gateway");
    });
    upstream.on("timeout", () => upstream.destroy());
    upstream.on("error", () => fail(502, "Bad Gateway"));
    upstream.end();
  }

  return { handle, upgrade };
}
