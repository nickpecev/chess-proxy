export function gateHtml(error) {
  const message =
    error === "limited"
      ? "Too many attempts. Wait a few minutes and try again."
      : error === "mismatch"
        ? "That password does not match."
        : "";
  const alert = message ? `<p class="alert" role="alert">${message}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Take a seat</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body {
    background-color: #e7d5ae;
    background-image:
      linear-gradient(45deg, #1d4332 25%, transparent 25%),
      linear-gradient(-45deg, #1d4332 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #1d4332 75%),
      linear-gradient(-45deg, transparent 75%, #1d4332 75%);
    background-size: 92px 92px;
    background-position: 0 0, 0 46px, 46px -46px, -46px 0;
    color: #241c16;
    font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
  }
  main {
    width: min(26rem, calc(100% - 2rem));
    margin: 14vh 7vw 3rem;
    padding: 1.6rem 1.45rem 1.35rem;
    background: #f6f0e3;
    box-shadow: 8px 10px 0 rgba(24, 36, 28, 0.22);
  }
  h1 { margin: 0 0 0.4rem; font-size: 2.4rem; font-weight: 600; letter-spacing: -0.03em; line-height: 0.95; }
  p { margin: 0 0 1.1rem; max-width: 34ch; line-height: 1.45; font-size: 1.05rem; }
  label { display: block; margin-bottom: 0.35rem; font-family: Candara, "Segoe UI", sans-serif; font-size: 0.95rem; }
  input {
    width: 100%;
    padding: 0.7rem 0.75rem;
    border: 1px solid #241c16;
    background: #fffaf1;
    color: #241c16;
    font: 1rem Candara, "Segoe UI", sans-serif;
  }
  input:focus { outline: 2px solid #241c16; outline-offset: 2px; }
  button {
    margin-top: 0.85rem;
    padding: 0.65rem 1rem;
    border: 0;
    background: #8c2f2f;
    color: #fff8ef;
    font: 600 1rem Candara, "Segoe UI", sans-serif;
    cursor: pointer;
  }
  button:focus { outline: 2px solid #241c16; outline-offset: 3px; }
  .alert { color: #8c2f2f; margin-bottom: 0.8rem; }
  @media (max-width: 640px) {
    main { margin: 1.25rem auto; }
  }
</style>
</head>
<body>
<main>
  <h1>Take a seat.</h1>
  <p>Enter the server password. Chess.com asks for your account on the next screen.</p>
  ${alert}
  <form method="post" action="/_proxy/unlock">
    <label for="password">Server password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">
    <button type="submit">Unlock</button>
  </form>
</main>
</body>
</html>`;
}
