import assert from "node:assert/strict";
import test from "node:test";
import { isMate, legalMoves, parseFen, playUci, san } from "../src/chess.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

function playLine(fen, moves) {
  let pos = parseFen(fen);
  for (const uci of moves) {
    const played = playUci(pos, uci);
    assert.ok(played, uci);
    pos = played.position;
  }
  return pos;
}

test("starting position has the twenty opening moves", () => {
  const moves = legalMoves(parseFen(START)).map((move) => move.uci);
  assert.equal(moves.length, 20);
  assert.equal(moves.includes("e2e4"), true);
  assert.equal(moves.includes("g1f3"), true);
  assert.equal(moves.includes("e1e2"), false);
});

test("castling, en passant, and promotion follow the rules", () => {
  const castle = legalMoves(parseFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1")).map((move) => move.uci);
  assert.equal(castle.includes("e1g1"), true);
  assert.equal(castle.includes("e1c1"), true);
  const throughCheck = legalMoves(parseFen("4k3/8/8/8/8/8/6r1/R3K2R w KQ - 0 1")).map((move) => move.uci);
  assert.equal(throughCheck.includes("e1g1"), false);
  assert.equal(throughCheck.includes("e1c1"), true);

  const ep = legalMoves(parseFen("rnbqkbnr/ppp2ppp/4p3/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3"));
  assert.equal(ep.some((move) => move.uci === "e5d6"), true);
  const after = playUci(parseFen("rnbqkbnr/ppp2ppp/4p3/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3"), "e5d6");
  assert.equal(after.position.board[35], null);

  const promo = legalMoves(parseFen("8/P7/8/8/8/8/8/4K2k w - - 0 1")).map((move) => move.uci);
  assert.deepEqual(promo.filter((uci) => uci.startsWith("a7a8")).sort(), ["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);
});

test("a pinned piece cannot move off the pin", () => {
  const moves = legalMoves(parseFen("4r2k/8/8/8/8/8/4R3/4K3 w - - 0 1")).map((move) => move.uci);
  assert.equal(moves.includes("e2e3"), true);
  assert.equal(moves.includes("e2d2"), false);
});

test("the crowded position has 48 legal moves", () => {
  const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
  assert.equal(legalMoves(parseFen(fen)).length, 48);
});

test("a puzzle line ends in mate and names the moves", () => {
  const fen = "6k1/ppp3pp/3b4/4p2q/4N1n1/3P2P1/PPP1Q1KP/R1B2r2 b - - 1 1";
  let pos = parseFen(fen);
  assert.equal(san(pos, "h5h2"), "Qxh2+");
  pos = playLine(fen, ["h5h2", "g2f1", "h2h1"]);
  assert.equal(isMate(pos), true);
});

test("the stored fallback lines are legal", () => {
  const backRank = playLine("1n4k1/5ppp/8/5N2/8/8/8/6QK w - - 0 1", ["g1g7"]);
  assert.equal(isMate(backRank), true);
  const promotion = playUci(parseFen("8/P7/8/8/8/8/8/k5K1 w - - 0 1"), "a7a8q");
  assert.ok(promotion);
  assert.equal(san(parseFen("8/P7/8/8/8/k7/8/6K1 w - - 0 1"), "a7a8q").startsWith("a8=Q"), true);
});
