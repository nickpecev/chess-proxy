import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";
import { createRateLimiter, issueSession, passwordsMatch, readSession, stripCookie } from "../src/auth.js";
import { clientBoot } from "../src/boot.js";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/proxy.js";
import { isAllowedHost } from "../src/allowlist.js";
import {
  parseRequestTarget,
  publicContext,
  restoreText,
  rewriteSetCookie,
  rewriteText,
  upstreamUrl,
} from "../src/rewrite.js";

const ctx = publicContext("http://127.0.0.1:8080");

test("allowlist accepts chess hosts and rejects lookalikes", () => {
  assert.equal(isAllowedHost("www.chess.com"), true);
  assert.equal(isAllowedHost("api.chess.com"), true);
  assert.equal(isAllowedHost("images.chesscomfiles.com"), true);
  assert.equal(isAllowedHost("challenges.cloudflare.com"), true);
  assert.equal(isAllowedHost("WWW.Chess.com."), true);
  assert.equal(isAllowedHost("chess.com.evil.com"), false);
  assert.equal(isAllowedHost("evilchess.com"), false);
  assert.equal(isAllowedHost("not.evilchess.com"), false);
  assert.equal(isAllowedHost("foo.challenges.cloudflare.com"), false);
  assert.equal(isAllowedHost("challenges.cloudflare.com.evil.com"), false);
  assert.equal(isAllowedHost("127.0.0.1"), false);
  assert.equal(isAllowedHost("localhost"), false);
  assert.equal(isAllowedHost("..chess.com"), false);
  assert.equal(isAllowedHost("chess.com:443"), false);
});

test("rewrites chess urls onto the proxy and leaves everything else", () => {
  assert.equal(
    rewriteText("https://www.chess.com/play?x=1", ctx),
    "http://127.0.0.1:8080/play?x=1",
  );
  assert.equal(
    rewriteText("https://images.chesscomfiles.com/a.png", ctx),
    "http://127.0.0.1:8080/_c/images.chesscomfiles.com/a.png",
  );
  assert.equal(
    rewriteText("https:\\/\\/api.chess.com\\/v1", ctx),
    "http:\\/\\/127.0.0.1:8080\\/_c\\/api.chess.com\\/v1",
  );
  assert.equal(
    rewriteText("wss://www.chess.com/service/play/rsocket", ctx),
    "ws://127.0.0.1:8080/service/play/rsocket",
  );
  assert.equal(
    rewriteText("//images.chesscomfiles.com/a.png", ctx),
    "//127.0.0.1:8080/_c/images.chesscomfiles.com/a.png",
  );
  assert.equal(
    rewriteText("https%3A%2F%2Fapi.chess.com%2Fv1", ctx),
    "http%3A%2F%2F127.0.0.1%3A8080%2F_c%2Fapi.chess.com%2Fv1",
  );
  const untouched = "email me at user@chess.com and visit https://evilchess.com/x";
  assert.equal(rewriteText(untouched, ctx), untouched);
  assert.equal(
    rewriteText("https://chess.com.evil.com/x https://notchess.com/x", ctx),
    "https://chess.com.evil.com/x https://notchess.com/x",
  );
});

test("restores proxy urls before they are sent upstream", () => {
  assert.equal(
    restoreText("http://127.0.0.1:8080/_c/api.chess.com/v1?x=1", ctx),
    "https://api.chess.com/v1?x=1",
  );
  assert.equal(restoreText("http://127.0.0.1:8080/play", ctx), "https://www.chess.com/play");
  assert.equal(
    restoreText("http%3A%2F%2F127.0.0.1%3A8080%2Fhome", ctx),
    "https%3A%2F%2Fwww.chess.com%2Fhome",
  );
  assert.equal(
    restoreText("ws://127.0.0.1:8080/_c/live.chess.com/cometd", ctx),
    "wss://live.chess.com/cometd",
  );
});

test("refuses upstream targets that are not chess", () => {
  assert.equal(parseRequestTarget("/_c/127.0.0.1/").error, 403);
  assert.equal(parseRequestTarget("/_c/chess.com.evil.com/a").error, 403);
  assert.equal(parseRequestTarget("/_c/localhost/").error, 403);
  assert.equal(parseRequestTarget("/_proxy/secret").error, 404);
  const target = parseRequestTarget("/_c/api.chess.com/v1/player?x=1");
  assert.equal(target.hostname, "api.chess.com");
  assert.equal(upstreamUrl(target, ctx).href, "https://api.chess.com/v1/player?x=1");
  const tricky = parseRequestTarget("/_c/api.chess.com/@evil.com");
  const parsed = upstreamUrl(tricky, ctx);
  assert.equal(parsed.hostname, "api.chess.com");
});

test("rewrites cookies onto the proxy host", () => {
  const raw = "psid=abc; path=/; domain=chess.com; secure; samesite=none; HttpOnly";
  assert.equal(rewriteSetCookie(raw, false), "psid=abc; path=/; HttpOnly; SameSite=Lax");
  assert.equal(
    rewriteSetCookie(raw, true),
    "psid=abc; path=/; HttpOnly; SameSite=Lax; Secure",
  );
  assert.equal(rewriteSetCookie("bad\r\nSet-Cookie: x=y", true), null);
});

test("sessions are signed and the proxy cookie is removed upstream", () => {
  const secret = "this-is-a-test-secret-value";
  const token = issueSession(secret, 1_000);
  assert.ok(readSession(token, secret, 1_000));
  assert.equal(readSession(token, secret, 1_000 + 13 * 60 * 60 * 1000), null);
  assert.equal(readSession(`${token}x`, secret, 1_000), null);
  assert.equal(passwordsMatch("correct horse", "correct horse"), true);
  assert.equal(passwordsMatch("correct horse", "wrong horse"), false);
  assert.equal(stripCookie("cp_session=abc; psid=def; theme=dark"), "psid=def; theme=dark");
});

test("unlock attempts are limited", () => {
  const limiter = createRateLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(limiter.blocked("a"), false);
  limiter.fail("a");
  limiter.fail("a");
  assert.equal(limiter.blocked("a"), true);
  limiter.clear("a");
  assert.equal(limiter.blocked("a"), false);
});

test("boot script parses and does not close itself", () => {
  const source = clientBoot();
  assert.equal(source.includes("</"), false);
  assert.equal(source.includes("chess.com"), true);
  assert.equal(source.includes("gameplay.live.premoves"), true);
  new Function(source);
});

test("production and exposed binds require a passphrase", () => {
  assert.throws(() => loadConfig({ NODE_ENV: "production", PORT: "8080" }));
  assert.throws(() =>
    loadConfig({
      NODE_ENV: "production",
      PORT: "8080",
      BIND_HOST: "0.0.0.0",
      PROXY_ACCESS_KEY: "long-enough-key",
    }),
  );
  const config = loadConfig({
    NODE_ENV: "development",
    PORT: "8080",
    BIND_HOST: "127.0.0.1",
  });
  assert.equal(config.accessKey, "");
});

test("gate stays closed until the server password matches", async () => {
  const config = loadConfig({
    NODE_ENV: "development",
    PORT: "8080",
    BIND_HOST: "127.0.0.1",
    PROXY_ACCESS_KEY: "long-enough-key",
    SESSION_SECRET: "this-is-a-test-secret-value",
  });
  const calls = [];
  const app = createApp(config, {
    fetchImpl: async (url) => {
      calls.push(String(url));
      return new Response("nope", { status: 500 });
    },
  });
  const server = http.createServer((req, res) => app.handle(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  try {
    const blocked = await fetch(`http://127.0.0.1:${port}/play`, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.equal(blocked.status, 302);
    assert.equal(blocked.headers.get("location"), "/_proxy/unlock");
    assert.equal(calls.length, 0);

    const wrong = await fetch(`http://127.0.0.1:${port}/_proxy/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: `http://127.0.0.1:${port}` },
      body: "password=not-the-key",
      redirect: "manual",
    });
    assert.equal(wrong.status, 303);
    assert.equal(wrong.headers.get("location"), "/_proxy/unlock?e=1");

    const foreign = await fetch(`http://127.0.0.1:${port}/_proxy/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" },
      body: "password=long-enough-key",
      redirect: "manual",
    });
    assert.equal(foreign.status, 403);

    const opaque = await fetch(`http://127.0.0.1:${port}/_proxy/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: "null" },
      body: "password=not-the-key",
      redirect: "manual",
    });
    assert.equal(opaque.status, 303);
    assert.equal(opaque.headers.get("location"), "/_proxy/unlock?e=1");

    const bare = await fetch(`http://127.0.0.1:${port}/_proxy/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=long-enough-key",
      redirect: "manual",
    });
    assert.equal(bare.status, 303);
    assert.match(bare.headers.get("set-cookie") || "", /cp_session=/);

    const right = await fetch(`http://127.0.0.1:${port}/_proxy/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", origin: `https://127.0.0.1:${port}` },
      body: "password=long-enough-key",
      redirect: "manual",
    });
    assert.equal(right.status, 303);
    assert.match(right.headers.get("set-cookie") || "", /cp_session=/);
    const open = await fetch(`http://127.0.0.1:${port}/_c/evil.example/secret`, {
      headers: { cookie: right.headers.get("set-cookie").split(";")[0] },
    });
    assert.equal(open.status, 403);
    assert.equal(calls.length, 0);
  } finally {
    server.close();
  }
});

test("puzzle screen is served here and does not call Chess.com", async () => {
  assert.equal(parseRequestTarget("/_proxy/puzzles").internal, "puzzles");
  assert.equal(parseRequestTarget("/_proxy/puzzles/next").internal, "puzzles");
  const sample = {
    puzzle: {
      id: "queen-mate",
      rating: 900,
      themes: ["mateIn1"],
      fen: "1n4k1/5ppp/8/5N2/8/8/8/6QK w - - 0 1",
      solution: ["g1g7"],
    },
  };
  const upstream = [];
  const config = loadConfig({
    NODE_ENV: "development",
    PORT: "8080",
    BIND_HOST: "127.0.0.1",
    PROXY_ACCESS_KEY: "long-enough-key",
    SESSION_SECRET: "this-is-a-test-secret-value",
  });
  const app = createApp(config, {
    fetchImpl: async (url) => {
      upstream.push(String(url));
      return new Response("nope", { status: 500 });
    },
    puzzleFetch: async () => Response.json(sample),
  });
  const server = http.createServer((req, res) => app.handle(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  try {
    const locked = await fetch(`http://127.0.0.1:${port}/_proxy/puzzles`, {
      headers: { accept: "text/html" },
      redirect: "manual",
    });
    assert.equal(locked.status, 302);
    assert.equal(locked.headers.get("location"), "/_proxy/unlock");

    const open = await fetch(`http://127.0.0.1:${port}/_proxy/unlock`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "password=long-enough-key",
      redirect: "manual",
    });
    const cookie = open.headers.get("set-cookie").split(";")[0];
    const page = await fetch(`http://127.0.0.1:${port}/_proxy/puzzles`, {
      headers: { cookie, accept: "text/html" },
    });
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Puzzles/);
    assert.match(html, /src="\/_proxy\/puzzles\/app.js"/);
    const next = await fetch(`http://127.0.0.1:${port}/_proxy/puzzles/next?difficulty=normal`, {
      headers: { cookie },
    });
    const body = await next.json();
    assert.equal(body.id, "queenmate");
    assert.deepEqual(body.solution, ["g1g7"]);
    const script = await fetch(`http://127.0.0.1:${port}/_proxy/puzzles/chess.js`, { headers: { cookie } });
    assert.equal(script.status, 200);
    assert.match(await script.text(), /export function legalMoves/);
    assert.equal(upstream.length, 0);
  } finally {
    server.close();
  }
});
