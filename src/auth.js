import crypto from "node:crypto";

const COOKIE = "cp_session";
const SESSION_MS = 12 * 60 * 60 * 1000;

export function cookieName() {
  return COOKIE;
}

function hmac(secret, body) {
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

export function passwordsMatch(input, expected) {
  const left = crypto.createHash("sha256").update(String(input)).digest();
  const right = crypto.createHash("sha256").update(String(expected)).digest();
  return crypto.timingSafeEqual(left, right);
}

export function issueSession(secret, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ v: 1, exp: now + SESSION_MS })).toString("base64url");
  return `${body}.${hmac(secret, body)}`;
}

export function readSession(token, secret, now = Date.now()) {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const dot = token.indexOf(".");
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = hmac(secret, body);
  const actualBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  const lengthOk = actualBuf.length === expectedBuf.length;
  const compareBuf = lengthOk ? actualBuf : expectedBuf;
  if (!crypto.timingSafeEqual(compareBuf, expectedBuf) || !lengthOk) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload?.v !== 1 || typeof payload.exp !== "number" || payload.exp <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(header, name = COOKIE) {
  if (!header) return "";
  const parts = header.split(";");
  const needle = `${name.toLowerCase()}=`;
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.toLowerCase().startsWith(needle)) return trimmed.slice(name.length + 1);
  }
  return "";
}

export function stripCookie(header, name = COOKIE) {
  if (!header) return undefined;
  const kept = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !part.toLowerCase().startsWith(`${name.toLowerCase()}=`));
  return kept.length ? kept.join("; ") : undefined;
}

export function sessionCookie(token, secure) {
  const flags = ["HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${SESSION_MS / 1000}`];
  if (secure) flags.push("Secure");
  return `${COOKIE}=${token}; ${flags.join("; ")}`;
}

export function createRateLimiter({ limit, windowMs }) {
  const hits = new Map();
  function bucket(key, now) {
    const stamp = hits.get(key);
    if (!stamp || stamp.reset <= now) {
      const fresh = { count: 0, reset: now + windowMs };
      hits.set(key, fresh);
      return fresh;
    }
    return stamp;
  }
  return {
    blocked(key, now = Date.now()) {
      return bucket(key, now).count >= limit;
    },
    fail(key, now = Date.now()) {
      const stamp = bucket(key, now);
      stamp.count += 1;
      return stamp.count >= limit;
    },
    clear(key) {
      hits.delete(key);
    },
  };
}
