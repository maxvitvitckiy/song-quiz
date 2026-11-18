// Game phases and events (state.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./load.js");

const fresh = () => load(["net.js", "state.js"],
  ["state", "game", "setPhase", "roundOver", "onGameScreen", "canHearMore", "pointsForStep", "unsolved"]);

test("setPhase tells the listeners, with the phase before", () => {
  const { state, game, setPhase } = fresh();
  const seen = [];
  game.on("phase", (phase, before) => seen.push(`${before}→${phase}`));
  setPhase("waiting");
  setPhase("open");
  setPhase("reveal");
  setPhase("end");
  assert.equal(state.phase, "end");
  assert.deepEqual(seen, ["lobby→waiting", "waiting→open", "open→reveal", "reveal→end"]);
});

test("a round is on only while waiting or open", () => {
  const { setPhase, roundOver, onGameScreen } = fresh();
  const on = {};
  for (const p of ["lobby", "waiting", "open", "reveal", "end"]) {
    setPhase(p);
    on[p] = [!roundOver(), onGameScreen()];
  }
  assert.deepEqual(on, {
    lobby: [false, false],
    waiting: [true, true],
    open: [true, true],
    reveal: [false, true],
    end: [false, false],
  });
});

test("shorter clips are worth more, and the longest can't be extended", () => {
  const { state, canHearMore, pointsForStep } = fresh();
  state.steps = [2, 5, 10, 20];
  assert.deepEqual([0, 1, 2, 3].map(pointsForStep), [4, 3, 2, 1]);
  state.step = 2;
  assert.ok(canHearMore());
  state.step = 3;
  assert.ok(!canHearMore());
});

test("unsolved lists the parts nobody got yet", () => {
  const { state, unsolved } = fresh();
  assert.deepEqual(unsolved(), ["title", "artist"]);
  state.solved.title = { by: "Ann", pts: 3 };
  assert.deepEqual(unsolved(), ["artist"]);
});

test("a listener that throws doesn't stop the game", () => {
  const { state, game, setPhase } = fresh();
  const errors = [];
  const original = console.error;
  console.error = (e) => errors.push(e);
  try {
    game.on("phase", () => { throw new Error("boom"); });
    let after = false;
    game.on("phase", () => (after = true));
    setPhase("waiting");
    assert.equal(state.phase, "waiting");
    assert.ok(after, "later listeners still run");
    assert.equal(errors.length, 1);
  } finally {
    console.error = original;
  }
});
