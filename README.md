# Chess proxy

A private reverse proxy for playing on Chess.com from a network that blocks that site. It only connects to Chess.com, Chess.com’s file hosts, and Cloudflare’s Turnstile host. It is not an open proxy.

Your Chess.com password is typed into Chess.com’s own login form. That login is forwarded to Chess.com and is not written to the log. The server password only unlocks this proxy.

## Run it on this computer

```powershell
node --test
npm start
```

Open http://127.0.0.1:8080 . This listen address is only reachable on the same computer, so no server password is required.

## Run it where the blocked network can reach it

Use a small VPS and HTTPS. Browsers need HTTPS for a stable login cookie and for live games.

```powershell
$env:NODE_ENV = "production"
$env:BIND_HOST = "0.0.0.0"
$env:PROXY_ACCESS_KEY = "a long passphrase you choose"
$env:SESSION_SECRET = node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
$env:PUBLIC_ORIGIN = "https://chess.example.com"
$env:TRUST_PROXY = "1"
npm start
```

Put Caddy, or another TLS reverse proxy, in front and leave WebSockets enabled:

```
chess.example.com {
  reverse_proxy localhost:8080
}
```

Docker uses the same variables. The image refuses to serve publicly until `PROXY_ACCESS_KEY` and `SESSION_SECRET` are set.

```powershell
docker build -t chess-proxy .
docker run --rm -p 8080:8080 -e PROXY_ACCESS_KEY=... -e SESSION_SECRET=... -e PUBLIC_ORIGIN=https://chess.example.com -e TRUST_PROXY=1 chess-proxy
```

Then open the site, enter the server password, and sign in to Chess.com as usual.

## What it deliberately does not do

- It does not fetch arbitrary URLs. Hosts other than Chess.com’s are refused, including addresses that only look similar.
- It does not record request bodies, cookies, or the server password.
- It removes the proxy’s own cookie before forwarding a request.
- It drops forwarding headers that would send your network address to Chess.com.
- Login attempts on the server password are slowed and capped.

Live play depends on Chess.com staying reachable from the machine running this proxy, and on that machine’s address not being blocked by Chess.com. Ads and the cookie-consent script are left on their own domains. Cloudflare Turnstile is tied to Chess.com’s domain, so a new account or a bot check can still fail even when the board itself loads. Host this yourself. Someone else’s copy of this proxy can see the Chess.com password you type.
