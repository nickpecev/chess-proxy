export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProd = nodeEnv === "production";
  const accessKey = env.PROXY_ACCESS_KEY || "";
  const sessionSecret = env.SESSION_SECRET || "";
  const port = Number(env.PORT || 8080);
  const bindHost = env.BIND_HOST || (isProd ? "0.0.0.0" : "127.0.0.1");
  const trustProxy = env.TRUST_PROXY === "1";
  const exposed = bindHost !== "127.0.0.1" && bindHost !== "::1" && bindHost !== "localhost";

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a number from 1 to 65535");
  }
  if (isProd && accessKey.length < 12) {
    throw new Error("PROXY_ACCESS_KEY must be at least 12 characters in production");
  }
  if (exposed && accessKey.length < 12) {
    throw new Error("PROXY_ACCESS_KEY must be at least 12 characters when listening beyond localhost");
  }
  if ((isProd || accessKey) && sessionSecret.length < 24) {
    throw new Error("SESSION_SECRET must be at least 24 characters");
  }

  let publicOrigin = "";
  if (env.PUBLIC_ORIGIN) {
    const url = new URL(env.PUBLIC_ORIGIN);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw new Error("PUBLIC_ORIGIN must be an http(s) origin");
    }
    if (url.pathname !== "/" && url.pathname !== "") {
      throw new Error("PUBLIC_ORIGIN must not include a path");
    }
    publicOrigin = url.origin;
  }

  return {
    nodeEnv,
    isProd,
    accessKey,
    sessionSecret,
    port,
    bindHost,
    trustProxy,
    publicOrigin,
    maxBodyBytes: 20 * 1024 * 1024,
    maxRewriteBytes: 12 * 1024 * 1024,
    upstreamTimeoutMs: 25_000,
  };
}
