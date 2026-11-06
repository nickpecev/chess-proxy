import { legalMoves, parseFen, playUci, san, squareIndex } from "./chess.js";

const PIECES = "/_c/images.chesscomfiles.com/chess-themes/pieces/neo/150";
const BOARD = "/_c/images.chesscomfiles.com/chess-themes/boards/green/150.png";

const THEMES = {
  mate: "Mate",
  mateIn1: "Mate in 1",
  mateIn2: "Mate in 2",
  mateIn3: "Mate in 3",
  mateIn4: "Mate in 4",
  fork: "Fork",
  pin: "Pin",
  skewer: "Skewer",
  sacrifice: "Sacrifice",
  discoveredAttack: "Discovered attack",
  hangingPiece: "Hanging piece",
  trappedPiece: "Trapped piece",
  exposedKing: "Exposed king",
  attraction: "Attraction",
  deflection: "Deflection",
  interference: "Interference",
  intermezzo: "Intermezzo",
  quietMove: "Quiet move",
  advancedPawn: "Advanced pawn",
  doubleCheck: "Double check",
  kingsideAttack: "Kingside attack",
  queensideAttack: "Queenside attack",
  clearance: "Clearance",
  xRayAttack: "X-ray",
  capturingDefender: "Remove the defender",
  backRankMate: "Back rank",
  smotheredMate: "Smothered mate",
  promotion: "Promotion",
  underPromotion: "Underpromotion",
  endgame: "Endgame",
  opening: "Opening",
  middlegame: "Middlegame",
  crushing: "Crushing",
  advantage: "Advantage",
  defensiveMove: "Defense",
  equality: "Equality",
};
const SKIP = new Set(["short", "long", "veryLong", "oneMove", "master"]);

const boardEl = document.querySelector("#board");
const headline = document.querySelector("#headline");
const detail = document.querySelector("#detail");
const movesEl = document.querySelector("#moves");
const themesEl = document.querySelector("#themes");
const statusEl = document.querySelector("#status");
const nextBtn = document.querySelector("#next");
const hintBtn = document.querySelector("#hint");
const solutionBtn = document.querySelector("#solution");
const levelEl = document.querySelector("#level");
const streakEl = document.querySelector("#streak");
const opponentRating = document.querySelector("#opponent-rating");
const selfSide = document.querySelector("#self-side");
const opponentAvatar = document.querySelector("#opponent-avatar");
const selfAvatar = document.querySelector("#self-avatar");

const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const savedLevel = sessionStorage.getItem("puzzle-level");
if (savedLevel) levelEl.value = savedLevel;

let puzzle = null;
let pos = null;
let ply = 0;
let misses = 0;
let streak = 0;
let mode = "loading";
let selected = null;
let hintLevel = 0;
let orientation = "w";
let busy = false;
let lastUci = "";
let played = [];
let drag = null;
let floatEl = null;
let audioCtx = null;

function wait(ms) {
  if (reduce) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pieceSvg(color, type) {
  return `<img alt="" draggable="false" src="${PIECES}/${color}${type}.png">`;
}

function sideName(color) {
  return color === "w" ? "White" : "Black";
}

function place(square) {
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  return {
    col: orientation === "w" ? file + 1 : 8 - file,
    row: orientation === "w" ? 8 - rank : rank + 1,
    file,
    rank,
  };
}

function canPlay() {
  return !busy && (mode === "play" || mode === "retry") && puzzle;
}

function blip(freq) {
  try {
    audioCtx = audioCtx || new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.045;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.09);
    osc.stop(audioCtx.currentTime + 0.1);
  } catch {
    /* sound is optional */
  }
}

function renderStatus() {
  statusEl.classList.toggle("good", mode === "solved");
  statusEl.classList.toggle("bad", mode === "failed");
  const turn = pos?.turn || "w";
  const copy = {
    loading: ["Finding a puzzle.", ""],
    play: [`${sideName(turn)} to move`, "Find the best move."],
    retry: ["Not the best move", "Try again."],
    solved: ["Correct", "That's the best move."],
    failed: ["Incorrect", "That's not the best move."],
  };
  const [title, sub] = copy[mode] || copy.loading;
  headline.textContent = title;
  detail.textContent = sub;
  nextBtn.hidden = mode !== "solved" && mode !== "failed";
  hintBtn.disabled = !canPlay();
  solutionBtn.disabled = mode === "loading" || mode === "solved" || !puzzle;
  streakEl.textContent = String(streak);
  themesEl.replaceChildren();
  for (const theme of puzzle?.themes || []) {
    if (SKIP.has(theme)) continue;
    const chip = document.createElement("span");
    chip.textContent = THEMES[theme] || theme.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
    themesEl.appendChild(chip);
  }
  movesEl.replaceChildren();
  for (const text of played) {
    const item = document.createElement("li");
    item.textContent = text;
    movesEl.appendChild(item);
  }
}

function render(options = {}) {
  if (!pos) return;
  const moves = legalMoves(pos);
  const marked = new Set();
  if (lastUci.length >= 4) {
    marked.add(lastUci.slice(0, 2));
    marked.add(lastUci.slice(2, 4));
  }
  const hinted = [];
  if (hintLevel > 0 && puzzle && ply < puzzle.solution.length) {
    hinted.push(puzzle.solution[ply].slice(0, 2));
    if (hintLevel > 1) hinted.push(puzzle.solution[ply].slice(2, 4));
  }
  boardEl.replaceChildren();
  for (let rank = 1; rank <= 8; rank += 1) {
    for (let file = 0; file < 8; file += 1) {
      const square = "abcdefgh"[file] + String(rank);
      const spot = place(square);
      const cell = document.createElement("div");
      cell.className = `square ${(file + rank) % 2 === 0 ? "dark" : "light"}`;
      cell.dataset.square = square;
      cell.style.gridColumn = String(spot.col);
      cell.style.gridRow = String(spot.row);
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", square);
      if (marked.has(square)) cell.classList.add("last");
      if (square === selected) cell.classList.add("selected");
      if (hinted.includes(square)) cell.classList.add("hint");
      if (options.bad && (square === options.bad.from || square === options.bad.to)) cell.classList.add("bad");
      if (spot.row === 8) {
        const fileLabel = document.createElement("span");
        fileLabel.className = "coord file";
        fileLabel.textContent = square[0];
        cell.appendChild(fileLabel);
      }
      if (spot.col === 1) {
        const rankLabel = document.createElement("span");
        rankLabel.className = "coord rank";
        rankLabel.textContent = square[1];
        cell.appendChild(rankLabel);
      }
      const piece = pos.board[squareIndex(square)];
      if (piece) {
        const token = document.createElement("span");
        token.className = "piece";
        if (drag && drag.from === square) token.classList.add("ghost");
        token.innerHTML = pieceSvg(piece.color, piece.type);
        cell.appendChild(token);
      }
      if (selected && canPlay()) {
        const option = moves.find((move) => move.from === selected && move.to === square);
        if (option) {
          const marker = document.createElement("span");
          marker.className = piece || square === pos.ep ? "ring" : "dot";
          cell.appendChild(marker);
        }
      }
      boardEl.appendChild(cell);
    }
  }
  if (options.animate && !reduce) {
    const to = options.animate.slice(2, 4);
    const from = options.animate.slice(0, 2);
    const piece = boardEl.querySelector(`[data-square="${to}"] .piece`);
    const fromCell = boardEl.querySelector(`[data-square="${from}"]`);
    const toCell = boardEl.querySelector(`[data-square="${to}"]`);
    if (piece && fromCell && toCell) {
      const a = fromCell.getBoundingClientRect();
      const b = toCell.getBoundingClientRect();
      piece.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px)`;
      requestAnimationFrame(() => {
        piece.style.transition = "transform 160ms ease-out";
        piece.style.transform = "translate(0, 0)";
      });
    }
  }
  renderStatus();
}

function paintFaces() {
  const you = orientation;
  const them = you === "w" ? "b" : "w";
  selfAvatar.innerHTML = pieceSvg(you, "k");
  opponentAvatar.innerHTML = pieceSvg(them, "k");
  selfSide.textContent = sideName(you);
  opponentRating.textContent = puzzle ? `Rated ${puzzle.rating}` : "";
}

async function loadPuzzle() {
  mode = "loading";
  puzzle = null;
  pos = null;
  played = [];
  selected = null;
  hintLevel = 0;
  misses = 0;
  boardEl.replaceChildren();
  renderStatus();
  const level = levelEl.value || "normal";
  sessionStorage.setItem("puzzle-level", level);
  const response = await fetch(`/_proxy/puzzles/next?difficulty=${encodeURIComponent(level)}`);
  if (!response.ok) throw new Error(String(response.status));
  puzzle = await response.json();
  pos = parseFen(puzzle.fen);
  orientation = pos.turn;
  ply = 0;
  lastUci = puzzle.lastMove || "";
  paintFaces();
  mode = "play";
  render();
}

function succeed() {
  mode = "solved";
  streak += 1;
  selected = null;
  blip(660);
  render();
}

async function reply() {
  busy = true;
  while (puzzle && ply < puzzle.solution.length && ply % 2 === 1) {
    const uci = puzzle.solution[ply];
    const step = playUci(pos, uci);
    if (!step) break;
    played.push(san(pos, uci));
    pos = step.position;
    lastUci = uci;
    ply += 1;
    render({ animate: uci });
    blip(440);
    await wait(220);
  }
  busy = false;
  if (ply >= puzzle.solution.length) succeed();
  else {
    mode = "play";
    render();
  }
}

async function playMove(uci) {
  if (!canPlay()) return;
  const expected = puzzle.solution[ply];
  const step = playUci(pos, uci);
  if (!step) return;
  selected = null;
  hintLevel = 0;
  if (uci !== expected) {
    misses += 1;
    busy = true;
    const before = pos;
    const marked = lastUci;
    pos = step.position;
    lastUci = uci;
    render({ animate: uci, bad: { from: uci.slice(0, 2), to: uci.slice(2, 4) } });
    blip(180);
    await wait(420);
    pos = before;
    lastUci = marked;
    busy = false;
    mode = misses >= 2 ? "failed" : "retry";
    if (mode === "failed") streak = 0;
    render();
    return;
  }
  played.push(san(pos, uci));
  pos = step.position;
  lastUci = uci;
  ply += 1;
  render({ animate: uci });
  blip(520);
  if (ply >= puzzle.solution.length) succeed();
  else await reply();
}

function choose(from, to) {
  const options = legalMoves(pos).filter((move) => move.from === from && move.to === to);
  if (options.length === 0) {
    const piece = pos.board[squareIndex(to)];
    if (piece && piece.color === pos.turn) {
      selected = to;
      render();
    }
    return;
  }
  if (options.length === 1) {
    playMove(options[0].uci);
    return;
  }
  const popup = document.createElement("div");
  popup.className = "promo";
  const spot = place(to);
  const cell = boardEl.querySelector(`[data-square="${to}"]`);
  const rect = cell.getBoundingClientRect();
  const boardRect = boardEl.getBoundingClientRect();
  popup.style.left = `${rect.left - boardRect.left}px`;
  popup.style.top = spot.row <= 4 ? `${rect.top - boardRect.top}px` : `${rect.bottom - boardRect.top - options.length * 64}px`;
  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.innerHTML = pieceSvg(pos.turn, option.promotion);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      popup.remove();
      playMove(option.uci);
    });
    popup.appendChild(button);
  }
  boardEl.appendChild(popup);
}

function clearFloat() {
  floatEl?.remove();
  floatEl = null;
  drag = null;
}

boardEl.addEventListener("pointerdown", (event) => {
  audioCtx?.resume?.();
  if (!canPlay()) return;
  const square = event.target.closest("[data-square]")?.dataset.square;
  if (!square) return;
  const piece = pos.board[squareIndex(square)];
  if (!piece || piece.color !== pos.turn) {
    if (selected) choose(selected, square);
    return;
  }
  selected = square;
  drag = { from: square, x: event.clientX, y: event.clientY, moved: false, pointer: event.pointerId };
  try {
    boardEl.setPointerCapture(event.pointerId);
  } catch {
    /* a tap still selects the piece when capture is unavailable */
  }
  render();
  event.preventDefault();
});

boardEl.addEventListener("pointermove", (event) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 6) drag.moved = true;
  if (!drag.moved) return;
  const piece = pos.board[squareIndex(drag.from)];
  if (!floatEl && piece) {
    floatEl = document.createElement("div");
    floatEl.className = "float";
    floatEl.innerHTML = pieceSvg(piece.color, piece.type);
    document.body.appendChild(floatEl);
  }
  if (floatEl) {
    floatEl.style.left = `${event.clientX}px`;
    floatEl.style.top = `${event.clientY}px`;
  }
});

boardEl.addEventListener("pointerup", (event) => {
  if (!drag || event.pointerId !== drag.pointer) return;
  const from = drag.from;
  const moved = drag.moved;
  clearFloat();
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.("[data-square]")?.dataset.square;
  if (moved && target) choose(from, target);
  else if (!moved) {
    selected = from;
    render();
  }
});

boardEl.addEventListener("pointercancel", () => {
  clearFloat();
  render();
});

hintBtn.addEventListener("click", () => {
  if (!canPlay()) return;
  hintLevel = Math.min(2, hintLevel + 1);
  selected = puzzle.solution[ply].slice(0, 2);
  render();
});

solutionBtn.addEventListener("click", async () => {
  if (!puzzle || mode === "loading" || mode === "solved" || busy) return;
  busy = true;
  streak = 0;
  selected = null;
  while (ply < puzzle.solution.length) {
    const uci = puzzle.solution[ply];
    const step = playUci(pos, uci);
    if (!step) break;
    played.push(san(pos, uci));
    pos = step.position;
    lastUci = uci;
    ply += 1;
    render({ animate: uci });
    await wait(260);
  }
  busy = false;
  mode = "failed";
  render();
});

nextBtn.addEventListener("click", () => {
  loadPuzzle().catch(() => {
    mode = "failed";
    headline.textContent = "Couldn't load a puzzle.";
    detail.textContent = "Try again.";
    nextBtn.hidden = false;
  });
});

levelEl.addEventListener("change", () => nextBtn.click());

opponentAvatar.innerHTML = pieceSvg("b", "k");
selfAvatar.innerHTML = pieceSvg("w", "k");
const boardArt = new Image();
boardArt.onload = () => boardEl.classList.add("skinned");
boardArt.src = BOARD;
loadPuzzle().catch(() => {
  headline.textContent = "Couldn't load a puzzle.";
  detail.textContent = "Try again.";
  nextBtn.hidden = false;
});
