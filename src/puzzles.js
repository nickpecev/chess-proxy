import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFen, playUci } from "./chess.js";

const LEVELS = new Set(["easiest", "easier", "normal", "harder", "hardest"]);
const MOVE = /^[a-h][1-8][a-h][1-8][nbrq]?$/;

const FALLBACK = [
  {
    id: "queenmate",
    rating: 900,
    themes: ["mateIn1"],
    fen: "1n4k1/5ppp/8/5N2/8/8/8/6QK w - - 0 1",
    solution: ["g1g7"],
    lastMove: "",
  },
  {
    id: "backrank",
    rating: 850,
    themes: ["mateIn1", "backRankMate"],
    fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
    solution: ["e1e8"],
    lastMove: "",
  },
  {
    id: "queenstep",
    rating: 880,
    themes: ["mateIn1"],
    fen: "6k1/4Q3/6K1/8/8/8/8/8 w - - 0 1",
    solution: ["e7g7"],
    lastMove: "",
  },
  {
    id: "smother",
    rating: 1100,
    themes: ["mateIn1", "smotheredMate"],
    fen: "6rk/5ppp/8/6N1/8/8/8/7K w - - 0 1",
    solution: ["g5f7"],
    lastMove: "",
  },
  {
    id: "qside",
    rating: 920,
    themes: ["mateIn1"],
    fen: "7k/8/5K2/8/8/8/6Q1/8 w - - 0 1",
    solution: ["g2g7"],
    lastMove: "",
  },
  {
    id: "pawnmate",
    rating: 860,
    themes: ["mateIn1", "promotion"],
    fen: "6k1/4P3/6K1/8/8/8/8/8 w - - 0 1",
    solution: ["e7e8q"],
    lastMove: "",
  },
  {
    id: "rooktake",
    rating: 980,
    themes: ["mateIn1", "backRankMate"],
    fen: "4r1k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1",
    solution: ["e1e8"],
    lastMove: "",
  },
  {
    id: "fork",
    rating: 1050,
    themes: ["fork"],
    fen: "r3k3/8/8/3N4/8/8/8/4K3 w - - 0 1",
    solution: ["d5c7", "e8d8", "c7a8"],
    lastMove: "",
  },
  {
    id: "promote",
    rating: 800,
    themes: ["promotion"],
    fen: "8/P7/8/8/8/8/8/k5K1 w - - 0 1",
    solution: ["a7a8q"],
    lastMove: "",
  },
  {
    id: "l3Psw",
    rating: 1354,
    themes: ["mateIn2", "sacrifice"],
    fen: "6k1/ppp3pp/3b4/4p2q/4N1n1/3P2P1/PPP1Q1KP/R1B2r2 b - - 1 1",
    solution: ["h5h2", "g2f1", "h2h1"],
    lastMove: "h1g2",
  },
];

const ASSETS = {
  "/_proxy/puzzles/app.js": readFileSync(join(dirname(fileURLToPath(import.meta.url)), "puzzle-app.js")),
  "/_proxy/puzzles/chess.js": readFileSync(join(dirname(fileURLToPath(import.meta.url)), "chess.js")),
};

export function linePlays(fen, solution) {
  try {
    let pos = parseFen(fen);
    for (const uci of solution) {
      const played = playUci(pos, uci);
      if (!played) return false;
      pos = played.position;
    }
    return true;
  } catch {
    return false;
  }
}

export function normalizePuzzle(body) {
  const puzzle = body?.puzzle;
  if (!puzzle || typeof puzzle !== "object") return null;
  const fen = String(puzzle.fen || "");
  const solution = Array.isArray(puzzle.solution) ? puzzle.solution.map(String) : [];
  if (solution.length === 0 || solution.some((move) => !MOVE.test(move))) return null;
  const lastMove = MOVE.test(String(puzzle.lastMove || "")) ? String(puzzle.lastMove) : "";
  const themes = Array.isArray(puzzle.themes)
    ? puzzle.themes.filter((theme) => typeof theme === "string" && /^[A-Za-z0-9]+$/.test(theme)).slice(0, 8)
    : [];
  const next = {
    id: String(puzzle.id || "puzzle").replace(/[^A-Za-z0-9]/g, "").slice(0, 16) || "puzzle",
    rating: Number.isFinite(Number(puzzle.rating)) ? Math.max(0, Math.round(Number(puzzle.rating))) : 1500,
    themes,
    fen,
    solution,
    lastMove,
  };
  return linePlays(next.fen, next.solution) ? next : null;
}

function shuffle(list) {
  const copy = list.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

async function requestBatch(fetchImpl, difficulty) {
  const response = await fetchImpl(
    `https://lichess.org/api/puzzle/batch/mix?difficulty=${difficulty}&nb=20`,
    {
      headers: {
        accept: "application/json",
        "user-agent": "chess-proxy puzzle trainer (personal use)",
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (response.status === 429) throw new Error("429");
  if (!response.ok) throw new Error(String(response.status));
  const body = await response.json();
  const list = Array.isArray(body?.puzzles) ? body.puzzles : [body];
  const puzzles = [];
  for (const item of list) {
    const puzzle = normalizePuzzle(item);
    if (puzzle) puzzles.push(puzzle);
  }
  if (puzzles.length === 0) throw new Error("empty");
  return puzzles;
}

export function createPuzzleSource(fetchImpl = globalThis.fetch) {
  const queues = new Map();
  const inflight = new Map();
  const stock = [];
  let lastId = "";
  let blockedUntil = 0;

  function remember(puzzles) {
    const fresh = [];
    for (const puzzle of puzzles) {
      if (stock.some((saved) => saved.id === puzzle.id)) continue;
      stock.push(puzzle);
      fresh.push(puzzle);
      if (stock.length > 80) stock.shift();
    }
    return fresh;
  }

  function reuse() {
    const pool = stock.length > 0 ? stock : FALLBACK;
    const queue = shuffle(pool);
    if (queue.length > 1 && queue[0].id === lastId) queue.push(queue.shift());
    return queue;
  }

  return async function nextPuzzle(requested) {
    const difficulty = LEVELS.has(requested) ? requested : "normal";
    if (!queues.get(difficulty)?.length) {
      let job = inflight.get(difficulty);
      if (!job) {
        job = (Date.now() < blockedUntil ? Promise.reject(new Error("429")) : requestBatch(fetchImpl, difficulty))
          .then((puzzles) => {
            const fresh = remember(puzzles);
            return fresh.length > 0 ? fresh : reuse();
          })
          .catch((error) => {
            if (String(error?.message || error) === "429") blockedUntil = Date.now() + 15 * 60 * 1000;
            return reuse();
          })
          .finally(() => inflight.delete(difficulty));
        inflight.set(difficulty, job);
      }
      const filled = await job;
      if (!queues.get(difficulty)?.length) queues.set(difficulty, filled);
    }
    const puzzle = queues.get(difficulty).shift();
    lastId = puzzle.id;
    return puzzle;
  };
}

export function puzzleHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Puzzles</title>
<style>
  :root {
    color-scheme: dark;
    --ink: #fff;
    --muted: #b0aea9;
    --bg: #312e2b;
    --panel: #262421;
    --raised: #3c3a38;
    --line: #454341;
    --green: #81b64c;
    --good: #7fa650;
    --bad: #c84545;
    --light: #ebecd0;
    --dark: #739552;
    --highlight: rgba(255, 255, 51, .5);
    font-family: "Segoe UI", "Avenir Next", "Trebuchet MS", sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--ink); }
  body { min-height: 100dvh; }
  button, select, a { font: inherit; color: inherit; }
  button, select { cursor: pointer; }
  button:focus-visible, select:focus-visible, a:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
  .shell { min-height: 100dvh; display: grid; grid-template-columns: minmax(0, 1fr) 400px; }
  .stage { display: flex; align-items: center; justify-content: center; padding: 16px 20px; }
  .stage { height: 100dvh; }
  .table { width: min(100%, calc(100dvh - 148px)); }
  .player { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 2px; }
  .avatar { width: 38px; height: 38px; border-radius: 4px; display: grid; place-items: center; background: #3c3a38; flex: 0 0 auto; overflow: hidden; }
  .avatar img { width: 30px; height: 30px; object-fit: contain; }
  .who { min-width: 0; }
  .who strong { display: block; font-size: 17px; line-height: 1.1; }
  .who span { color: var(--muted); font-size: 13px; }
  .clock { margin-left: auto; color: var(--muted); font-weight: 700; font-size: 15px; }
  .board { position: relative; width: 100%; aspect-ratio: 1; display: grid; grid-template-columns: repeat(8, 1fr); grid-template-rows: repeat(8, 1fr); touch-action: none; user-select: none; }
  .board.skinned { background: url("/_c/images.chesscomfiles.com/chess-themes/boards/green/150.png") 0 0 / 100% 100% no-repeat; }
  .square { position: relative; display: grid; place-items: center; }
  .square.light { background: var(--light); color: var(--dark); }
  .square.dark { background: var(--dark); color: var(--light); }
  .board.skinned .square.light, .board.skinned .square.dark { background: transparent; }
  .square.last::after, .square.selected::after, .square.bad::after { content: ""; position: absolute; inset: 0; background: var(--highlight); pointer-events: none; }
  .square.bad::after { background: rgba(235, 97, 80, .7); }
  .square.hint { box-shadow: inset 0 0 0 3px rgba(255, 170, 0, .9); }
  .coord { position: absolute; font-size: 11px; font-weight: 700; line-height: 1; pointer-events: none; z-index: 1; }
  .coord.file { right: 2px; bottom: 1px; }
  .coord.rank { left: 2px; top: 1px; }
  .piece { width: 100%; height: 100%; display: grid; place-items: center; z-index: 1; }
  .piece img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
  .piece.ghost { opacity: .35; }
  .dot, .ring { position: absolute; pointer-events: none; z-index: 1; }
  .dot { width: 18%; height: 18%; border-radius: 50%; background: rgba(0, 0, 0, .2); }
  .ring { inset: 0; background: radial-gradient(circle, transparent 62%, rgba(0, 0, 0, .2) 63%); }
  .float { position: fixed; width: 78px; height: 78px; margin: -39px 0 0 -39px; pointer-events: none; z-index: 5; filter: drop-shadow(0 8px 8px rgba(0,0,0,.45)); }
  .float img { width: 100%; height: 100%; object-fit: contain; }
  .promo { position: absolute; z-index: 4; display: flex; flex-direction: column; background: #fff; border-radius: 6px; overflow: hidden; box-shadow: 0 10px 28px rgba(0,0,0,.4); }
  .promo button { width: 72px; height: 72px; border: 0; background: #fff; padding: 4px; }
  .promo img { width: 100%; height: 100%; object-fit: contain; }
  .promo button + button { border-top: 1px solid #e4e4e4; }
  .panel { background: var(--panel); display: flex; flex-direction: column; border-left: 1px solid #1b1917; min-width: 0; height: 100dvh; overflow: auto; }
  .panel-head { display: flex; align-items: center; gap: 8px; height: 64px; padding: 0 16px; border-bottom: 1px solid var(--line); }
  .back { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 8px; text-decoration: none; font-size: 22px; }
  .back:hover { background: var(--raised); }
  .panel-head h1 { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.03em; }
  .streak { margin-left: auto; text-align: right; }
  .streak b { display: block; font-size: 22px; line-height: 1; }
  .streak span { color: var(--muted); font-size: 12px; }
  .status { flex: 1; display: flex; flex-direction: column; justify-content: center; padding: 28px 24px 12px; }
  .status.good { background: var(--good); color: #fff; }
  .status.bad { background: var(--bad); color: #fff; }
  .headline { margin: 0; font-size: 34px; line-height: 1.05; letter-spacing: -0.035em; }
  .detail { margin: 8px 0 0; font-size: 18px; color: var(--muted); }
  .status.good .detail, .status.bad .detail { color: rgba(255,255,255,.88); }
  .moves { margin: 18px 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 8px 14px; font-size: 16px; font-weight: 650; }
  .themes { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
  .themes span { background: var(--raised); color: #eee; border-radius: 999px; padding: 5px 10px; font-size: 13px; }
  .status.good .themes span, .status.bad .themes span { background: rgba(0,0,0,.16); }
  .actions { padding: 16px 20px 20px; display: flex; flex-direction: column; gap: 10px; }
  .next, .tools button, .level { border: 0; border-radius: 8px; background: var(--raised); color: white; }
  .next { height: 52px; font-size: 18px; font-weight: 750; background: var(--green); color: #fff; }
  .status.good .next, .status.bad .next { background: #fff; color: #262421; }
  .next[hidden] { display: none; }
  .tools { display: flex; gap: 8px; }
  .tools button, .level { height: 44px; font-weight: 650; }
  .tools button { flex: 1; }
  .level { width: 100%; padding: 0 12px; }
  .credit { margin: 2px 0 0; color: #8d8b88; font-size: 12px; }
  @media (max-width: 860px) {
    .shell { grid-template-columns: 1fr; }
    .stage { height: auto; padding: 8px 8px 0; }
    .table { width: min(calc(100vw - 16px), 68dvh); margin: 0 auto; }
    .panel { border-left: 0; height: auto; overflow: visible; }
    .status { min-height: 180px; }
    .headline { font-size: 30px; }
  }
  @media (prefers-reduced-motion: reduce) {
    .piece { transition: none !important; }
  }
</style>
</head>
<body>
<div class="shell">
  <main class="stage">
    <div class="table">
      <div class="player" id="opponent">
        <div class="avatar" id="opponent-avatar"></div>
        <div class="who"><strong>Puzzle</strong><span id="opponent-rating"></span></div>
      </div>
      <div class="board" id="board" role="grid" aria-label="Chess board"></div>
      <div class="player" id="self">
        <div class="avatar" id="self-avatar"></div>
        <div class="who"><strong>You</strong><span id="self-side"></span></div>
      </div>
    </div>
  </main>
  <aside class="panel">
    <header class="panel-head">
      <a class="back" href="/play/computer" aria-label="Back to bots">‹</a>
      <h1>Puzzles</h1>
      <div class="streak"><b id="streak">0</b><span>streak</span></div>
    </header>
    <section class="status" id="status" aria-live="polite">
      <h2 class="headline" id="headline">Finding a puzzle.</h2>
      <p class="detail" id="detail"></p>
      <ol class="moves" id="moves"></ol>
      <div class="themes" id="themes"></div>
      <button class="next" id="next" hidden type="button">Next puzzle</button>
    </section>
    <div class="actions">
      <div class="tools">
        <button id="hint" type="button">Hint</button>
        <button id="solution" type="button">Solution</button>
      </div>
      <select class="level" id="level" aria-label="Difficulty">
        <option value="easier">Easier</option>
        <option value="normal" selected>Normal</option>
        <option value="harder">Harder</option>
      </select>
      <p class="credit">Puzzles from Lichess</p>
    </div>
  </aside>
</div>
<script type="module" src="/_proxy/puzzles/app.js"></script>
</body>
</html>`;
}

export function createPuzzleHandler(fetchImpl) {
  const nextPuzzle = createPuzzleSource(fetchImpl);
  return async function handlePuzzle(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { allow: "GET, HEAD", "cache-control": "no-store" });
      res.end();
      return;
    }
    const url = new URL(req.url || "/", "http://puzzle.local");
    const asset = ASSETS[url.pathname];
    if (asset) {
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : asset);
      return;
    }
    if (url.pathname === "/_proxy/puzzles/next") {
      const puzzle = await nextPuzzle(url.searchParams.get("difficulty"));
      const body = JSON.stringify(puzzle);
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(req.method === "HEAD" ? undefined : body);
      return;
    }
    const html = puzzleHtml();
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; img-src 'self'; connect-src 'self'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "same-origin",
    });
    res.end(req.method === "HEAD" ? undefined : html);
  };
}
