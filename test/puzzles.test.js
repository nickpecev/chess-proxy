import assert from "node:assert/strict";
import test from "node:test";
import { createPuzzleSource } from "../src/puzzles.js";

const queen = {
  puzzle: {
    id: "aaa111",
    rating: 900,
    themes: ["mateIn1"],
    fen: "1n4k1/5ppp/8/5N2/8/8/8/6QK w - - 0 1",
    solution: ["g1g7"],
  },
};
const promote = {
  puzzle: {
    id: "bbb222",
    rating: 800,
    themes: ["promotion"],
    fen: "8/P7/8/8/8/8/8/k5K1 w - - 0 1",
    solution: ["a7a8q"],
  },
};

test("one batch is served puzzle by puzzle", async () => {
  let calls = 0;
  const next = createPuzzleSource(async () => {
    calls += 1;
    return Response.json({ puzzles: [queen, promote] });
  });
  const first = await next("normal");
  const second = await next("normal");
  assert.equal(calls, 1);
  assert.deepEqual([first.id, second.id], ["aaa111", "bbb222"]);
});

test("a rate limit serves the saved list before asking again", async () => {
  let calls = 0;
  const next = createPuzzleSource(async () => {
    calls += 1;
    return new Response("limited", { status: 429 });
  });
  const ids = [];
  for (let index = 0; index < 8; index += 1) ids.push((await next("normal")).id);
  assert.equal(calls, 1);
  assert.equal(new Set(ids).size, 8);
});

test("a failed refill replays fetched puzzles instead of the tiny fallback list", async () => {
  let calls = 0;
  const next = createPuzzleSource(async () => {
    calls += 1;
    if (calls === 1) return Response.json({ puzzles: [queen, promote] });
    return new Response("limited", { status: 429 });
  });
  const ids = [];
  for (let i = 0; i < 6; i += 1) ids.push((await next("normal")).id);
  assert.deepEqual(ids.slice(0, 2), ["aaa111", "bbb222"]);
  assert.equal(ids.every((id) => id === "aaa111" || id === "bbb222"), true);
  assert.equal(new Set(ids).size, 2);
});
