const FILES = "abcdefgh";
const TYPES = "pnbrqk";

const KNIGHT = [
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
];
const KING = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const BISHOP = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];
const ROOK = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

export function opponent(color) {
  return color === "w" ? "b" : "w";
}

export function squareIndex(square) {
  if (typeof square !== "string" || square.length !== 2) return -1;
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]) - 1;
  if (file < 0 || rank < 0 || rank > 7) return -1;
  return rank * 8 + file;
}

export function indexSquare(index) {
  return FILES[index % 8] + String(Math.floor(index / 8) + 1);
}

function onBoard(file, rank) {
  return file >= 0 && file < 8 && rank >= 0 && rank < 8;
}

export function parseFen(fen) {
  const parts = String(fen || "").trim().split(/\s+/);
  if (parts.length < 4) throw new Error("bad fen");
  const board = Array(64).fill(null);
  let rank = 7;
  let file = 0;
  for (const char of parts[0]) {
    if (char === "/") {
      rank -= 1;
      file = 0;
      continue;
    }
    if (char >= "1" && char <= "8") {
      file += Number(char);
      continue;
    }
    const type = char.toLowerCase();
    if (!TYPES.includes(type) || file > 7 || rank < 0) throw new Error("bad fen");
    board[rank * 8 + file] = { color: char === type ? "b" : "w", type };
    file += 1;
  }
  if (rank !== 0 || file !== 8) throw new Error("bad fen");
  const ep = parts[3] === "-" ? null : parts[3];
  if (ep && squareIndex(ep) < 0) throw new Error("bad fen");
  return {
    board,
    turn: parts[1] === "b" ? "b" : "w",
    castling: /^[KQkq]+$/.test(parts[2]) ? parts[2] : "-",
    ep,
    halfmove: Number(parts[4] || 0),
    fullmove: Number(parts[5] || 1),
  };
}

function clone(pos) {
  return {
    board: pos.board.slice(),
    turn: pos.turn,
    castling: pos.castling,
    ep: pos.ep,
    halfmove: pos.halfmove,
    fullmove: pos.fullmove,
  };
}

function findKing(pos, color) {
  return pos.board.findIndex((piece) => piece && piece.color === color && piece.type === "k");
}

export function isAttacked(pos, index, byColor) {
  const file = index % 8;
  const rank = Math.floor(index / 8);
  const board = pos.board;
  const pawnRank = rank + (byColor === "w" ? -1 : 1);
  for (const df of [-1, 1]) {
    const sourceFile = file + df;
    if (!onBoard(sourceFile, pawnRank)) continue;
    const piece = board[pawnRank * 8 + sourceFile];
    if (piece && piece.color === byColor && piece.type === "p") return true;
  }
  for (const [df, dr] of KNIGHT) {
    const f = file + df;
    const r = rank + dr;
    if (!onBoard(f, r)) continue;
    const piece = board[r * 8 + f];
    if (piece && piece.color === byColor && piece.type === "n") return true;
  }
  for (const [df, dr] of KING) {
    const f = file + df;
    const r = rank + dr;
    if (!onBoard(f, r)) continue;
    const piece = board[r * 8 + f];
    if (piece && piece.color === byColor && piece.type === "k") return true;
  }
  const slide = (dirs, types) => {
    for (const [df, dr] of dirs) {
      let f = file + df;
      let r = rank + dr;
      while (onBoard(f, r)) {
        const piece = board[r * 8 + f];
        if (piece) {
          if (piece.color === byColor && types.includes(piece.type)) return true;
          break;
        }
        f += df;
        r += dr;
      }
    }
    return false;
  };
  return slide(BISHOP, "bq") || slide(ROOK, "rq");
}

export function inCheck(pos) {
  const king = findKing(pos, pos.turn);
  return king >= 0 && isAttacked(pos, king, opponent(pos.turn));
}

function dropCastling(rights, flag) {
  const next = rights.replace(flag, "");
  return next || "-";
}

function applyUnchecked(pos, move) {
  const next = clone(pos);
  const from = squareIndex(move.from);
  const to = squareIndex(move.to);
  const piece = next.board[from];
  const captured = next.board[to];
  next.board[to] = move.promotion ? { color: piece.color, type: move.promotion } : piece;
  next.board[from] = null;
  let capture = Boolean(captured);
  if (piece.type === "k" && Math.abs((to % 8) - (from % 8)) === 2) {
    const rank = Math.floor(from / 8);
    if (to % 8 === 6) {
      next.board[rank * 8 + 5] = next.board[rank * 8 + 7];
      next.board[rank * 8 + 7] = null;
    } else {
      next.board[rank * 8 + 3] = next.board[rank * 8];
      next.board[rank * 8] = null;
    }
  }
  if (piece.type === "p" && move.to === pos.ep) {
    const cap = to + (piece.color === "w" ? -8 : 8);
    next.board[cap] = null;
    capture = true;
  }
  if (piece.type === "k") {
    next.castling = piece.color === "w" ? dropCastling(dropCastling(next.castling, "K"), "Q") : dropCastling(dropCastling(next.castling, "k"), "q");
  }
  if (piece.type === "r") {
    if (move.from === "h1") next.castling = dropCastling(next.castling, "K");
    if (move.from === "a1") next.castling = dropCastling(next.castling, "Q");
    if (move.from === "h8") next.castling = dropCastling(next.castling, "k");
    if (move.from === "a8") next.castling = dropCastling(next.castling, "q");
  }
  if (captured?.type === "r") {
    if (move.to === "h1") next.castling = dropCastling(next.castling, "K");
    if (move.to === "a1") next.castling = dropCastling(next.castling, "Q");
    if (move.to === "h8") next.castling = dropCastling(next.castling, "k");
    if (move.to === "a8") next.castling = dropCastling(next.castling, "q");
  }
  next.ep = null;
  if (piece.type === "p" && Math.abs(Math.floor(to / 8) - Math.floor(from / 8)) === 2) {
    next.ep = indexSquare(from + (piece.color === "w" ? 8 : -8));
  }
  next.halfmove = piece.type === "p" || capture ? 0 : pos.halfmove + 1;
  next.fullmove = pos.turn === "b" ? pos.fullmove + 1 : pos.fullmove;
  next.turn = opponent(pos.turn);
  return next;
}

function push(list, from, to, promotion) {
  list.push({
    from: indexSquare(from),
    to: indexSquare(to),
    promotion: promotion || "",
    uci: indexSquare(from) + indexSquare(to) + (promotion || ""),
  });
}

function pseudoMoves(pos) {
  const moves = [];
  const color = pos.turn;
  const forward = color === "w" ? 1 : -1;
  const home = color === "w" ? 1 : 6;
  const last = color === "w" ? 7 : 0;
  for (let index = 0; index < 64; index += 1) {
    const piece = pos.board[index];
    if (!piece || piece.color !== color) continue;
    const file = index % 8;
    const rank = Math.floor(index / 8);
    if (piece.type === "p") {
      const one = rank + forward;
      const quiet = one * 8 + file;
      if (onBoard(file, one) && !pos.board[quiet]) {
        if (one === last) {
          for (const promotion of ["q", "r", "b", "n"]) push(moves, index, quiet, promotion);
        } else {
          push(moves, index, quiet);
          const twoRank = rank + forward * 2;
          const two = twoRank * 8 + file;
          if (rank === home && !pos.board[two]) push(moves, index, two);
        }
      }
      for (const df of [-1, 1]) {
        const f = file + df;
        const target = one * 8 + f;
        if (!onBoard(f, one)) continue;
        const occupant = pos.board[target];
        const enPassant = indexSquare(target) === pos.ep;
        if ((occupant && occupant.color !== color) || enPassant) {
          if (one === last) {
            for (const promotion of ["q", "r", "b", "n"]) push(moves, index, target, promotion);
          } else push(moves, index, target);
        }
      }
      continue;
    }
    if (piece.type === "n" || piece.type === "k") {
      for (const [df, dr] of piece.type === "n" ? KNIGHT : KING) {
        const f = file + df;
        const r = rank + dr;
        if (!onBoard(f, r)) continue;
        const occupant = pos.board[r * 8 + f];
        if (!occupant || occupant.color !== color) push(moves, index, r * 8 + f);
      }
      continue;
    }
    const dirs = piece.type === "b" ? BISHOP : piece.type === "r" ? ROOK : BISHOP.concat(ROOK);
    for (const [df, dr] of dirs) {
      let f = file + df;
      let r = rank + dr;
      while (onBoard(f, r)) {
        const occupant = pos.board[r * 8 + f];
        if (!occupant) push(moves, index, r * 8 + f);
        else {
          if (occupant.color !== color) push(moves, index, r * 8 + f);
          break;
        }
        f += df;
        r += dr;
      }
    }
  }
  const rank = color === "w" ? 0 : 7;
  const king = rank * 8 + 4;
  const piece = pos.board[king];
  if (piece?.type === "k" && piece.color === color) {
    const enemy = opponent(color);
    const flag = (side) => (color === "w" ? (side === "k" ? "K" : "Q") : side === "k" ? "k" : "q");
    if (
      pos.castling.includes(flag("k")) &&
      !pos.board[rank * 8 + 5] &&
      !pos.board[rank * 8 + 6] &&
      pos.board[rank * 8 + 7]?.type === "r" &&
      !isAttacked(pos, king, enemy) &&
      !isAttacked(pos, rank * 8 + 5, enemy) &&
      !isAttacked(pos, rank * 8 + 6, enemy)
    ) {
      push(moves, king, rank * 8 + 6);
    }
    if (
      pos.castling.includes(flag("q")) &&
      !pos.board[rank * 8 + 1] &&
      !pos.board[rank * 8 + 2] &&
      !pos.board[rank * 8 + 3] &&
      pos.board[rank * 8]?.type === "r" &&
      !isAttacked(pos, king, enemy) &&
      !isAttacked(pos, rank * 8 + 3, enemy) &&
      !isAttacked(pos, rank * 8 + 2, enemy)
    ) {
      push(moves, king, rank * 8 + 2);
    }
  }
  return moves;
}

export function legalMoves(pos) {
  const king = findKing(pos, pos.turn);
  return pseudoMoves(pos).filter((move) => {
    const next = applyUnchecked(pos, move);
    const movedKing = findKing(next, pos.turn);
    return movedKing >= 0 && !isAttacked(next, movedKing, next.turn) && king >= 0;
  });
}

export function playUci(pos, uci) {
  const move = legalMoves(pos).find((item) => item.uci === uci);
  if (!move) return null;
  return { position: applyUnchecked(pos, move), move };
}

export function isMate(pos) {
  return inCheck(pos) && legalMoves(pos).length === 0;
}

export function san(pos, uci) {
  const moves = legalMoves(pos);
  const move = moves.find((item) => item.uci === uci);
  if (!move) return uci;
  const from = squareIndex(move.from);
  const piece = pos.board[from];
  if (piece.type === "k" && move.to === "g1" && move.from === "e1") return finish(pos, move, "O-O");
  if (piece.type === "k" && move.to === "c1" && move.from === "e1") return finish(pos, move, "O-O-O");
  if (piece.type === "k" && move.to === "g8" && move.from === "e8") return finish(pos, move, "O-O");
  if (piece.type === "k" && move.to === "c8" && move.from === "e8") return finish(pos, move, "O-O-O");
  const capture = Boolean(pos.board[squareIndex(move.to)]) || (piece.type === "p" && move.to === pos.ep);
  let text = "";
  if (piece.type !== "p") {
    text += piece.type.toUpperCase();
    const others = moves.filter((item) => {
      if (item.uci === move.uci || item.to !== move.to || item.promotion !== move.promotion) return false;
      return pos.board[squareIndex(item.from)]?.type === piece.type;
    });
    if (others.length) {
      const sameFile = others.some((item) => item.from[0] === move.from[0]);
      const sameRank = others.some((item) => item.from[1] === move.from[1]);
      if (!sameFile) text += move.from[0];
      else if (!sameRank) text += move.from[1];
      else text += move.from;
    }
  } else if (capture) text += move.from[0];
  if (capture) text += "x";
  text += move.to;
  if (move.promotion) text += `=${move.promotion.toUpperCase()}`;
  return finish(pos, move, text);
}

function finish(pos, move, text) {
  const next = applyUnchecked(pos, move);
  if (!inCheck(next)) return text;
  return text + (legalMoves(next).length === 0 ? "#" : "+");
}
